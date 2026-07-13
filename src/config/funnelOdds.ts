/**
 * The funnel's stage ladder and the odds a deal at each stage eventually FUNDS.
 *
 * These live here — not inside a component — because two screens need the SAME
 * numbers and they must not drift apart:
 *   - MoneyInPlay weights the pipeline forecast by FUND_ODDS.
 *   - Revenue & Commission measures ACTUAL conversion and shows the drift against
 *     these very odds. If the two ever held separate copies, the drift report would
 *     be measuring itself against the wrong baseline and nobody would notice.
 *
 * PROVENANCE: these are TARGETS from CLAUDE.md's 9-stage funnel (contact 65% →
 * qualify 60% → app 70% → docs 55% → approve 60% → accept 75% → fund 87.5%),
 * compounded forward. They are NOT measured history. Every surface that renders
 * them must label them as estimates.
 */

/** Odds a deal sitting at each stage eventually funds. Estimates — see above. */
export const FUND_ODDS: Record<string, number> = {
  new: 0.06,
  contacted: 0.09,
  qualifying: 0.15,
  application_sent: 0.22,
  docs_collected: 0.39,
  bank_statements: 0.39,
  submitted_to_funder: 0.39,
  offer_received: 0.66,
  offer_presented: 0.66,
  offer_accepted: 0.88,
};

export const STAGE_LABEL: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualifying: "Qualifying",
  application_sent: "Application sent",
  docs_collected: "Docs collected",
  bank_statements: "Bank statements",
  submitted_to_funder: "Submitted to funder",
  offer_received: "Offer received",
  offer_presented: "Offer presented",
  offer_accepted: "Offer accepted",
};

/** The open-pipeline stages, in funnel order. Excludes funded/declined/dead/nurture. */
export const STAGE_ORDER = Object.keys(STAGE_LABEL);

/**
 * The advance a funder would plausibly write: the top of the industry band
 * (120% of monthly revenue). An MCA is a purchase of future receivables, so it is
 * sized off revenue — never off what the merchant wishes for.
 */
export const ADVANCE_CEILING_PCT = 1.2;
