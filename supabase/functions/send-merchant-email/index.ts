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
  corsHeaders, serviceClient, getGhlConfig, sendEmailToContact, latestEmailMessageId,
  sendMarker, ensureContactEmail, ghlErrorMessage,
  lastEmailFailure, bounceMessage, recordEmailOutcome, type LastEmailOutcome,
} from "../_shared/ghl.ts";
import { renderMerchantEmail } from "../_shared/merchantEmail.ts";

/** "We didn't look" — used when the failure clearly isn't about the address. */
const NO_OUTCOME: LastEmailOutcome = {
  bounced: false, status: null, error: null, to: null, emailMessageId: null, at: null,
};

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

  // --- PRE-FLIGHT: verify the thing GHL is about to complain about. ---
  // GHL answers a send with 400 "Contact's email is invalid" when the CONTACT it
  // sends to has no usable email — which can be true even though the merchant's
  // email in Supabase is fine (stored ghl_contact_id pointing at a duplicate /
  // emailless / deleted contact). So confirm the target contact carries this
  // email BEFORE sending, and heal it by upserting by email if it doesn't (the
  // same guarantee push-application-to-ghl gets by always upserting by email).
  const linkedId = (deal.ghl_contact_id as string | null) ?? (customer.ghl_contact_id as string | null) ?? null;
  const pre = await ensureContactEmail(cfg, linkedId, merchantEmail, {
    firstName: (customer.first_name as string | null) ?? undefined,
    lastName: (customer.last_name as string | null) ?? undefined,
    companyName: (customer.business_name as string | null) ?? undefined,
    phone: (customer.phone as string | null) ?? undefined,
    tags: ["merchant"],
    source: "Merchant Message",
  });
  const merchantLabel = ((customer.business_name as string | null)
    ?? [customer.first_name, customer.last_name].filter(Boolean).join(" "))
    || "this merchant";
  if (!pre.contactId) {
    return json({
      error:
        `Email to ${merchantLabel} was NOT sent. GHL has no contact that can receive ${merchantEmail}` +
        (linkedId ? ` (this deal is linked to GHL contact ${linkedId})` : "") +
        `. Fix: open the merchant in GHL, put ${merchantEmail} on the contact record (or merge the duplicate), then send again. ` +
        `GHL said: ${pre.error}`,
      contact_id: linkedId, attempted_email: merchantEmail, ghl_error: pre.error,
    }, 502);
  }
  const contactId = pre.contactId;
  if (pre.healed) {
    console.warn("[send-merchant-email] healed GHL contact", JSON.stringify({
      dealId, from: linkedId, to: contactId, email: merchantEmail, previous_contact_email: pre.previousEmail,
    }));
  }
  // Persist whatever contact actually owns this email so later comms reuse it.
  if ((customer.ghl_contact_id ?? null) !== contactId) {
    const { error: cuErr } = await db.from("customers").update({ ghl_contact_id: contactId }).eq("id", customer.id);
    if (cuErr) console.error("[send-merchant-email] customer ghl_contact_id update failed:", cuErr.message);
  }
  if ((deal.ghl_contact_id ?? null) !== contactId) {
    const { error: duErr } = await db.from("deals").update({ ghl_contact_id: contactId }).eq("id", dealId);
    if (duErr) console.error("[send-merchant-email] deal ghl_contact_id update failed:", duErr.message);
  }

  // Wrap the closer's verbatim text in the branded shell. white-space:pre-wrap
  // preserves their line breaks; no auto-signoff (they sign their own message).
  const html = renderMerchantEmail({
    bodyHtml: `<div style="white-space:pre-wrap;font-size:15px;line-height:1.6;color:#0F172A">${esc(bodyText)}</div>`,
    signoff: "",
  });
  let replyMessageId: string | undefined;
  try { replyMessageId = (await latestEmailMessageId(cfg, contactId)) ?? undefined; } catch { /* thread if we can */ }
  const sr = await sendEmailToContact(cfg, contactId, subject, html, { text: bodyText, emailCc: cc, emailBcc: bcc, replyMessageId });
  if (!sr.ok) {
    // ghlFetch already logged the endpoint + payload + full GHL body server-side.
    // What the CLOSER gets must be actionable — and TRUE. GHL's raw "Contact's
    // email is invalid" is a lie about the address's SYNTAX; what it actually
    // means, 99% of the time, is "this address HARD-BOUNCED once, so I've flagged
    // it and I will never send to it again". So don't guess: read the contact's
    // last outbound email RECORD and let its status say which of the two it is.
    const reason = ghlErrorMessage(sr.error);
    const emailIssue = /email is invalid|invalid email/i.test(reason);
    const outcome = emailIssue ? await lastEmailFailure(cfg, contactId) : NO_OUTCOME;
    if (outcome.bounced) await recordEmailOutcome(db, customer.id as string, merchantEmail, outcome);
    return json({
      error:
        `Email to ${merchantLabel} was NOT sent (GHL ${sr.status}). ` +
        (outcome.bounced
          // THE TRUTH: dead mailbox. No amount of GHL contact surgery fixes this —
          // only a new address does. (klbreen3@yahoo.com: "1 Requested mail action
          // aborted, mailbox not found" — a 550 on the very first automated send.)
          ? bounceMessage(merchantEmail, outcome)
          : emailIssue
            // Genuinely no bounce on record → it really is the contact record.
            ? `We sent it to ${merchantEmail} on GHL contact ${contactId}, and GHL rejected the contact's email address, ` +
              `but there is NO bounce on record for it. Open contact ${contactId} in GHL, re-save ${merchantEmail} on it ` +
              `and merge any duplicate contact for this merchant, then click send again.`
            : `Address: ${merchantEmail} · GHL contact: ${contactId}. Retry once; if it fails again, check the contact in GHL.`) +
        ` GHL said: "${reason}". Nothing was delivered — do not tell the merchant it went out.`,
      contact_id: contactId, attempted_email: merchantEmail,
      email_bounced: outcome.bounced,
      bounce_reason: outcome.error,
      ghl_status: sr.status, ghl_error: reason,
    }, 502);
  }

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
