// merchantPortal — the ONE way a merchant gets a portal account.
//
// A merchant can only sign in to my.mfunding.net when customers.user_id points at
// an auth user. Historically the ONLY thing that stamped it was a human clicking
// "Portal invite", so every merchant a closer worked through the Revenue Playbook
// ended up portal-less — and merchant-login-link (the self-serve "email me a
// sign-in link" form) REQUIRED user_id to already be set, so they couldn't rescue
// themselves either. Dead end.
//
// This module owns the find-or-create-auth-user + stamp-customers.user_id logic so
// every caller provisions IDENTICALLY and the paths can never drift:
//   · merchant-invite     — staff clicks "Portal invite"
//   · merchant-login-link — merchant self-serves (PROVISIONS ON DEMAND)
// Any future caller (e.g. an auto-invite when the application docs go out) must
// come through here too.
//
// SECURITY — why provisioning on demand is safe:
// The magic link this produces is ONLY ever emailed to the address already on file
// for that customer row (customers.email), never to an address supplied by the
// caller. So a stranger POSTing someone else's email can, at worst, cause a link to
// be mailed to the real merchant's own inbox — exactly what the merchant would get
// by asking themselves. It grants no access to the requester. The account it
// creates is an ordinary auth user with no profile row and no staff role; RLS still
// scopes it to the customer row whose user_id it is.
//
// Compliance: MCA = purchase of future receivables, NOT a loan. Copy below uses
// neutral "funding" / "application" / "account" language only — never "loan".

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { renderMerchantEmail } from "./merchantEmail.ts";

/** Where a magic link lands. The portal reads the session and routes from there. */
export const PORTAL_REDIRECT = "https://mfunding.net/auth/merchant";

/** Find an existing auth user by email (paged; the user base is small). */
export async function findAuthUserByEmail(db: SupabaseClient, email: string) {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit;
    if (users.length < 200) break;
  }
  return null;
}

export type EnsurePortalUserResult =
  | { ok: true; userId: string; created: boolean }
  | { ok: false; error: string };

/**
 * Make sure this customer HAS a portal account, and that customers.user_id points
 * at it. Idempotent: if user_id is already set this is a no-op.
 *
 * `createUser` may fail because the auth user already exists (the merchant signed
 * up elsewhere, or a prior run created the user but died before stamping user_id),
 * so we always fall back to a lookup by email rather than treating that as fatal.
 */
export async function ensureMerchantPortalUser(
  db: SupabaseClient,
  customer: { id: string; email?: string | null; user_id?: string | null },
): Promise<EnsurePortalUserResult> {
  const existingUserId = (customer.user_id ?? null) as string | null;
  if (existingUserId) return { ok: true, userId: existingUserId, created: false };

  const email = (customer.email ?? "").trim();
  if (!email) return { ok: false, error: "customer has no email on file" };

  let userId: string;
  let created = false;
  const createRes = await db.auth.admin.createUser({ email, email_confirm: true });
  if (createRes.data?.user) {
    userId = createRes.data.user.id;
    created = true;
  } else {
    let existing: Awaited<ReturnType<typeof findAuthUserByEmail>> = null;
    try {
      existing = await findAuthUserByEmail(db, email);
    } catch (e) {
      return { ok: false, error: `auth lookup failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!existing) {
      return { ok: false, error: `could not create or find auth user: ${createRes.error?.message ?? "unknown"}` };
    }
    userId = existing.id;
  }

  const { error: linkErr } = await db.from("customers").update({ user_id: userId }).eq("id", customer.id);
  if (linkErr) return { ok: false, error: `failed to link user_id: ${linkErr.message}` };

  return { ok: true, userId, created };
}

/** Generate a passwordless sign-in link for this email, landing in the portal. */
export async function generatePortalMagicLink(
  db: SupabaseClient,
  email: string,
): Promise<{ ok: true; actionLink: string } | { ok: false; error: string }> {
  const res = await db.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: PORTAL_REDIRECT },
  });
  const actionLink = res.data?.properties?.action_link;
  if (res.error || !actionLink) {
    return { ok: false, error: `generateLink failed: ${res.error?.message ?? "no action_link"}` };
  }
  return { ok: true, actionLink };
}

/**
 * The merchant-facing portal-invite email (subject + text + html), in one place.
 *
 * NOTE: an auto-invite on the docs-send path (push-application-to-ghl) was scoped
 * OUT deliberately — the owner wants to decide the link design first (the merchant
 * already receives a GHL MCA 04 / 04B document email, and two competing links is a
 * product decision, not an implementation detail). When that lands, it should reuse
 * this builder rather than writing new copy.
 */
export function buildPortalEmail(opts: {
  firstName?: string | null;
  actionLink: string;
}): { subject: string; text: string; html: string } {
  const firstName = (opts.firstName ?? "").trim();
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";
  const link = opts.actionLink;

  const footerNote =
    "You never pay us — our funding partners compensate us. Checking your options does not impact your credit; only a formal submission can.";

  const paragraphs = [
    "Your secure MFunding application portal is ready. Tap the button below to log in — no password needed.",
    "Inside, you can upload your documents, track your application in real time, and review your funding options in one place.",
  ];
  return {
    subject: "Your MFunding application portal is ready",
    text:
      `${greeting}\n\n` +
      `Your secure MFunding application portal is ready. Tap the link below to log in — no password needed:\n\n${link}\n\n` +
      `Inside, you can upload your documents, track your application in real time, and review your funding ` +
      `options in one place.\n\n${footerNote}\n\n— The Momentum Funding team`,
    html: renderMerchantEmail({
      greeting,
      paragraphs,
      ctaLabel: "Open your portal",
      ctaUrl: link,
      footerNote,
    }),
  };
}
