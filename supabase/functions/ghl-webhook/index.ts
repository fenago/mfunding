// ghl-webhook — INBOUND: receive GoHighLevel webhook events and reflect them
// into Supabase. Configure this URL in GHL (Settings → Webhooks, or a workflow
// "Webhook" action) for the events you care about.
//
// Handled event types (GHL `type` field):
//   ContactCreate / ContactUpdate            → upsert customers (match by ghl_contact_id, else email)
//   OpportunityStatusUpdate / OpportunityStageUpdate / OpportunityUpdate
//                                            → update deals (match by ghl_opportunity_id), map stage→status
//   InboundMessage (email reply from a funder contact)
//                                            → stamp deal_submissions.response_at + email an internal alert
//
// Funder-reply detection (feature): when a contact tagged "funder" replies (their
// ghl_contact_id matches a lenders row), we stamp response_at on that funder's most
// recent open submission and send an internal alert email to the owner. See the
// "GHL config for funder replies" note near handleInboundMessage for the workflow
// the user must add if native InboundMessage webhooks aren't enabled.
//
// Auth: GHL cannot send a Supabase JWT, so this function uses verify_jwt = false
// and instead checks a shared secret. Set GHL_WEBHOOK_SECRET in the vault and
// pass it as `?secret=...` (or header `x-ghl-secret`) when registering the webhook.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig, ghlFetch, getContact, upsertContact, sendEmailToContact, addContactTags,
  listBusinesses, createBusiness, linkContactToBusiness,
} from "../_shared/ghl.ts";

// Internal alerts go ONLY here — never to a funder or merchant.
const OWNER_EMAIL = "socrates73@gmail.com";
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// GHL stage name (lowercased) → deal status
const STATUS_BY_STAGE: Record<string, string> = {
  "new lead": "new",
  "contacted": "contacted",
  "qualifying": "qualifying",
  "application sent": "application_sent",
  "docs collected": "docs_collected",
  "bank statements": "bank_statements",
  "submitted to funders": "submitted_to_funder",
  "submitted to funder": "submitted_to_funder",
  "offer received": "offer_received",
  "offer presented": "offer_presented",
  "offer accepted": "offer_accepted",
  "funded": "funded",
  "renewal eligible": "renewal_eligible",
  "nurture / re-engage": "nurture",
};

// Deal status → its stage-timestamp column. Mirrors STATUS_TIMESTAMP_MAP in
// src/services/dealService.ts — when this webhook moves a deal into one of these
// statuses we stamp the matching *_at (only if still null, so a real earlier
// timestamp is never clobbered). Statuses with no timestamp column (VCF stages,
// "new", "renewal_eligible") simply don't stamp.
const STATUS_TIMESTAMP_MAP: Record<string, string> = {
  contacted: "contacted_at",
  qualifying: "qualified_at",
  application_sent: "application_sent_at",
  docs_collected: "docs_collected_at",
  bank_statements: "bank_statements_at",
  submitted_to_funder: "submitted_at",
  offer_received: "offer_received_at",
  offer_presented: "offer_presented_at",
  offer_accepted: "offer_accepted_at",
  funded: "funded_at",
  nurture: "nurture_at",
  declined: "declined_at",
};

// Commission economics — mirrors COMMISSION_DEFAULTS in src/types/commissions.ts.
// Kept in sync by hand (edge functions can't import from src/).
const NEW_DEAL_POINTS = 8;
const RENEWAL_POINTS = 6;
const COMPANY_LEAD_SPLIT = 30;
const SELF_GEN_SPLIT = 65;
const RENEWAL_SPLIT = 30;

// We auto-create deals for opportunities in these two pipelines.
const MCA_PIPELINE_ID = "bG9ZEh4eP9x60E1CyaMx";
const VCF_PIPELINE_ID = "nsmH6jIeVA0SsZMMq4LC";

// Stage id -> deal status (webhooks reliably include pipelineStageId).
const STATUS_BY_STAGE_ID: Record<string, string> = {
  // MCA pipeline
  "d60d563a-9904-423f-9a8e-0d0df0b12976": "new",
  "bc68ac6f-d45d-4d56-b1c8-c10a7ec4fdf7": "contacted",
  "27960f79-0b08-48ac-8fee-f4a9bf7748e3": "qualifying",
  "2071ceb6-b0cf-4700-b57b-f8a3ef4b15bf": "application_sent",
  "c49fa9f8-a155-4d14-a597-2b23fd937b32": "docs_collected",
  "72d926b3-ee88-4ee5-8ca2-ddb7071b2fc5": "bank_statements",
  "47d3f297-bf23-40a3-8e2b-48fa6c04e809": "submitted_to_funder",
  "5881c6a8-a84a-4753-be7f-6b8cd3f7d5be": "offer_received",
  "718d76bc-58c9-4913-a68d-e0345ed0b515": "offer_presented",
  "7e3cfb93-8e6e-428c-be99-9dfc77f300e6": "offer_accepted",
  "69995f02-4f20-41b9-8206-bbaaf7060c10": "funded",
  "bfd0515e-7dfd-4527-8460-1edef442311a": "renewal_eligible",
  "d4c4ce2d-75af-4766-82cf-c3ff56f0137b": "nurture",
  // VCF pipeline
  "625e5afd-94a9-455c-b1bd-d712cad4cb17": "new_distressed",
  "bcdd76ef-f798-4d14-8606-4087edaa6d42": "hardship_consult",
  "a1c7e1c8-2404-4a81-bf70-0bd21837fd33": "positions_analysis",
  "36ccf48f-c0a4-4264-bc42-066803ec6b75": "strategy_proposal",
  "046a711e-2303-4aa1-84e5-c32dac68d72b": "agreement_sent",
  "6ad1513c-08e1-4e60-99c5-7809da5a6d99": "submitted_to_vcf",
  "a46a57f5-b75c-4ae7-8705-98979db4bb53": "restructure_executed",
  "5e684647-324c-4f31-90aa-59d9ca6a596c": "servicing",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Constant-time string equality for secret comparison. Avoids leaking, via
// response-time, how many leading bytes of a guess matched. Returns false for a
// length mismatch but still folds every byte so timing doesn't reveal the length
// of `expected`. An empty `provided` (no secret sent) never matches a non-empty
// expected secret.
function timingSafeEqualStr(provided: string, expected: string): boolean {
  const enc = new TextEncoder();
  const a = enc.encode(provided);
  const b = enc.encode(expected);
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();

  // ── Shared-secret gate (FAIL CLOSED) ───────────────────────────────────────
  // GHL can't send a Supabase JWT, so this endpoint runs verify_jwt=false and
  // authenticates IN CODE via a 64-char shared secret. GHL is configured to send
  // it on every call (workflow "Webhook" action URL `?secret=…`, or an
  // `x-ghl-secret` header). Verified live: unauthenticated requests are rejected
  // and the live pipeline processes, so GHL is provably sending the correct
  // secret today.
  //
  // Delivery note: real inbound traffic is GHL workflow-"Webhook"-action payloads
  // (flat snake_case fields, no native `x-wh-signature`/`webhookId`). GHL's RSA
  // webhook signing only applies to native Marketplace-app webhooks, which this
  // sub-account does NOT use — so the shared secret is the only verification
  // mechanism available for this delivery method, and it is the gate here.
  //
  // Previous versions "failed OPEN": the whole check sat inside a try/catch that,
  // on any get_ghl_config error, fell through and processed the request WITHOUT
  // auth; and when no secret was configured the check was skipped entirely. Both
  // holes are closed below.
  //
  //   * Expected secret resolves from the vault (get_ghl_config) first, then the
  //     GHL_WEBHOOK_SECRET env as a fallback, so a transient DB/RPC error can't
  //     reopen the gate.
  //   * If NO secret can be resolved from either source we return 503 (refuse) —
  //     never process anonymously.
  //   * A missing/empty or mismatched provided secret returns 401.
  //   * Comparison is constant-time (no early-out on the first differing byte).
  {
    let expected = "";
    try {
      const { data: cfg } = await db.rpc("get_ghl_config"); // also confirms DB connectivity
      expected = (cfg?.webhook_secret as string | undefined) ?? "";
    } catch (_e) { /* vault/RPC unavailable — fall back to the env secret below */ }
    if (!expected) expected = Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";

    if (!expected) {
      // Misconfiguration (both vault and env empty). Refuse rather than accept
      // unauthenticated traffic. GHL retries, so a brief window is recoverable.
      await logEvent(db, {}, "auth", "error",
        "no webhook secret configured (vault + GHL_WEBHOOK_SECRET env both empty) — refusing");
      return json({ error: "server auth not configured" }, 503);
    }

    const url = new URL(req.url);
    const provided = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
    if (!timingSafeEqualStr(provided, expected)) return json({ error: "unauthorized" }, 401);
  }

  let evt: Record<string, unknown>;
  try { evt = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  // GHL delivers two shapes:
  //  1) Native event webhooks: { type: "OpportunityCreate", opportunity: {...}, contact: {...} }
  //  2) Workflow "Webhook" action: flat snake_case fields (id, pipeline_id, pipleline_stage,
  //     contact_id, lead_value, first_name, ...) with our key/value pairs nested under `customData`.
  // Support both. Prefer an explicit type; otherwise infer from the payload shape.
  const cd = (evt.customData ?? {}) as Record<string, unknown>;
  const type = String(evt.type ?? evt.eventType ?? cd.type ?? "");
  const looksLikeOpportunity = !!(evt.pipeline_id || evt.opportunity_name || evt.opportunity || cd.opportunityId);
  const looksLikeContact = !!(evt.contact_id || evt.contactId || evt.contact);
  // Inbound message: native webhook (type "InboundMessage") or a "Customer Replied"
  // workflow that posts a flat payload marking it (customData.type / messageType).
  const messageType = String(evt.messageType ?? evt.message_type ?? cd.messageType ?? cd.message_type ?? "");
  const direction = String(evt.direction ?? cd.direction ?? "").toLowerCase();
  const looksLikeMessage = !!(evt.conversationId || cd.conversationId || messageType || evt.body || cd.message_body);
  const isInboundMessage =
    type.startsWith("InboundMessage") ||
    String(cd.type ?? "").startsWith("InboundMessage") ||
    (!type && looksLikeMessage && direction !== "outbound") ||
    // Channel-typed inbound SMS/Call/Voicemail from a workflow payload that sets
    // a messageType but no InboundMessage type (guarded by direction so we never
    // pick up outbound). handleInboundMessage decides what to do per channel.
    (/(sms|text|call|voice)/i.test(messageType) && direction !== "outbound");
  // Email OPEN: a GHL "Email Events → Opened" workflow posts a webhook with
  // customData.type = "EmailOpened" (or a native LCEmailStats event=opened).
  const isEmailOpen =
    type === "EmailOpened" || type === "LCEmailStats" ||
    String(cd.type ?? "").toLowerCase() === "emailopened" ||
    String(evt.event ?? cd.event ?? cd.email_event ?? "").toLowerCase() === "opened";
  try {
    if (isEmailOpen) {
      const r = await handleEmailOpen(db, evt);
      await logEvent(db, evt, type || "EmailOpened", r.outcome, r.detail);
      return json({ ok: true, type: type || "EmailOpened", ...r.result });
    } else if (isInboundMessage) {
      const r = await handleInboundMessage(db, evt);
      await logEvent(db, evt, type || "InboundMessage", r.outcome, r.detail);
      return json({ ok: true, type: type || "InboundMessage", ...r.result });
    } else if (type.startsWith("Opportunity") || (!type && looksLikeOpportunity)) {
      await handleOpportunity(db, evt);
    } else if (type.startsWith("Contact") || (!type && looksLikeContact)) {
      await handleContact(db, evt);
    } else {
      // Acknowledge unhandled events so GHL doesn't retry forever.
      await logEvent(db, evt, type, "ignored", "unhandled event type");
      return json({ ok: true, ignored: type || "unknown" });
    }
    await logEvent(db, evt, type, "processed", null);
    return json({ ok: true, type });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    await logEvent(db, evt, type, "error", msg);
    return json({ ok: false, type, error: msg }, 500);
  }
});

// Best-effort inbound event log (observability for Gap A/B). Never throws.
async function logEvent(db: DB, evt: Record<string, unknown>, type: string, outcome: string, detail: string | null) {
  try {
    const c = (evt.contact ?? {}) as Record<string, unknown>;
    const o = (evt.opportunity ?? {}) as Record<string, unknown>;
    const cd = (evt.customData ?? {}) as Record<string, unknown>;
    await db.from("ghl_webhook_events").insert({
      event_type: type || null,
      ghl_contact_id: (c.id ?? evt.contactId ?? evt.contact_id ?? cd.contactId ?? o.contactId ?? null) as string | null,
      ghl_opportunity_id: (o.id ?? evt.opportunityId ?? cd.opportunityId ?? (evt.pipeline_id ? evt.id : null) ?? null) as string | null,
      outcome,
      detail,
      payload: evt,
    });
  } catch { /* best-effort */ }
}

type DB = ReturnType<typeof serviceClient>;

interface InboundResult {
  outcome: "processed" | "ignored" | "error";
  detail: string;
  result: Record<string, unknown>;
}

// ── Funder email OPEN → stamp submission.opened_at (time-to-open metric) ─────
// The funder's GHL contactId maps to a lender (ghl_contact_id). We stamp that
// funder's most recent still-unopened submission as opened (first open), and
// bump open_count on repeats. Matching is by funder + recency (no message-id
// plumbing needed) — enough for "how fast do they read our submissions".
async function handleEmailOpen(db: DB, evt: Record<string, unknown>): Promise<InboundResult> {
  const cd = (evt.customData ?? {}) as Record<string, unknown>;
  const c = (evt.contact ?? {}) as Record<string, unknown>;
  const contactId = String(c.id ?? evt.contactId ?? evt.contact_id ?? cd.contactId ?? cd.contact_id ?? "");
  if (!contactId) return { outcome: "ignored", detail: "email-open: no contactId", result: {} };

  const { data: lender } = await db.from("lenders").select("id, company_name").eq("ghl_contact_id", contactId).maybeSingle();
  if (!lender) return { outcome: "ignored", detail: `email-open: no lender for contact ${contactId}`, result: {} };

  // Prefer the most recent still-unopened sent submission; else the most recent sent one.
  let sub: { id: string; opened_at: string | null; open_count: number | null } | null = null;
  const un = await db.from("deal_submissions").select("id, opened_at, open_count")
    .eq("lender_id", lender.id).not("submitted_at", "is", null).is("opened_at", null)
    .order("submitted_at", { ascending: false }).limit(1).maybeSingle();
  sub = (un.data as typeof sub) ?? null;
  if (!sub) {
    const any = await db.from("deal_submissions").select("id, opened_at, open_count")
      .eq("lender_id", lender.id).not("submitted_at", "is", null)
      .order("submitted_at", { ascending: false }).limit(1).maybeSingle();
    sub = (any.data as typeof sub) ?? null;
  }
  if (!sub) return { outcome: "ignored", detail: `email-open: no sent submission for ${lender.company_name}`, result: {} };

  const patch: Record<string, unknown> = { open_count: (Number(sub.open_count) || 0) + 1 };
  const firstOpen = !sub.opened_at;
  if (firstOpen) patch.opened_at = new Date().toISOString();
  await db.from("deal_submissions").update(patch).eq("id", sub.id);
  return {
    outcome: "processed",
    detail: `email-open: ${lender.company_name} submission ${sub.id} (${firstOpen ? "first open" : "repeat"})`,
    result: { lender: lender.company_name, submissionId: sub.id, firstOpen },
  };
}

// ── Funder reply → stamp submission + alert the owner ────────────────────────
//
// GHL config for funder replies:
//   If native "InboundMessage" webhooks are enabled on the sub-account (Settings →
//   Webhooks, or a Marketplace app subscription), nothing else is needed — they
//   POST here with { type:"InboundMessage", contactId, conversationId, body,
//   messageType }. Otherwise add a Workflow:
//     Trigger:  "Customer Replied"  (Channel = Email)
//     Action:   "Webhook" → POST to this function's URL (?secret=<GHL_WEBHOOK_SECRET>)
//               with Custom Data: type=InboundMessage, contactId={{contact.id}},
//               messageType=Email, conversationId={{message.conversationId}},
//               message_body={{message.body}}
//   Either shape resolves the sending contact → lenders.ghl_contact_id.
// Generic mailbox providers / system senders that are never a funder's own domain.
const NON_FUNDER_DOMAIN = /(gmail|yahoo|outlook|hotmail|aol|icloud|docusign|hellosign|pandadoc|boldsign|signnow|dropboxsign|leadconnector)\./;
const OWN_DOMAIN = /(^|\.)(mfunding\.net|send\.mfunding\.net|mfunding\.com)$/;

// Our own numbers (GHL location number, etc.) — never link these to a funder.
const OWN_PHONES = new Set(["9547375692"]);

// Normalize any phone string to 10 US digits (strip non-digits, drop a leading
// country "1"). Returns null if it isn't a plausible 10-digit US number.
function normPhone(raw?: string | null): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d : null;
}

// Common stored formats for a 10-digit number, so an exact-match customers
// lookup catches the merchant regardless of how their phone was saved.
function phoneVariants(p: string): string[] {
  const a = p.slice(0, 3), b = p.slice(3, 6), c = p.slice(6);
  return [
    p, `1${p}`, `+1${p}`, `+1 ${p}`,
    `(${a}) ${b}-${c}`, `${a}-${b}-${c}`, `${a}.${b}.${c}`, `${a} ${b} ${c}`,
    `+1 (${a}) ${b}-${c}`, `+1${a}${b}${c}`, `1 (${a}) ${b}-${c}`, `+1 ${a}-${b}-${c}`,
  ];
}

// Best-effort: ensure the lender has a GHL Business and that the GHL contact we
// just tied to it is linked UNDER that business (mirrors funder-reply-reconcile's
// syncLenderContactsToGhl for the single contact). Reuse ghl_business_id, else
// find a business whose name equals company_name, else create it; cache the id
// back. Never throws — a failure here must not break inbound message handling.
async function ensureContactInLenderBusiness(db: DB, lenderId: string, contactId: string) {
  if (!lenderId || !contactId) return;
  try {
    const cfg = await getGhlConfig(db);
    const { data: l } = await db.from("lenders")
      .select("company_name, website, ghl_business_id").eq("id", lenderId).maybeSingle();
    if (!l) return;
    const row = l as Record<string, unknown>;
    const companyName = String(row.company_name ?? "").trim();
    const website = (row.website ?? null) as string | null;
    let businessId = String(row.ghl_business_id ?? "").trim();
    if (!businessId) {
      const want = companyName.toLowerCase();
      if (want) {
        const list = await listBusinesses(cfg);
        const found = (list.data?.businesses ?? []).find(
          (b) => String(b.name ?? "").trim().toLowerCase() === want,
        );
        businessId = found?.id ?? "";
        if (!businessId) {
          const created = await createBusiness(cfg, { name: companyName, website });
          businessId = created.data?.business?.id ?? "";
        }
      }
      if (businessId) await db.from("lenders").update({ ghl_business_id: businessId }).eq("id", lenderId);
    }
    if (!businessId) return;
    if (companyName) await ghlFetch(cfg, "PUT", `/contacts/${contactId}`, { companyName });
    await linkContactToBusiness(cfg, contactId, businessId);
  } catch { /* best-effort */ }
}

// Real-time reconciler hook: given an inbound sender's contactId (and, when we
// can get it, their email), match the sender's email DOMAIN to a lender. If that
// lender isn't linked to a GHL contact yet, LINK it (set ghl_contact_id) and
// append the contact — so THIS and every future reply from the funder auto-
// associates via the eq(ghl_contact_id) lookup. Best-effort/guarded: any failure
// returns null and the caller falls back to its existing behavior. Returns the
// resolved lender (linked or already-matching) or null.
async function linkFunderByDomain(
  db: DB, contactId: string, emailHint: string,
): Promise<{ id: string; company_name: string } | null> {
  let email = emailHint.trim().toLowerCase();
  let name = "";
  let phone = "";
  try {
    const cfg = await getGhlConfig(db);
    if (!email) {
      const c = await getContact(cfg, contactId);
      const ct = (c.data?.contact ?? {}) as Record<string, unknown>;
      email = String(ct.email ?? "").trim().toLowerCase();
      name = [ct.firstName, ct.lastName].filter(Boolean).join(" ").trim();
      phone = String(ct.phone ?? "").trim();
    }
  } catch { /* couldn't load the contact — give up quietly */ }
  if (!email || !email.includes("@")) return null;
  const domain = email.split("@")[1]?.trim().toLowerCase() ?? "";
  if (!domain || !domain.includes(".") || NON_FUNDER_DOMAIN.test(domain) || OWN_DOMAIN.test(domain)) return null;

  const domOf = (s?: string | null) => {
    if (!s) return null;
    if (s.includes("@")) return s.split("@")[1].trim().toLowerCase();
    return s.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0].toLowerCase() || null;
  };
  const { data: lenders } = await db.from("lenders")
    .select("id, company_name, ghl_contact_id, contacts, website, submission_email, primary_contact_email, primary_contact_name, primary_contact_phone");
  const lender = (lenders ?? []).find((l: Record<string, unknown>) =>
    [l.website, l.submission_email, l.primary_contact_email].some((x) => domOf(x as string) === domain));
  if (!lender) return null;

  // Only mutate when not yet linked (freshest-wins-only-if-empty for primary_*).
  if (!lender.ghl_contact_id && contactId) {
    const patch: Record<string, unknown> = { ghl_contact_id: contactId };
    const arr = Array.isArray(lender.contacts) ? (lender.contacts as Array<Record<string, unknown>>) : [];
    const exists = arr.some((c) => String(c.email ?? "").toLowerCase() === email);
    if (!exists) {
      arr.push({
        name: name || null, title: null, email, phone: phone || null,
        source: "email_reply", ghl_contact_id: contactId, added_at: new Date().toISOString(),
      });
      patch.contacts = arr;
    }
    if (!lender.primary_contact_email) patch.primary_contact_email = email;
    if (!lender.primary_contact_name && name) patch.primary_contact_name = name;
    if (!lender.primary_contact_phone && phone) patch.primary_contact_phone = phone;
    await db.from("lenders").update(patch).eq("id", lender.id as string);
    await log(db, "lender", lender.id as string, "ghl:funder-linked",
      { via: "inbound-domain-match", email, contactId });
    // Also link this contact under the funder's GHL Business (best-effort).
    await ensureContactInLenderBusiness(db, lender.id as string, contactId);
  }
  return { id: lender.id as string, company_name: lender.company_name as string };
}

// Real-time reconciler hook (phone twin of linkFunderByDomain): an inbound CALL
// or TEXT arrived from a contact we've never linked to a funder. Match the
// caller/sender PHONE against every lender's phones (primary_contact_phone +
// contacts[].phone + contacts[].text_phone). On a unique match, LINK the lender
// (set ghl_contact_id) and append a phone-sourced contact — so this and every
// future call/text from that number auto-associates. Best-effort/guarded: any
// failure returns null and the caller falls back to its existing behavior.
// Returns the resolved lender (linked or already-matching) or null.
async function linkFunderByPhone(
  db: DB, contactId: string, phoneHint: string, source: string,
): Promise<{ id: string; company_name: string } | null> {
  let phone = normPhone(phoneHint);
  let name = "";
  try {
    if (!phone && contactId) {
      const cfg = await getGhlConfig(db);
      const c = await getContact(cfg, contactId);
      const ct = (c.data?.contact ?? {}) as Record<string, unknown>;
      phone = normPhone(String(ct.phone ?? ""));
      name = [ct.firstName, ct.lastName].filter(Boolean).join(" ").trim();
    }
  } catch { /* couldn't load the contact — give up quietly */ }
  if (!phone) return null;
  if (OWN_PHONES.has(phone)) return null;

  // Never link a number that belongs to a merchant.
  const { data: merchant } = await db.from("customers")
    .select("id").in("phone", phoneVariants(phone)).limit(1).maybeSingle();
  if (merchant) return null;

  // Build a phone → {lender ids} map from all lenders' phones.
  const { data: lenders } = await db.from("lenders")
    .select("id, company_name, ghl_contact_id, contacts, primary_contact_phone, primary_contact_name");
  const byPhone = new Map<string, Set<string>>();
  const byId = new Map<string, Record<string, unknown>>();
  for (const l of (lenders ?? []) as Array<Record<string, unknown>>) {
    byId.set(l.id as string, l);
    const nums: Array<string | null | undefined> = [l.primary_contact_phone as string];
    const arr = Array.isArray(l.contacts) ? (l.contacts as Array<Record<string, unknown>>) : [];
    for (const c of arr) { nums.push(c.phone as string); nums.push(c.text_phone as string); }
    for (const raw of nums) {
      const n = normPhone(raw);
      if (!n) continue;
      if (!byPhone.has(n)) byPhone.set(n, new Set());
      byPhone.get(n)!.add(l.id as string);
    }
  }

  const matches = byPhone.get(phone);
  if (!matches || matches.size === 0) return null;
  // Shared line (a toll-free answering service, or a duplicated number) → don't
  // guess. A number unique to one lender is fine, even when it's toll-free.
  if (matches.size > 1) return null;
  const lender = byId.get([...matches][0])!;

  // Mirror linkFunderByDomain: only mutate when not yet linked to a GHL contact.
  if (!lender.ghl_contact_id && contactId) {
    const patch: Record<string, unknown> = { ghl_contact_id: contactId };
    const arr = Array.isArray(lender.contacts) ? (lender.contacts as Array<Record<string, unknown>>) : [];
    const exists = arr.some((c) =>
      normPhone(c.phone as string) === phone || normPhone(c.text_phone as string) === phone);
    if (!exists) {
      arr.push({
        name: name || null, title: null, email: null, phone,
        source: "phone_match", ghl_contact_id: contactId, added_at: new Date().toISOString(),
      });
      patch.contacts = arr;
    }
    if (!lender.primary_contact_phone) patch.primary_contact_phone = phone;
    if (!lender.primary_contact_name && name) patch.primary_contact_name = name;
    await db.from("lenders").update(patch).eq("id", lender.id as string);
    await log(db, "lender", lender.id as string, "ghl:funder-linked",
      { via: `inbound-phone-match:${source}`, phone, contactId });
    // Also link this contact under the funder's GHL Business (best-effort).
    await ensureContactInLenderBusiness(db, lender.id as string, contactId);
  }
  return { id: lender.id as string, company_name: lender.company_name as string };
}

async function handleInboundMessage(db: DB, evt: Record<string, unknown>): Promise<InboundResult> {
  const cd = (evt.customData ?? {}) as Record<string, unknown>;
  const contact = (evt.contact ?? {}) as Record<string, unknown>;
  const contactId = String(
    evt.contactId ?? evt.contact_id ?? cd.contactId ?? cd.contact_id ?? contact.id ?? "",
  );
  const messageType = String(evt.messageType ?? evt.message_type ?? cd.messageType ?? cd.message_type ?? "");
  const conversationId = String(evt.conversationId ?? cd.conversationId ?? cd.conversation_id ?? "");
  const body = String(evt.body ?? evt.message ?? cd.message_body ?? cd.body ?? "");

  if (!contactId) return { outcome: "ignored", detail: "inbound message without contact id", result: { handled: false } };

  // Funders were emailed, so only email replies drive submission stamping. Skip
  // clearly non-email channels; still process when the type is unknown (workflow
  // may omit it). But an inbound CALL or TEXT from a funder still lets us tie
  // that funder to this GHL contact by phone number (best-effort, guarded).
  if (messageType && !/email/i.test(messageType)) {
    if (/sms|text|call|voice/i.test(messageType)) {
      try {
        // Only when this contact isn't already linked to any funder.
        const { data: alreadyLinked } = await db.from("lenders")
          .select("id").eq("ghl_contact_id", contactId).maybeSingle();
        if (!alreadyLinked) {
          const phoneHint = String(
            evt.phone ?? contact.phone ?? cd.phone ?? cd.from ?? evt.from ??
            evt.fromNumber ?? cd.fromNumber ?? evt.callerId ?? cd.callerId ?? "",
          );
          const linked = await linkFunderByPhone(db, contactId, phoneHint, messageType);
          if (linked) {
            return {
              outcome: "processed",
              detail: `inbound ${messageType} tied funder ${linked.company_name} to contact ${contactId} by phone`,
              result: { handled: true, lender: linked.company_name, linkedBy: "phone", channel: messageType },
            };
          }
        }
      } catch { /* guarded — fall through to the ignore below */ }
    }
    return { outcome: "ignored", detail: `inbound ${messageType} — not an email reply`, result: { handled: false } };
  }

  // Does this contact map to a funder? First by the linked GHL contact id.
  let lender: { id: string; company_name: string } | null = null;
  const { data: linkedLender } = await db.from("lenders")
    .select("id, company_name").eq("ghl_contact_id", contactId).maybeSingle();
  lender = linkedLender;
  // Fallback (real-time reconciler): the funder replied from an address we've
  // never linked. Match by the sender's email DOMAIN and LINK the lender so this
  // and every future reply auto-associates. Best-effort — never throws.
  if (!lender) {
    const emailHint = String(
      (evt.contact as Record<string, unknown> | undefined)?.email ??
      cd.email ?? cd.from ?? evt.email ?? evt.from ?? "",
    );
    try { lender = await linkFunderByDomain(db, contactId, emailHint); } catch { /* guarded */ }
  }
  if (!lender) {
    return { outcome: "ignored", detail: "inbound message not from a funder contact", result: { handled: false } };
  }

  // Most recent submission to this funder that is out and not yet answered. The
  // reply doesn't say which deal, so stamp the latest open one. Because we only
  // stamp when response_at IS NULL, a webhook retry (or a second reply) is a
  // no-op — no duplicate alerts.
  const { data: sub } = await db.from("deal_submissions")
    .select("id, deal_id")
    .eq("lender_id", lender.id)
    .not("submitted_at", "is", null)
    .is("response_at", null)
    .order("submitted_at", { ascending: false })
    .limit(1).maybeSingle();
  if (!sub) {
    return {
      outcome: "processed",
      detail: `${lender.company_name} replied but no open submission to stamp`,
      result: { handled: true, lender: lender.company_name, stamped: false },
    };
  }

  // Echo guard: a connected inbox can loop our own CC copy back as "inbound".
  // If the body starts with our sent payload, it's us — not the funder.
  const { data: subPayload } = await db.from("deal_submissions")
    .select("sent_payload").eq("id", sub.id).maybeSingle();
  const sentBody = String((subPayload?.sent_payload as Record<string, unknown> | null)?.body ?? "");
  const normEcho = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, 160);
  const bodyN = normEcho(body); const sentN = normEcho(sentBody);
  if (sentN && bodyN && (bodyN.startsWith(sentN.slice(0, 120)) || sentN.startsWith(bodyN.slice(0, 120)))) {
    return {
      outcome: "ignored",
      detail: `echo of our own submission to ${lender.company_name} — not a reply`,
      result: { handled: false },
    };
  }

  const now = new Date().toISOString();
  await db.from("deal_submissions").update({ response_at: now }).eq("id", sub.id);

  // Deal context for the alert.
  const { data: deal } = await db.from("deals")
    .select("deal_number, customer_id").eq("id", sub.deal_id).maybeSingle();
  const dealNumber = (deal?.deal_number as string) || String(sub.deal_id);
  let business = "";
  if (deal?.customer_id) {
    const { data: cust } = await db.from("customers").select("business_name").eq("id", deal.customer_id).maybeSingle();
    business = (cust?.business_name as string) || "";
  }

  const snippet = body ? body.replace(/\s+/g, " ").slice(0, 300) : "";
  await log(db, "deal", sub.deal_id, "ghl:funder-reply", {
    lender: lender.company_name, submissionId: sub.id, conversationId, snippet,
  });

  // Internal alert — owner ONLY, never the funder or merchant.
  let alerted = false;
  let alertError: string | undefined;
  try {
    const cfg = await getGhlConfig(db);
    const owner = await upsertContact(cfg, {
      email: OWNER_EMAIL, firstName: "Momentum", lastName: "Funding",
      tags: ["staff"], source: "Funder Reply Alert",
    });
    const ownerContactId = owner.data?.contact?.id;
    if (!ownerContactId) {
      alertError = `owner contact upsert failed: ${owner.error ?? "no id"}`;
    } else {
      const subject = `Funder replied: ${lender.company_name} on ${dealNumber}`;
      const line = business
        ? `${lender.company_name} replied on ${dealNumber} (${business}).`
        : `${lender.company_name} replied on ${dealNumber}.`;
      const text = `${line}\n\nOpen GHL → Conversations to read the full reply and respond.` +
        (snippet ? `\n\nPreview: ${snippet}` : "");
      const html =
        `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;max-width:600px">` +
        `<p>${esc(line)}</p>` +
        `<p>Open <strong>GHL → Conversations</strong> to read the full reply and respond.</p>` +
        (snippet
          ? `<blockquote style="border-left:3px solid #cbd5e1;margin:8px 0;padding:4px 12px;color:#334155;white-space:pre-wrap">${esc(snippet)}</blockquote>`
          : "") +
        `</div>`;
      const sr = await sendEmailToContact(cfg, ownerContactId, subject, html, { text });
      alerted = sr.ok;
      if (!sr.ok) alertError = `alert send failed: ${sr.error}`;
    }
  } catch (e) {
    alertError = e instanceof Error ? e.message : String(e);
  }

  return {
    outcome: "processed",
    detail: `${lender.company_name} reply stamped on ${dealNumber}; alert ${alerted ? "sent" : `not sent (${alertError ?? "unknown"})`}`,
    result: { handled: true, lender: lender.company_name, dealNumber, submissionId: sub.id, stamped: true, alerted },
  };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

// If a contact's email is on a KNOWN funder's domain, tag it (`funder` + the
// company slug) so the unified inbox groups by company at scale, and signal the
// caller to SKIP merchant-customer creation — funder reps aren't leads.
async function tagFunderContact(db: DB, contactId: string, email: string): Promise<boolean> {
  const domain = (email.split("@")[1] ?? "").trim().toLowerCase();
  if (!domain || !domain.includes(".") ||
    /(gmail|yahoo|outlook|hotmail|aol|icloud|docusign|hellosign)\./.test(domain)) return false;
  const domOf = (s?: string | null) => {
    if (!s) return null;
    if (s.includes("@")) return s.split("@")[1].trim().toLowerCase();
    return s.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0].toLowerCase() || null;
  };
  const { data: lenders } = await db.from("lenders")
    .select("id, company_name, ghl_tag_slug, website, submission_email, primary_contact_email");
  const lender = (lenders ?? []).find((l: Record<string, unknown>) =>
    [l.website, l.submission_email, l.primary_contact_email].some((x) => domOf(x as string) === domain));
  if (!lender) return false;
  const slug = (lender.ghl_tag_slug as string) || slugify(String(lender.company_name));
  if (!lender.ghl_tag_slug) await db.from("lenders").update({ ghl_tag_slug: slug }).eq("id", lender.id as string);
  if (contactId) {
    try {
      const cfg = await getGhlConfig(db);
      await addContactTags(cfg, contactId, ["funder", slug]);
    } catch { /* tagging is best-effort */ }
  }
  return true;
}

async function handleContact(db: DB, evt: Record<string, unknown>) {
  const c = (evt.contact ?? evt) as Record<string, unknown>;
  const cd = (evt.customData ?? {}) as Record<string, unknown>;
  // Contact id: native (contact.id / contactId) or flat workflow payload (contact_id / customData.contactId).
  const ghlId = String(evt.contactId ?? cd.contactId ?? evt.contact_id ?? c.id ?? "");
  const email = (c.email ?? evt.email ?? null) as string | null;
  if (!ghlId && !email) return;

  // Funder rep? Tag by company for the unified inbox and DON'T create a lead.
  if (email) {
    const isFunder = await tagFunderContact(db, ghlId, email);
    if (isFunder) { await logEvent(db, evt, String(evt.type), "funder_contact_tagged", email); return; }
  }

  const patch = {
    first_name: (c.firstName ?? evt.first_name ?? undefined) as string | undefined,
    last_name: (c.lastName ?? evt.last_name ?? undefined) as string | undefined,
    email: email ?? undefined,
    phone: (c.phone ?? evt.phone ?? undefined) as string | undefined,
    business_name: (c.companyName ?? evt.company_name ?? undefined) as string | undefined,
    ghl_contact_id: ghlId || undefined,
  };

  // Match existing customer by ghl_contact_id, then email.
  let existing: { id: string } | null = null;
  if (ghlId) {
    const { data } = await db.from("customers").select("id").eq("ghl_contact_id", ghlId).maybeSingle();
    existing = data;
  }
  if (!existing && email) {
    const { data } = await db.from("customers").select("id").eq("email", email).maybeSingle();
    existing = data;
  }

  let custId: string | null = null;
  if (existing) {
    await db.from("customers").update(patch).eq("id", existing.id);
    await log(db, "customer", existing.id, `ghl:${String(evt.type)}`, evt);
    custId = existing.id;
  } else {
    const { data: created } = await db.from("customers")
      .insert({ ...patch, status: "lead", source: "other" }).select("id").maybeSingle();
    if (created) { await log(db, "customer", created.id, `ghl:${String(evt.type)}`, evt); custId = created.id; }
  }

  // Pull any intake-form file uploads (GHL file-upload custom fields) into the
  // customer's Documents. Best-effort — never let it break the contact upsert.
  if (custId && ghlId) {
    try {
      const { synced, bankStatementsAdded } = await syncFormUploads(db, custId, ghlId);
      if (synced > 0) await logEvent(db, evt, String(evt.type), "form_uploads_synced", `${synced} file(s)`);
      // New bank statements → re-run the AI underwriter (auto, deduped by docs_hash).
      if (bankStatementsAdded > 0) await triggerUnderwriting(custId);
    } catch (e) {
      await logEvent(db, evt, String(evt.type), "form_upload_sync_error", e instanceof Error ? e.message : String(e));
    }
  }
}

// Sync GHL intake-form file uploads → customer_documents. GHL stores form file
// uploads as file-upload custom fields on the contact (value = { <docId>: { meta:
// { originalname }, url } }). Only emailed attachments were being auto-filed, so
// form uploads (bank statements, ID) silently never reached the app. Idempotent
// via customer_documents.external_ref = the GHL doc id. Returns files synced.
async function syncFormUploads(
  db: DB,
  customerId: string,
  ghlContactId: string,
): Promise<{ synced: number; bankStatementsAdded: number }> {
  const cfg = await getGhlConfig(db);
  const res = await ghlFetch<{ contact?: { customFields?: Array<{ id: string; value: unknown }> } }>(
    cfg, "GET", `/contacts/${ghlContactId}`,
  );
  const fields = res.ok ? (res.data?.contact?.customFields ?? []) : [];
  // Field id -> field name (e.g. "MCA Bank Statements", "Other Documents (ID,
  // voided check…)") so we type each file by the upload field it came from, not
  // just the (often generic, e.g. "image.jpg") filename.
  const defs = await ghlFetch<{ customFields?: Array<{ id: string; name: string }> }>(
    cfg, "GET", `/locations/${cfg.locationId}/customFields`,
  );
  const fieldName: Record<string, string> = {};
  for (const fd of (defs.data?.customFields ?? [])) fieldName[fd.id] = fd.name;

  const files: Array<{ ref: string; name: string; url: string; hint: string }> = [];
  for (const f of fields) {
    const v = f.value;
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const hint = fieldName[f.id] ?? "";
    for (const [ref, entry] of Object.entries(v as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const meta = (e.meta ?? {}) as Record<string, unknown>;
      const url = String(e.url ?? e.documentId ?? "");
      const name = String(meta.originalname ?? meta.name ?? e.name ?? `${ref}.pdf`).trim();
      if (url.startsWith("http")) files.push({ ref, name, url, hint });
    }
  }
  if (!files.length) return { synced: 0, bankStatementsAdded: 0 };

  const { data: existingDocs } = await db.from("customer_documents")
    .select("external_ref").eq("customer_id", customerId).not("external_ref", "is", null);
  const have = new Set((existingDocs ?? []).map((r: { external_ref: string }) => r.external_ref));

  let synced = 0;
  let bankStatementsAdded = 0;
  for (const file of files.slice(0, 25)) {
    if (have.has(file.ref)) continue;
    try {
      // Auth header is dropped on the cross-origin redirect to storage (expected).
      const bin = await fetch(file.url, { headers: { Authorization: `Bearer ${cfg.apiKey}`, Version: "2021-07-28" } });
      if (!bin.ok) continue;
      const bytes = new Uint8Array(await bin.arrayBuffer());
      if (!bytes.length) continue;
      const ct = contentTypeFor(file.name);
      const docType = docTypeFor(`${file.hint} ${file.name}`);
      const slug = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "upload";
      const path = `customer/${customerId}/${Date.now()}-${slug}`;
      const up = await db.storage.from("customer-documents").upload(path, bytes, { contentType: ct, upsert: false });
      if (up.error) continue;
      await db.from("customer_documents").insert({
        customer_id: customerId,
        document_type: docType,
        filename: file.name,
        storage_path: path,
        file_size: bytes.length,
        mime_type: ct,
        status: "pending",
        external_ref: file.ref,
        description: "Auto-synced from GHL intake-form upload.",
      });
      synced++;
      if (docType === "bank_statement") bankStatementsAdded++;
    } catch (_e) { /* skip this file, keep going */ }
  }
  return { synced, bankStatementsAdded };
}

// Fire-and-forget: re-run the AI underwriter for a deal when new bank statements
// arrive (auto mode; deduped server-side by docs_hash). Best-effort — never breaks
// the webhook. Invoked with the service-role key so underwrite-deal treats it as a
// trusted server call.
async function triggerUnderwriting(customerId: string): Promise<void> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return;
    const db = serviceClient();
    // The merchant's most recently updated active deal is the one collecting docs.
    const { data: deal } = await db
      .from("deals")
      .select("id")
      .eq("customer_id", customerId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!deal?.id) return;
    await fetch(`${url}/functions/v1/underwrite-deal`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ dealId: deal.id, mode: "auto" }),
    });
  } catch { /* best-effort — underwriting must never break the webhook */ }
}

function contentTypeFor(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

// Keep to the document_type values the app already uses (bank_statement,
// application, id, voided_check, other). Matches against the field name + filename.
function docTypeFor(s: string): string {
  const n = s.toLowerCase();
  if (/statement/.test(n)) return "bank_statement";
  if (/applica/.test(n)) return "application";
  if (/driver|licen|passport|photo id|\bid\b/.test(n)) return "id";
  if (/void|cheque|\bcheck\b/.test(n)) return "voided_check";
  return "other";
}

async function handleOpportunity(db: DB, evt: Record<string, unknown>) {
  const o = (evt.opportunity ?? evt) as Record<string, unknown>;
  const cd = (evt.customData ?? {}) as Record<string, unknown>;
  // Opportunity id: native (o.id) or flat workflow payload (evt.id / customData.opportunityId).
  const oppId = String(o.id ?? evt.opportunityId ?? cd.opportunityId ?? evt.id ?? "");
  if (!oppId) return;

  // Resolve the GHL stage -> our deal status. Prefer stage id (native), then stage NAME
  // (the workflow webhook only sends the name, under GHL's misspelled key "pipleline_stage").
  const stageId = String(o.pipelineStageId ?? o.stageId ?? evt.pipelineStageId ?? "");
  const stageName = String(
    o.stageName ?? o.pipelineStageName ?? evt.pipelineStageName ?? evt.pipleline_stage ?? evt.pipeline_stage ?? "",
  ).toLowerCase().trim();
  const mapped = STATUS_BY_STAGE_ID[stageId] ?? STATUS_BY_STAGE[stageName] ?? null;

  // Monetary value: native (monetaryValue) or flat (lead_value).
  const monetary = (o.monetaryValue ?? evt.lead_value ?? null) as number | null;

  // Pull the fields the stage-mirror needs to (a) stamp timestamps only-if-null
  // and (b) create the funded commission with this deal's real splits.
  const { data: deal } = await db.from("deals")
    .select("id, status, customer_id, deal_number, amount_funded, amount_requested, assigned_closer_id, is_renewal, lead_source, contacted_at, qualified_at, application_sent_at, docs_collected_at, bank_statements_at, submitted_at, offer_received_at, offer_presented_at, offer_accepted_at, funded_at, declined_at, nurture_at")
    .eq("ghl_opportunity_id", oppId).maybeSingle();

  // ── Gap A: create the deal if this opportunity isn't linked to one yet ──
  if (!deal) {
    const pipelineId = String(o.pipelineId ?? evt.pipelineId ?? evt.pipeline_id ?? "");
    // Auto-create for the MCA and VCF pipelines; ignore anything else.
    const dealType = pipelineId === VCF_PIPELINE_ID ? "vcf" : pipelineId === MCA_PIPELINE_ID ? "mca" : null;
    if (!dealType) return;

    const contactId = String(
      o.contactId ?? evt.contactId ?? cd.contactId ?? evt.contact_id ?? (evt.contact as Record<string, unknown> | undefined)?.id ?? "",
    );
    if (!contactId) return; // can't tie a deal to a merchant without a contact

    // ROBOT GUARD: never auto-create a deal for a lead-delivery mailbox contact
    // (tagged lt-source — e.g. Synergy's Double-Verified sender). A GHL-side
    // automation once created an opportunity on that contact and this mirror
    // dutifully turned it into a junk deal (MF-2026-0017). The REAL lead's deal
    // is created by live-transfer-intake from the parsed email instead.
    {
      const evtTags = ((evt.contact as Record<string, unknown> | undefined)?.tags ?? evt.tags ?? []) as unknown;
      let isRobot = Array.isArray(evtTags) && evtTags.some((t) => String(t).toLowerCase() === "lt-source");
      if (!isRobot) {
        try {
          const cfg = await getGhlConfig(db);
          const cRes = await getContact(cfg, contactId);
          const tags = (cRes.data?.contact?.tags ?? []) as string[];
          isRobot = tags.some((t) => String(t).toLowerCase() === "lt-source");
        } catch { /* best-effort — fall through to normal handling */ }
      }
      if (isRobot) {
        await logEvent(db, evt, "OpportunityCreate", "skipped", "lt-source robot contact — no deal auto-created");
        return;
      }
    }

    // Find the customer by ghl_contact_id; create a minimal one if missing
    // (a Contact event will enrich it later).
    let customerId: string | null = null;
    const { data: cust } = await db.from("customers").select("id").eq("ghl_contact_id", contactId).maybeSingle();
    if (cust) {
      customerId = cust.id;
    } else {
      const c = (evt.contact ?? {}) as Record<string, unknown>;
      const { data: created } = await db.from("customers").insert({
        ghl_contact_id: contactId,
        first_name: (c.firstName ?? evt.first_name ?? null) as string | null,
        last_name: (c.lastName ?? evt.last_name ?? null) as string | null,
        email: (c.email ?? evt.email ?? null) as string | null,
        phone: (c.phone ?? evt.phone ?? null) as string | null,
        business_name: (c.companyName ?? evt.company_name ?? o.name ?? evt.opportunity_name ?? null) as string | null,
        status: "lead",
        source: "other",
      }).select("id").maybeSingle();
      customerId = created?.id ?? null;
    }
    if (!customerId) return;

    const status = mapped ?? (dealType === "vcf" ? "new_distressed" : "new");
    const insert: Record<string, unknown> = {
      customer_id: customerId,
      deal_type: dealType,
      status,
      amount_requested: monetary,
      ghl_contact_id: contactId,
      ghl_opportunity_id: oppId,
      lead_source: "ghl_other",
    };
    // Stamp the stage timestamp for whatever status this opportunity was created
    // at (it's a fresh row, so the column is null by definition).
    const createTsCol = STATUS_TIMESTAMP_MAP[status];
    if (createTsCol) insert[createTsCol] = new Date().toISOString();
    if (status === "funded" && monetary != null) insert.amount_funded = monetary;
    const { data: newDeal } = await db.from("deals").insert(insert).select("id").maybeSingle();
    if (newDeal) {
      await log(db, "deal", newDeal.id, `ghl:${evtTypeLabel(evt)}:created`, { stage: mapped, evt });
      // An opportunity created straight at Funded still owes a commission.
      if (status === "funded") {
        await createCommissionForFundedDeal(db, {
          id: newDeal.id as string,
          amount_funded: (insert.amount_funded as number | null) ?? null,
          amount_requested: monetary,
          assigned_closer_id: null,
          is_renewal: false,
          lead_source: "ghl_other",
        }, monetary);
      }
    }
    return;
  }

  // ── Existing deal: mirror the stage change from GHL ──
  const d = deal as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  const movedStatus = mapped && mapped !== deal.status;
  if (movedStatus) {
    patch.status = mapped;
    // Stamp the matching stage timestamp, but only if it's still null so an
    // earlier real timestamp (e.g. the deal was already funded once) is kept.
    const tsCol = STATUS_TIMESTAMP_MAP[mapped as string];
    if (tsCol && !d[tsCol]) patch[tsCol] = new Date().toISOString();
    // Funded with no known amount yet → capture the opportunity's value so
    // funded-by-month analytics (and the commission below) aren't blind.
    if (mapped === "funded" && d.amount_funded == null && monetary != null) {
      patch.amount_funded = monetary;
    }
  }
  if (monetary != null) patch.amount_requested = monetary;

  if (Object.keys(patch).length) {
    await db.from("deals").update(patch).eq("id", deal.id);
    await log(db, "deal", deal.id, `ghl:${evtTypeLabel(evt)}`, { from: deal.status, to: patch.status, evt });
  }

  // A deal dragged to Funded inside GHL owes a commission — the mirror used to
  // skip this entirely. Idempotent + best-effort; never breaks webhook processing.
  if (mapped === "funded") {
    await createCommissionForFundedDeal(db, {
      id: deal.id as string,
      amount_funded: (patch.amount_funded as number | null) ?? (d.amount_funded as number | null) ?? null,
      amount_requested: (d.amount_requested as number | null) ?? null,
      assigned_closer_id: (d.assigned_closer_id as string | null) ?? null,
      is_renewal: !!d.is_renewal,
      lead_source: (d.lead_source as string | null) ?? null,
    }, monetary);
  }
}

// ── Server-side commission on funded (GHL stage mirror) ──────────────────────
// Mirrors autoCreateCommissionForFundedDeal in src/services/dealService.ts. The
// inbound stage-mirror had no path to create a commission, so a deal funded
// inside GHL got a status change but no commission row. Idempotent (no-ops when a
// commission already exists for the deal) and fully guarded — a failure here logs
// but never throws, so it can't break webhook processing.
interface MirrorDealForCommission {
  id: string;
  amount_funded?: number | null;
  amount_requested?: number | null;
  assigned_closer_id?: string | null;
  is_renewal?: boolean | null;
  lead_source?: string | null;
}

async function createCommissionForFundedDeal(
  db: DB,
  deal: MirrorDealForCommission,
  monetaryFallback: number | null,
): Promise<void> {
  try {
    // Idempotency guard: never create a second commission for the same deal.
    const { data: existing } = await db.from("commissions").select("id").eq("deal_id", deal.id).limit(1);
    if (existing && existing.length > 0) return;

    // Funded amount: explicit amount_funded, else the opportunity's monetaryValue,
    // else the requested amount. If none are usable, flag for manual review rather
    // than writing a zero-amount commission.
    const amountFunded = firstPositive(deal.amount_funded, monetaryFallback, deal.amount_requested);
    if (amountFunded == null) {
      await log(db, "deal", deal.id, "commission-needs-review", {
        reason: "deal funded via GHL stage mirror but no amount_funded / monetaryValue / amount_requested to base commission on",
      });
      return;
    }

    // Map the assigned closer (profiles.id) → its closers record for this closer's
    // individual splits; fall back to platform defaults when unmapped.
    let closerId: string | null = null;
    let closerSplits: { company: number; self: number; renewal: number } | null = null;
    if (deal.assigned_closer_id) {
      const { data: closer } = await db.from("closers")
        .select("id, company_lead_split, self_gen_split, renewal_split")
        .eq("user_id", deal.assigned_closer_id).maybeSingle();
      if (closer) {
        closerId = closer.id as string;
        closerSplits = {
          company: Number(closer.company_lead_split),
          self: Number(closer.self_gen_split),
          renewal: Number(closer.renewal_split),
        };
      }
    }

    const isRenewal = !!deal.is_renewal;
    const commissionPoints = isRenewal ? RENEWAL_POINTS : NEW_DEAL_POINTS;
    const leadSource: "company" | "self_generated" | "renewal" = isRenewal
      ? "renewal"
      : deal.lead_source && /self/i.test(deal.lead_source)
        ? "self_generated"
        : "company";

    const closerSplitPercentage = closerSplits
      ? leadSource === "renewal"
        ? closerSplits.renewal
        : leadSource === "self_generated"
          ? closerSplits.self
          : closerSplits.company
      : undefined;

    const calc = calcMirrorCommission({
      amountFunded, commissionPoints, closerId, closerSplitPercentage, leadSource, isRenewal,
    });

    const { error } = await db.from("commissions").insert({
      deal_id: deal.id,
      deal_submission_id: null,
      gross_commission: calc.grossCommission,
      commission_points: calc.commissionPoints,
      closer_id: closerId,
      closer_split_percentage: calc.closerSplitPercentage,
      closer_amount: calc.closerAmount,
      company_amount: calc.companyAmount,
      sub_iso_id: null,
      override_points: 0,
      override_amount: 0,
      manager_override_percentage: null,
      manager_override_amount: 0,
      payment_status: "pending",
      funder_paid_at: null,
      closer_paid_at: null,
      clawback_amount: 0,
      clawback_reason: null,
      notes: "Auto-generated on deal funded (GHL stage mirror)",
    });
    if (error) {
      await log(db, "deal", deal.id, "commission-create-failed", { error: error.message });
    }
  } catch (e) {
    try {
      await log(db, "deal", deal.id, "commission-create-failed",
        { error: e instanceof Error ? e.message : String(e) });
    } catch { /* best-effort — commission failure must never break the webhook */ }
  }
}

// First finite, positive number among the candidates, else null.
function firstPositive(...nums: Array<number | null | undefined>): number | null {
  for (const n of nums) {
    const v = typeof n === "number" ? n : NaN;
    if (Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

// Commission split math for the mirror. Mirrors calculateCommission() in
// src/services/commissionService.ts for the no-Sub-ISO case (the inbound mirror
// never carries a Sub-ISO). closerAmount comes off the full gross; company keeps
// the remainder.
function calcMirrorCommission(params: {
  amountFunded: number;
  commissionPoints: number;
  closerId: string | null;
  closerSplitPercentage?: number;
  leadSource: "company" | "self_generated" | "renewal";
  isRenewal: boolean;
}): {
  grossCommission: number;
  commissionPoints: number;
  closerSplitPercentage: number;
  closerAmount: number;
  companyAmount: number;
} {
  const { amountFunded, commissionPoints, closerId, closerSplitPercentage, leadSource, isRenewal } = params;
  const grossCommission = (amountFunded * commissionPoints) / 100;

  let effectiveSplit = 0;
  if (closerId) {
    if (closerSplitPercentage !== undefined) effectiveSplit = closerSplitPercentage;
    else if (isRenewal || leadSource === "renewal") effectiveSplit = RENEWAL_SPLIT;
    else if (leadSource === "self_generated") effectiveSplit = SELF_GEN_SPLIT;
    else effectiveSplit = COMPANY_LEAD_SPLIT;
  }

  const closerAmount = closerId ? (grossCommission * effectiveSplit) / 100 : 0;
  const companyAmount = grossCommission - closerAmount;

  return {
    grossCommission,
    commissionPoints,
    closerSplitPercentage: effectiveSplit,
    closerAmount,
    companyAmount,
  };
}

// Best-effort event-type label for activity logging (native type or workflow customData.type).
function evtTypeLabel(evt: Record<string, unknown>): string {
  const cd = (evt.customData ?? {}) as Record<string, unknown>;
  return String(evt.type ?? evt.eventType ?? cd.type ?? "opportunity");
}

async function log(db: DB, entityType: string, entityId: string, action: string, meta: unknown) {
  try {
    await db.from("activity_log").insert({
      entity_type: entityType, entity_id: entityId,
      interaction_type: "note", subject: action, content: JSON.stringify(meta),
    });
  } catch { /* best-effort */ }
}
