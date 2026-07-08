// sync-lead-to-ghl — push a lead's edited identity (name / business / email /
// phone) into the merchant's EXISTING GHL contact, so GHL delivery (the MCA 04
// e-sign automation, cover notes, funder-reply notifications) follows the fix.
//
// Called from the playbook's "Edit lead info" (LeadQuickEditModal) AFTER the DB
// writes land. GHL is the delivery system; if the closer corrects a wrong email
// here but GHL keeps the old address, the merchant never gets the application.
//
// CRITICAL — we UPDATE the contact by id, we do NOT upsert-by-email. Upserting by
// a NEW email silently FORKS a second contact (that's the exact bug this heals):
// the deal's opportunity/documents stay on the original contact while comms go to
// the fork. So: resolve the contact from customer.ghl_contact_id (falling back to
// deal.ghl_contact_id) and PUT the changed fields onto THAT record. Only when no
// contact is linked yet do we upsert to bootstrap one.
//
// GHL enforces unique email/phone per location. If the new email already belongs
// to ANOTHER contact, the PUT is rejected — we surface a clear error naming the
// conflicting contact (so the closer can merge in GHL) rather than failing mute.
// A phone-only conflict is non-fatal: we retry without the phone and warn.
//
// POST body: { customerId, dealId? }  — dealId enables the closer-owns-deal check
// and a contact-id fallback.
//
// Auth mirrors send-merchant-email / push-application-to-ghl: signed-in staff
// only (verify_jwt = true + in-code role check); a closer may only sync a deal
// assigned to them.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig, ghlFetch, upsertContact, searchContacts,
} from "../_shared/ghl.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const str = (v: unknown): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const t = String(v).trim();
  return t === "" ? undefined : t;
};

// Parse a GHL "duplicated contact" rejection to learn which field collided and
// which contact holds it. GHL returns e.g.
//   { message, meta: { contactId, matchingField: "email" | "phone" } }
function parseDuplicate(err: string | undefined): { contactId?: string; field?: string } {
  if (!err) return {};
  try {
    const o = JSON.parse(err) as { meta?: { contactId?: string; matchingField?: string } };
    return { contactId: o.meta?.contactId, field: o.meta?.matchingField };
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { customerId?: string; dealId?: string };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const customerId = payload.customerId;
  const dealId = payload.dealId;
  if (!customerId) return json({ error: "customerId is required" }, 400);

  const db = serviceClient();

  // --- Authn/Authz: writes real merchant PII into GHL → signed-in staff only,
  // and a closer may only sync a deal assigned to them. ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);
  const { data: callerProfile } = await db
    .from("profiles").select("role").eq("id", caller.id).single();
  const callerRole = callerProfile?.role as string | undefined;
  if (!callerRole || !["closer", "admin", "super_admin"].includes(callerRole)) {
    return json({ error: "Forbidden — staff only" }, 403);
  }
  if (callerRole === "closer" && dealId) {
    const { data: owns } = await db.rpc("closer_owns_deal", { uid: caller.id, d_id: dealId });
    if (!owns) return json({ error: "Forbidden — this deal isn't assigned to you" }, 403);
  }

  // Load the customer (identity) + the deal (contact-id fallback).
  const { data: customer, error: cErr } = await db
    .from("customers")
    .select("id, first_name, last_name, business_name, email, phone, ghl_contact_id")
    .eq("id", customerId).maybeSingle();
  if (cErr || !customer) return json({ error: `customer not found: ${cErr?.message ?? customerId}` }, 404);

  let dealContactId: string | null = null;
  if (dealId) {
    const { data: deal } = await db
      .from("deals").select("id, ghl_contact_id, customer_id").eq("id", dealId).maybeSingle();
    if (deal && deal.customer_id !== customerId) {
      return json({ error: "deal does not belong to this customer" }, 400);
    }
    dealContactId = (deal?.ghl_contact_id as string | null) ?? null;
  }

  // GHL config from the vault.
  let cfg: Awaited<ReturnType<typeof getGhlConfig>> | null = null;
  let ghlError: string | undefined;
  try { cfg = await getGhlConfig(db); } catch (e) { ghlError = e instanceof Error ? e.message : String(e); }
  if (!cfg) return json({ error: `GHL not configured: ${ghlError ?? "missing credentials"}` }, 502);

  const firstName = str(customer.first_name);
  const lastName = str(customer.last_name);
  const companyName = str(customer.business_name);
  const email = str(customer.email);
  const phone = str(customer.phone);

  const contactId = (customer.ghl_contact_id as string | null) ?? dealContactId ?? null;

  // ── No linked contact yet → bootstrap one by upsert (safe: nothing to fork). ──
  if (!contactId) {
    if (!email && !phone) {
      return json({ error: "This lead has no email or phone yet, so there's nothing to create a GHL contact from." }, 422);
    }
    const cr = await upsertContact(cfg, { email, phone, firstName, lastName, companyName, tags: ["merchant"], source: "Lead edit" });
    const newId = cr.data?.contact?.id ?? null;
    if (!newId) return json({ error: `GHL contact create failed: ${cr.error ?? "no contact id"}` }, 502);
    await db.from("customers").update({ ghl_contact_id: newId }).eq("id", customerId);
    if (dealId) await db.from("deals").update({ ghl_contact_id: newId }).eq("id", dealId);
    return json({ ok: true, contactId: newId, created: true });
  }

  // ── Update the EXISTING contact by id (no upsert → no fork). ──────────────────
  const fullPatch: Record<string, unknown> = {};
  if (firstName !== undefined) fullPatch.firstName = firstName;
  if (lastName !== undefined) fullPatch.lastName = lastName;
  if (companyName !== undefined) fullPatch.companyName = companyName;
  if (email !== undefined) fullPatch.email = email;
  if (phone !== undefined) fullPatch.phone = phone;
  if (Object.keys(fullPatch).length === 0) return json({ ok: true, contactId, updated: false });

  let res = await ghlFetch(cfg, "PUT", `/contacts/${contactId}`, fullPatch);
  if (res.ok) return json({ ok: true, contactId, updated: true });

  // Rejected — figure out why. A duplicate email/phone means another contact
  // already holds that value (GHL enforces uniqueness per location).
  const dup = parseDuplicate(res.error);

  if (dup.field === "email") {
    // Hard stop: the whole point is to move delivery to this new email, and it's
    // taken. Name the conflicting contact so the closer can merge it in GHL.
    let who = dup.contactId ? `contact ${dup.contactId}` : "another contact";
    try {
      if (email) {
        const sr = await searchContacts(cfg, { query: email, pageLimit: 1 });
        const hit = sr.data?.contacts?.[0] as Record<string, unknown> | undefined;
        if (hit) {
          const name = [hit.firstName, hit.lastName].filter(Boolean).join(" ") || (hit.contactName as string) || "";
          who = `contact ${hit.id}${name ? ` (${name})` : ""}`;
        }
      }
    } catch { /* best-effort naming */ }
    return json({
      error: `GHL already has ${who} using ${email}. It enforces one contact per email, so the lead's contact can't be updated to it. Merge the two contacts in GHL (keep this deal's contact ${contactId}), then edit again.`,
      contactId, conflict: "email", conflictContactId: dup.contactId ?? null,
    }, 409);
  }

  if (dup.field === "phone") {
    // Non-fatal: sync everything EXCEPT the phone, and warn. The email (delivery)
    // is what matters; a stale test contact often squats on the phone.
    const { phone: _drop, ...noPhone } = fullPatch;
    if (Object.keys(noPhone).length > 0) {
      res = await ghlFetch(cfg, "PUT", `/contacts/${contactId}`, noPhone);
      if (res.ok) {
        return json({
          ok: true, contactId, updated: true, warning:
            `Synced name/email to GHL, but NOT the phone — ${phone} is already used by ${dup.contactId ? `contact ${dup.contactId}` : "another GHL contact"}.`,
          conflict: "phone",
        });
      }
    }
  }

  return json({ error: `GHL contact update failed: ${res.error}`, contactId }, 502);
});
