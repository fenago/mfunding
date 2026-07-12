// send-merchant-email — send ONE email to the merchant on a deal, from the
// closer, through GHL (so it lands in the merchant's existing Conversations
// thread — the system of record for comms). This fires ONLY on an explicit
// closer click in the Funder Responses board; there is NO auto-send anywhere.
//
// POST body: { dealId, subject, body, cc?, bcc? }  (plain-text body; rendered to simple HTML)
//
// Auth mirrors submit-to-funders: signed-in staff only (verify_jwt = true, plus
// an in-code role check). Closers may only email the merchant on their OWN deals.
//
// Compliance: MCA = purchase of future receivables, NOT a loan. The closer writes
// the body in the UI (pre-filled with product-neutral "funding partner" language);
// this function is transport + audit only and adds no product claims of its own.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig, upsertContact, sendEmailToContact, latestEmailMessageId,
  sendMarker,
} from "../_shared/ghl.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { dealId?: string; subject?: string; body?: string; cc?: string[]; bcc?: string[]; regarding?: string | null };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const dealId = payload.dealId;
  const subject = (payload.subject ?? "").trim();
  const bodyText = (payload.body ?? "").trim();
  const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const cc = (payload.cc ?? []).map((e) => String(e).trim()).filter(emailOk).slice(0, 10);
  const bcc = (payload.bcc ?? []).map((e) => String(e).trim()).filter(emailOk).slice(0, 10);
  if (!dealId) return json({ error: "dealId is required" }, 400);
  if (!subject) return json({ error: "subject is required" }, 400);
  if (!bodyText) return json({ error: "body is required" }, 400);

  const db = serviceClient();

  // --- Authn/Authz: emails a real merchant, so caller MUST be signed-in staff.
  // Closers may only email the merchant on their OWN deals. ---
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

  // Load the deal + its merchant.
  const { data: deal, error: dErr } = await db
    .from("deals")
    .select("id, deal_number, customer_id, ghl_contact_id")
    .eq("id", dealId).maybeSingle();
  if (dErr || !deal) return json({ error: `deal not found: ${dErr?.message ?? dealId}` }, 404);

  if (callerRole === "closer") {
    const { data: owns } = await db.rpc("closer_owns_deal", { uid: caller.id, d_id: dealId });
    if (!owns) return json({ error: "Forbidden — this deal isn't assigned to you" }, 403);
  }

  const { data: customer } = await db
    .from("customers")
    .select("id, user_id, first_name, last_name, business_name, email, phone, ghl_contact_id")
    .eq("id", deal.customer_id).maybeSingle();
  if (!customer) return json({ error: "This deal has no merchant on file." }, 404);

  const merchantEmail = (customer.email as string | null) ?? "";
  if (!merchantEmail) return json({ error: "This merchant has no email address on file." }, 422);

  // GHL is the email transport + system of record.
  let cfg: Awaited<ReturnType<typeof getGhlConfig>> | null = null;
  let ghlError: string | undefined;
  try { cfg = await getGhlConfig(db); } catch (e) { ghlError = e instanceof Error ? e.message : String(e); }
  if (!cfg) return json({ error: `GHL not configured: ${ghlError ?? "missing credentials"}` }, 502);

  // Resolve the merchant's GHL contact (create via upsert if missing — same as
  // the submit engine). Persist a newly-created id so later comms reuse it.
  let contactId = (deal.ghl_contact_id as string | null) ?? (customer.ghl_contact_id as string | null) ?? null;
  if (!contactId) {
    const cr = await upsertContact(cfg, {
      email: merchantEmail,
      firstName: (customer.first_name as string | null) ?? undefined,
      lastName: (customer.last_name as string | null) ?? undefined,
      companyName: (customer.business_name as string | null) ?? undefined,
      phone: (customer.phone as string | null) ?? undefined,
      tags: ["merchant"],
      source: "Merchant Message",
    });
    contactId = cr.data?.contact?.id ?? null;
    if (!contactId) return json({ error: `GHL upsert failed: ${cr.error ?? "no contact id"}` }, 502);
    // Cache it on the customer so future sends skip the upsert.
    if ((customer.ghl_contact_id ?? null) !== contactId) {
      await db.from("customers").update({ ghl_contact_id: contactId }).eq("id", customer.id);
    }
  }

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;max-width:600px;white-space:pre-wrap">${esc(bodyText)}</div>`;
  let replyMessageId: string | undefined;
  try { replyMessageId = (await latestEmailMessageId(cfg, contactId)) ?? undefined; } catch { /* thread if we can */ }
  const sr = await sendEmailToContact(cfg, contactId, subject, html, { text: bodyText, emailCc: cc, emailBcc: bcc, replyMessageId });
  if (!sr.ok) return json({ error: `GHL send failed: ${sr.error}` }, 502);

  // Audit trail (best-effort — never fail the send over the log).
  try {
    const routing = [cc.length ? `CC: ${cc.join(", ")}` : "", bcc.length ? `BCC: ${bcc.join(", ")}` : ""]
      .filter(Boolean).join(" · ");
    const re = (payload.regarding ?? "").toString().trim().slice(0, 80);
    const snippet = (re ? `[re: ${re}] ` : "") + (routing ? `[${routing}]\n` : "") + bodyText.slice(0, 500);
    await db.from("activity_log").insert({
      entity_type: "deal",
      entity_id: dealId,
      interaction_type: "email",
      subject: `merchant:email — ${subject}`,
      // Marker lets poll-funder-replies phase 3 stamp [opened:…] on this row later.
      content: snippet + sendMarker(sr.data),
      logged_by: caller.id,
    });
  } catch { /* best-effort */ }

  // In-portal parity (best-effort): if this merchant has claimed a portal
  // profile, also drop a person-to-person messages row so the reply lands in
  // their portal inbox/notification bell — kind + action_path NULL marks it as a
  // human message (not a system notification). If they haven't claimed a portal
  // (user_id null), this is a no-op and behavior is exactly as before.
  let portalMessaged = false;
  const merchantUserId = (customer.user_id as string | null) ?? null;
  if (merchantUserId) {
    try {
      const { error: mErr } = await db.from("messages").insert({
        from_user_id: caller.id,
        to_user_id: merchantUserId,
        subject,
        body: bodyText,
        related_customer_id: customer.id,
        status: "unread",
        // kind + action_path intentionally omitted (NULL) — this is a person message.
      });
      portalMessaged = !mErr;
      if (mErr) console.warn("[send-merchant-email] portal message insert failed:", mErr.message);
    } catch (e) {
      console.warn("[send-merchant-email] portal message insert threw:", e instanceof Error ? e.message : String(e));
    }
  }

  return json({ ok: true, dealId, to: merchantEmail, messageId: sr.data?.messageId ?? null, portalMessaged });
});
