// funderSubmissions — the ONE definition of what a funder submission means and
// what you can do to it.
//
// Two surfaces read these: the per-deal FunderResponsesBoard (Revenue Playbook
// Step 7 + the Processor detail drawer) and the flat FunderChaseTab queue on
// /admin/processor. They must never disagree about whether a submission is
// "Awaiting" or what "Log offer" writes — a status chip that means one thing on
// one screen and something else on the other is how we ship a wrong number.
//
// Everything here is surface-agnostic: no JSX, no component state. The chrome
// differs legitimately between a card and a table row; the MEANING does not.
import supabase from "../supabase";
import { tryWrite } from "@/supabase/writes";
import { updateDealStatus, updateSubmission } from "../services/dealService";
import type { LostReason } from "../types/deals";

export type Frequency = "daily" | "weekly";
export const PAYMENTS_PER_MONTH: Record<Frequency, number> = { daily: 21, weekly: 4.33 };

export type StateKey =
  | "awaiting"
  | "replied"
  | "offer"
  | "accepted"
  | "merchant_declined"
  | "funder_declined"
  | "withdrawn";

/** The minimum a row needs for any of the derivations below. Both surfaces'
 *  richer row types satisfy it structurally. */
export interface SubmissionLike {
  status: string;
  /** How the reply was classified — `response_data.parsed.method`, one of
   *  "llm" | "heuristic" | "no_typed_text". Optional so older rows and callers
   *  that don't select it still satisfy the shape. */
  parseMethod?: string | null;
  submittedAt: string | null;
  responseAt: string | null;
  offerAmount: number | null;
  factorRate: number | null;
  dailyPayment: number | null;
  weeklyPayment: number | null;
  totalPayback: number | null;
}

export const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/** Compact "3h ago" / "2d ago". */
export function relTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "";
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

/** One place the badge + accents come from, derived from the row's status and
 *  which economics fields are populated. */
export function stateOf(s: SubmissionLike): { key: StateKey; emoji: string; label: string; cls: string } {
  if (s.status === "withdrawn")
    return { key: "withdrawn", emoji: "↩", label: "Withdrawn", cls: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300" };
  if (s.status === "offer_accepted")
    return { key: "accepted", emoji: "✅", label: "Accepted", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" };
  if (s.status === "offer_declined")
    return { key: "merchant_declined", emoji: "🙅", label: "Merchant declined", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" };
  if (s.status === "declined")
    return { key: "funder_declined", emoji: "❌", label: "Funder declined", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" };
  if (s.offerAmount != null || s.status === "offer_made" || s.status === "approved")
    return { key: "offer", emoji: "💰", label: "Offer", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" };
  if (s.responseAt)
    return { key: "replied", emoji: "✉", label: "Replied", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" };
  return { key: "awaiting", emoji: "⏳", label: "Awaiting", cls: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300" };
}

export const freqOf = (s: SubmissionLike): Frequency => (s.weeklyPayment != null ? "weekly" : "daily");
export const paymentOf = (s: SubmissionLike) => (s.weeklyPayment != null ? s.weeklyPayment : s.dailyPayment);
export const paybackOf = (s: SubmissionLike) =>
  s.totalPayback ?? (s.offerAmount != null && s.factorRate != null ? Math.round(s.offerAmount * s.factorRate) : null);

/** Merchant-side monthly burden of an offer + its share of monthly revenue.
 *  amber when the pull eats >15% of revenue (a common affordability red line). */
export function burden(payment: number | null, freq: Frequency, monthlyRevenue: number | null | undefined) {
  if (!payment) return null;
  const monthly = payment * PAYMENTS_PER_MONTH[freq];
  const pct = monthlyRevenue ? (monthly / monthlyRevenue) * 100 : null;
  return { monthly, pct, hot: pct != null && pct > 15 };
}

/** A submission counts as "on the board" once it actually went out (or came
 *  back). Failed/never-sent rows (pending with no timestamp/response) are hidden. */
export function isLive(s: SubmissionLike): boolean {
  return (
    !!s.submittedAt ||
    !!s.responseAt ||
    s.offerAmount != null ||
    ["submitted", "under_review", "approved", "offer_made", "offer_accepted", "offer_declined", "declined", "withdrawn"].includes(
      s.status,
    )
  );
}

/**
 * The funder replied, but typed NOTHING — the body was only the quoted thread,
 * usually a bare reply carrying attachments.
 *
 * Deliberately NOT a separate StateKey. It is a real reply that needs real
 * work, so every "replied" affordance (message the funder, log the offer) must
 * stay switched on; a new key would fall through the `st.key === "replied"`
 * branches and strip exactly those buttons. What is wrong without this flag is
 * only the CHIP, which otherwise implies someone wrote something we have read.
 *
 * Branch on the METHOD, never on the classifier's `type` or on `is_decline`:
 * here `type` is "other" and `is_decline` is false by DEFAULT, not by verdict —
 * an attached PDF could itself be the decline letter and nothing has read it.
 */
export function isNoTypedText(s: SubmissionLike): boolean {
  return s.parseMethod === "no_typed_text";
}

/** Still owed us an answer — the chase set. */
export function isOutstanding(s: SubmissionLike): boolean {
  return stateOf(s).key === "awaiting" || stateOf(s).key === "replied";
}

// ── The chase clock ──────────────────────────────────────────────────────────

/** Hours since the package went out, or null when we never stamped a send. */
export function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return ms / 3_600_000;
}

/**
 * Pull an hours figure out of a funder's own free-text `lenders.funding_speed`
 * ("~60-minute decisions in most cases" → 1, "2-hour approvals" → 2, "same-day"
 * → 8, "24-48 hours" → 24 — the FIRST//fastest number they quote, because that
 * is the promise we hold them to).
 *
 * Returns null when the text quotes nothing parseable. Null means "we have no
 * quoted turnaround", NOT "they are fast" — callers must not treat it as zero.
 */
export function quotedDecisionHours(fundingSpeed: string | null | undefined): number | null {
  if (!fundingSpeed) return null;
  const t = fundingSpeed.toLowerCase();
  const m = t.match(/(\d+)\s*(?:-|–|\s)?\s*(minute|min\b|hour|hr\b|business day|day)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n)) return null;
    const unit = m[2];
    if (unit.startsWith("min")) return n / 60;
    if (unit.startsWith("h")) return n;
    return n * 24; // days (business or not — we don't model weekends here)
  }
  if (/same[-\s]?day/.test(t)) return 8;
  return null;
}

export type ChaseTone = "fresh" | "warm" | "stale" | "breached";

/**
 * How hard this row should shout. Ages on wall-clock, and independently flags a
 * row that has blown past the funder's OWN stated turnaround — that is the
 * whole point of the screen, so it outranks the generic clock.
 */
export function chaseTone(hours: number | null, quotedHours: number | null): ChaseTone {
  if (hours == null) return "fresh";
  if (quotedHours != null && hours > quotedHours) return "breached";
  if (hours >= 48) return "stale";
  if (hours >= 24) return "warm";
  return "fresh";
}

export const CHASE_TONE_CLS: Record<ChaseTone, string> = {
  fresh: "text-gray-500 dark:text-gray-400",
  warm: "text-amber-600 dark:text-amber-400 font-semibold",
  stale: "text-red-600 dark:text-red-400 font-bold",
  breached: "text-red-700 dark:text-red-300 font-bold",
};

// ── Writes — one implementation, so both surfaces record the same thing ──────

/** Best-effort activity-trail entry. Never throws: the trail is nice-to-have and
 *  tryWrite surfaces an RLS denial to the console without blocking the action. */
export async function logDealActivity(args: {
  dealId: string;
  userId: string | null | undefined;
  interactionType: string;
  subject: string;
  content: string;
  newStatus?: string;
}) {
  await tryWrite(
    "deal activity log",
    supabase.from("activity_log").insert({
      entity_type: "deal",
      entity_id: args.dealId,
      interaction_type: args.interactionType,
      subject: args.subject,
      content: args.content,
      new_status: args.newStatus ?? null,
      logged_by: args.userId ?? null,
    }),
  );
}

export interface OfferInput {
  amount: number;
  factor: number;
  term: number | null;
  payment: number | null;
  frequency: Frequency;
}

/** Validate a typed offer. Returns the error string, or null when it's good. */
export function validateOffer(raw: { amount: string; factor: string }): string | null {
  const amount = parseFloat(raw.amount);
  const factor = parseFloat(raw.factor);
  if (!Number.isFinite(amount) || amount <= 0) return "Enter the advance amount.";
  if (!Number.isFinite(factor) || factor <= 0) return "Enter the factor rate (e.g. 1.3).";
  return null;
}

/** Log a funder's offer against a submission + write the trail entry. Throws on
 *  the submission write (the caller shows the error); the trail is best-effort. */
export async function logOffer(args: {
  submissionId: string;
  dealId: string;
  lenderName: string;
  userId: string | null | undefined;
  offer: OfferInput;
}) {
  const { amount, factor, term, payment, frequency } = args.offer;
  const totalPayback = Math.round(amount * factor);
  await updateSubmission(args.submissionId, {
    status: "offer_made",
    offer_amount: amount,
    factor_rate: factor,
    term_months: term,
    daily_payment: frequency === "daily" ? payment : null,
    weekly_payment: frequency === "weekly" ? payment : null,
    total_payback: totalPayback,
  });
  await logDealActivity({
    dealId: args.dealId,
    userId: args.userId,
    interactionType: "offer_received",
    subject: `Offer logged — ${args.lenderName}`,
    content:
      `${args.lenderName} offered ${money(amount)} at ${factor} factor (${money(totalPayback)} payback)` +
      `${payment ? `, ${money(payment)} ${frequency}` : ""}${term ? `, ${term} mo` : ""}.`,
    newStatus: "offer_made",
  });
}

/** Record that the FUNDER declined (distinct from the merchant declining an
 *  offer, which is setOfferOutcome on the board). */
export async function markFunderDeclined(args: {
  submissionId: string;
  dealId: string;
  lenderName: string;
  userId: string | null | undefined;
  reason: string;
}) {
  const reason = args.reason.trim();
  await updateSubmission(args.submissionId, { status: "declined", decline_reason: reason || null });
  await logDealActivity({
    dealId: args.dealId,
    userId: args.userId,
    interactionType: "note",
    subject: `Funder declined — ${args.lenderName}`,
    content: `${args.lenderName} declined the deal${reason ? `: ${reason}` : "."}`,
    newStatus: "declined",
  });
}

/** Send an ad-hoc email to a funder about a deal (submit-to-funders
 *  action=message_funder). Owns the wire format for BOTH surfaces — a payload
 *  that drifts between them is a send that silently does nothing. */
export async function messageFunder(args: {
  dealId: string;
  lenderId: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  documentIds?: string[];
}) {
  const split = (v: string | undefined) =>
    (v ?? "")
      .split(/[,;\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  const { data, error } = await supabase.functions.invoke("submit-to-funders", {
    body: {
      action: "message_funder",
      dealId: args.dealId,
      lenderId: args.lenderId,
      subject: args.subject.trim(),
      body: args.body.trim(),
      cc: split(args.cc),
      bcc: split(args.bcc),
      attachments: { documentIds: args.documentIds ?? [] },
    },
  });
  if (error) throw error;
  if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
}

/** The default subject + body when chasing a funder. Kept here so the chase
 *  queue and the per-deal board open with the same words. */
export function funderMessagePrefill(args: {
  businessName: string | null | undefined;
  dealNumber: string | null | undefined;
  senderName: string;
  responseType?: string | null;
  requestedItems?: string[];
}): { subject: string; body: string } {
  const business = args.businessName || "the merchant";
  const dealNo = args.dealNumber || "—";
  const signoff = `— ${args.senderName}, Agentic Voice, Inc. dba Momentum Funding · (954) 737-5692`;
  if (args.responseType === "stip_request") {
    const items = args.requestedItems?.length ? args.requestedItems.join(", ") : "the requested items";
    return {
      subject: `Re: ${business} — requested items`,
      body:
        `Hi — please find the requested ${items} attached for ${business} (Deal ${dealNo}). ` +
        `Let us know if anything else is needed.\n\n${signoff}`,
    };
  }
  return {
    subject: `Re: ${business} — Deal ${dealNo}`,
    body: `Hi — following up on ${business} (Deal ${dealNo}). [write your message here]\n\n${signoff}`,
  };
}

// ── Decline close-out ────────────────────────────────────────────────────────
// Every funder passed. Tell the merchant, then park the deal. Shared by the
// Funder chase tab and the Playbook's FunderWorkspace so the words the merchant
// receives, and the guards around sending them, are identical on both.

/** Where a closed-out deal lands. All three are ParkedStatus values, so
 *  updateDealStatus's overload demands a LostReason for every one of them.
 *
 *  `nurture` stays the default on purpose: 45-60% of merchants come back for
 *  capital within six months, Sequences C and F exist to work them, and it is
 *  the only one of the three that is cheap to reverse. */
export type CloseOutOutcome = "nurture" | "declined" | "dead";

export const CLOSE_OUT_OUTCOMES: { key: CloseOutOutcome; label: string; hint: string }[] = [
  { key: "nurture", label: "Nurture", hint: "comes back to the board later — the re-engagement sequences keep working it" },
  { key: "declined", label: "Declined", hint: "file closed on a funder outcome — the accurate record of what happened" },
  { key: "dead", label: "Dead", hint: "gone for good — the hardest of the three to reverse" },
];

/**
 * REFUSE to close out a merchant who has a live offer on the table. Declining
 * someone a funder has actually approved is the worst error this screen could
 * make, so it is a hard block rather than a warning.
 *
 * Returns the reason to show, or null when the close-out may proceed.
 */
export function closeOutBlockReason(subs: SubmissionLike[], lenderNames?: (string | undefined)[]): string | null {
  const live: string[] = [];
  subs.forEach((s, i) => {
    const k = stateOf(s).key;
    if (k === "offer" || k === "accepted") live.push(lenderNames?.[i] || "a funder");
  });
  if (live.length === 0) return null;
  return `${live.join(" and ")} ${live.length === 1 ? "has" : "have"} an offer on the table — that has to be resolved before this merchant can be told everyone passed.`;
}

/**
 * The decline email. Reviewed by the compliance agent before first ship:
 * an MCA is a purchase of future receivables, so there is no "loan", no
 * "credit decision", and the decision is attributed explicitly to the FUNDERS
 * rather than to us — we are the broker relaying their outcome, not a creditor
 * issuing a denial, and passive phrasing blurred that.
 *
 * Deliberately non-final in tone: ~45-60% of merchants requalify, and this is
 * the last thing they hear from us before the re-engagement sequences.
 */
export function declineCloseoutPrefill(args: {
  businessName: string | null | undefined;
  firstName: string | null | undefined;
  senderName: string;
}): { subject: string; body: string } {
  const business = args.businessName || "your business";
  const first = args.firstName?.trim() || "there";
  return {
    subject: `Update on your funding application — ${business}`,
    body:
      `Hi ${first},\n\n` +
      `I wanted to come back to you personally about your application.\n\n` +
      `We submitted your file to several funders, and unfortunately none of them were able to move ` +
      `forward at this time. That reflects those funders' criteria as they stand today — not a ` +
      `permanent judgment on you or your business.\n\n` +
      `Circumstances change, and so do the programs our funders run. If your revenue, time in ` +
      `business, or banking picture shifts over the next few months, I'd genuinely welcome another ` +
      `look — there's no cost to asking and no obligation.\n\n` +
      `Thank you for the time you put into this. Gathering statements and paperwork is not a small ` +
      `ask, and I appreciate you doing it.\n\n` +
      `— ${args.senderName}, Agentic Voice, Inc. dba Momentum Funding · (954) 737-5692`,
  };
}

/**
 * Send the decline, then park the deal — IN THAT ORDER, and never the reverse.
 *
 * If the send fails the deal is left exactly as it was, on the board, so a
 * merchant who never received the email cannot be quietly filed away. The
 * throw propagates and the caller shows it; a park is never reported when the
 * email did not go.
 *
 * `skipEmail` is for a do_not_contact merchant: park, log WHY no email went,
 * and say so in the UI. We never email a DND merchant.
 */
export async function closeOutDeclined(args: {
  dealId: string;
  outcome: CloseOutOutcome;
  reason: LostReason;
  subject: string;
  body: string;
  skipEmail: boolean;
  lenderNames: string[];
  userId: string | null | undefined;
  byName: string;
}): Promise<{ emailed: boolean }> {
  let emailed = false;

  if (!args.skipEmail) {
    // Throws on failure → the park below never runs.
    const { data, error } = await supabase.functions.invoke("send-merchant-email", {
      body: { dealId: args.dealId, subject: args.subject.trim(), body: args.body.trim() },
    });
    if (error) throw error;
    const err = (data as { error?: string } | null)?.error;
    if (err) throw new Error(err);
    emailed = true;
  }

  // Only now does the deal move. updateDealStatus owns the stage-stamp and
  // backward-move rules; a park into a terminal state is always permitted.
  await updateDealStatus(args.dealId, args.outcome, args.reason);

  const funders = args.lenderNames.length ? args.lenderNames.join(", ") : "the funders it went to";
  await logDealActivity({
    dealId: args.dealId,
    userId: args.userId,
    interactionType: "note",
    subject: `Closed out — all funders declined`,
    content:
      `${args.byName} closed this out to ${args.outcome} (${args.reason}). Declined by: ${funders}. ` +
      (emailed
        ? `Decline email sent to the merchant — subject "${args.subject.trim()}".`
        : `NO email sent — merchant is marked do-not-contact.`),
    newStatus: args.outcome,
  });

  return { emailed };
}
