// coldEmail — the PURE logic behind the GHL <-> Instantly cold-email wiring
// (instantly-enroll = send side, instantly-event-hook = return side).
//
// Nothing in this file does I/O. Everything that decides something lives here so
// it can be unit-tested (coldEmail.test.ts) without a network, a database or a key.
//
// THE TWO HALVES
//   send   : a GHL workflow (tag `camp-micro-bitty` added) POSTs the contact to
//            instantly-enroll, which adds it to the Instantly pilot campaign ONLY
//            when the address is verified deliverable.
//   return : Instantly POSTs webhook events to instantly-event-hook. A reply or a
//            positive label becomes a cold_email deal + GHL opportunity + setter task;
//            a click becomes a call task; an unsubscribe becomes GHL EMAIL DND; a
//            bounce marks the address unsendable so it is never enrolled again.

import type { EmailHealth } from "./instantly.ts";

// ── Shared constants ─────────────────────────────────────────────────────────

/** platform_settings key holding this wiring's config (one jsonb object). */
export const SETTINGS_KEY = "cold_email";

/** Opportunity Source label setters filter the MCA pipeline by. */
export const OPP_SOURCE = "Cold Email – Micro";

/** Instantly's {{industry}} renders mid-sentence ("a lot of {{industry}} owners"),
 *  so a blank is visible to the merchant. Always send something. */
export const INDUSTRY_FALLBACK = "small business";

export const TAG_REPLIED = "cold-email-replied";
export const TAG_EMAIL_INVALID = "email-invalid";
export const TAG_UNSUBSCRIBED = "cold-email-unsubscribed";

// ── Send side: the GHL webhook payload ──────────────────────────────────────

export interface EnrollInput {
  contactId: string;
  email: string;        // lower-cased, trimmed; "" when absent
  firstName: string;
  lastName: string;
  companyName: string;
  industry: string;     // never blank — INDUSTRY_FALLBACK when unknown
  industryWasFallback: boolean;
  /** true only when the caller asked for the TEST campaign (harness). */
  test: boolean;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

function firstNonEmpty(...vals: unknown[]): string {
  for (const v of vals) {
    const s = str(v);
    if (s) return s;
  }
  return "";
}

/**
 * Normalise GHL's Custom Webhook body. GHL sends the standard contact fields at the
 * top level (contact_id, first_name, last_name, email, company_name, ...) plus a
 * `customData` object holding whatever keys the workflow author typed in. We read
 * customData FIRST (the explicit contract), then the standard fields, so a workflow
 * built either way works.
 */
export function parseEnrollPayload(body: Record<string, unknown>): EnrollInput {
  const cd = (body.customData && typeof body.customData === "object")
    ? body.customData as Record<string, unknown> : {};
  const contact = (body.contact && typeof body.contact === "object")
    ? body.contact as Record<string, unknown> : {};

  const industryRaw = firstNonEmpty(cd.industry, body.industry, contact.industry);
  // A GHL merge tag that resolved to nothing arrives as the literal tag text in
  // some workflow builds ("{{contact.industry}}") — treat it as blank.
  const industryClean = /\{\{.*\}\}/.test(industryRaw) ? "" : industryRaw;

  const testRaw = firstNonEmpty(cd.test, body.test);
  return {
    contactId: firstNonEmpty(cd.contact_id, body.contact_id, body.contactId, contact.id),
    email: firstNonEmpty(cd.email, body.email, contact.email).toLowerCase(),
    firstName: firstNonEmpty(cd.first_name, body.first_name, body.firstName, contact.firstName),
    lastName: firstNonEmpty(cd.last_name, body.last_name, body.lastName, contact.lastName),
    companyName: firstNonEmpty(cd.company_name, cd.business_name, body.company_name, body.companyName,
      body.business_name, contact.companyName),
    industry: industryClean || INDUSTRY_FALLBACK,
    industryWasFallback: !industryClean,
    test: testRaw === "true" || testRaw === "1",
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isPlausibleEmail = (e: string) => EMAIL_RE.test(e);

// ── Send side: the enrollment decision ───────────────────────────────────────

export type EnrollDecision =
  | "enroll"                 // verified deliverable → add to Instantly
  | "verify_first"           // no verdict on file → ask Instantly, then re-decide
  | "refuse_invalid"         // Instantly says the mailbox does not exist → tag GHL email-invalid
  | "refuse_bounced"         // a real send already hard-bounced → never again
  | "refuse_unverifiable"    // catch_all / risky / unresolved → not provably deliverable
  | "refuse_suppressed";     // DND / unsubscribed / prior bounce event

/**
 * The verification gate. ONLY "verified" enrolls: cold email to an address we
 * cannot prove is real burns sender reputation for all 30 mailboxes, so the bar is
 * higher here than for a merchant-facing transactional send (where UNSENDABLE in
 * _shared/instantly.ts deliberately lets catch_all/risky/unknown through).
 *
 * `afterVerification` = this verdict came from the on-the-fly check, so "unknown"
 * now means "we asked and still couldn't tell" → refuse, rather than loop.
 */
export function decideEnrollment(
  health: EmailHealth | null,
  opts: { suppressed: boolean; afterVerification?: boolean },
): EnrollDecision {
  if (opts.suppressed) return "refuse_suppressed";
  if (health === "bounced") return "refuse_bounced";
  if (health === "invalid") return "refuse_invalid";
  if (health === "verified") return "enroll";
  if (health === "catch_all" || health === "risky") return "refuse_unverifiable";
  // null (never checked) or "unknown"
  return opts.afterVerification ? "refuse_unverifiable" : "verify_first";
}

/** Worst-wins merge across every place a verdict for one address can live.
 *  Proof (bounced) > prediction (invalid) > doubt > pass. */
const HEALTH_RANK: Record<EmailHealth, number> = {
  bounced: 6, invalid: 5, risky: 4, catch_all: 3, unknown: 2, verified: 1,
};
export function worstHealth(values: Array<string | null | undefined>): EmailHealth | null {
  let best: EmailHealth | null = null;
  for (const v of values) {
    if (!v || !(v in HEALTH_RANK)) continue;
    const h = v as EmailHealth;
    if (!best || HEALTH_RANK[h] > HEALTH_RANK[best]) best = h;
  }
  return best;
}

/** Instantly's create-lead body. custom_variables carry the GHL contact id back to
 *  us on every webhook event (Instantly merges lead data into the payload), so the
 *  return side never has to search GHL by email. */
export function buildInstantlyLead(campaignId: string, inp: EnrollInput): Record<string, unknown> {
  return {
    campaign: campaignId,
    email: inp.email,
    first_name: inp.firstName || undefined,
    last_name: inp.lastName || undefined,
    company_name: inp.companyName || undefined,
    // Instantly-side dedupe: never add the same address twice to this campaign.
    skip_if_in_campaign: true,
    custom_variables: {
      industry: inp.industry,
      ghl_contact_id: inp.contactId,
    },
  };
}

// ── Return side: the Instantly webhook event ────────────────────────────────

/** Subscription names from the LIVE API (GET /api/v2/webhooks/event-types,
 *  2026-11-16). NOTE the docs page (guides/webhook-events) lists the click as
 *  `link_clicked`, but POST /webhooks rejects that and only accepts
 *  `email_link_clicked` — so the classifier accepts BOTH spellings for the delivered
 *  payload. Anything else — including workspace CUSTOM LABELS, which Instantly
 *  sends as the event_type verbatim — is parked, never dropped. */
export const REGISTERED_EVENTS = [
  "reply_received",
  "lead_interested",
  "email_link_clicked",
  "lead_unsubscribed",
  "email_bounced",
  "custom_label_any_positive",
] as const;

export type EventAction =
  | "reply"          // reply_received / lead_interested → deal + opp + setter task
  | "click"          // link_clicked → call task
  | "unsubscribe"    // lead_unsubscribed (or an opt-out reply) → GHL email DND
  | "bounce"         // email_bounced → mark unsendable
  | "park";          // unknown / unreadable → kept for a human, no side effects

export interface InstantlyEvent {
  eventType: string;
  timestamp: string;
  campaignId: string;
  campaignName: string;
  leadEmail: string;     // lower-cased
  emailId: string;
  step: string;
  variant: string;
  replyText: string;
  replySubject: string;
  unibox: string;
  ghlContactId: string;  // from our custom_variables, when Instantly echoes them
  firstName: string;
  lastName: string;
  companyName: string;
  phone: string;
  industry: string;
}

export function parseInstantlyEvent(body: Record<string, unknown>): InstantlyEvent {
  // Instantly merges the lead's fields (incl. custom variables) into the payload as
  // extra keys. Some workspaces nest them under `payload`/`lead`; read both.
  const nested = [body.payload, body.lead, body.custom_variables]
    .filter((v): v is Record<string, unknown> => !!v && typeof v === "object");
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const top = str(body[k]);
      if (top) return top;
      for (const n of nested) {
        const s = str(n[k]);
        if (s) return s;
      }
    }
    return "";
  };
  return {
    eventType: str(body.event_type),
    timestamp: str(body.timestamp),
    campaignId: str(body.campaign_id),
    campaignName: str(body.campaign_name),
    leadEmail: pick("lead_email", "email").toLowerCase(),
    emailId: str(body.email_id),
    step: str(body.step),
    variant: str(body.variant),
    replyText: pick("reply_text", "reply_text_snippet"),
    replySubject: str(body.reply_subject),
    unibox: str(body.unibox_url),
    ghlContactId: pick("ghl_contact_id"),
    firstName: pick("first_name", "firstName"),
    lastName: pick("last_name", "lastName"),
    companyName: pick("company_name", "companyName"),
    phone: pick("phone"),
    industry: pick("industry"),
  };
}

/** Phrases that mean "stop emailing me". The campaign's footer tells merchants to
 *  reply "stop" (docs/campaigns/momentum-micro-bitty.md, blocker 2), so a reply IS
 *  the opt-out channel and must be honoured as one — turning it into a deal and a
 *  setter call would be the opposite of what they asked for. Only the reply's OWN
 *  text is checked (quoted history below it would contain our footer, which itself
 *  says "stop"). */
const OPT_OUT_RE =
  /^(?:please\s+)?(?:stop|unsubscribe|remove(?:\s+me)?|opt[\s-]?out|take\s+me\s+off|do\s+not\s+(?:contact|email)|don'?t\s+(?:contact|email))\b/i;

/** The reply's own words: everything above the first quoted-history marker. */
export function ownReplyText(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) break;
    if (/^\s*On .+wrote:\s*$/i.test(line)) break;
    if (/^\s*-{2,}\s*Original Message/i.test(line)) break;
    if (/^\s*From:\s/i.test(line) && out.length) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

export function isOptOutReply(text: string): boolean {
  const own = ownReplyText(text);
  if (!own) return false;
  // Judge the first non-empty line, and only SHORT ones: "Stop by our shop on
  // Tuesday, I'd like $20k" starts with "stop" and is a lead, not an opt-out.
  const first = (own.split("\n").find((l) => l.trim()) ?? "").trim();
  if (own.length > 160 || first.length > 60) return false;
  return OPT_OUT_RE.test(first);
}

export function classifyEvent(ev: InstantlyEvent): { action: EventAction; reason: string } {
  if (!ev.eventType) return { action: "park", reason: "no event_type — unreadable payload" };
  if (!ev.leadEmail && ev.eventType !== "campaign_completed") {
    return { action: "park", reason: `${ev.eventType} without lead_email — cannot attach to a merchant` };
  }
  switch (ev.eventType) {
    case "reply_received":
      return isOptOutReply(ev.replyText)
        ? { action: "unsubscribe", reason: "reply is an opt-out (\"stop\") — honoured as unsubscribe, no deal" }
        : { action: "reply", reason: "reply received" };
    case "lead_interested":
      return { action: "reply", reason: "lead labelled interested" };
    case "link_clicked":
    case "email_link_clicked":
      return { action: "click", reason: "tracked link clicked" };
    case "lead_unsubscribed":
      return { action: "unsubscribe", reason: "lead unsubscribed" };
    case "email_bounced":
      return { action: "bounce", reason: "email bounced" };
    default:
      return { action: "park", reason: `unhandled event_type "${ev.eventType}" — parked for review` };
  }
}

/**
 * Instantly's payload carries NO event id (verified against the documented schema:
 * timestamp, event_type, workspace, campaign_id, lead_email, email_id, step,
 * variant, ...). The idempotency key is therefore DERIVED from the fields that
 * identify one occurrence; a retry of the same delivery reproduces them exactly.
 * If Instantly ever adds an id we prefer it.
 */
export async function eventKey(body: Record<string, unknown>, ev: InstantlyEvent): Promise<string> {
  const explicit = str(body.id) || str(body.event_id) || str(body.webhook_event_id);
  if (explicit) return `id:${explicit}`;
  const basis = [ev.eventType, ev.campaignId, ev.leadEmail, ev.timestamp, ev.emailId, ev.step, ev.variant].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(basis));
  return "h:" + Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Return side: small helpers ──────────────────────────────────────────────

/** Split a reply's sender name when the lead record lacks one. customers.first_name
 *  and last_name are NOT NULL, so never return undefined. */
export function nameParts(first: string, last: string, email: string): { first: string; last: string } {
  if (first || last) return { first: first || "", last: last || "" };
  const local = email.split("@")[0] ?? "";
  const guess = local.replace(/[._\-+0-9]+/g, " ").trim();
  return { first: guess ? guess.charAt(0).toUpperCase() + guess.slice(1) : "Cold email", last: "" };
}

/** A setter task's due date: soon, on the business clock is the setter's job. */
export function dueIn(minutes: number, now = Date.now()): string {
  return new Date(now + minutes * 60_000).toISOString();
}

/** Constant-time compare for the shared secret. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}
