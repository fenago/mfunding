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
// The GHL→Supabase document bridge now lives in _shared (the AI underwriter and the
// ingest-ghl-documents function use the exact same code path).
import { ingestGhlDocuments } from "../_shared/ghlDocs.ts";
import { resolveReplyTarget, type SubCandidate } from "../_shared/funder-reply-match.ts";
import { captureFunderReply } from "../_shared/funderDecline.ts";

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

// Business identity — the tiebreak when one owner runs several businesses off a
// single GHL contact. THIRD COPY of the same rules: the other two are
// normBusiness() in playbook-open-contact and normBusinessName() in
// src/lib/businessName.ts. All three must agree; edge functions can't import from
// src/ and _shared is the only place they could share, which this one line does
// not earn. Change one, change all three.
const BIZ_ENTITY_SUFFIXES = new Set([
  "llc", "inc", "incorporated", "corp", "corporation", "co", "company",
  "ltd", "limited", "lp", "llp", "pllc", "pc", "dba",
]);
function normBusinessName(v: unknown): string {
  const s = String(v ?? "").toLowerCase()
    .replace(/\bl\.?\s*l\.?\s*c\b/g, "llc")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  const parts = s.split(" ");
  while (parts.length > 1 && BIZ_ENTITY_SUFFIXES.has(parts[parts.length - 1])) parts.pop();
  return parts.join(" ");
}
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

// Best-effort email/message id from an open event, for deduping repeat opens of
// the same email. GHL open payloads vary by how the workflow is wired, so we probe
// the common shapes (flat fields, customData, a nested email object, meta.email).
function emailMessageIdOf(evt: Record<string, unknown>): string | null {
  const cd = (evt.customData ?? {}) as Record<string, unknown>;
  const email = (evt.email ?? cd.email ?? {}) as Record<string, unknown>;
  const meta = (evt.meta ?? {}) as Record<string, unknown>;
  const metaEmail = (meta.email ?? {}) as Record<string, unknown>;
  const metaIds = Array.isArray(metaEmail.messageIds) ? (metaEmail.messageIds as unknown[]) : [];
  const candidate =
    evt.messageId ?? evt.message_id ?? evt.emailMessageId ?? evt.emailId ?? evt.email_id ??
    cd.messageId ?? cd.message_id ?? cd.emailMessageId ?? cd.email_message_id ?? cd.emailId ??
    email.id ?? email.messageId ?? metaIds[0] ?? null;
  const s = candidate == null ? "" : String(candidate).trim();
  return s || null;
}

interface LeadOpenRow { matched: boolean; is_new: boolean; customer_id: string | null }
interface SubRow { id: string; opened_at: string | null; open_count: number | null }

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

  // (1) Per-LEAD open: record it for the merchant behind this contact (going
  // forward). Best-effort and isolated — never let it break the funder path below.
  // The recorder dedupes on the email/message id when GHL sends one, and bumps the
  // customers aggregate (email_last_opened_at / email_open_count) the audit reads.
  let leadOpen: LeadOpenRow | null = null;
  try {
    const messageId = emailMessageIdOf(evt);
    const { data } = await db.rpc("record_lead_email_open", { p_contact_id: contactId, p_message_id: messageId });
    const rows = data as unknown as LeadOpenRow[] | LeadOpenRow | null;
    leadOpen = Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null);
  } catch (e) {
    console.warn("[ghl-webhook] record_lead_email_open skipped:", e instanceof Error ? e.message : e);
  }

  // (2) Funder submission stamp (existing behavior). A contact is a merchant XOR a
  // funder; when it isn't a lender, we still return "processed" if we logged a lead open.
  const { data: lender } = await db.from("lenders").select("id, company_name").eq("ghl_contact_id", contactId).maybeSingle();
  if (!lender) {
    if (leadOpen?.matched) {
      return {
        outcome: "processed",
        detail: `email-open: lead ${leadOpen.customer_id} (${leadOpen.is_new ? "new open" : "repeat"})`,
        result: { customerId: leadOpen.customer_id, firstOpen: leadOpen.is_new },
      };
    }
    return { outcome: "ignored", detail: `email-open: no lender/customer for contact ${contactId}`, result: {} };
  }

  // Prefer the most recent still-unopened sent submission; else the most recent sent one.
  let sub: SubRow | null = null;
  const un = await db.from("deal_submissions").select("id, opened_at, open_count")
    .eq("lender_id", lender.id).not("submitted_at", "is", null).is("opened_at", null)
    .order("submitted_at", { ascending: false }).limit(1).maybeSingle();
  sub = (un.data as unknown as SubRow | null) ?? null;
  if (!sub) {
    const any = await db.from("deal_submissions").select("id, opened_at, open_count")
      .eq("lender_id", lender.id).not("submitted_at", "is", null)
      .order("submitted_at", { ascending: false }).limit(1).maybeSingle();
    sub = (any.data as unknown as SubRow | null) ?? null;
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
    .select("id").in("phone", phoneVariants(phone))
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
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

  // Identify WHICH merchant this reply is about before stamping — a funder thread
  // interleaves replies about many merchants, so stamping the funder's newest open
  // submission cross-wires a reply about merchant A onto merchant B's deal. We
  // build the funder's OPEN submissions with their merchant identity and match the
  // reply by deal number / business name (poll-funder-replies uses the same rule).
  const { data: openSubs } = await db.from("deal_submissions")
    .select("id, deal_id, status, response_at, submitted_at, deal:deals!deal_id ( deal_number, customer:customers!customer_id ( business_name ) )")
    .eq("lender_id", lender.id)
    .not("submitted_at", "is", null)
    .is("response_at", null)
    .order("submitted_at", { ascending: false });
  if (!openSubs?.length) {
    return {
      outcome: "processed",
      detail: `${lender.company_name} replied but no open submission to stamp`,
      result: { handled: true, lender: lender.company_name, stamped: false },
    };
  }
  const subCands: SubCandidate[] = (openSubs).map((s) => ({
    submissionId: s.id as string, dealId: s.deal_id as string,
    dealNumber: ((s.deal as { deal_number?: string } | null)?.deal_number) ?? null,
    businessName: (((s.deal as { customer?: { business_name?: string } } | null)?.customer)?.business_name) ?? null,
    submittedAt: (s.submitted_at as string | null) ?? null,
  }));
  const subject = String(
    evt.subject ?? cd.subject ?? (evt.email as Record<string, unknown> | undefined)?.subject ?? "",
  );
  // This inbound event just arrived (push) — its date is now, unless GHL provided
  // one. That keeps a genuine live reply past the submit-time gate while a replay
  // of an old email still gets gated by its real date.
  const emailDate = String(
    evt.dateAdded ?? cd.dateAdded ?? (evt.email as Record<string, unknown> | undefined)?.dateAdded ?? new Date().toISOString(),
  );
  const resolution = resolveReplyTarget({ subject, body, subs: subCands, lenderName: lender.company_name, emailDate });
  if (resolution.kind !== "match") {
    // Never force it onto a deal. Park it on the sync-log for a human to place
    // (never silently attached, never silently dropped).
    const reason = resolution.kind === "wrong_merchant" ? `names a different merchant: ${resolution.merchant}`
      : resolution.kind === "wrong_deal_number" ? `names deal ${resolution.dealNumber} (not open with this funder)`
      : resolution.kind === "stale" ? resolution.reason
      : resolution.kind === "general" ? "marketing / onboarding / general (not about a specific file)"
      : resolution.kind === "ambiguous" ? "could not tell which open deal it is about"
      : "no open submission to this funder";
    // Unplaceable, but still box intel: keep the FULL body (a decline we can't tie
    // to a deal still tells us what this funder says no to). Marketing blasts are
    // skipped. Best-effort — never blocks the park. funder-decline-intel parses it.
    if (resolution.kind !== "general") {
      await captureFunderReply(db, {
        lenderId: lender.id, source: "webhook", fullBody: body,
        emailRecordId: null, dedupeKey: `wh:${lender.id}:${conversationId || contactId}:${emailDate}`,
        subject, fromEmail: String(cd.from ?? evt.from ?? ""), receivedAt: emailDate,
      });
    }
    await db.from("ghl_webhook_events").insert({
      event_type: resolution.kind === "general" ? "FunderReplyGeneral" : "FunderReplyUnmatched",
      ghl_contact_id: contactId,
      outcome: resolution.kind === "general" ? "ignored" : "error",
      detail: `${lender.company_name}: inbound reply — ${reason}. Subject: "${subject.slice(0, 120)}" · "${body.replace(/\s+/g, " ").slice(0, 160)}"`,
      payload: { source: "ghl-webhook", lender: lender.company_name, conversationId, contactId, subject, reason },
    });
    return {
      outcome: "ignored",
      detail: `${lender.company_name} replied but could not tie to a deal — ${reason}; parked for review`,
      result: { handled: false, lender: lender.company_name, stamped: false, parked: true, reason },
    };
  }
  const matchedSub = subCands.find((s) => s.submissionId === resolution.sub.submissionId)!;
  const sub = { id: matchedSub.submissionId, deal_id: matchedSub.dealId };

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
  // Log in the SAME format the poller uses so FunderResponsesBoard can render the
  // "✉ view email" chip: an email-record id → [emsg:<id>], else the conversation
  // message id → [msg:<id>] (get-funder-email resolves either). Without a marker
  // the reply line had no id and showed no chip.
  const emailRecordId = String(
    evt.emailMessageId ?? cd.emailMessageId ?? cd.email_message_id ??
    (evt.email as Record<string, unknown> | undefined)?.messageId ??
    ((evt.meta as { email?: { messageIds?: unknown[] } } | undefined)?.email?.messageIds?.[0]) ?? "",
  );
  const convMsgId = String(evt.messageId ?? cd.messageId ?? evt.message_id ?? cd.message_id ?? "");
  const idMarker = emailRecordId ? ` [emsg:${emailRecordId}]` : convMsgId ? ` [msg:${convMsgId}]` : "";
  const fromLabel = String((evt.contact as Record<string, unknown> | undefined)?.email ?? cd.from ?? evt.from ?? contactId);

  // Keep the COMPLETE body before the 180-char activity_log preview throws it away.
  // Best-effort — the log line is the record; this is the intel copy.
  await captureFunderReply(db, {
    lenderId: lender.id, source: "webhook", fullBody: body,
    dealId: sub.deal_id, dealSubmissionId: sub.id,
    emailRecordId: emailRecordId || null,
    dedupeKey: emailRecordId ? null : `wh:${lender.id}:${convMsgId || conversationId || contactId}:${emailDate}`,
    subject, fromEmail: fromLabel, receivedAt: emailDate,
  });

  await db.from("activity_log").insert({
    entity_type: "deal", entity_id: sub.deal_id, interaction_type: "email",
    subject: `ghl:funder-reply — ${lender.company_name}`,
    content: `reply: "${snippet.slice(0, 180)}" (${fromLabel})${idMarker}`,
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
    const { data } = await db.from("customers").select("id").eq("ghl_contact_id", ghlId)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    existing = data;
  }
  if (!existing && email) {
    const { data } = await db.from("customers").select("id").eq("email", email)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
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
      const { synced, bankStatementsAdded } = await ingestGhlDocuments(db, custId, ghlId);
      if (synced > 0) await logEvent(db, evt, String(evt.type), "form_uploads_synced", `${synced} file(s)`);
      // New bank statements → re-run the AI underwriter (auto, deduped by docs_hash).
      if (bankStatementsAdded > 0) await triggerUnderwriting(custId);
    } catch (e) {
      await logEvent(db, evt, String(evt.type), "form_upload_sync_error", e instanceof Error ? e.message : String(e));
    }
  }
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

// Everything the stage-mirror reads off a deal. ONE definition so the adopt path
// and the by-opportunity-id lookup can never return different shapes.
const DEAL_MIRROR_COLS =
  "id, status, customer_id, deal_number, amount_funded, amount_requested, assigned_closer_id, is_renewal, lead_source, ghl_opportunity_id, contacted_at, qualified_at, application_sent_at, docs_collected_at, bank_statements_at, submitted_at, offer_received_at, offer_presented_at, offer_accepted_at, funded_at, declined_at, nurture_at";

// Deal statuses that mean "this cycle is over" — mirrors CLOSED_STATUSES in
// playbook-open-contact. A finished deal is never adopted onto a live
// opportunity; that would resurrect a closed cycle.
const TERMINAL_STATUSES = ["funded", "declined", "dead", "renewal_eligible", "restructure_executed", "servicing"];

/**
 * ADOPT, DON'T DUPLICATE.
 *
 * `deals.ghl_opportunity_id` is the ONLY deal-level join key between us and GHL,
 * and playbook-open-contact can create a deal before that id is knowable — so an
 * OpportunityStageUpdate arriving minutes later found nothing, created a second
 * deal for the same merchant, and the round-robin handed it to a different
 * closer. Both deals then lived on, splitting commission attribution.
 *
 * So before creating anything: does this contact already have an OPEN deal of
 * this type that carries no opportunity id? That deal is this opportunity's deal.
 * Claim it.
 *
 * MATCHING IS DELIBERATELY NARROW — ghl_contact_id + deal_type + non-terminal
 * status + ghl_opportunity_id IS NULL. Nothing looser (email, business name,
 * phone) is used, so this can never pull in a different merchant's deal.
 *
 * IDEMPOTENT + RACE-SAFE: the write is filtered on `ghl_opportunity_id IS NULL`,
 * so a re-fire (or a concurrent event) updates zero rows rather than re-pointing
 * a deal. Losing that race is not a reason to create a duplicate — we re-read the
 * row and, if the winner stamped THIS opportunity, carry on with it.
 *
 * Returns the adopted deal (in DEAL_MIRROR_COLS shape) for the normal mirror path
 * to update, or an outcome that says whether adoption was REFUSED — see AdoptResult.
 */

/**
 * The outcome of an adoption attempt.
 *
 * `refused` is the whole point: it separates "this contact has nothing to adopt"
 * (safe — the caller may create a deal) from "this contact HAS an unlinked deal
 * but nothing proved it belongs to this opportunity" (never safe to create — a
 * created deal would be the SECOND deal for a merchant we are already tracking,
 * plus a phantom customers row). In the refusal case the receipt written here is
 * the record, and the opportunity is linked by hand.
 */
type AdoptResult = { deal: Record<string, unknown> | null; refused: boolean };
/** Nothing on this contact to adopt — the caller's create path may run. */
const NOTHING_TO_ADOPT: AdoptResult = { deal: null, refused: false };
/** An unlinked deal exists but is not provably this opportunity's — create NOTHING. */
const ADOPT_REFUSED: AdoptResult = { deal: null, refused: true };

async function adoptOrphanDeal(
  db: DB,
  evt: Record<string, unknown>,
  contactId: string,
  dealType: string,
  oppId: string,
  /** The opportunity's NAME, when the event carries one. The tiebreak when a
   * contact has more than one orphan deal — see the multi-business note below. */
  oppName: string | null,
): Promise<AdoptResult> {
  const { data: candidates, error } = await db.from("deals")
    .select("id, deal_number, status, created_at, customers(business_name)")
    .eq("ghl_contact_id", contactId)
    .eq("deal_type", dealType)
    .is("ghl_opportunity_id", null)
    .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`)
    .order("created_at", { ascending: false })
    .limit(10);
  // UNREADABLE ≠ "NOTHING TO ADOPT". This used to fall through to the caller's
  // create path on the theory that it is "itself guarded" — it is not guarded
  // against THIS. Every one of its guards asks a different question (cold pool,
  // robot contact, which customer), and none of them can see the deal this failed
  // read was supposed to find. So a transient DB error minted a second deal for a
  // merchant we were already tracking: exactly the duplication this function
  // exists to prevent, arrived at through its own failure.
  //
  // A missed create is retryable — GHL re-fires, and the next attempt reads the
  // orphan and adopts it. A duplicate deal is data corruption: two deals split one
  // merchant's commission attribution and someone has to unpick it by hand. Refuse.
  if (error) {
    await logEvent(db, evt, evtTypeLabel(evt), "error",
      `adopt lookup failed: ${error.message} — created nothing (an unreadable contact is not an empty one); GHL will re-fire`);
    return ADOPT_REFUSED;
  }
  if (!candidates || candidates.length === 0) return NOTHING_TO_ADOPT;

  type Cand = {
    id: string; deal_number: string | null; status: string;
    customers?: { business_name?: string | null } | { business_name?: string | null }[] | null;
  };
  const cands = candidates as unknown as Cand[];
  const nameOf = (c: Cand): string | null | undefined =>
    (Array.isArray(c.customers) ? c.customers[0] : c.customers)?.business_name;

  // ── ONE OWNER, MANY BUSINESSES ────────────────────────────────────────────
  // A contact can now legitimately carry several open MCA deals — one per
  // business the owner runs (see playbook-open-contact's add_business). Taking
  // "the newest orphan" there is not a tiebreak, it is a COIN FLIP that welds
  // business A's opportunity onto business B's deal: every later stage move,
  // funded timestamp and commission lands on the wrong merchant.
  //
  // So the opportunity's NAME decides — it is the business name we create
  // opportunities under — and when the name settles nothing, we ADOPT NOTHING and
  // say so on the receipt. A missed adoption is a deal that stays unlinked and can
  // be linked by hand; a wrong adoption is two merchants silently merged.
  //
  // ONE CANDIDATE IS NOT PROOF. This location has allowDuplicateOpportunity OFF,
  // so business #2's deal is normally the ONLY orphan on the contact (business #1
  // already holds its opportunity) — i.e. the cross-wire shape looks exactly like
  // the safe single-business shape. The name is what tells them apart.
  //
  // BUT A NAME MISMATCH IS ONLY EVIDENCE WHEN THE OWNER HAS SEVERAL BUSINESSES.
  // Opportunity names are not always business names: ghl-create-opportunities
  // falls back to the CONTACT's name and then the email (opportunityName()), and
  // plenty of customers rows carry no business_name at all. Refusing on a
  // mismatch for a one-business owner would strand ordinary deals unlinked
  // forever. So: the name must settle it whenever this owner could plausibly have
  // two merchants on one contact — several orphan candidates, or several
  // customers rows on the contact — and only a genuinely single-business contact
  // keeps the old "the one candidate is it" behavior.
  const want = normBusinessName(oppName);
  const hits = want ? cands.filter((c) => normBusinessName(nameOf(c)) === want) : [];

  let target: Cand;
  if (hits.length === 1) {
    target = hits[0];                      // the name settles it
  } else if (cands.length === 1 && hits.length === 0) {
    // One orphan and the name did not match it (or there was no name). Safe only
    // if this contact carries exactly one business.
    const { data: owned, error: ownErr } = await db.from("customers")
      .select("id, business_name").eq("ghl_contact_id", contactId).limit(50);
    // Unreadable ≠ "one business" — that assumption is the cross-wire. Refuse.
    if (ownErr) {
      await logEvent(db, evt, evtTypeLabel(evt), "error",
        `couldn't read this contact's businesses to check whether unlinked deal ${cands[0].deal_number ?? cands[0].id} ` +
        `belongs to opportunity "${oppName ?? ""}" (${ownErr.message}) — adopted nothing and created nothing. Link it by hand.`);
      return ADOPT_REFUSED;
    }
    if ((owned ?? []).length > 1) {
      await logEvent(db, evt, evtTypeLabel(evt), "skipped",
        `this contact runs ${(owned ?? []).length} businesses (${(owned ?? []).map((c) => c.business_name ?? "unnamed").join(", ")}) ` +
        `and opportunity "${oppName ?? ""}" matches none of the ${cands.length} unlinked open ${dealType} deal(s) on it — ` +
        `adopted NOTHING and created nothing, rather than weld this opportunity onto another business's deal. ` +
        `Link it by hand: deal ${cands[0].deal_number ?? cands[0].id}.`);
      return ADOPT_REFUSED;
    }
    target = cands[0];
  } else {
    await logEvent(db, evt, evtTypeLabel(evt), "skipped",
      `${cands.length} unlinked open ${dealType} deals on this contact (one owner, several businesses) and opportunity "${oppName ?? ""}" matches ` +
      `${hits.length} of them — adopted NOTHING and created nothing, rather than risk linking this opportunity to the wrong business. ` +
      `Link it by hand: deals ${cands.map((c) => c.deal_number ?? c.id).join(", ")}.`);
    return ADOPT_REFUSED;
  }
  const { data: claimed, error: upErr } = await db.from("deals")
    .update({ ghl_opportunity_id: oppId })
    .eq("id", target.id)
    .is("ghl_opportunity_id", null)
    .select(DEAL_MIRROR_COLS)
    .maybeSingle();
  if (upErr) {
    // We KNOW this opportunity's deal exists — the write is what failed. Falling
    // through to create would mint the duplicate this whole path prevents.
    await logEvent(db, evt, evtTypeLabel(evt), "error",
      `adopt of deal ${target.deal_number ?? target.id} failed: ${upErr.message} — created nothing; link it by hand`);
    return ADOPT_REFUSED;
  }

  if (!claimed) {
    // Someone stamped an opportunity id between the read and the write. If it was
    // THIS opportunity, the adoption already happened — use that row.
    const { data: after } = await db.from("deals").select(DEAL_MIRROR_COLS).eq("id", target.id).maybeSingle();
    const already = (after as Record<string, unknown> | null)?.ghl_opportunity_id;
    if (already === oppId) return { deal: after as Record<string, unknown>, refused: false };
    return NOTHING_TO_ADOPT;
  }

  await log(db, "deal", target.id, `ghl:${evtTypeLabel(evt)}:adopted`, {
    ghl_opportunity_id: oppId, ghl_contact_id: contactId, was_status: target.status,
  });
  await logEvent(db, evt, evtTypeLabel(evt), "adopted",
    `linked existing ${dealType} deal ${target.deal_number ?? target.id} (status "${target.status}") to this opportunity instead of creating a duplicate` +
    (hits.length === 1
      ? ` — matched by business name against opportunity "${oppName ?? ""}" (${cands.length} unlinked open deal(s) on this contact)`
      : ""));
  return { deal: claimed as Record<string, unknown>, refused: false };
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
  const { data: dealFound, error: dealLookupErr } = await db.from("deals")
    .select(DEAL_MIRROR_COLS)
    .eq("ghl_opportunity_id", oppId).maybeSingle();

  // UNREADABLE IS NOT EMPTY. A failed/ambiguous lookup used to read as "no deal
  // exists for this opportunity" and fall straight into the create path — i.e. a
  // transient DB error (or two deals already sharing this opportunity id, which
  // makes maybeSingle() error) would MINT A DUPLICATE. Park the event instead;
  // the receipt says exactly what happened and GHL will re-fire.
  if (dealLookupErr) {
    await logEvent(db, evt, evtTypeLabel(evt), "error",
      `deal lookup by ghl_opportunity_id failed — no deal created or updated: ${dealLookupErr.message}`);
    return;
  }
  let deal = dealFound as Record<string, unknown> | null;

  // Contact + pipeline are needed by BOTH the adopt and the create path below.
  const pipelineId = String(o.pipelineId ?? evt.pipelineId ?? evt.pipeline_id ?? "");
  // We only mirror the MCA and VCF pipelines; anything else is ignored.
  const dealType = pipelineId === VCF_PIPELINE_ID ? "vcf" : pipelineId === MCA_PIPELINE_ID ? "mca" : null;
  const contactId = String(
    o.contactId ?? evt.contactId ?? cd.contactId ?? evt.contact_id ?? (evt.contact as Record<string, unknown> | undefined)?.id ?? "",
  );

  // The opportunity's NAME — native (o.name), the flat workflow payload's
  // opportunity_name, or customData's. It is the business name we create
  // opportunities under, so it is what tells one business's deal from another's
  // when an owner runs several. RESOLVED ONCE, here, because the adopt path and
  // the create path below must agree on it: they used to read it from different
  // sets of keys, so a customData-only name matched a business in adopt and then
  // matched NOTHING in the create path's customer picker — minting a phantom
  // second customers row for a merchant we already had.
  const oppName = String(o.name ?? evt.opportunity_name ?? cd.opportunity_name ?? "").trim() || null;

  // ── Gap A0: ADOPT an orphaned deal instead of creating a second one ─────────
  // A deal born in playbook-open-contact (a setter opening the Revenue Playbook)
  // may carry NO ghl_opportunity_id, so the lookup above can't see it and this
  // mirror used to create a SECOND deal for the same merchant minutes later —
  // owned by a different closer, splitting commission attribution. If this
  // contact already has an open deal of this type with no opportunity id, that IS
  // this opportunity's deal: link it and mirror onto it.
  let adoptRefused = false;
  if (!deal && dealType && contactId) {
    const adopted = await adoptOrphanDeal(db, evt, contactId, dealType, oppId, oppName);
    deal = adopted.deal;
    adoptRefused = adopted.refused;
  }

  // ── Gap A: create the deal if this opportunity isn't linked to one yet ──
  if (!deal) {
    // ADOPT SAID NO — AND "NO" MEANS NO. Refusal is not "there is nothing here",
    // it is "there IS an unlinked deal on this contact and nothing proved it is
    // this opportunity's". Creating here would give a merchant we are already
    // tracking a SECOND deal (and a second customers row) — the exact duplication
    // adopt exists to stop, arrived at from the other side. adoptOrphanDeal has
    // already written the receipt naming the deals to link by hand.
    if (adoptRefused) return;

    if (!dealType) return;

    // COLD-POOL GUARD (MCA only): a ~145K cold-dial import lands every opportunity
    // in the MCA pipeline's "New Lead" stage (mapped status "new"). Do NOT mint a
    // deal for those — a deal is born only when a setter WORKS the lead: they open
    // the Revenue Playbook (playbook-open-contact creates the deal directly in
    // Supabase) or the opportunity advances past New Lead (mapped !== "new").
    // Verified: every legit New-Lead deal is created DIRECTLY by its own edge
    // function — playbook-open-contact (created:true, status "new"), mca-intake
    // (the "MCA 00 - Web Form Intake" path, lead_source "mca_web"), and
    // live-transfer-intake — never by this mirror. So skipping New-Lead auto-create
    // here breaks nothing while stopping the mass cascade. VCF is unaffected.
    // (mapped === null means an unrecognized stage → effective status defaults to
    // "new" below, so it is treated as New Lead and skipped too.)
    if (dealType === "mca" && (mapped === "new" || mapped === null)) {
      await logEvent(db, evt, "OpportunityCreate", "skipped", "MCA New-Lead cold pool — no deal auto-created (deal is born when a setter works the lead)");
      return;
    }

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
    //
    // ONE OWNER, MANY BUSINESSES: "the oldest customer on this contact" is only
    // the right answer when the contact HAS one. An owner running several
    // businesses (playbook-open-contact's add_business) has several customers
    // here, and taking the oldest welds this opportunity's deal onto business #1 —
    // a merchant it has nothing to do with. The opportunity's NAME is the business
    // it belongs to, so it picks; and when it matches none of them, this is a
    // business we have not seen, which is a NEW customer, not business #1.
    let customerId: string | null = null;
    const { data: custs, error: custReadErr } = await db.from("customers")
      .select("id, business_name").eq("ghl_contact_id", contactId)
      .order("created_at", { ascending: true }).limit(50);
    // Unreadable ≠ "no customer": creating one here would duplicate the merchant.
    if (custReadErr) {
      await logEvent(db, evt, evtTypeLabel(evt), "error",
        `customer lookup failed — no deal auto-created: ${custReadErr.message}`);
      return;
    }
    const cust = (custs ?? []).length <= 1
      ? (custs ?? [])[0] ?? null
      : (() => {
        // Same name resolution as adopt, from the same variable — see oppName.
        const want = normBusinessName(oppName);
        const hits = want
          ? (custs ?? []).filter((c) => normBusinessName(c.business_name) === want)
          : [];
        return hits.length === 1 ? hits[0] : null;
      })();
    if (cust) {
      customerId = cust.id;
    } else {
      if ((custs ?? []).length > 1) {
        console.log("[ghl-webhook] contact", contactId, "has", (custs ?? []).length,
          "businesses and opportunity", JSON.stringify(oppName ?? ""),
          "matches none — creating a new business rather than attaching to the oldest");
      }
      const c = (evt.contact ?? {}) as Record<string, unknown>;
      const { data: created, error: custErr } = await db.from("customers").insert({
        ghl_contact_id: contactId,
        // customers.first_name / last_name are NOT NULL. A payload with no name at
        // all used to fail this insert, which then read as "no customer" and the
        // whole event vanished without a trace. Default rather than lose the deal.
        first_name: (c.firstName ?? evt.first_name ?? "Merchant") as string,
        last_name: (c.lastName ?? evt.last_name ?? "") as string,
        email: (c.email ?? evt.email ?? null) as string | null,
        phone: (c.phone ?? evt.phone ?? null) as string | null,
        // Normally the CONTACT's company name; but when this is a new business
        // under an owner we already know, the contact's company name is some
        // OTHER business of theirs — the opportunity's name is the one that
        // identified this as new, so it wins there.
        business_name: ((custs ?? []).length > 1
          ? (oppName ?? c.companyName ?? evt.company_name ?? null)
          : (c.companyName ?? evt.company_name ?? oppName ?? null)) as string | null,
        status: "lead",
        source: "other",
      }).select("id").maybeSingle();
      if (custErr) {
        await logEvent(db, evt, evtTypeLabel(evt), "error",
          `customer create failed — no deal auto-created: ${custErr.message}`);
        return;
      }
      customerId = created?.id ?? null;
    }
    if (!customerId) {
      await logEvent(db, evt, evtTypeLabel(evt), "error",
        "could not resolve or create a customer for this contact — no deal auto-created");
      return;
    }

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
    const { data: newDeal, error: insErr } = await db.from("deals").insert(insert).select("id, deal_number").maybeSingle();
    if (insErr || !newDeal) {
      await logEvent(db, evt, evtTypeLabel(evt), "error",
        `deal auto-create failed: ${insErr?.message ?? "insert returned no row"}`);
      return;
    }
    {
      await log(db, "deal", newDeal.id, `ghl:${evtTypeLabel(evt)}:created`, { stage: mapped, evt });
      // Receipt: this event MINTED a deal (vs. "adopted" — see adoptOrphanDeal).
      await logEvent(db, evt, evtTypeLabel(evt), "created",
        `deal ${newDeal.deal_number ?? newDeal.id} auto-created for ${dealType} opportunity at stage "${status}" (no existing or adoptable deal for this contact)`);
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

  // ── Existing deal (found by opportunity id, or just adopted): mirror the
  // stage change from GHL. Identical for both — an adopted deal goes through the
  // exact same status/timestamp/commission path as any other. ──
  const d = deal as Record<string, unknown>;
  const dealId = String(d.id);
  const dealStatus = d.status as string | null;
  const patch: Record<string, unknown> = {};
  const movedStatus = mapped && mapped !== dealStatus;
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
    const { error: mirrorErr } = await db.from("deals").update(patch).eq("id", dealId);
    if (mirrorErr) {
      await logEvent(db, evt, evtTypeLabel(evt), "error", `stage mirror update failed: ${mirrorErr.message}`);
      return;
    }
    await log(db, "deal", dealId, `ghl:${evtTypeLabel(evt)}`, { from: dealStatus, to: patch.status, evt });
  }

  // A deal dragged to Funded inside GHL owes a commission — the mirror used to
  // skip this entirely. Idempotent + best-effort; never breaks webhook processing.
  if (mapped === "funded") {
    await createCommissionForFundedDeal(db, {
      id: dealId,
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
    // Deno mirror of resolveCommissionLeadSource() in src/types/commissions.ts —
    // KEEP IN SYNC (this file cannot import from src/). Explicit allow-list, not the
    // old /self/i regex: `referral` is a COMPANY lead (the company's referral-partner
    // program bore the acquisition cost, per Schedule A), and the regex would also
    // have matched any future lead_source merely containing "self". IMPORTANT_TODO #2.
    const SELF_GEN_LEAD_SOURCES = ["self_generated", "self_gen", "selfgen"];
    const leadSource: "company" | "self_generated" | "renewal" = isRenewal
      ? "renewal"
      : SELF_GEN_LEAD_SOURCES.includes((deal.lead_source ?? "").trim().toLowerCase())
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
