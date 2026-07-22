// push-deal-note — append a human closer note to the deal's GHL contact as a
// contact note. Called from the Revenue Playbook AFTER the note is already saved
// locally (activity_log), so this is a best-effort MIRROR: the note is never lost
// if GHL is down — the caller keeps the local copy and can retry the sync.
//
// POST body: { deal_id, content, subject? }
//
// Auth mirrors sync-deal-product-tags: signed-in staff only (verify_jwt = true +
// an in-code role check), and a closer may only push a note on a deal assigned to
// them. The note body carries the author + the note's context (subject) so the
// GHL record is self-explanatory to anyone reading the contact.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient, getGhlConfig, createContactNote } from "../_shared/ghl.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { deal_id?: string; content?: string; subject?: string };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const dealId = payload.deal_id;
  const content = (payload.content ?? "").trim();
  const subject = (payload.subject ?? "").trim();
  if (!dealId) return json({ error: "deal_id is required" }, 400);
  if (!content) return json({ error: "content is required" }, 400);

  const db = serviceClient();

  // --- Authn/Authz: staff only; a closer may only note a deal assigned to them. ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing authorization" }, 401);
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const caller = userData?.user;
  if (userErr || !caller) return json({ error: "Invalid session" }, 401);
  const { data: callerProfile } = await db
    .from("profiles").select("role, first_name, last_name").eq("id", caller.id).single();
  const callerRole = callerProfile?.role as string | undefined;
  if (!callerRole || !["closer", "admin", "super_admin"].includes(callerRole)) {
    return json({ error: "Forbidden — staff only" }, 403);
  }
  if (callerRole === "closer") {
    const { data: owns } = await db.rpc("closer_owns_deal", { uid: caller.id, d_id: dealId });
    if (!owns) return json({ error: "Forbidden — this deal isn't assigned to you" }, 403);
  }

  // Read the deal → its GHL contact, falling back to the customer's linked contact.
  const { data: deal, error: dErr } = await db
    .from("deals")
    .select("id, ghl_contact_id, customer_id")
    .eq("id", dealId).maybeSingle();
  if (dErr || !deal) return json({ error: `deal not found: ${dErr?.message ?? dealId}` }, 404);

  let contactId = (deal.ghl_contact_id as string | null) ?? null;
  if (!contactId && deal.customer_id) {
    const { data: cust } = await db
      .from("customers").select("ghl_contact_id").eq("id", deal.customer_id).maybeSingle();
    contactId = (cust?.ghl_contact_id as string | null) ?? null;
  }
  // No contact to note yet — NOT an error: the note is already saved locally, and
  // the caller shows a quiet "no GHL contact yet" rather than a failed sync.
  if (!contactId) return json({ ok: true, skipped: "no linked GHL contact" });

  // GHL config from the vault.
  let cfg: Awaited<ReturnType<typeof getGhlConfig>> | null = null;
  let ghlError: string | undefined;
  try { cfg = await getGhlConfig(db); } catch (e) { ghlError = e instanceof Error ? e.message : String(e); }
  if (!cfg) return json({ error: `GHL not configured: ${ghlError ?? "missing credentials"}` }, 502);

  // Compose a self-explanatory note: the closer's words, prefixed with the note's
  // context (unless it's a plain ad-hoc note) and signed with the author.
  const author = `${callerProfile?.first_name ?? ""} ${callerProfile?.last_name ?? ""}`.trim();
  const header = subject && subject !== "closer-note" ? `[${subject}]\n` : "";
  const signature = `\n\n— ${author || "MFunding staff"} · MFunding Playbook`;
  const noteBody = `${header}${content}${signature}`;

  const r = await createContactNote(cfg, contactId, noteBody);
  if (!r.ok) return json({ error: `GHL note failed: ${r.error}`, contactId }, 502);

  return json({ ok: true, contactId, noteId: r.data?.note?.id ?? null });
});
