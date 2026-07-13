// merchant-login-link — a merchant self-serves a passwordless sign-in link.
//
// POST body: { email }
//
// Anon-callable (verify_jwt = false): it must work for a logged-OUT merchant who
// has no valid link. It NEVER reveals whether an account exists — it always
// returns { ok: true }, so the frontend can only ever say "if that email is on
// file, a link is on its way."
//
// Flow:
//   1. Harden input: cap body size, require a string that looks like an email.
//      Anything off → { ok: true } silently (no enumeration, no error detail).
//   2. Find the customer by email, REGARDLESS of user_id. No customer → { ok: true }
//      (silent).
//   3. PROVISION ON DEMAND: if that customer has no portal account yet (user_id is
//      null), create/find their auth user and stamp customers.user_id right here,
//      then carry on as normal. This is the fix for the old dead end — the portal
//      account used to exist ONLY if a human had clicked "Portal invite", so a
//      merchant working the pipeline could type their email, be told "check your
//      email", and receive nothing, forever, with no way to rescue themselves.
//      Safe by construction: the link is only ever mailed to the address already on
//      the customer record, never to one the caller supplies. See _shared/merchantPortal.ts.
//   4. Throttle: if we already sent this customer a login link < 2 min ago
//      (activity_log 'portal:login-link sent'), skip the send, still return ok.
//   5. Generate a magic link (redirectTo /auth/merchant) and send it via GHL
//      email — the SAME path merchant-invite uses (lands in Conversations).
//   6. Write an activity_log note and return { ok: true }.
//
// Compliance: MCA = purchase of future receivables, NOT a loan. Copy uses neutral
// "funding" / "account" language only — never "loan", no product claims.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig, upsertContact, sendEmailToContact,
  latestEmailMessageId,
} from "../_shared/ghl.ts";
import { renderMerchantEmail } from "../_shared/merchantEmail.ts";
import { ensureMerchantPortalUser, generatePortalMagicLink } from "../_shared/merchantPortal.ts";

const THROTTLE_MS = 2 * 60 * 1000;
const MAX_BODY_BYTES = 4096;
const LOGIN_LINK_SUBJECT = "portal:login-link sent";
// Deliberately permissive — just enough to reject obvious junk before we do work.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Silent to the CALLER, never silent to US.
 *
 * Every bail-out below returns { ok: true } so a stranger can't probe which
 * emails have accounts. But it used to return that with NO trace anywhere, so a
 * merchant would say "the link never arrived" and there was literally nothing to
 * look at — no log, no row, nothing. That is not acceptable for an auth flow.
 *
 * This logs the reason to the edge-function log (server-side only, never in the
 * response body), so the outcome of every attempt is answerable.
 */
function bail(reason: string, email: string) {
  console.warn(JSON.stringify({ fn: "merchant-login-link", outcome: reason, email }));
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // --- Input hardening. Any failure returns ok:true silently (no enumeration). ---
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ ok: true });
  let email = "";
  try {
    const parsed = JSON.parse(raw) as { email?: unknown };
    if (typeof parsed.email === "string") email = parsed.email.trim().toLowerCase();
  } catch { /* fall through to shape check */ }
  if (!email || email.length > 254 || !EMAIL_SHAPE.test(email)) return bail("bad-email-shape", email);

  const db = serviceClient();

  // --- Find the customer by email — CLAIMED OR NOT. ---
  // ilike with no wildcards = case-insensitive exact match.
  // This deliberately does NOT filter on user_id any more. Requiring a claimed
  // portal here was the trap: a merchant in the pipeline whom nobody had clicked
  // "Portal invite" for would fall through to a silent { ok: true } forever.
  const { data: customer } = await db
    .from("customers")
    .select("id, first_name, last_name, business_name, email, phone, ghl_contact_id, user_id")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();
  // Silent success whether or not a match exists — never reveal account state to the
  // caller. Only a genuinely unknown email bails now (typo, or not a merchant).
  if (!customer) return bail("no-customer-for-email", email);

  const customerId = customer.id as string;
  const to = ((customer.email as string | null) ?? email).trim();
  const firstName = (customer.first_name as string | null) ?? "";

  // --- PROVISION ON DEMAND: no portal account yet → create it, right now. ---
  // The merchant asked for a link at their own address; the link can only ever go
  // to the address on their customer record, so standing up the account here lets
  // nobody in who wasn't already entitled. Shared with merchant-invite so the two
  // provisioning paths can never drift.
  const wasUnclaimed = !customer.user_id;
  const ensured = await ensureMerchantPortalUser(db, customer);
  if (!ensured.ok) return bail(`provision-failed:${ensured.error}`, email);
  if (wasUnclaimed) {
    await db.from("activity_log").insert({
      entity_type: "customer",
      entity_id: customerId,
      interaction_type: "note",
      subject: "portal:auto-provisioned",
      content:
        `Portal account created automatically when ${to} requested a sign-in link ` +
        `(no Portal Invite had been sent).`,
    }).then(() => {}, () => {});
  }

  // --- Throttle: skip (but still return ok) if we sent one < 2 minutes ago. ---
  const since = new Date(Date.now() - THROTTLE_MS).toISOString();
  const { data: recent } = await db
    .from("activity_log")
    .select("id")
    .eq("entity_type", "customer")
    .eq("entity_id", customerId)
    .eq("subject", LOGIN_LINK_SUBJECT)
    .gte("created_at", since)
    .limit(1)
    .maybeSingle();
  if (recent) return bail("throttled-link-sent-within-2min", email);

  // --- Generate the magic link (same landing route as merchant-invite). ---
  const linkRes = await generatePortalMagicLink(db, to);
  // Do not leak generateLink failures to the caller — but do NOT swallow them either.
  if (!linkRes.ok) return bail(`generate-link-failed:${linkRes.error}`, email);
  const actionLink = linkRes.actionLink;

  // --- Send via GHL email (system of record; lands in Conversations). ---
  const cfg = await getGhlConfig(db);

  // Resolve (or create) the merchant's GHL contact.
  let contactId = (customer.ghl_contact_id as string | null) ?? null;
  if (!contactId) {
    const cr = await upsertContact(cfg, {
      email: to,
      firstName: firstName || undefined,
      lastName: (customer.last_name as string | null) ?? undefined,
      companyName: (customer.business_name as string | null) ?? undefined,
      phone: (customer.phone as string | null) ?? undefined,
      tags: ["merchant"],
      source: "Portal Login Link",
    });
    contactId = cr.data?.contact?.id ?? null;
    if (!contactId) return bail("ghl-upsert-returned-no-contact-id", email);
    if ((customer.ghl_contact_id ?? null) !== contactId) {
      await db.from("customers").update({ ghl_contact_id: contactId }).eq("id", customerId);
    }
  }

  const subject = "Your MFunding sign-in link";
  const bodyText =
    `${firstName ? `Hi ${firstName},` : "Hi,"}\n\n` +
    `Here is your secure sign-in link for your MFunding account. Tap it to log in — ` +
    `this link signs you in, no password needed:\n\n${actionLink}\n\n` +
    `For your security this link works for a short time. If it expires, just request ` +
    `a new one from the sign-in page.\n\n` +
    `If you didn't ask to sign in, you can ignore this email.\n\n` +
    `— The Momentum Funding team`;
  const html = renderMerchantEmail({
    greeting: firstName ? `Hi ${firstName},` : "Hi,",
    paragraphs: [
      "Here is your secure sign-in link for your MFunding account. Tap the button below to log in — this link signs you in, no password needed.",
    ],
    ctaLabel: "Sign in to my account",
    ctaUrl: actionLink,
    footerNote:
      "For your security this link works for a short time. If it expires, just request a new one from the sign-in page. If you didn't ask to sign in, you can ignore this email.",
  });

  let replyMessageId: string | undefined;
  try { replyMessageId = (await latestEmailMessageId(cfg, contactId)) ?? undefined; } catch { /* thread if we can */ }
  const sr = await sendEmailToContact(cfg, contactId, subject, html, { text: bodyText, replyMessageId });
  // Even on send failure we return ok:true (no enumeration); but only log a
  // throttle marker when the send actually went out.
  if (sr.ok) {
    await db.from("activity_log").insert({
      entity_type: "customer",
      entity_id: customerId,
      interaction_type: "note",
      subject: LOGIN_LINK_SUBJECT,
      content: `Self-serve sign-in link sent to ${to}`,
    });
  }

  return json({ ok: true });
});
