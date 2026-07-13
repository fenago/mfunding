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
//   2. Find a CLAIMED portal profile: a customer with that email AND user_id set.
//      No match → { ok: true } (silent).
//   3. Throttle: if we already sent this customer a login link < 2 min ago
//      (activity_log 'portal:login-link sent'), skip the send, still return ok.
//   4. Generate a magic link (redirectTo /auth/merchant) and send it via GHL
//      email — the SAME path merchant-invite uses (lands in Conversations).
//   5. Write an activity_log note and return { ok: true }.
//
// Compliance: MCA = purchase of future receivables, NOT a loan. Copy uses neutral
// "funding" / "account" language only — never "loan", no product claims.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig, upsertContact, sendEmailToContact,
  latestEmailMessageId,
} from "../_shared/ghl.ts";
import { renderMerchantEmail } from "../_shared/merchantEmail.ts";

const PORTAL_REDIRECT = "https://mfunding.net/auth/merchant";
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

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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

  // --- Find a CLAIMED portal profile (customer with this email + a linked user). ---
  // ilike with no wildcards = case-insensitive exact match.
  const { data: customer } = await db
    .from("customers")
    .select("id, first_name, last_name, business_name, email, phone, ghl_contact_id, user_id")
    .ilike("email", email)
    .not("user_id", "is", null)
    .limit(1)
    .maybeSingle();
  // Silent success whether or not a match exists — never reveal account state to the
  // caller. But tell OURSELVES which of the two very different things happened:
  //   a) no customer with that email at all (typo, or not a merchant), vs
  //   b) the customer EXISTS but has never claimed their portal (user_id is null) —
  //      that merchant can never sign in until someone sends them a Portal Invite,
  //      and before this they'd have retried forever with zero feedback to anyone.
  if (!customer) {
    const { data: unclaimed } = await db
      .from("customers")
      .select("id, user_id")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    if (unclaimed && !unclaimed.user_id) {
      // Surface it on the merchant's own timeline so a closer actually sees it.
      await db.from("activity_log").insert({
        entity_type: "customer",
        entity_id: unclaimed.id,
        interaction_type: "note",
        subject: "portal:login-blocked (not invited)",
        content:
          "This merchant tried to sign in to the portal but has no portal account yet. " +
          "Send them a Portal Invite — a sign-in link alone can never work for them.",
      }).then(() => {}, () => {});
      return bail("customer-exists-but-portal-not-claimed", email);
    }
    return bail("no-customer-for-email", email);
  }

  const customerId = customer.id as string;
  const to = ((customer.email as string | null) ?? email).trim();
  const firstName = (customer.first_name as string | null) ?? "";

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
  const linkRes = await db.auth.admin.generateLink({
    type: "magiclink",
    email: to,
    options: { redirectTo: PORTAL_REDIRECT },
  });
  const actionLink = linkRes.data?.properties?.action_link;
  // Do not leak generateLink failures to the caller — but do NOT swallow them either.
  if (linkRes.error || !actionLink) {
    return bail(`generate-link-failed:${linkRes.error?.message ?? "no-action-link"}`, email);
  }

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
