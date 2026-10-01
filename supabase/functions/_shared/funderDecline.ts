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
  /**
   * How this parse was produced. `no_typed_text` means the reply carried no
   * typed words at all (body was only the quoted thread) — recorded explicitly
   * so a surface can say WHY there is no reason, instead of rendering a blank.
   */
  method: "llm" | "heuristic" | "no_typed_text";
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
  /**
   * How many files the email carried, read from the email RECORD at capture.
   *
   * ⚠️ OMIT IT WHEN YOU DO NOT KNOW — that writes NULL, which means "not
   * recorded". Passing 0 asserts the email demonstrably carried none, which is
   * a different and much stronger claim. The webhook and vendor-sweep paths see
   * a payload with no attachments field at all, so they must leave this unset
   * rather than defaulting to 0.
   */
  attachmentCount?: number | null;
}

/**
 * Count attachments on a GHL email record, or return null when the record
 * carries no attachments field at all.
 *
 * null (unknown) and 0 (none) are different facts and this is where they are
 * kept apart — see the column comment on funder_replies.attachment_count.
 */
export function attachmentCountOf(e: Record<string, unknown> | null | undefined): number | null {
  if (!e || !("attachments" in e)) return null;
  const a = (e as { attachments?: unknown }).attachments;
  return Array.isArray(a) ? a.length : null;
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
      // undefined → NULL → "not recorded". Never coerced to 0.
      attachment_count: typeof o.attachmentCount === "number" ? o.attachmentCount : null,
    }, { onConflict: "dedupe_key", ignoreDuplicates: true })
    .select("id");
  if (error) return { id: null, captured: false, error: error.message };
  const id = (data?.[0] as { id?: string } | undefined)?.id ?? null;

  // STANDING-INSTRUCTION DETECTION HANGS OFF CAPTURE, ON PURPOSE.
  //
  // Five code paths mirror a funder email and every one of them already calls
  // this function, so hooking here means the poller, the live webhook, the
  // vendor sweep and the decline-intel backfill all get directive detection
  // without any of them remembering to ask for it. The alternative — a call at
  // each of the five sites — is one forgotten site away from being exactly the
  // bug this fixes: a reply that was received, understood, and never acted on.
  //
  // Only on a FRESH capture (`id` non-null). A duplicate was detected on the
  // first pass, and funder-directive-scan is the retry for a pass that failed.
  //
  // The dynamic import is deliberate: funderDirective.ts imports coreBody()
  // from this file, and loading it statically here would make the two modules
  // a cycle. Resolving it at call time keeps the dependency one-directional in
  // the module graph and costs nothing in a bundled function.
  if (id) {
    try {
      const { recordDirectives } = await import("./funderDirective.ts");
      const r = await recordDirectives(db, {
        lenderId: o.lenderId,
        funderReplyId: id,
        fullBody: body,
        dealId: o.dealId ?? null,
        dealSubmissionId: o.dealSubmissionId ?? null,
        subject: o.subject ?? null,
        fromEmail: o.fromEmail ?? null,
        receivedAt: o.receivedAt ?? null,
      });
      if (r.kinds.length) {
        console.log(`[funderDirective] ${o.lenderId}: ${r.kinds.join(", ")} (wrote ${r.written})`);
      }
    } catch (e) {
      // recordDirectives already reports its own write failures to
      // activity_log. This catch is only for a load/throw it could not, and it
      // must not break the capture — but it does NOT go quiet either.
      console.error("[funderDirective] detection threw:", e instanceof Error ? e.message : String(e));
    }
  }

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

/**
 * The quoted-original header: "On Tue, Aug 11, 2026 at 10:52 AM <sender> wrote:".
 *
 * Anchored on a weekday / month / numeric date immediately after "On " so a
 * lowercase "on" in the funder's own prose can never open the match, and capped
 * at 240 rather than 80 so a long "via <list name> <address>" sender survives.
 * Lazy on the tail so the FIRST " wrote:" closes it. See the long note in
 * coreBody() for what the old 80-char cap did to 7 real replies.
 */
export const QUOTED_ORIGINAL_HEADER =
  /\bOn\s(?:(?:Mon|Tues?|Wed(?:nes)?|Thu(?:rs)?|Fri|Sat(?:ur)?|Sun)(?:day)?|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{1,2}[\s./-])[^\n]{2,240}?\swrote:/i;

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
  //
  // ⚠️ `>= 0`, NOT `> 0`. When a reply is nothing BUT quoted history — someone
  // hits reply, attaches a file, types no text — the marker sits at index 0,
  // a `> 0` guard is false, nothing is stripped, and OUR OWN quoted email
  // survives as "what the funder wrote". It then gets classified as their
  // decline. The guard fails in exactly the case stripping matters most.
  //
  // Found on the merchant path (poll-funder-replies, fixed in ba765cb), where
  // it described an inbound reply carrying eight of the merchant's bank
  // statements as "an outbound email from broker Kristine at Momentum Funding".
  // As funder-match put it: an unstripped body is not "no quote found", it is
  // "the whole thing was quote and we didn't notice" — the failure and the
  // success produce identical-looking output, so neither the code nor the
  // reader can tell them apart.
  //
  // No live instance on the funder side: 0 of 153 funder_replies have a body
  // starting with the quote marker. Fixed as a latent defect, not an observed
  // one, because a decline nobody can explain in six weeks is a worse way to
  // find out.
  //
  // ⚠️ AND THEN THE LENGTH CAP DID THE SAME THING ANYWAY (found 2026-10-01).
  //
  // The old marker was /\bOn\s.{4,80}\swrote:/i. That 80-char cap is a quiet
  // assumption about how long a quoted-original header is, and 1 West breaks
  // it: their thread header reads
  //
  //   "On Tue, Aug 11, 2026 at 10:52 AM Momentum Funding via Partner
  //    Submissions partnersubs@1westfinance.com wrote:"
  //
  // — 99 characters between "On " and " wrote:". Over the cap, no match, so
  // NOTHING was stripped and OUR OWN ENTIRE SUBMISSION EMAIL survived as "what
  // the funder wrote": the merchant's name, revenue, phone, personal email and
  // every signed-URL document link, all handed to the decline parser as the
  // funder's words. 7 of 156 funder_replies were in that state. The funder had
  // actually written "Received, thank you." and "Application is missing, please
  // provide the same to proceed." — one sentence each, buried under 6KB of us.
  //
  // Exactly the failure the block above describes, reached by a different road,
  // which is the point: the no-match branch and the nothing-to-strip branch are
  // indistinguishable in the output, so neither the code nor a reader can tell
  // "clean body" from "we failed to find the boundary".
  //
  // The cap is now 240 and the header must START like a real date line
  // (weekday, month, or a numeric date). Anchoring it that way matters more
  // than the length: a bare lazy `.{4,240}?` happily starts at the lowercase
  // "on" in "CC me on the deals… On Fri, Jul 3, 2026 … wrote:" and eats the
  // funder's actual instruction. Measured over all 156 captured replies:
  // 148 byte-identical, 7 newly (and correctly) stripped, 1 improved, 0 losses.
  const quote = t.search(QUOTED_ORIGINAL_HEADER);
  if (quote >= 0) t = t.slice(0, quote).trim();
  // Legal / confidentiality boilerplate that dwarfs the one real sentence.
  // SAME BUG, five lines down, and nobody had flagged it: a funder whose
  // template leads with a confidentiality notice starts the match at index 0,
  // so `> 0` kept the entire notice and classified the decline off legal
  // boilerplate instead of the one sentence that says why.
  const legal = t.search(
    /(The information contained in this e-?mail|This e-?mail transmission|CONFIDENTIALITY NOTICE|This message and any attachments)/i,
  );
  if (legal >= 0) t = t.slice(0, legal).trim();
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
/**
 * The summary for a reply that contained NO TYPED TEXT — the body was nothing
 * but quoted history.
 *
 * ⚠️ NEVER HAND THE CLASSIFIER AN EMPTY STRING. Fixing the `> 0` guard turns
 * "wrong text" into "no text", and that is only an improvement if something
 * downstream knows what empty MEANS. It didn't: `parseFunderReply` returned
 * null on an empty body, `funder-decline-intel` counted that as `deferred` and
 * left `parsed_at` NULL, so the row requeued forever and never surfaced. On the
 * boards, `response_summary` rendered as a blank chip.
 *
 * As processor-funders put it: an attachment-only DECLINE would show as
 * "✉ Replied" with an empty box rather than "❌ Declined" — a real event
 * rendering as absence, which is the same defect class one step further down.
 *
 * ⚠️ AND WE DO NOT INVENT THE ATTACHMENT COUNT. `funder_replies` has no
 * attachments column, so the funder path genuinely does not know N. Saying
 * "3 attachments" because it reads better would be fabricating the one number
 * a human would act on. When N is known (callers that have it) we state it;
 * when it is not, we say what we do know and tell them to look.
 */
/**
 * The human-facing stand-in a reader writes when an email body has no typed
 * words. It exists so a PERSON sees something sensible.
 *
 * ⚠️ IT IS NOT DATA, AND IT MUST NEVER REACH A CLASSIFIER. It is non-empty, so
 * every `if (!text)` guard downstream passes it straight through — and an LLM
 * will confidently describe whatever it is handed, including this. That is how
 * fixing the quote-strip guard nearly traded a WRONG summary for a fluent
 * description of our own placeholder (2026-09-30).
 *
 * Exported as a constant with a predicate so the three places that produce or
 * consume it agree by construction, instead of three hand-written
 * `startsWith("(reply received")` comparisons drifting apart.
 */
export const NO_TYPED_TEXT_PLACEHOLDER = "(reply received — open the conversation to read it)";

/** True when a body carries no typed words — genuinely empty, or the stand-in. */
export function isNoTypedTextBody(s: string | null | undefined): boolean {
  const t = (s ?? "").trim();
  return !t || t.startsWith("(reply received");
}

export function noTypedTextNote(attachmentCount?: number | null): string {
  const n = typeof attachmentCount === "number" && attachmentCount > 0 ? attachmentCount : null;
  return n
    ? `Replied with ${n} attachment${n === 1 ? "" : "s"} and no typed text — open the email to read them.`
    : "Replied with no typed text — the body was only the quoted thread. Open the email to see whether anything was attached.";
}

export async function parseFunderReply(
  db: SupabaseClient,
  o: {
    subject?: string | null;
    body: string;
    lenderName?: string | null;
    /** Pass when the caller knows it. Omitted means UNKNOWN, never zero. */
    attachmentCount?: number | null;
  },
): Promise<DeclineParse | null> {
  // ⚠️ THE PLACEHOLDER COUNTS AS EMPTY. A caller that already substituted the
  // human-facing stand-in must not have it classified as if it were the
  // funder's words — the check is on the ORIGINAL body, before coreBody.
  const body = isNoTypedTextBody(o.body) ? "" : coreBody(o.body);
  // NO TYPED TEXT — a defined answer, not null and not "".
  // Returning null here left the row queued forever with parsed_at NULL and a
  // blank summary on every board. This stamps it, says why, and flags LOW
  // confidence: we cannot rule out that an attached PDF is itself a decline
  // letter, so `is_decline: false` is the honest default and NOT a verdict.
  if (!body) {
    return {
      is_decline: false,
      reason_categories: [],
      verbatim_quote: "",
      confidence: "low",
      method: "no_typed_text",
      model: null,
      is_stip_request: false,
      summary: noTypedTextNote(o.attachmentCount),
    };
  }

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
