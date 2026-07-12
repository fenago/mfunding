// merchant-invite — send a merchant a passwordless magic-link invite to the
// application portal (mfunding.net/portal). Staff-gated and idempotent.
//
// POST body: { customer_id }
//
// Flow (idempotent — safe to click twice):
//   1. Auth: signed-in staff only (verify_jwt = true + in-code role check).
//      Closers may only invite their OWN customers (closer_owns_customer RPC).
//   2. Load the customer (service role). An email is required.
//   3. If customers.user_id is null: find-or-create the auth user keyed to that
//      email, then stamp customers.user_id.
//   4. Generate a magic link (redirectTo /auth/merchant) and send it via GHL
//      email (lands in Conversations). If the merchant has a phone AND a GHL
//      contact, also fire an SMS (the on-call path). SMS failure is a warning.
//   5. Stamp customers.portal_invited_at + write an activity_log note.
//
// Compliance: MCA = purchase of future receivables, NOT a loan. Invite copy uses
// neutral "funding" / "application" language only — never "loan".

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig, upsertContact, sendEmailToContact,
  sendSmsToContact, latestEmailMessageId,
} from "../_shared/ghl.ts";
import { renderMerchantEmail } from "../_shared/merchantEmail.ts";

const PORTAL_REDIRECT = "https://mfunding.net/auth/merchant";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Find an existing auth user by email (paged; user base is small).
async function findAuthUserByEmail(db: ReturnType<typeof serviceClient>, email: string) {
  const target = email.toLowerCase();
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { customer_id?: string };
  try { payload = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const customerId = payload.customer_id;
  if (!customerId) return json({ error: "customer_id is required" }, 400);

  const db = serviceClient();

  // --- Authn/Authz: signed-in staff only; closers limited to their own. ---
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
  if (callerRole === "closer") {
    const { data: owns } = await db.rpc("closer_owns_customer", { uid: caller.id, cust_id: customerId });
    if (!owns) return json({ error: "Forbidden — this customer isn't assigned to you" }, 403);
  }

  // --- Load the merchant. ---
  const { data: customer, error: cErr } = await db
    .from("customers")
    .select("id, first_name, last_name, business_name, email, phone, ghl_contact_id, user_id")
    .eq("id", customerId).maybeSingle();
  if (cErr || !customer) return json({ error: `customer not found: ${cErr?.message ?? customerId}` }, 404);

  const email = ((customer.email as string | null) ?? "").trim();
  if (!email) return json({ error: "This merchant has no email address on file." }, 422);
  const firstName = (customer.first_name as string | null) ?? "";

  // --- Ensure an auth user exists + is linked to this customer. ---
  let authUserId = (customer.user_id as string | null) ?? null;
  if (!authUserId) {
    const created = await db.auth.admin.createUser({ email, email_confirm: true });
    if (created.data?.user) {
      authUserId = created.data.user.id;
    } else {
      // Most likely already registered — resolve them.
      const existing = await findAuthUserByEmail(db, email);
      if (!existing) {
        return json({ error: `could not create or find auth user: ${created.error?.message ?? "unknown"}` }, 502);
      }
      authUserId = existing.id;
    }
    const { error: linkErr } = await db.from("customers").update({ user_id: authUserId }).eq("id", customerId);
    if (linkErr) return json({ error: `failed to link user_id: ${linkErr.message}` }, 500);
  }

  // --- Generate the magic link. ---
  const linkRes = await db.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: PORTAL_REDIRECT },
  });
  const actionLink = linkRes.data?.properties?.action_link;
  if (linkRes.error || !actionLink) {
    return json({ error: `generateLink failed: ${linkRes.error?.message ?? "no action_link"}` }, 502);
  }

  // --- Send via GHL (email is system of record; SMS is the on-call path). ---
  let cfg: Awaited<ReturnType<typeof getGhlConfig>> | null = null;
  let ghlError: string | undefined;
  try { cfg = await getGhlConfig(db); } catch (e) { ghlError = e instanceof Error ? e.message : String(e); }
  if (!cfg) return json({ error: `GHL not configured: ${ghlError ?? "missing credentials"}` }, 502);

  // Resolve (or create) the merchant's GHL contact.
  let contactId = (customer.ghl_contact_id as string | null) ?? null;
  if (!contactId) {
    const cr = await upsertContact(cfg, {
      email,
      firstName: firstName || undefined,
      lastName: (customer.last_name as string | null) ?? undefined,
      companyName: (customer.business_name as string | null) ?? undefined,
      phone: (customer.phone as string | null) ?? undefined,
      tags: ["merchant"],
      source: "Portal Invite",
    });
    contactId = cr.data?.contact?.id ?? null;
    if (!contactId) return json({ error: `GHL upsert failed: ${cr.error ?? "no contact id"}` }, 502);
    if ((customer.ghl_contact_id ?? null) !== contactId) {
      await db.from("customers").update({ ghl_contact_id: contactId }).eq("id", customerId);
    }
  }

  const subject = "Your MFunding application portal is ready";
  const bodyText =
    `${firstName ? `Hi ${firstName},` : "Hi,"}\n\n` +
    `Your secure MFunding application portal is ready. Tap the link below to log in — ` +
    `no password needed:\n\n${actionLink}\n\n` +
    `Inside, you can upload your documents, track your application in real time, and ` +
    `review your funding options in one place.\n\n` +
    `You never pay us — our funding partners compensate us. Checking your options ` +
    `does not impact your credit; only a formal submission can.\n\n` +
    `— The Momentum Funding team`;
  const html = renderMerchantEmail({
    greeting: firstName ? `Hi ${firstName},` : "Hi,",
    paragraphs: [
      "Your secure MFunding application portal is ready. Tap the button below to log in — no password needed.",
      "Inside, you can upload your documents, track your application in real time, and review your funding options in one place.",
    ],
    ctaLabel: "Open your portal",
    ctaUrl: actionLink,
    footerNote:
      "You never pay us — our funding partners compensate us. Checking your options does not impact your credit; only a formal submission can.",
  });

  let replyMessageId: string | undefined;
  try { replyMessageId = (await latestEmailMessageId(cfg, contactId)) ?? undefined; } catch { /* thread if we can */ }
  const sr = await sendEmailToContact(cfg, contactId, subject, html, { text: bodyText, replyMessageId });
  if (!sr.ok) return json({ error: `GHL email send failed: ${sr.error}` }, 502);

  // Optional SMS (the on-call path) — warning, not failure.
  let smsWarning: string | null = null;
  let smsSent = false;
  const phone = ((customer.phone as string | null) ?? "").trim();
  if (phone) {
    const smsText =
      `MFunding: your secure application portal is ready. Tap to log in (no password): ${actionLink}`;
    const smsRes = await sendSmsToContact(cfg, contactId, smsText);
    if (smsRes.ok) smsSent = true;
    else smsWarning = `SMS not sent: ${smsRes.error ?? "unknown"}`;
  }

  // --- Stamp + audit. ---
  const { error: stampErr } = await db
    .from("customers").update({ portal_invited_at: new Date().toISOString() }).eq("id", customerId);
  if (stampErr) smsWarning = (smsWarning ? smsWarning + "; " : "") + `portal_invited_at not stamped: ${stampErr.message}`;

  await db.from("activity_log").insert({
    entity_type: "customer",
    entity_id: customerId,
    interaction_type: "note",
    subject: "Portal invite sent",
    content: `Portal invite sent to ${email}${smsSent ? " (email + SMS)" : " (email)"}`,
    logged_by: caller.id,
  });

  return json({
    ok: true,
    customer_id: customerId,
    user_id: authUserId,
    to: email,
    email_sent: true,
    sms_sent: smsSent,
    warning: smsWarning,
  });
});
