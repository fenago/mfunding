// funderDecline — capture the FULL text of what a funder wrote, and parse the
// decline out of it.
//
// THE PROBLEM THIS SOLVES: every path that mirrors a funder email (the
// vendor-conversation-sweep, the poll-funder-replies pull, the ghl-webhook push)
// wrote only a ~200-char preview into activity_log. The decline REASON — the one
// piece of permanent box intel a "no" gives us — was truncated away and lived only
// inside GHL. captureFunderReply() persists the complete body once, keyed for
// idempotency, in funder_replies. parseFunderReply() turns it into structure.
//
// Capture is deliberately cheap and synchronous (one upsert, no LLM) so it can sit
// inside the hot reply path without slowing it or risking a failure. The LLM parse
// runs later, from the funder-decline-intel cron, over whatever is unparsed.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, resolveConfig } from "./llm.ts";

/** The closed vocabulary. Anything the funder cites that isn't one of these is "other". */
export const DECLINE_CATEGORIES = [
  "too_many_positions",
  "industry_restricted",
  "tib_too_short",
  "low_revenue",
  "low_fico",
  "negative_days_or_nsf",
  "open_collections",
  "open_lien_or_judgment",
  "prior_default",
  "state_restricted",
  "deposit_quality",
  "other",
] as const;
export type DeclineCategory = (typeof DECLINE_CATEGORIES)[number];

export interface DeclineParse {
  is_decline: boolean;
  reason_categories: DeclineCategory[];
  verbatim_quote: string;
  confidence: "high" | "medium" | "low";
  method: "llm" | "heuristic";
  model: string | null;
  /** Present when the funder is asking for stips rather than passing. */
  is_stip_request: boolean;
  summary: string;
}

// ── Capture ──────────────────────────────────────────────────────────────────

export interface CaptureOpts {
  lenderId: string;
  /** poll | webhook | vendor_sweep | backfill — which path saw the email. */
  source: string;
  /** THE COMPLETE BODY. Never pass a snippet here; that defeats the whole table. */
  fullBody: string;
  dealId?: string | null;
  dealSubmissionId?: string | null;
  /** GHL email-record id — the [emsg:<id>] marker. Best dedupe key when present. */
  emailRecordId?: string | null;
  /** Explicit key for paths with no email-record id (e.g. 'sub:<uuid>' on backfill). */
  dedupeKey?: string | null;
  subject?: string | null;
  fromEmail?: string | null;
  receivedAt?: string | null;
  direction?: "inbound" | "outbound";
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Persist one funder email's FULL body. Idempotent on dedupe_key — the 10-minute
 * poller, the 15-minute sweep and the live webhook can all see the same email and
 * only the first one writes. Returns the row id, or null when nothing was written
 * (already captured, or no usable body).
 *
 * Best-effort by contract: callers wrap it so a capture failure can never break the
 * reply path. It reports its own error rather than throwing.
 */
export async function captureFunderReply(
  db: SupabaseClient,
  o: CaptureOpts,
): Promise<{ id: string | null; captured: boolean; error: string | null }> {
  const body = (o.fullBody ?? "").trim();
  if (!o.lenderId || !body) return { id: null, captured: false, error: null };

  const dedupeKey = o.dedupeKey
    ? o.dedupeKey
    : o.emailRecordId
    ? `emsg:${o.emailRecordId}`
    : `${o.lenderId}:${await sha256Hex(body)}`;

  const { data, error } = await db.from("funder_replies")
    .upsert({
      lender_id: o.lenderId,
      deal_id: o.dealId ?? null,
      deal_submission_id: o.dealSubmissionId ?? null,
      source: o.source,
      ghl_email_record_id: o.emailRecordId ?? null,
      dedupe_key: dedupeKey,
      direction: o.direction ?? "inbound",
      subject: o.subject ?? null,
      from_email: o.fromEmail ?? null,
      received_at: o.receivedAt ?? null,
      full_body: body,
    }, { onConflict: "dedupe_key", ignoreDuplicates: true })
    .select("id");
  if (error) return { id: null, captured: false, error: error.message };
  const id = (data?.[0] as { id?: string } | undefined)?.id ?? null;
  return { id, captured: Boolean(id), error: null };
}

/**
 * A row already captured with no deal attached can be back-filled with the deal once
 * the reply is matched. Never clears a deal that's already set.
 */
export async function attachReplyDeal(
  db: SupabaseClient,
  dedupeKey: string,
  dealId: string,
  dealSubmissionId: string,
): Promise<void> {
  await db.from("funder_replies")
    .update({ deal_id: dealId, deal_submission_id: dealSubmissionId })
    .eq("dedupe_key", dedupeKey)
    .is("deal_id", null);
}

// ── Parse ────────────────────────────────────────────────────────────────────

// Strip the parts of an email that are never underwriting signal — quoted history,
// signature blocks, confidentiality boilerplate — so both the model and the
// heuristic read the funder's actual sentence and the verbatim quote stays tight.
export function coreBody(raw: string): string {
  let t = String(raw ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  // Quoted original.
  const quote = t.search(/\bOn\s.{4,80}\swrote:/i);
  if (quote > 0) t = t.slice(0, quote).trim();
  // Legal / confidentiality boilerplate that dwarfs the one real sentence.
  const legal = t.search(
    /(The information contained in this e-?mail|This e-?mail transmission|CONFIDENTIALITY NOTICE|This message and any attachments)/i,
  );
  if (legal > 0) t = t.slice(0, legal).trim();
  return t;
}

const SYSTEM =
  "You read ONE email a business-funding FUNDER sent back to an ISO (broker) about a " +
  "submitted merchant file, and extract why the funder said no. An MCA is a purchase of " +
  "future receivables, NOT a loan — never use lending words. Return ONLY a strict JSON " +
  "object, no prose or markdown, of the EXACT shape:\n" +
  '{"is_decline":boolean,"is_stip_request":boolean,' +
  `"reason_categories":string[] (each one of: ${DECLINE_CATEGORIES.join(", ")}),` +
  '"verbatim_quote":"<the funder\'s own words giving the reason, copied exactly, max 240 chars, empty string if none>",' +
  '"confidence":"high"|"medium"|"low","summary":"<one plain sentence>"}\n' +
  "Rules:\n" +
  "- is_decline is true when the funder passes, declines, or cannot move forward on the file. " +
  "A pure request for more documents is NOT a decline: set is_decline false and is_stip_request true.\n" +
  "- reason_categories: ONLY reasons the email actually states or unmistakably implies. " +
  "Never infer a reason the funder did not give. If it declines with no reason stated, " +
  'return ["other"] and confidence "low". Multiple categories are allowed.\n' +
  "- Category meanings: too_many_positions = existing MCAs/stacking/position count; " +
  "industry_restricted = the merchant's industry or entity type is not funded; " +
  "tib_too_short = time in business; low_revenue = monthly revenue/deposit volume too small; " +
  "low_fico = credit score; negative_days_or_nsf = negative days, NSFs, low daily balance; " +
  "open_collections = active collections or debt-collection activity; " +
  "open_lien_or_judgment = tax lien, judgment, or open bankruptcy; " +
  "prior_default = a previous or current default on an advance; " +
  "state_restricted = merchant's state is not funded; " +
  "deposit_quality = deposit COUNT, Zelle/cash-sourced revenue, or affordability of the daily/weekly payment.\n" +
  "- verbatim_quote must be text copied out of the email, never paraphrased.\n" +
  '- confidence "high" only when the email names the reason plainly.';

function clean<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

/**
 * Deterministic backstop so an LLM outage never costs us the intel. Only fires on
 * language a funder cannot plausibly mean any other way; returns null when unsure so
 * the caller can leave the row unparsed and retry on the next cron.
 */
export function heuristicDecline(text: string): DeclineParse | null {
  const t = text.toLowerCase();
  const declines =
    /\bdeclin(e|ed|ing|es)\b|\bpass(ing|ed)? on this\b|^pass\b|unable to (move forward|proceed|approve|fund|offer|come up with)|not able to (move forward|approve|fund)|we (?:will|are going to|have to|'ll) pass\b|cannot (?:approve|fund|move forward)|not a (?:fit|good fit)|weren'?t able to come up with/;
  if (!declines.test(t)) return null;

  const cats = new Set<DeclineCategory>();
  const hit = (re: RegExp, c: DeclineCategory) => { if (re.test(t)) cats.add(c); };
  hit(/\bpositions?\b|stack(ed|ing)|too many advances|existing (mca|advance)/, "too_many_positions");
  hit(/\bindustry\b|we (?:do not|don'?t) fund|restricted (?:industry|sic)|sole prop/, "industry_restricted");
  hit(/time in business|\btib\b|months? in business|too new/, "tib_too_short");
  hit(/low revenue|revenue (?:is )?too low|below (?:our )?(?:revenue )?(?:minimum|floor)|monthly (?:revenue|deposits) (?:too low|below)/, "low_revenue");
  hit(/\bfico\b|credit score|vantage/, "low_fico");
  hit(/negative days|\bnsf\b|insufficient funds|overdraft|low (?:average )?daily balance/, "negative_days_or_nsf");
  hit(/collection/, "open_collections");
  hit(/\blien\b|judgment|judgement|bankrupt/, "open_lien_or_judgment");
  hit(/default/, "prior_default");
  hit(/\bstate\b.{0,30}(restrict|not fund|do not fund)|we (?:do not|don'?t) fund in/, "state_restricted");
  hit(/deposit count|true deposit|zelle|cash deposits|afford (?:the )?(?:daily|weekly|additional) payment|not confident merchant can afford/, "deposit_quality");

  // The funder's own sentence, when it labels the reason.
  const m = text.match(/(?:decline(?:d)? (?:reason|due to|for the following reason\(?s?\)?)|reason\(?s?\)?)\s*[:\-]\s*([^\n\r]{3,240})/i);
  const quote = m ? m[1].trim().replace(/\s+/g, " ") : "";

  return {
    is_decline: true,
    is_stip_request: false,
    reason_categories: cats.size ? [...cats] : ["other"],
    verbatim_quote: quote,
    // A keyword match is a data point, not a reading. Never claim high confidence.
    confidence: cats.size ? "medium" : "low",
    method: "heuristic",
    model: null,
    summary: quote ? `Declined — ${quote}` : "Funder declined; no reason stated in the email.",
  };
}

/**
 * Parse one funder email. LLM first (provider-agnostic through callLLM, task
 * "parse_decline"), deterministic heuristic as the backstop. Returns null only when
 * BOTH give up — the row then stays unparsed and the next cron retries it, so a
 * transient provider outage never permanently loses a decline.
 */
export async function parseFunderReply(
  db: SupabaseClient,
  o: { subject?: string | null; body: string; lenderName?: string | null },
): Promise<DeclineParse | null> {
  const body = coreBody(o.body);
  if (!body) return null;

  const prompt =
    `Funder: ${o.lenderName ?? "(unknown)"}\n` +
    `Subject: ${o.subject ?? "(none)"}\n` +
    `Email:\n"""\n${body.slice(0, 6000)}\n"""\n\nReturn the JSON now.`;

  // Recorded on the row so a later re-parse can tell which model produced which read.
  let model: string | null = null;
  try { model = (await resolveConfig(db, "parse_decline")).model; } catch { /* label only */ }

  try {
    const raw = (await callLLM(db, {
      system: SYSTEM,
      prompt,
      maxTokens: 900,
      jsonMode: true,
      task: "parse_decline",
    })).trim();

    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(raw); } catch {
      const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
      if (s !== -1 && e > s) { try { parsed = JSON.parse(raw.slice(s, e + 1)); } catch { /* fall through */ } }
    }
    if (parsed && typeof parsed === "object") {
      const cats = Array.isArray(parsed.reason_categories)
        ? [...new Set((parsed.reason_categories as unknown[])
            .filter((x): x is string => typeof x === "string")
            .map((x) => x.trim().toLowerCase())
            .filter((x): x is DeclineCategory => (DECLINE_CATEGORIES as readonly string[]).includes(x)))]
        : [];
      const isDecline = parsed.is_decline === true;
      return {
        is_decline: isDecline,
        is_stip_request: parsed.is_stip_request === true,
        // A decline with no recognized category still counts — as "other".
        reason_categories: isDecline && cats.length === 0 ? ["other"] : cats,
        verbatim_quote: typeof parsed.verbatim_quote === "string" ? parsed.verbatim_quote.slice(0, 240) : "",
        confidence: clean(parsed.confidence, ["high", "medium", "low"] as const, "medium"),
        method: "llm",
        model,
        summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 300) : "",
      };
    }
  } catch { /* provider hiccup — fall through to the heuristic */ }

  return heuristicDecline(body);
}
