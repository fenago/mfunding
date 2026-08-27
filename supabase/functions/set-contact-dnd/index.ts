// set-contact-dnd — the one client-callable path that suppresses a contact.
//
// WHY. A setter on the Revenue Playbook hears "take me off your list" and needs
// to act on it in the same second. Until now the only code that could set DND
// was internal (wavv-disposition-sync's do-not-contact drain, live-transfer-
// intake's sender-robot suppression) — the human on the phone had no button.
// This is that button's backend.
//
// WHAT IT DOES. PUT /contacts/{id} { dnd: true } on the GHL contact. GHL's
// contact-level DND is the DURABLE suppression the dialer actually enforces —
// WAVV/LeadConnector will not place a call or send a text to a DND contact — so
// it is the correct primitive, not a tag. Also mirrors onto the local record
// (customers.do_not_contact + reason) so our own surfaces can see it without a
// GHL round-trip. GHL remains the source of truth for the suppression itself;
// the local column is a mirror, and a mirror-write failure is reported, never
// swallowed (a "DND'd" toast over a silent failure is how people get called
// after asking not to be).
//
// POST body: { ghl_contact_id } or { deal_id } (deal_id resolves to the deal's
// contact, falling back to the customer's linked contact — same resolution
// order as push-deal-note).
//
// Auth mirrors push-deal-note: verify_jwt = true at the gateway PLUS an in-code
// staff-role check. The OPS set is allowed (closer INCLUDED — setters are the
// people who hear the opt-out), and a closer may only DND a deal assigned to
// them. A bare ghl_contact_id with no deal context is admin-only, because
// closer_owns_deal has nothing to check against.
//
// Idempotent: setting dnd on an already-DND contact is a no-op success.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient, getGhlConfig, ghlFetch } from "../_shared/ghl.ts";

const STAFF_ROLES = ["closer", "employee", "admin", "super_admin"];
const ADMIN_ROLES = ["admin", "super_admin"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { ghl_contact_id?: string; deal_id?: string; reason?: string };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const dealId = (payload.deal_id ?? "").trim();
  let contactId = (payload.ghl_contact_id ?? "").trim();
  const reason = (payload.reason ?? "").trim();
  if (!contactId && !dealId) return json({ error: "ghl_contact_id or deal_id is required" }, 400);

  const db = serviceClient();

  // --- Authn/Authz: staff only; a closer may only DND a deal assigned to them. ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);
  const { data: callerProfile } = await db
    .from("profiles").select("role, first_name, last_name").eq("id", caller.id).single();
  const callerRole = callerProfile?.role as string | undefined;
  if (!callerRole || !STAFF_ROLES.includes(callerRole)) {
    return json({ error: "Forbidden — staff only" }, 403);
  }
  const isAdmin = ADMIN_ROLES.includes(callerRole);
  if (!isAdmin) {
    // Non-admin staff must act through a deal, so ownership is checkable.
    if (!dealId) return json({ error: "Forbidden — deal_id required" }, 403);
    if (callerRole === "closer") {
      const { data: owns } = await db.rpc("closer_owns_deal", { uid: caller.id, d_id: dealId });
      if (!owns) return json({ error: "Forbidden — this deal isn't assigned to you" }, 403);
    }
  }

  // Resolve deal → contact + customer (needed for the local mirror either way).
  let customerId: string | null = null;
  if (dealId) {
    const { data: deal, error: dErr } = await db
      .from("deals")
      .select("id, ghl_contact_id, customer_id")
      .eq("id", dealId).maybeSingle();
    if (dErr) return json({ error: `deal lookup failed: ${dErr.message}` }, 502);
    if (!deal) return json({ error: `deal not found: ${dealId}` }, 404);
    customerId = (deal.customer_id as string | null) ?? null;
    if (!contactId) contactId = (deal.ghl_contact_id as string | null) ?? "";
    if (!contactId && customerId) {
      const { data: cust } = await db
        .from("customers").select("ghl_contact_id").eq("id", customerId).maybeSingle();
      contactId = (cust?.ghl_contact_id as string | null) ?? "";
    }
  }
  if (!contactId) {
    // No contact means nothing the dialer can be told about — say so plainly
    // rather than returning a success the caller would render as "suppressed".
    return json({ ok: false, error: "no linked GHL contact on this deal" }, 409);
  }

  // GHL config from the vault.
  let cfg: Awaited<ReturnType<typeof getGhlConfig>> | null = null;
  let cfgError: string | undefined;
  try { cfg = await getGhlConfig(db); } catch (e) { cfgError = e instanceof Error ? e.message : String(e); }
  if (!cfg) return json({ error: `GHL not configured: ${cfgError ?? "missing credentials"}` }, 502);

  const r = await ghlFetch(cfg, "PUT", `/contacts/${contactId}`, { dnd: true });
  if (!r.ok) {
    return json({ ok: false, error: `GHL DND failed (${r.status}): ${r.error ?? "unknown"}` }, 502);
  }

  // Local mirror — best-effort in scope, but its outcome is REPORTED, so a
  // half-applied suppression is visible instead of looking like a clean success.
  let mirrored = false;
  let mirrorError: string | undefined;
  if (!customerId && contactId) {
    const { data: cust } = await db
      .from("customers").select("id").eq("ghl_contact_id", contactId).maybeSingle();
    customerId = (cust?.id as string | null) ?? null;
  }
  if (customerId) {
    const who = `${callerProfile?.first_name ?? ""} ${callerProfile?.last_name ?? ""}`.trim() || caller.email || "staff";
    const { error: mErr } = await db
      .from("customers")
      .update({
        do_not_contact: true,
        do_not_contact_reason: reason || `Added to DND from the Playbook by ${who}`,
      })
      .eq("id", customerId);
    if (mErr) mirrorError = mErr.message; else mirrored = true;
  }

  // Audit trail. entity_type/interaction_type are constrained — 'note' is the
  // only legal type for a system event (see the activity_log check constraints).
  if (customerId) {
    await db.from("activity_log").insert({
      entity_type: "customer",
      entity_id: customerId,
      interaction_type: "note",
      subject: "dnd:added",
      content: reason
        ? `Contact added to DND (do-not-contact) — ${reason}`
        : "Contact added to DND (do-not-contact). GHL/WAVV will no longer call or text this contact.",
      logged_by: caller.id,
    });
  }

  return json({ ok: true, dnd: true, ghl_contact_id: contactId, mirrored, mirror_error: mirrorError });
});
