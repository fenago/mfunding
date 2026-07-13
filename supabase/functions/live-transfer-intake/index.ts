// live-transfer-intake — AUTO-INTAKE for Synergy (Double-Verified) leads.
//
// Handles TWO Synergy lead products off the SAME sales@send.mfunding.net inbox:
//   • LIVE TRANSFER — subject "Live Transfer! …". A merchant is being phone-
//     transferred to a closer right now.
//   • REAL-TIME / APPOINTMENT — a pre-qualified merchant Synergy emails in the
//     instant they hang up (subject varies: "Real Time", "Appointment", "New
//     Lead", etc.). Same qualification data, same speed-to-lead urgency.
//
// A GHL workflow fires on inbound email → Webhook → this function. This endpoint
// is the REAL gate (fail-closed secret + trusted-delivery-domain + valid-merchant
// checks), so the workflow can safely fire on ALL inbound email — ordinary mail
// (funder replies, chatter) is ignored as a cheap no-op that never messages
// anyone and never writes to activity_log.
//
// For a genuine transfer we classify it, parse the label/value table, auto-create
// a customer + MCA deal, a PROPER GHL contact (the merchant — NOT the junk sender
// contact) + an MCA-pipeline opportunity, mirror every fact onto the contact's
// custom fields, born HOT with a 5-minute speed-to-lead clock (top of My Day), and
// email the team an urgent alert (a live transfer = they're on the line now; a
// real-time lead = call them within 5 min).
//
// SELF-HEALING: when a NEW sender on a trusted delivery domain emails for the
// first time, the function itself tags that sender contact `lt-source` and sets
// all-channel DND — so new Synergy sender addresses are adopted with zero human
// steps (no more "remember to tag the sender").
//
// HARD-REJECT: a transfer that parses to the delivery robot's own address, or with
// no valid merchant phone, creates NOTHING (never arm a nurture from the robot) —
// but DOES alert the team so a real lead never dies silently.
//
// Deployed with verify_jwt = false (GHL workflow webhooks can't send a Supabase
// JWT). Authenticates IN CODE via a shared secret (?secret=… or x-lt-secret),
// resolved from the vault (LIVE_TRANSFER_SECRET) — FAIL CLOSED.
//
// Accepts EITHER:
//   • a GHL-workflow Webhook POST (fires on the inbound email). The body text may
//     be included ({{message.body}}); if not, we fetch the newest inbound email on
//     the conversation via the GHL API (same email-record technique as
//     get-funder-email).
//   • a direct structured POST (future Zapier): { company, first_name, last_name,
//     phone, email, state, industry, monthly_deposits, requested_amount,
//     use_of_funds, fico, open_positions, positions_balance, best_time, agent }.
//     Structured posts default to live_transfer unless { kind: "realtime" }.
//
// Compliance: MCA = purchase of future receivables, NOT a loan. This function
// creates internal records + an internal team alert only — no merchant-facing
// product claims.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig, ghlFetch,
  upsertContact, createOpportunity, listPipelines, sendEmailToContact,
  listCustomFields, updateContactCustomFields, addContactTags, getContact,
  type GhlConfig,
} from "../_shared/ghl.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Config (kept simple, top of file) ────────────────────────────────────────
// A "Live Transfer!" subject (or, when the webhook carries no subject, the same
// marker in the body head) is what distinguishes a live transfer from a real-time
// lead — everything else about the two emails is identical.
const LIVE_TRANSFER_SUBJECT_MARKER = "live transfer";
// Trusted lead-delivery domains. A sender on one of these is a Synergy delivery
// robot; add more domains here as vendors/senders change — no code change needed.
const TRUSTED_DELIVERY_DOMAINS = ["double-verified.com"];
// Canonical MFunding MCA pipeline (same id ghl-webhook keys off, so stage changes round-trip).
const MCA_PIPELINE_ID = "bG9ZEh4eP9x60E1CyaMx";
// Speed-to-lead SLA — REAL-TIME LEADS ONLY.
//
// live_transfer = the vendor WARM-TRANSFERS the merchant to us ON THE PHONE. They
//                 are already on the line. There is no callback window; the call is
//                 the event. No SLA clock.
// realtime      = an email-delivered lead. Nobody is on the phone. The closer must
//                 call them, and this is the window they have to do it in.
const FIRST_CALL_SLA_MS = 5 * 60 * 1000;
// Can we actually TELL a live transfer from a real-time lead?
//
// No. Today Synergy sends BOTH products to sales@send.mfunding.net with the same
// subject ("Live Transfer! …"), the same sender, and an identical body. There is no
// discriminator in the email — so the classifier calls everything live_transfer.
//
// Flip this to TRUE the moment the two products land on two different addresses
// (set campaigns.tracking_email for SYN-LT and SYN-RT). Until then, anything that
// keys off the live_transfer label is really keying off "a Synergy lead" and must
// behave accordingly — see first_call_due_at below.
const CAN_DISTINGUISH_KINDS = false;
// Urgent internal alert recipients.
const TEAM_ALERT_TO = "socrates73@gmail.com";
const TEAM_ALERT_CC = ["cmarq2k8@gmail.com"];
const PLAYBOOK_URL = "https://mfunding.net/admin/playbooks";
// Dedupe window: same phone/email within this many days → no duplicate deal.
const DEDUPE_WINDOW_DAYS = 30;
// Self-healing sender adoption: the tag the LT-intake workflow keys off + the
// all-channel DND we stamp so a lead-delivery robot is never messaged. Mirrors
// what was set by hand on the original sender contact.
const SENDER_ADOPT_TAG = "lt-source";
const SENDER_DND_SETTINGS = {
  Email: { status: "active", message: "Lead-delivery robot — never message" },
  SMS: { status: "active", message: "Lead-delivery robot" },
  Call: { status: "active", message: "Lead-delivery robot" },
};

// ── Lead-kind configuration ───────────────────────────────────────────────────
// The two products share ALL the machinery below; only these strings differ.
// customerSource must be a valid value of the `lead_source` Postgres enum
// (customers.source is that enum). The enum has NO realtime value, and the manual
// capture path already stamps 'other' for every Synergy lead, so real-time
// customers get 'other'. The DEAL's lead_source (free text) carries 'realtime_appt'
// — that's what LEAD_SOURCE_TO_PLAYBOOK keys off to open the Real-Time playbook.
type LeadKind = "live_transfer" | "realtime";
interface KindConfig {
  kind: LeadKind;
  leadSource: string;        // deals.lead_source (text) — routes the playbook
  customerSource: string;    // customers.source (lead_source enum) — MUST be a valid enum value
  campaignChannel: string;   // campaigns.channel to attribute against
  detailPrefix: string;      // deals.lead_source_detail prefix
  notesHeader: string;       // first line of the deal notes
  activitySubject: string;   // activity_log subject marker (queryable)
  ghlTags: string[];
  ghlSource: string;
  alertSubjectPrefix: string;
  alertHeaderHtml: string;
  alertHeaderText: string;
  alertIntro: string;        // one-line intro in the alert body (HTML allowed)
}
const LIVE_TRANSFER_CFG: KindConfig = {
  kind: "live_transfer",
  leadSource: "live_transfer",
  customerSource: "live_transfer",
  campaignChannel: "live_transfer",
  detailPrefix: "Synergy live transfer",
  notesHeader: "Live transfer — Synergy (Double-Verified).",
  activitySubject: "live-transfer:intake",
  ghlTags: ["live-transfer", "synergy", "merchant"],
  ghlSource: "Live Transfer",
  alertSubjectPrefix: "🔴 LIVE TRANSFER",
  alertHeaderHtml: "🔴 LIVE TRANSFER — MERCHANT IS ON THE LINE NOW",
  alertHeaderText: "LIVE TRANSFER — MERCHANT IS ON THE LINE NOW",
  alertIntro:
    "The vendor is <b>warm-transferring this merchant to us on the phone right now</b> — they are already on the line. " +
    "This email is the RECORD of that transfer, not a callback request. There is no 5-minute clock: take the call.",
};
const REALTIME_CFG: KindConfig = {
  kind: "realtime",
  leadSource: "realtime_appt",
  customerSource: "other",
  campaignChannel: "realtime_transfer",
  detailPrefix: "Synergy real-time",
  notesHeader: "Real-time lead — Synergy (Double-Verified).",
  activitySubject: "realtime:intake",
  ghlTags: ["real-time", "synergy", "merchant"],
  ghlSource: "Real-Time Lead",
  alertSubjectPrefix: "🔴 REAL-TIME LEAD",
  alertHeaderHtml: "🔴 REAL-TIME LEAD — CALL WITHIN 5 MINUTES",
  alertHeaderText: "REAL-TIME LEAD — CALL WITHIN 5 MINUTES",
  alertIntro: "A Synergy real-time lead just came in — the merchant just finished with Synergy and expects a call <b>right now</b>.",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Constant-time string compare (mirrors ghl-webhook) so the secret gate doesn't
// leak match length/prefix via response timing.
function timingSafeEqualStr(provided: string, expected: string): boolean {
  const enc = new TextEncoder();
  const a = enc.encode(provided);
  const b = enc.encode(expected);
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

// ── Parsing helpers ──────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&#0?39;/g, "'").replace(/&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

// HTML email body → a flat list of non-empty text cells (the label/value table
// collapses to alternating label, value, label, value…). Also works on plain
// text (no tags → one segment per line).
function htmlToSegments(html: string): string[] {
  const withBreaks = html
    .replace(/<\s*(br|\/td|\/tr|\/p|\/div|\/h[1-6]|\/li)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(withBreaks)
    .split(/\n|\r/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

const normLabel = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// canonical key → the label text(s) as they appear in the Double-Verified email.
const LABEL_DEFS: Array<[string, string[]]> = [
  ["company", ["Company Name"]],
  ["contact_name", ["Contact Name"]],
  ["phone", ["Contact's Phone", "Contacts Phone", "Phone"]],
  ["email", ["Contact Email", "Email"]],
  ["state", ["State"]],
  ["industry", ["Industry"]],
  ["best_time", ["What is the best time to reach you?"]],
  ["fax", ["Fax"]],
  ["is_owner", ["Are You The Owner?"]],
  ["time_as_owner", ["How long have you been the owner?"]],
  ["monthly_deposits", ["How much do you deposit per month?"]],
  ["need_money_now", ["Do You Need Money Right Away??", "Do You Need Money Right Away?"]],
  ["requested_amount", ["Requested Amount"]],
  ["use_of_funds", ["Why do they want the funds?"]],
  ["difficulty_approved", ["Have you had difficulty getting approved"]],
  ["processes_cc", ["Do you process credit cards?"]],
  ["fico", ["FICO"]],
  ["has_equity", ["Do you have equity?"]],
  ["property_paid_down", ["Is your property paid down at least 50%?"]],
  ["positions_balance", ["What Are The Balances of The Loans?"]],
  ["open_positions", ["How Many Loans Do You Have Right Now?"]],
  ["agent", ["Select the Company or Agent"]],
];

const LABEL_TO_KEY = new Map<string, string>();
for (const [key, variants] of LABEL_DEFS) for (const v of variants) LABEL_TO_KEY.set(normLabel(v), key);
const LABEL_SET = new Set(LABEL_TO_KEY.keys());

// Walk the label/value cell sequence: each label cell's value is the next cell
// that isn't itself a label.
function parseLabelValue(segments: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < segments.length; i++) {
    const key = LABEL_TO_KEY.get(normLabel(segments[i]));
    if (!key || out[key]) continue;
    const next = segments[i + 1];
    if (next && !LABEL_SET.has(normLabel(next))) out[key] = next.trim();
  }
  return out;
}

/**
 * First number in a messy vendor string.
 *
 * The old version stripped every non-digit and parsed what was left, which silently
 * MANGLED any range: FICO "700-750" became 700750, and "$10,000-$15,000" became
 * 1000015000. Those numbers then flowed into underwriting and the funder-matching
 * screens as if they were real. Take the FIRST number instead — a range's lower
 * bound is the conservative read, and it can't invent a value that was never stated.
 */
const numFrom = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const m = String(v).match(/\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;                       // "N/A", "", "unknown" → null, not 0
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/**
 * Pull a real US phone out of messy text and return E.164, or "" if there isn't one.
 *
 * The old version only accepted an exact 10 digits, or 11 starting with 1 — anything
 * else it handed back verbatim, which then failed isValidMerchantPhone() and HARD-
 * REJECTED the whole lead. So a merchant whose phone arrived as
 * "(708) 616-3446 ext 12" was thrown away entirely. Losing a real, qualified lead
 * because of a formatting quirk in a field we don't even control is indefensible.
 *
 * Now: strip to digits, drop a leading country code, and scan for the first window
 * that is a valid NANP number (area code and exchange can't start with 0 or 1). That
 * survives extensions, a second number trailing the first, and stray punctuation.
 */
function phoneNorm(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";

  const take = (d: string): string | null => {
    if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
    if (d.length !== 10) return null;
    // NANP: NPA and NXX both start 2–9. This is what stops a random digit window
    // (a zip, an EIN, a dollar figure) from being mistaken for a phone number.
    if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return null;
    return `+1${d}`;
  };

  const whole = take(digits);
  if (whole) return whole;

  for (let i = 0; i + 10 <= digits.length; i++) {
    const hit = take(digits.slice(i, i + 10));
    if (hit) return hit;
  }
  return "";
}

// Domain of an email address ("Marcus <a@b.com>" → "b.com").
function emailDomain(addr: string): string {
  const m = String(addr).toLowerCase().match(/@\s*([a-z0-9.-]+)/);
  return m ? m[1].replace(/[.>)\s]+$/, "") : "";
}
// Is this address on a trusted lead-delivery domain (a Synergy robot)?
function isTrustedDomain(addr: string): boolean {
  const d = emailDomain(addr);
  return !!d && TRUSTED_DELIVERY_DOMAINS.some((t) => d === t || d.endsWith(`.${t}`));
}
// A real US merchant phone after normalization (+1 then 10 digits). Rejects the
// empty/garbage phone a mis-parse leaves behind.
function isValidMerchantPhone(p: string): boolean {
  return /^\+1\d{10}$/.test(p);
}

// The canonical lead shape both intake modes produce.
interface Lead {
  business: string;
  first: string;
  last: string;
  phone: string;        // normalized
  phoneRaw: string;
  email: string;
  state: string;
  industry: string;
  monthlyDeposits: number | null;
  requestedAmount: number | null;
  useOfFunds: string;
  fico: number | null;
  openPositions: number | null;
  positionsBalance: number | null;
  bestTime: string;
  agent: string;
  isOwner: string;
  timeAsOwner: string;
  needMoneyNow: string;
  difficultyApproved: string;
  processesCc: string;
  hasEquity: string;
  propertyPaidDown: string;
  raw: Record<string, string>; // everything parsed, verbatim
}

function toLead(f: Record<string, unknown>): Lead {
  const s = (k: string) => (f[k] == null ? "" : String(f[k]).trim());
  // contact_name (email mode) OR first_name/last_name (structured mode).
  let first = s("first_name");
  let last = s("last_name");
  if (!first && !last && s("contact_name")) {
    const n = splitName(s("contact_name"));
    first = n.first; last = n.last;
  }
  const phoneRaw = s("phone");
  return {
    business: s("company"),
    first, last,
    phone: phoneRaw ? phoneNorm(phoneRaw) : "",
    phoneRaw,
    email: s("email").toLowerCase(),
    state: s("state"),
    industry: s("industry"),
    monthlyDeposits: numFrom(f["monthly_deposits"]),
    requestedAmount: numFrom(f["requested_amount"]),
    useOfFunds: s("use_of_funds"),
    fico: numFrom(f["fico"]),
    openPositions: numFrom(f["open_positions"]),
    positionsBalance: numFrom(f["positions_balance"]),
    bestTime: s("best_time"),
    agent: s("agent"),
    isOwner: s("is_owner"),
    timeAsOwner: s("time_as_owner"),
    needMoneyNow: s("need_money_now"),
    difficultyApproved: s("difficulty_approved"),
    processesCc: s("processes_cc"),
    hasEquity: s("has_equity"),
    propertyPaidDown: s("property_paid_down"),
    raw: Object.fromEntries(Object.entries(f).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)])),
  };
}

// Is this a GHL webhook wrapper (an inbound EMAIL delivered to us) rather than a
// direct structured lead POST? These keys only ever appear on a GHL payload.
function looksLikeGhlWebhook(b: Record<string, unknown>): boolean {
  return [
    "contact_id", "contactId", "conversationId", "conversation_id",
    "locationId", "location_id", "customData", "messageType", "webhookId",
  ].some((k) => b[k] != null && b[k] !== "");
}

/**
 * Does this look like a Double-Verified structured POST (vs a GHL webhook wrapper)?
 *
 * THIS IS THE BUG THAT ATE A REAL LEAD (Robert Young / ECS Holdings, Jul 13).
 *
 * A GHL webhook for an inbound email carries the CONTACT's own fields —
 * first_name, last_name, company, email, phone. And on a lead-delivery email that
 * contact is the DELIVERY ROBOT (e.g. "Live Transfer for Agentic Voice Inc!" /
 * info@double-verified.com), never the merchant.
 *
 * The old test fired on `first_name` alone, so every GHL-delivered transfer looked
 * "structured": we ingested GHL's ~116 payload keys as the lead, took the robot's
 * address as the merchant email, found no merchant phone, and NEVER PARSED THE
 * EMAIL BODY — where the actual merchant is. The parse-failure alert then reported
 * "Fields parsed: 116", which is the tell: there are only ~23 real labels.
 *
 * Two changes:
 *   1. A GHL webhook is NEVER structured. The body is the lead; go parse it.
 *   2. Only LEAD-SPECIFIC keys may trigger structured mode — ones GHL does not
 *      send. company/first_name/last_name are too generic and are exactly what
 *      fooled it.
 */
const STRUCTURED_LEAD_KEYS = [
  "requested_amount", "monthly_deposits", "positions_balance", "open_positions",
  "use_of_funds", "fico", "time_as_owner",
];
function looksStructured(b: Record<string, unknown>): boolean {
  if (looksLikeGhlWebhook(b)) return false; // the email body is the source of truth
  return STRUCTURED_LEAD_KEYS.some((k) => b[k] != null && b[k] !== "");
}

// Pull the email body text out of a GHL webhook payload's many possible shapes.
function extractBodyText(b: Record<string, unknown>): string {
  const cands = [
    b.body, b.email_body, b.emailBody, b.message, b.text, b.html, b.email, b.emailContent,
    (b.message as Record<string, unknown> | undefined)?.body,
    (b.email as Record<string, unknown> | undefined)?.body,
    (b.customData as Record<string, unknown> | undefined)?.body,
  ];
  for (const c of cands) {
    if (typeof c === "string" && /contact|requested amount|company name|select the company/i.test(c)) return c;
  }
  // Fall back to any long string field that mentions the labels.
  for (const c of cands) if (typeof c === "string" && c.length > 40) return c;
  return "";
}

// Pull an email SUBJECT out of a GHL webhook payload. Body-embedded mode carries
// no subject on its own, but we need it to tell a live transfer from a real-time
// lead — so check every shape the workflow might send it in.
function extractSubject(b: Record<string, unknown>): string {
  for (const k of ["subject", "email_subject", "emailSubject", "mailSubject", "title"]) {
    const v = b[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  for (const nest of ["message", "email", "customData"]) {
    const o = b[nest] as Record<string, unknown> | undefined;
    const v = o?.subject;
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

// Pull the SENDER address out of a GHL webhook payload (for trusted-domain gating
// + self-heal). The workflow contact IS the sender, so contact.email works too.
function extractFrom(b: Record<string, unknown>): string {
  for (const k of ["from", "emailFrom", "email_from", "fromEmail", "sender"]) {
    const v = b[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  for (const nest of ["message", "email", "customData", "contact"]) {
    const o = b[nest] as Record<string, unknown> | undefined;
    const v = (o?.from ?? o?.email ?? o?.emailFrom);
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

// Pull the DELIVERY address (To/emailTo — the address the inbound lead landed on)
// out of a GHL webhook payload. This is what identifier attribution matches a
// campaign's tracking_email against. The email-record fetch path fills this in from
// the record's `to` field; here we cover the shapes a webhook might send directly.
function extractTo(b: Record<string, unknown>): string {
  for (const k of ["to", "emailTo", "email_to", "toEmail", "deliveredTo", "delivered_to", "recipient"]) {
    const v = b[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Array.isArray(v) && v.length) return v.map((x) => String(x)).join(", ");
  }
  for (const nest of ["message", "email", "customData"]) {
    const o = b[nest] as Record<string, unknown> | undefined;
    const v = (o?.to ?? o?.emailTo ?? o?.email_to);
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Array.isArray(v) && v.length) return v.map((x) => String(x)).join(", ");
  }
  return "";
}

// All bare email addresses in a To/recipient string, lowercased. Handles
// "Name <a@b.com>, c@d.com" and array-joined forms.
function extractAddresses(s: string): string[] {
  const out: string[] = [];
  const re = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push(m[0].toLowerCase());
  return out;
}

// FUTURE HOOK — the GHL tracking number a live-transfer CALL landed on. GHL's
// inbound-email webhooks do NOT carry this today (the intake is email-driven), so
// this returns "" in practice; wired so phone attribution activates the moment a
// call/voice webhook that carries the dialed tracking number is pointed here.
function extractDeliveryPhone(b: Record<string, unknown>): string {
  for (const k of ["calledNumber", "called_number", "toNumber", "to_number", "dialedNumber", "trackingNumber", "tracking_number"]) {
    const v = b[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  for (const nest of ["message", "call", "customData"]) {
    const o = b[nest] as Record<string, unknown> | undefined;
    const v = (o?.calledNumber ?? o?.toNumber ?? o?.dialedNumber ?? o?.trackingNumber);
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function pickId(b: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = b[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

// One fetched GHL email record, flattened. `recordId` is the STABLE, unique id of
// the email itself — it is what synergy_intake_log is keyed on and what lets the
// reconciliation sweep re-drive one SPECIFIC email (see email_record_id below).
interface FetchedEmail {
  recordId: string;
  body: string;
  subject: string;
  from: string;
  to: string;
  conversationId: string;
  contactId: string;
  dateAdded: string;   // when GHL received it — the ledger's received_at
}

// Fetch ONE email record by its GHL email-record id. This is the re-drive path:
// the sweep found an inbound lead email that never produced a deal and hands us
// its id so we process THAT email — not merely "the newest one on the thread",
// which is what made recovery a manual job.
async function fetchEmailRecord(cfg: GhlConfig, recordId: string): Promise<FetchedEmail | null> {
  const e = await ghlFetch<{ emailMessage?: Record<string, unknown> } & Record<string, unknown>>(
    cfg, "GET", `/conversations/messages/email/${recordId}`,
  );
  const em = (e.data?.emailMessage ?? e.data ?? {}) as Record<string, unknown>;
  const body = String(em.body ?? "");
  if (!body) return null;
  const to = Array.isArray(em.to)
    ? (em.to as unknown[]).map((x) => String(x)).join(", ")
    : String(em.to ?? "");
  return {
    recordId,
    body,
    subject: String(em.subject ?? ""),
    from: String(em.from ?? ""),
    to,
    conversationId: String(em.conversationId ?? ""),
    contactId: String(em.contactId ?? ""),
    dateAdded: String(em.dateAdded ?? ""),
  };
}

// Fetch the newest INBOUND email body on a GHL conversation (by conversation id,
// or resolved from a contact id). Uses the email-record technique from
// get-funder-email: conversation message → meta.email.messageIds → email record.
async function newestInboundEmail(
  cfg: GhlConfig,
  ids: { conversationId?: string; contactId?: string },
): Promise<FetchedEmail | null> {
  let cid = ids.conversationId ?? "";
  if (!cid && ids.contactId) {
    const c = await ghlFetch<{ conversations?: Array<{ id: string }> }>(
      cfg, "GET", `/conversations/search?locationId=${cfg.locationId}&contactId=${ids.contactId}`,
    );
    cid = c.data?.conversations?.[0]?.id ?? "";
  }
  if (!cid) return null;
  const msgs = await ghlFetch<{ messages?: { messages?: Array<Record<string, unknown>> } }>(
    cfg, "GET", `/conversations/${cid}/messages?limit=25`,
  );
  const arr = msgs.data?.messages?.messages ?? [];
  for (const m of arr) {
    if (!/email/i.test(String(m.messageType ?? ""))) continue;
    if (String(m.direction ?? "").toLowerCase() === "outbound") continue;
    const recIds = (m.meta as { email?: { messageIds?: string[] } } | undefined)?.email?.messageIds ?? [];
    const recId = recIds[recIds.length - 1];
    if (!recId) continue;
    const fetched = await fetchEmailRecord(cfg, recId);
    if (fetched?.body) {
      return { ...fetched, conversationId: fetched.conversationId || cid, contactId: fetched.contactId || (ids.contactId ?? "") };
    }
  }
  return null;
}

// ── The intake ledger (synergy_intake_log) ───────────────────────────────────
// Every terminal path writes here, keyed by the email-record id, so the
// reconciliation sweep can prove that every inbound lead email produced a deal.
// BEST-EFFORT ONLY: a logging failure must NEVER break an intake — a lead is worth
// more than its audit row.
interface IntakeLogRow {
  ghl_email_record_id: string;
  ghl_conversation_id?: string | null;
  ghl_contact_id?: string | null;
  from_email?: string | null;
  subject?: string | null;
  received_at?: string | null;
  outcome: "created" | "deduped" | "rejected";
  deal_id?: string | null;
  customer_id?: string | null;
  reject_reason?: string | null;
  notes?: string | null;
}
async function logIntake(db: SupabaseClient, row: IntakeLogRow | null): Promise<void> {
  if (!row?.ghl_email_record_id) return;  // structured POSTs carry no email record
  try {
    const { error } = await db.from("synergy_intake_log")
      .upsert({ ...row, updated_at: new Date().toISOString() },
        { onConflict: "ghl_email_record_id" });
    if (error) console.error("live-transfer-intake: synergy_intake_log write failed", { id: row.ghl_email_record_id, error: error.message });
  } catch (e) {
    console.error("live-transfer-intake: synergy_intake_log threw", { error: e instanceof Error ? e.message : String(e) });
  }
}

// ── Self-healing sender adoption ───────────────────────────────────────────────
// A trusted-domain sender that isn't yet registered gets the lt-source tag + all-
// channel DND, so a NEW Synergy sender address is adopted the first time it emails.
// Idempotent: returns adopted=false (no announce) when it was already registered.
async function adoptSender(
  cfg: GhlConfig, senderContactId: string,
): Promise<{ adopted: boolean; address: string; error?: string }> {
  try {
    const c = await getContact(cfg, senderContactId);
    const contact = c.data?.contact as Record<string, unknown> | undefined;
    if (!contact) return { adopted: false, address: "", error: c.error || "sender contact not found" };
    const address = String(contact.email ?? "");
    const tags = ((contact.tags as string[] | undefined) ?? []).map((t) => String(t).toLowerCase());
    const hasTag = tags.includes(SENDER_ADOPT_TAG);
    const dndOn = contact.dnd === true;
    if (hasTag && dndOn) return { adopted: false, address };
    if (!hasTag) await addContactTags(cfg, senderContactId, [SENDER_ADOPT_TAG]);
    if (!dndOn) await ghlFetch(cfg, "PUT", `/contacts/${senderContactId}`, { dnd: true, dndSettings: SENDER_DND_SETTINGS });
    return { adopted: true, address };
  } catch (e) {
    return { adopted: false, address: "", error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Team alert (shared) ────────────────────────────────────────────────────────
interface AlertOpts {
  subject: string;
  headerHtml: string;
  headerText: string;
  intro: string;
  rows: Array<[string, string | null]>;
  note?: string;      // e.g. "new Synergy sender auto-registered: …"
  headerBg?: string;  // default red
}
async function sendTeamAlert(cfg: GhlConfig, o: AlertOpts): Promise<{ sent: boolean; error?: string }> {
  try {
    // Send through the alerts inbox contact (owner's address); CC the rest of the
    // team. No name fields on the upsert so we never clobber an existing record.
    const alert = await upsertContact(cfg, { email: TEAM_ALERT_TO, tags: ["internal-alerts"], source: "Synergy Intake Alert" });
    const alertContactId = alert.data?.contact?.id;
    if (!alertContactId) return { sent: false, error: alert.error || "no alert contact id" };
    const trs = o.rows.filter(([, v]) => v).map(
      ([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#64748b;white-space:nowrap">${k}</td><td style="padding:4px 0;color:#0f172a;font-weight:600">${v}</td></tr>`,
    ).join("");
    const noteHtml = o.note ? `<p style="margin:0 0 10px;font-size:13px;color:#7c3aed;font-weight:600">${o.note}</p>` : "";
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px">
<div style="background:${o.headerBg ?? "#dc2626"};color:#fff;font-size:16px;font-weight:700;padding:12px 16px;border-radius:8px 8px 0 0">${o.headerHtml}</div>
<div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 8px 8px;padding:16px">
${noteHtml}<p style="margin:0 0 10px;font-size:14px;color:#0f172a">${o.intro}</p>
${trs ? `<table style="font-size:14px;border-collapse:collapse">${trs}</table>` : ""}
<p style="margin:14px 0 0"><a href="${PLAYBOOK_URL}" style="background:#2563eb;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:6px;display:inline-block">Open the Playbook →</a></p>
</div></div>`;
    const text = `${o.headerText}\n\n${o.note ? o.note + "\n\n" : ""}${o.rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nOpen the playbook: ${PLAYBOOK_URL}`;
    const sr = await sendEmailToContact(cfg, alertContactId, o.subject, html, { text, emailCc: TEAM_ALERT_CC });
    return { sent: sr.ok, error: sr.ok ? undefined : sr.error };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── GHL custom fields ─────────────────────────────────────────────────────────
// EVERY fact from the Synergy email is mirrored onto the merchant's GHL contact so
// nothing is lost on the GHL side. Fields are resolved by NAME against the
// location's existing custom fields (reusing ~8 that already fit); the 10
// Synergy-specific facts that had no home are created once (lazy, idempotent — a
// create only fires if the named field is missing). dataType is used only when a
// field must be created. Values go out as {id, value} via updateContactCustomFields.
const CUSTOM_FIELD_PLAN: Array<{ name: string; dataType: string; get: (l: Lead) => string | number | "" }> = [
  // Reused existing fields (exact names from the location's custom-field set).
  { name: "Business Name", dataType: "TEXT", get: (l) => l.business },
  { name: "Owner Full Name", dataType: "TEXT", get: (l) => `${l.first} ${l.last}`.trim() },
  { name: "Industry (Doc)", dataType: "TEXT", get: (l) => l.industry },
  { name: "Average Monthly Deposits", dataType: "MONETORY", get: (l) => l.monthlyDeposits ?? "" },
  { name: "Funding Amount Requested", dataType: "MONETORY", get: (l) => l.requestedAmount ?? "" },
  { name: "Use of Funds (Doc)", dataType: "TEXT", get: (l) => l.useOfFunds },
  { name: "Total Outstanding MCA Balance", dataType: "MONETORY", get: (l) => l.positionsBalance ?? "" },
  { name: "Active MCA Positions", dataType: "NUMERICAL", get: (l) => l.openPositions ?? "" },
  // New Synergy-specific fields (created if missing).
  { name: "Best Time To Reach", dataType: "TEXT", get: (l) => l.bestTime },
  { name: "Years As Owner", dataType: "TEXT", get: (l) => l.timeAsOwner },
  { name: "Needs Money Right Away", dataType: "TEXT", get: (l) => l.needMoneyNow },
  { name: "Difficulty Getting Approved", dataType: "TEXT", get: (l) => l.difficultyApproved },
  { name: "Processes Credit Cards", dataType: "TEXT", get: (l) => l.processesCc },
  { name: "FICO (Self-Reported)", dataType: "NUMERICAL", get: (l) => l.fico ?? "" },
  { name: "Has Equity", dataType: "TEXT", get: (l) => l.hasEquity },
  { name: "Property 50%+ Paid", dataType: "TEXT", get: (l) => l.propertyPaidDown },
  { name: "Lead Agent / Source Company", dataType: "TEXT", get: (l) => l.agent },
  { name: "Fax", dataType: "TEXT", get: (l) => l.raw["fax"] ?? "" },
];

async function writeContactCustomFields(
  cfg: GhlConfig, contactId: string, lead: Lead,
): Promise<{ written: number; created: string[]; ok: boolean; error?: string }> {
  const cf = await listCustomFields(cfg);
  const byName = new Map((cf.data?.customFields ?? []).map((f) => [f.name.toLowerCase(), f.id]));
  const fields: Array<{ id: string; value: string | number }> = [];
  const created: string[] = [];
  for (const spec of CUSTOM_FIELD_PLAN) {
    const val = spec.get(lead);
    if (val === "" || val === null || val === undefined) continue;
    let id = byName.get(spec.name.toLowerCase());
    if (!id) {
      const cr = await ghlFetch<{ customField?: { id: string } }>(
        cfg, "POST", `/locations/${cfg.locationId}/customFields`,
        { name: spec.name, dataType: spec.dataType, model: "contact" },
      );
      id = cr.data?.customField?.id;
      if (id) { created.push(spec.name); byName.set(spec.name.toLowerCase(), id); }
    }
    if (id) fields.push({ id, value: val });
  }
  if (!fields.length) return { written: 0, created, ok: true };
  const res = await updateContactCustomFields(cfg, contactId, fields);
  return { written: fields.length, created, ok: res.ok, error: res.error };
}

// ── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();

  // GHL config (also the source of the shared secret). Needed up front.
  let cfg: GhlConfig | null = null;
  let cfgErr = "";
  let expectedSecret = "";
  try {
    const { data } = await db.rpc("get_ghl_config");
    expectedSecret = (data?.live_transfer_secret as string | undefined) ?? "";
    const apiKey = data?.api_key as string | undefined;
    const locationId = data?.location_id as string | undefined;
    if (apiKey && locationId) cfg = { apiKey, locationId };
  } catch (e) { cfgErr = e instanceof Error ? e.message : String(e); }
  if (!expectedSecret) expectedSecret = Deno.env.get("LIVE_TRANSFER_SECRET") ?? "";

  // ── Shared-secret gate (FAIL CLOSED) ──
  if (!expectedSecret) return json({ error: "server auth not configured" }, 503);
  const url = new URL(req.url);
  const provided = url.searchParams.get("secret") ?? req.headers.get("x-lt-secret") ?? "";
  if (!provided || !timingSafeEqualStr(provided, expectedSecret)) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { body = {}; }

  // The sender's own GHL contact (the workflow contact = whoever emailed us). Used
  // for trusted-domain gating + self-heal — NEVER the merchant contact we create.
  const senderContactId = pickId(body, ["contactId", "contact_id", "id"]) ||
    (typeof (body.contact as Record<string, unknown> | undefined)?.id === "string"
      ? String((body.contact as Record<string, unknown>).id) : "");

  // ── Resolve the canonical lead ──
  let fields: Record<string, string>;
  let sourceMode: "structured" | "email-body" | "ghl-fetch" | "email-record";
  let emailSubject = "";
  let emailFrom = "";
  let emailTo = "";   // delivery address (To) — matched against campaigns.tracking_email
  let bodyForMarker = ""; // raw body text used to sniff markers/structure

  // RE-DRIVE HOOK — the reconciliation sweep (synergy-reconcile) passes the
  // email-record id of a SPECIFIC inbound lead email that never became a deal.
  // Without this the intake could only ever fetch the NEWEST email on the thread,
  // which is exactly why recovering the Detroit Mobile Car Repair lead had to be
  // done by hand.
  const requestedRecordId = pickId(body, ["email_record_id", "emailRecordId", "emailMessageId"]);
  // The GHL email record this run is about. Null for structured POSTs (no email).
  let emailRecordId = "";
  let logConversationId = pickId(body, ["conversationId", "conversation_id", "conversation"]);
  let logContactId = senderContactId;
  let receivedAt: string | null = null;

  if (requestedRecordId) {
    if (!cfg) return json({ error: `GHL not configured: ${cfgErr || "missing credentials"}` }, 502);
    const fetched = await fetchEmailRecord(cfg, requestedRecordId);
    if (!fetched) return json({ error: `email record ${requestedRecordId} not found or has no body` }, 422);
    sourceMode = "email-record";
    emailRecordId = fetched.recordId;
    emailSubject = fetched.subject;
    emailFrom = fetched.from;
    emailTo = fetched.to;
    logConversationId = fetched.conversationId || logConversationId;
    logContactId = fetched.contactId || logContactId;
    receivedAt = fetched.dateAdded || null;
    bodyForMarker = fetched.body;
    fields = parseLabelValue(htmlToSegments(fetched.body));
  } else if (looksStructured(body)) {
    sourceMode = "structured";
    fields = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v == null ? "" : String(v)]));
    emailFrom = extractFrom(body);
    emailTo = extractTo(body);
  } else {
    let bodyText = extractBodyText(body);
    emailSubject = extractSubject(body);
    emailFrom = extractFrom(body);
    emailTo = extractTo(body);
    if (bodyText) {
      sourceMode = "email-body";
    } else {
      // Fetch the newest inbound email from GHL using whatever id the webhook sent.
      if (!cfg) return json({ error: `GHL not configured: ${cfgErr || "missing credentials"}` }, 502);
      const conversationId = pickId(body, ["conversationId", "conversation_id", "conversation"]);
      const fetched = await newestInboundEmail(cfg, { conversationId, contactId: senderContactId });
      if (!fetched) return json({ error: "no inbound email body found (payload carried no body and no resolvable conversation/contact id)" }, 422);
      bodyText = fetched.body;
      emailSubject = fetched.subject || emailSubject;
      emailFrom = fetched.from || emailFrom;
      emailTo = fetched.to || emailTo;
      emailRecordId = fetched.recordId;
      logConversationId = fetched.conversationId || logConversationId;
      logContactId = fetched.contactId || logContactId;
      receivedAt = fetched.dateAdded || null;
      sourceMode = "ghl-fetch";
    }
    bodyForMarker = bodyText;
    fields = parseLabelValue(htmlToSegments(bodyText));
  }
  // The ledger row this run will write on whatever terminal path it takes. Only
  // an email-sourced run has one (a structured POST has no GHL email record).
  const logBase = emailRecordId
    ? {
      ghl_email_record_id: emailRecordId,
      ghl_conversation_id: logConversationId || null,
      ghl_contact_id: logContactId || null,
      from_email: emailFrom || null,
      subject: emailSubject || null,
      received_at: receivedAt,
    }
    : null;
  // The tracking number a live-transfer call landed on (future hook; empty today).
  const deliveryPhone = extractDeliveryPhone(body);

  const lead = toLead(fields);
  if (emailSubject) lead.raw["_email_subject"] = emailSubject;
  if (emailFrom) lead.raw["_email_from"] = emailFrom;
  if (emailTo) lead.raw["_email_to"] = emailTo;

  // ── CLASSIFY: live transfer vs real-time ──
  // The ONLY discriminator is the "Live Transfer!" subject (checked in the body
  // head too, since body-embedded webhooks carry no subject). Anything else from
  // the trusted sender that parses into a lead is a real-time / appointment lead.
  const subjLower = emailSubject.toLowerCase();
  let isLiveTransfer: boolean;
  if (sourceMode === "structured") {
    // Structured posts are the (future) Zapier path; default to live_transfer to
    // preserve existing behavior, unless the caller explicitly says realtime.
    const explicit = String(body.kind ?? body.lead_kind ?? body.lead_type ?? "").toLowerCase();
    isLiveTransfer = explicit ? explicit.includes("live") : true;
  } else {
    isLiveTransfer =
      subjLower.includes(LIVE_TRANSFER_SUBJECT_MARKER) ||
      (!emailSubject && /live\s*transfer/i.test(bodyForMarker.slice(0, 400)));
  }
  const kcfg = isLiveTransfer ? LIVE_TRANSFER_CFG : REALTIME_CFG;

  // Trust signal: sender is on a trusted delivery domain, OR the subject marks it a
  // live transfer. Structured POSTs are an intentional (secret-gated) API call.
  const senderTrusted = isTrustedDomain(emailFrom);
  const looksLikeTransfer = isLiveTransfer || senderTrusted || sourceMode === "structured";

  // ── GATE 1 — ordinary inbound (funder reply, chatter, random email) ──
  // With the workflow now firing on ALL inbound email, THIS endpoint is the gate:
  // no trust signal + no live-transfer subject → pure no-op. Never messages anyone,
  // never writes activity_log. Just a log line so firing on everything is harmless.
  if (!looksLikeTransfer) {
    console.log("live-transfer-intake: ignored non-transfer inbound", { from: emailFrom, subject: emailSubject, parsedFields: Object.keys(fields).length });
    return json({ ok: true, ignored: true, reason: "not a Synergy transfer (untrusted sender + no live-transfer subject) — ignored" });
  }

  // ── SELF-HEAL — adopt a new trusted sender (tag lt-source + DND). Idempotent. ──
  let adoptNote = "";
  if (cfg && senderTrusted && senderContactId) {
    const ad = await adoptSender(cfg, senderContactId);
    if (ad.adopted) adoptNote = `🆕 New Synergy sender auto-registered: ${ad.address || emailFrom} — lt-source tag + all-channel DND set.`;
    if (ad.error) console.error("live-transfer-intake: sender adopt issue", { senderContactId, error: ad.error });
  }

  // ── HARD-REJECT robot-as-lead / invalid merchant BEFORE creating anything ──
  // If the parser mis-aligned and grabbed the delivery robot's own address as the
  // lead email, or there's no real merchant phone, we must NOT arm a customer /
  // deal / opportunity / nurture from the robot. A genuine-looking transfer that
  // fails this still gets a LOUD alert so a real lead never dies silently; a plain
  // human reply (no lead structure) is skipped quietly.
  const leadEmailTrusted = Boolean(lead.email && isTrustedDomain(lead.email));
  const hasIdentity = Boolean(lead.first || lead.last || lead.business);
  const phoneOk = isValidMerchantPhone(lead.phone);
  // The merchant's OWN email (not the delivery robot's) is also a way to reach them.
  const hasReachableEmail = Boolean(lead.email && !leadEmailTrusted);

  // A BAD PHONE NO LONGER KILLS THE LEAD.
  //
  // This used to require a perfectly-formed phone, so a merchant whose number arrived
  // with an extension — or in any shape the normalizer didn't like — was DISCARDED
  // outright, name, business, email and all. That is the wrong trade: an unclean phone
  // is a data-quality problem, a dropped lead is lost revenue. phoneNorm() is now far
  // more forgiving, and if it still can't find a number we keep the lead anyway so
  // long as we can identify AND reach the merchant some other way (their own email).
  //
  // What must STILL be rejected is the robot: if the parsed lead email is the delivery
  // robot's own address, we have no merchant at all and must not arm a nurture from it.
  const validMerchant = hasIdentity && !leadEmailTrusted && (phoneOk || hasReachableEmail);
  const phoneNeedsReview = validMerchant && !phoneOk;
  const parsedCount = Object.keys(fields).length;

  if (!validMerchant) {
    const hasLeadStructure = parsedCount >= 2 ||
      /requested amount|company name|select the company|contact name|deposit per month/i.test(bodyForMarker);
    const alertOnFailure = isLiveTransfer || hasLeadStructure;
    let alertSent = false;
    let alertWarning: string | undefined;
    if (alertOnFailure && cfg) {
      const reasonBits = [
        leadEmailTrusted ? "parsed lead email is the delivery robot's address" : null,
        !isValidMerchantPhone(lead.phone) ? "no valid merchant phone extracted" : null,
        !hasIdentity ? "no merchant name/business extracted" : null,
      ].filter(Boolean).join("; ");
      const r = await sendTeamAlert(cfg, {
        subject: "⚠️ SYNERGY TRANSFER — PARSE FAILURE, REVIEW MANUALLY",
        headerHtml: "⚠️ TRANSFER RECEIVED — COULD NOT EXTRACT A VALID MERCHANT",
        headerText: "TRANSFER RECEIVED — COULD NOT EXTRACT A VALID MERCHANT",
        headerBg: "#b45309",
        intro: `A ${kcfg.kind.replace("_", " ")} email came in but we could not extract a valid merchant (${reasonBits}). NOTHING was created — review this one by hand so a real lead doesn't die silently.`,
        note: adoptNote || undefined,
        rows: [
          ["From", emailFrom || null],
          ["Subject", emailSubject || null],
          ["Parsed name", `${lead.first} ${lead.last}`.trim() || lead.business || null],
          ["Parsed phone", lead.phoneRaw || lead.phone || null],
          ["Parsed email", lead.email || null],
          ["Fields parsed", String(parsedCount)],
        ],
      });
      alertSent = r.sent;
      alertWarning = r.error;
      if (!r.sent) console.error("live-transfer-intake: parse-failure alert issue", { alertWarning });
    }
    console.log("live-transfer-intake: rejected — no valid merchant", { kind: kcfg.kind, from: emailFrom, leadEmailTrusted, hasIdentity, phoneValid: isValidMerchantPhone(lead.phone) });
    // LEDGER: a rejected lead email is EXACTLY the failure mode that killed a lead.
    // Record it so the sweep can find it and re-drive it after a parser fix.
    await logIntake(db, logBase && {
      ...logBase,
      outcome: "rejected",
      reject_reason: [
        leadEmailTrusted ? "parsed lead email is the delivery robot's address" : null,
        !isValidMerchantPhone(lead.phone) ? "no valid merchant phone extracted" : null,
        !hasIdentity ? "no merchant name/business extracted" : null,
      ].filter(Boolean).join("; ") || "no valid merchant",
      notes: `kind=${kcfg.kind} mode=${sourceMode} parsedFields=${parsedCount}`,
    });
    return json({
      ok: true, rejected: true, kind: kcfg.kind,
      reason: alertOnFailure
        ? "could not extract a valid merchant — team alerted for manual review"
        : "trusted sender, no parseable lead (likely a human reply) — skipped",
      alertSent, adopted: Boolean(adoptNote),
    });
  }

  const fullName = `${lead.first} ${lead.last}`.trim() || lead.business || (isLiveTransfer ? "Live Transfer Lead" : "Real-Time Lead");

  // Tolerance flag (never LOSE a lead): a real-time email in an unexpected format
  // still becomes a lead, but we mark it for a human to eyeball the parse.
  const variantFlag = (!isLiveTransfer && parsedCount < 5)
    ? " ⚠️ format variant — review parse (fewer fields than a standard Synergy lead)."
    : "";

  // We KEPT this lead despite an unparseable phone (see validMerchant above). Say so
  // loudly everywhere a human will look, so nobody discovers it by dialing a dead
  // number in front of a merchant.
  const phoneFlag = phoneNeedsReview
    ? ` ⚠️ PHONE COULD NOT BE PARSED — raw value from the vendor: "${lead.phoneRaw || "(none)"}". Lead was KEPT (we can still reach them at ${lead.email}); fix the number before calling.`
    : "";

  // ── DEDUPE: same phone/email with a same-kind deal in the last 30 days ──
  const sinceIso = new Date(Date.now() - DEDUPE_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
  const candIds = new Set<string>();
  if (lead.email) {
    const { data } = await db.from("customers").select("id").eq("email", lead.email);
    for (const c of data ?? []) candIds.add(c.id as string);
  }
  if (lead.phone) {
    const { data } = await db.from("customers").select("id").eq("phone", lead.phone);
    for (const c of data ?? []) candIds.add(c.id as string);
  }
  let existingCustomerId: string | null = candIds.size ? [...candIds][0] : null;
  if (candIds.size) {
    const { data: dup } = await db.from("deals")
      .select("id, deal_number, customer_id, created_at")
      .in("customer_id", [...candIds])
      .eq("lead_source", kcfg.leadSource)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();
    if (dup) {
      // DEDUPE = don't create a second deal. It does NOT mean "throw the new data
      // away", which is what this used to do: it logged a note and returned, so a
      // re-send carrying fresher qualification (revenue, FICO, requested amount,
      // positions) was silently discarded and the deal kept stale numbers.
      //
      // The merchant is the same; the DATA may be newer. So refresh the customer and
      // top up the deal — without clobbering anything a human has since typed. Only
      // fill fields that are still empty, plus always refresh lead_qual (the vendor's
      // raw answers) and re-stamp the contact details, which are the whole point of a
      // re-send.
      const { data: cur } = await db.from("customers").select("*").eq("id", dup.customer_id).maybeSingle();
      if (cur) {
        const fresh: Record<string, unknown> = { lead_qual: lead.raw, temperature: "hot" };
        const fill = (col: string, val: unknown) => {
          if (val == null || val === "") return;
          const existing = (cur as Record<string, unknown>)[col];
          if (existing == null || existing === "") fresh[col] = val;      // fill gaps
        };
        // Contact details always refresh — a re-send is the vendor correcting them.
        if (lead.phone) fresh.phone = lead.phone;
        if (lead.email) fresh.email = lead.email;
        fill("first_name", lead.first);
        fill("last_name", lead.last);
        fill("business_name", lead.business);
        fill("state", lead.state);
        fill("industry", lead.industry);
        fill("monthly_revenue", lead.monthlyDeposits);
        fill("credit_score", lead.fico);
        await db.from("customers").update(fresh).eq("id", dup.customer_id).then(() => {}, () => {});
      }

      const { data: curDeal } = await db.from("deals").select("*").eq("id", dup.id).maybeSingle();
      if (curDeal) {
        const dpatch: Record<string, unknown> = { lead_qual: lead.raw, temperature: "hot" };
        const d = curDeal as Record<string, unknown>;
        if ((d.amount_requested == null) && lead.requestedAmount != null) dpatch.amount_requested = lead.requestedAmount;
        if ((d.use_of_funds == null || d.use_of_funds === "") && lead.useOfFunds) dpatch.use_of_funds = lead.useOfFunds;
        await db.from("deals").update(dpatch).eq("id", dup.id).then(() => {}, () => {});
      }

      await db.from("activity_log").insert({
        entity_type: "deal", entity_id: dup.id,
        interaction_type: "note",
        subject: kcfg.activitySubject.replace(":intake", ":dedupe"),
        content:
          `Duplicate ${kcfg.kind} intake — no second deal created (same ${lead.email ? "email" : "phone"} within ${DEDUPE_WINDOW_DAYS}d), ` +
          `but the record was REFRESHED from this email. Incoming: ${fullName} / ${lead.business} / ${lead.phone || lead.email}.`,
      }).then(() => {}, () => {});
      await logIntake(db, logBase && {
        ...logBase,
        outcome: "deduped",
        deal_id: dup.id as string,
        customer_id: dup.customer_id as string,
        notes: `Duplicate ${kcfg.kind} — refreshed existing deal ${dup.deal_number ?? dup.id}.`,
      });
      return json({
        ok: true, deduped: true, refreshed: true, kind: kcfg.kind,
        dealId: dup.id, dealNumber: dup.deal_number, customerId: dup.customer_id,
      });
    }
  }

  // ── Upsert the CUSTOMER ──
  const custPatch: Record<string, unknown> = {
    first_name: lead.first || null,
    last_name: lead.last || null,
    email: lead.email || null,
    phone: lead.phone || null,
    business_name: lead.business || null,
    address_state: lead.state || null,
    industry: lead.industry || null,
    monthly_revenue: lead.monthlyDeposits,
    amount_requested: lead.requestedAmount,
    use_of_funds: lead.useOfFunds || null,
    source: kcfg.customerSource,
    is_live_transfer: true,
    temperature: "hot",
    lead_qual: lead.raw,
  };
  let customerId: string;
  if (existingCustomerId) {
    // Only fill gaps — never blank out existing data.
    const { data: cur } = await db.from("customers").select("*").eq("id", existingCustomerId).maybeSingle();
    const merged: Record<string, unknown> = { is_live_transfer: true, temperature: "hot", lead_qual: lead.raw };
    for (const [k, v] of Object.entries(custPatch)) {
      if (v == null || v === "") continue;
      if (cur && (cur[k] == null || cur[k] === "")) merged[k] = v;
    }
    await db.from("customers").update(merged).eq("id", existingCustomerId);
    customerId = existingCustomerId;
  } else {
    const { data: c, error } = await db.from("customers").insert({ status: "lead", ...custPatch }).select("id").single();
    if (error) return json({ error: `could not create customer: ${error.message}` }, 500);
    customerId = c.id as string;
  }

  // ── Resolve the attribution campaign ──
  // Order:
  //   (a) IDENTIFIER — an active campaign whose tracking_email matches the delivery
  //       (To) address of this inbound email → use it REGARDLESS of channel. A
  //       tracking_phone match is the same idea for calls (future hook; the number
  //       a live transfer dialed isn't in the email webhook today).
  //   (b) CHANNEL — newest active campaign on this lead kind's channel (Synergy
  //       partner preferred). The prior behavior, now the fallback.
  //   (c) NONE — campaign_id stays null. Attribution must NEVER fail the intake.
  let campaignId: string | null = null;
  let attributionNote = "";
  let attributionRule: "tracking_email" | "tracking_phone" | "channel" | "none" = "none";
  {
    const deliveryAddrs = extractAddresses(emailTo);
    const deliveryPhoneDigits = deliveryPhone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

    // (a) identifier match — email first, then phone (future hook).
    if (deliveryAddrs.length || deliveryPhoneDigits) {
      const { data: idCamps } = await db.from("campaigns")
        .select("id, code, tracking_email, tracking_phone, created_at")
        .eq("status", "active")
        .order("created_at", { ascending: false });
      const list = idCamps ?? [];
      const emailMatch = deliveryAddrs.length
        ? list.find((c) => {
            const te = String(c.tracking_email ?? "").trim().toLowerCase();
            return te && deliveryAddrs.includes(te);
          })
        : undefined;
      if (emailMatch) {
        campaignId = emailMatch.id as string;
        attributionRule = "tracking_email";
        attributionNote = `Attributed to ${emailMatch.code ?? emailMatch.id} via tracking email (${emailMatch.tracking_email}).`;
      } else if (deliveryPhoneDigits) {
        const phoneMatch = list.find((c) => {
          const tp = String(c.tracking_phone ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
          return tp && tp === deliveryPhoneDigits;
        });
        if (phoneMatch) {
          campaignId = phoneMatch.id as string;
          attributionRule = "tracking_phone";
          attributionNote = `Attributed to ${phoneMatch.code ?? phoneMatch.id} via tracking phone (${phoneMatch.tracking_phone}).`;
        }
      }
    }

    // (b) channel-based fallback.
    if (!campaignId) {
      const { data: camps } = await db.from("campaigns")
        .select("id, code, partner, created_at")
        .eq("channel", kcfg.campaignChannel)
        .eq("status", "active")
        .order("created_at", { ascending: false });
      const clist = camps ?? [];
      const synergy = clist.find((c) => /synergy/i.test(String(c.partner ?? "")));
      const chosen = synergy ?? clist[0] ?? null;
      campaignId = (chosen?.id as string | undefined) ?? null;
      attributionRule = chosen ? "channel" : "none";
      attributionNote = chosen
        ? `Attributed to active ${kcfg.campaignChannel} campaign ${chosen.code ?? chosen.id}${synergy ? " (Synergy)" : ""} via channel${emailTo ? ` (delivery ${emailTo} matched no tracking email)` : ""}.`
        : `No active ${kcfg.campaignChannel} campaign found — deal left unattributed (campaign_id null).`;
    }
  }

  // ── Create the DEAL — born HOT with a 5-minute call clock ──
  const now = Date.now();
  const { data: deal, error: dErr } = await db.from("deals").insert({
    customer_id: customerId,
    deal_type: "mca",
    status: "new",
    lead_source: kcfg.leadSource,
    lead_source_detail: `${kcfg.detailPrefix}${lead.agent ? ` · ${lead.agent}` : ""}`,
    amount_requested: lead.requestedAmount,
    use_of_funds: lead.useOfFunds || null,
    campaign_id: campaignId,
    temperature: "hot",
    urgency: /yes/i.test(lead.needMoneyNow) ? "high" : null,
    // THE CLOCK STAYS ON UNTIL WE CAN ACTUALLY TELL THE TWO PRODUCTS APART.
    //
    // In principle the 5-minute speed-to-lead clock belongs to REAL-TIME leads only:
    // a LIVE TRANSFER is a warm phone handoff — the merchant is already on the line,
    // there is nothing to "call back".
    //
    // But TODAY both products arrive at sales@ with the identical subject
    // ("Live Transfer! …"), so the classifier labels EVERYTHING live_transfer. Gating
    // the clock on that label therefore removes it from real-time leads too — and a
    // real-time lead with no clock is a dead lead. So while the kinds are
    // indistinguishable we always set it:
    //   • truly a warm handoff → the closer is already on the phone; the clock is
    //     harmless noise they ignore.
    //   • truly a real-time lead → the clock is the ONLY thing that makes them call.
    // Asymmetric risk: a spurious clock costs nothing, a missing one loses the lead.
    //
    // Flip CAN_DISTINGUISH_KINDS to true once Synergy delivers the two products to
    // two different addresses (campaigns.tracking_email) — then live transfers
    // correctly stop carrying a callback deadline.
    first_call_due_at: (isLiveTransfer && CAN_DISTINGUISH_KINDS)
      ? null
      : new Date(now + FIRST_CALL_SLA_MS).toISOString(),
    lead_qual: lead.raw,
    notes: [
      kcfg.notesHeader,
      lead.business && `Business: ${lead.business}`,
      lead.state && `State: ${lead.state}`,
      lead.industry && `Industry: ${lead.industry}`,
      lead.monthlyDeposits != null && `Monthly deposits: $${lead.monthlyDeposits.toLocaleString()}`,
      lead.requestedAmount != null && `Requested: $${lead.requestedAmount.toLocaleString()}`,
      lead.fico != null && `FICO: ${lead.fico}`,
      lead.openPositions != null && `Open positions: ${lead.openPositions}`,
      lead.positionsBalance != null && `Positions balance: $${lead.positionsBalance.toLocaleString()}`,
      lead.timeAsOwner && `Time as owner: ${lead.timeAsOwner}`,
      lead.bestTime && `Best time to reach: ${lead.bestTime}`,
    ].filter(Boolean).join("\n"),
  }).select("id, deal_number").single();
  if (dErr) return json({ error: `could not create deal: ${dErr.message}` }, 500);
  const dealId = deal.id as string;
  const dealNumber = deal.deal_number as string | null;

  // ── Full audit: the entire parsed payload, nothing lost ──
  await db.from("activity_log").insert({
    entity_type: "deal", entity_id: dealId,
    interaction_type: "note",
    subject: kcfg.activitySubject,
    content: `Auto-created from ${sourceMode} ${kcfg.kind} lead. ${attributionNote}${variantFlag}${phoneFlag}${adoptNote ? `\n${adoptNote}` : ""}\n${JSON.stringify(lead.raw, null, 2)}`,
  }).then(() => {}, () => {});

  // ── LEDGER: this email produced a deal. Written BEFORE the GHL sync so a GHL
  // hiccup can never leave a real deal looking like a dropped lead to the sweep. ──
  await logIntake(db, logBase && {
    ...logBase,
    outcome: "created",
    deal_id: dealId,
    customer_id: customerId,
    notes: `${kcfg.kind} · ${lead.business || fullName} · ${dealNumber ?? dealId} (mode=${sourceMode})`,
  });

  // ── GHL: proper merchant contact + MCA opportunity at "New Lead" ──
  let ghlContactId: string | null = null;
  let ghlOpportunityId: string | null = null;
  let ghlWarning: string | undefined;
  let customFieldsWritten = 0;
  let customFieldsCreated: string[] = [];
  if (cfg) {
    try {
      const cr = await upsertContact(cfg, {
        firstName: lead.first || null,
        lastName: lead.last || null,
        name: (!lead.first && !lead.last) ? fullName : null,
        email: lead.email || null,
        phone: lead.phone || null,
        companyName: lead.business || null,
        state: lead.state || null,
        tags: kcfg.ghlTags,
        source: kcfg.ghlSource,
      });
      ghlContactId = cr.data?.contact?.id ?? null;
      if (!ghlContactId) {
        ghlWarning = cr.error || "GHL upsert returned no contact id";
      } else {
        await db.from("customers").update({ ghl_contact_id: ghlContactId }).eq("id", customerId);
        await db.from("deals").update({ ghl_contact_id: ghlContactId }).eq("id", dealId);
        // Mirror EVERY email fact onto the contact (standard fields above +
        // custom fields here) so nothing is lost on the GHL side.
        try {
          const cfr = await writeContactCustomFields(cfg, ghlContactId, lead);
          customFieldsWritten = cfr.written;
          customFieldsCreated = cfr.created;
          if (!cfr.ok) ghlWarning = `custom fields: ${cfr.error}`;
        } catch (e) {
          ghlWarning = `custom fields: ${e instanceof Error ? e.message : String(e)}`;
        }
        const pl = await listPipelines(cfg);
        const mca = pl.data?.pipelines?.find((p) => p.id === MCA_PIPELINE_ID)
          ?? pl.data?.pipelines?.find((p) => {
            const n = new Set(p.stages.map((s) => s.name.toLowerCase()));
            return n.has("new lead") && n.has("renewal eligible");
          });
        const stage = mca?.stages.find((s) => s.name.toLowerCase() === "new lead") ?? mca?.stages[0];
        if (mca && stage) {
          const opp = await createOpportunity(cfg, {
            pipelineId: mca.id, pipelineStageId: stage.id, contactId: ghlContactId,
            name: lead.business || fullName,
            monetaryValue: lead.requestedAmount ?? undefined,
          });
          ghlOpportunityId = opp.data?.opportunity?.id ?? null;
          // GHL allows only ONE opportunity per contact; a repeat transfer of the
          // same merchant 400s with the existing opportunity's id — reuse it so the
          // deal is still linked rather than orphaned.
          if (!ghlOpportunityId && opp.error) {
            try {
              const m = JSON.parse(opp.error) as { meta?: { existingId?: string } };
              if (m?.meta?.existingId) ghlOpportunityId = m.meta.existingId;
            } catch { /* not a JSON error body */ }
          }
          if (ghlOpportunityId) await db.from("deals").update({ ghl_opportunity_id: ghlOpportunityId }).eq("id", dealId);
        }
      }
    } catch (e) {
      ghlWarning = e instanceof Error ? e.message : String(e);
    }
    if (ghlWarning) console.error(`live-transfer-intake: GHL sync issue (${kcfg.kind})`, { dealId, ghlWarning });
  } else {
    ghlWarning = `GHL not configured: ${cfgErr || "missing credentials"}`;
  }

  // ── Urgent internal alert to the team (best-effort) ──
  let alertSent = false;
  let alertWarning: string | undefined;
  if (cfg) {
    const r = await sendTeamAlert(cfg, {
      subject: `${kcfg.alertSubjectPrefix}: ${fullName} / ${lead.business || "—"} — CALL WITHIN 5 MIN`,
      headerHtml: kcfg.alertHeaderHtml,
      headerText: kcfg.alertHeaderText,
      intro: kcfg.alertIntro,
      note: adoptNote || undefined,
      rows: [
        ["Contact", fullName],
        ["Business", lead.business || null],
        ["Phone", lead.phoneRaw || lead.phone || null],
        ["Email", lead.email || null],
        ["State", lead.state || null],
        ["Industry", lead.industry || null],
        ["Requested", lead.requestedAmount != null ? `$${lead.requestedAmount.toLocaleString()}` : null],
        ["Monthly deposits", lead.monthlyDeposits != null ? `$${lead.monthlyDeposits.toLocaleString()}` : null],
        ["FICO", lead.fico != null ? String(lead.fico) : null],
        ["Open positions", lead.openPositions != null ? String(lead.openPositions) : null],
        ["Best time", lead.bestTime || null],
        ["Deal #", dealNumber],
        ["Attribution", attributionNote || null],
      ],
    });
    alertSent = r.sent;
    alertWarning = r.error;
    if (!r.sent) console.error(`live-transfer-intake: alert email issue (${kcfg.kind})`, { dealId, alertWarning });
  }

  return json({
    ok: true,
    deduped: false,
    kind: kcfg.kind,
    leadSource: kcfg.leadSource,
    dealId,
    dealNumber,
    customerId,
    campaignId,
    attributionRule,
    ghlContactId,
    ghlOpportunityId,
    customFieldsWritten,
    customFieldsCreated,
    ghlWarning,
    alertSent,
    alertWarning,
    adopted: Boolean(adoptNote),
    mode: sourceMode,
    emailRecordId: emailRecordId || null,
    variant: variantFlag ? true : false,
    phoneNeedsReview,
    parsedFields: parsedCount,
  });
});
