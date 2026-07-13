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
import {
  ensureMerchantPortalUser, generatePortalMagicLink, buildPortalEmail,
} from "../_shared/merchantPortal.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
  // Shared with merchant-login-link's provision-on-demand path, so a merchant ends
  // up with the exact same account whether staff invited them or they self-served.
  const ensured = await ensureMerchantPortalUser(db, customer);
  if (!ensured.ok) return json({ error: ensured.error }, 502);
  const authUserId = ensured.userId;

  // --- Generate the magic link. ---
  const linkRes = await generatePortalMagicLink(db, email);
  if (!linkRes.ok) return json({ error: linkRes.error }, 502);
  const actionLink = linkRes.actionLink;

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

  const { subject, text: bodyText, html } = buildPortalEmail({ firstName, actionLink });

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
