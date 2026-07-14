// leadScore.ts — v1 rules-based lead quality score + expected value.
//
// ⚠️ KEEP IN SYNC — this file exists in TWO places (same pattern as
// SELF_GEN_LEAD_SOURCES) and they must stay byte-identical:
//   • supabase/functions/_shared/leadScore.ts   (edge functions)
//   • src/lib/leadScore.ts                      (frontend)
//
// ⚠️ FUNDER-GATE SYNC NOTE: gateProgram() below is a COPY of the hard-gate +
// sizing logic inside evaluate() in src/components/admin/FunderQualifier.tsx
// (the UI keeps its own copy because its Assessment shape carries UI strings).
// If you change a gate or the sizing band in either place, change BOTH.
//
// ⚠️ FUND_ODDS + ADVANCE_CEILING are copied from src/config/funnelOdds.ts —
// keep in sync with that file too. They are TARGETS, not measured history.
//
// HONESTY (from research/PLAN_lead_scoring.md): the repo has 0 funded deals, so
// there is NO ground truth to calibrate on. Every weight in this file is a
// JUDGMENT CALL, versioned as SCORE_VERSION = 1. Every score logs its reasons.
// lead_score_events snapshots the inputs so a v2 can be FITTED on real outcomes
// (≥50 terminal outcomes or ≥20 funded) instead of guessed again. Never present
// a v1 score as measured — the UI must label it "est." / "v1 rules score".
//
// Two numbers, per the plan:
//   • close_score 0–100 → grade A/B/C/D  (how likely to fund, from what we know)
//   • expected_value $ = P(close) × expected commission (the true "best first" sort)
// Urgency (My Day rank ladder) is a DIFFERENT question and is not touched here.
//
// Compliance: an MCA is a purchase of future receivables, NOT a loan. This module
// is internal-only and sizes advances off monthly revenue.

export const SCORE_VERSION = 1;

// Industry-standard advance band when a funder hasn't published its own multiple
// (Greenbox's "70–120% of monthly sales") — mirrors FunderQualifier.tsx.
export const DEFAULT_PCT_LO = 70;
export const DEFAULT_PCT_HI = 120;
// The advance a funder would plausibly write: 120% of monthly revenue.
// COPY of ADVANCE_CEILING_PCT in src/config/funnelOdds.ts — keep in sync.
export const ADVANCE_CEILING = 1.2;

// Odds a deal at each stage eventually funds. COPY of FUND_ODDS in
// src/config/funnelOdds.ts (targets from the 9-stage funnel, NOT history).
export const STAGE_FUND_ODDS: Record<string, number> = {
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
// Parked / terminal stages (not in the ladder above). Judgment, logged as such.
const OFF_LADDER_ODDS: Record<string, number> = {
  nurture: 0.03,
  declined: 0.01,
  dead: 0.01,
  funded: 0.95, // already won — EV ≈ the commission itself
};

// Grade multiplier on the stage odds. JUDGMENT (v1) — logged for recalibration.
export const GRADE_MULT: Record<Grade, number> = { A: 1.5, B: 1.0, C: 0.6, D: 0.25 };

// Commission points — KEEP IN SYNC with expectedCommissionInPlay() semantics in
// src/types/commissions.ts (8 pts new / 6 pts renewal, gross).
const NEW_DEAL_POINTS = 8;
const RENEWAL_POINTS = 6;

export type Grade = "A" | "B" | "C" | "D";

export interface ScoreReason {
  factor: string;
  points: number;
  max: number;
  note: string;
}

// ── Funder gate (mirrors FunderQualifier.evaluate — see sync note up top) ────
export interface ProgramGate {
  approval_min: number | null;
  approval_max: number | null;
  approval_pct_min: number | null;
  approval_pct_max: number | null;
  monthly_revenue_required: number | null;
  annual_revenue_required: number | null;
  time_in_business_months: number | null;
  min_credit_score: number | null;
}

export type GateVerdict = "likely" | "stretch" | "blocked" | "unknown";

export function gateProgram(
  p: ProgramGate,
  i: { revenue: number | null; tib: number | null; fico: number | null; requested: number | null },
): GateVerdict {
  const rev = i.revenue ?? 0;
  let blocked = false;

  // A funder can state its floor monthly OR annually — normalize to monthly.
  const monthlyReq =
    p.monthly_revenue_required ??
    (p.annual_revenue_required != null ? Number(p.annual_revenue_required) / 12 : null);

  // Hard gates (identical to FunderQualifier).
  if (monthlyReq != null && rev > 0 && rev < Number(monthlyReq)) blocked = true;
  if (p.time_in_business_months != null && i.tib != null && i.tib < p.time_in_business_months) blocked = true;
  if (p.min_credit_score != null && i.fico != null && i.fico < p.min_credit_score) blocked = true;

  // Sizing: what does the REVENUE support (never the aspiration)?
  const pctHi = p.approval_pct_max != null ? Number(p.approval_pct_max) : DEFAULT_PCT_HI;
  let offerHi: number | null = null;
  if (rev > 0) {
    const rawHi = (rev * pctHi) / 100;
    // A funder whose minimum advance exceeds what the revenue supports is unreachable.
    if (p.approval_min != null && rawHi < Number(p.approval_min)) blocked = true;
    offerHi = Math.round(rawHi);
    if (p.approval_max != null) offerHi = Math.min(offerHi, Number(p.approval_max));
  }

  const hasAnyCriteria =
    monthlyReq != null ||
    p.time_in_business_months != null ||
    p.min_credit_score != null ||
    p.approval_min != null ||
    p.approval_max != null;

  if (blocked) return "blocked";
  if (!hasAnyCriteria) return "unknown";
  if (i.requested != null && offerHi != null && i.requested > offerHi) return "stretch";
  return "likely";
}

// ── Score inputs ─────────────────────────────────────────────────────────────
export interface UnderwritingInput {
  /** True monthly revenue from bank statements (deposits − padding). Replaces stated. */
  trueMonthlyRevenue: number | null;
  riskRating: string | null; // low | medium | high
  affordabilityRating: string | null; // strong | adequate | tight | unaffordable
  maxAffordableAdvance: number | null;
  criticalFlagCount: number;
}

export interface ScoreInputs {
  status: string;
  isRenewal: boolean;
  amountRequested: number | null;
  /** Stated monthly revenue/deposits. */
  monthlyRevenue: number | null;
  tibMonths: number | null;
  fico: number | null;
  /** null = unknown (vendor said "N/A"). 0 = merchant said none. */
  openPositions: number | null;
  positionsBalance: number | null;
  needMoneyNow: boolean | null;
  useOfFunds: string | null;
  difficultyApproved: string | null; // raw vendor text ("No" is a positive signal)
  temperature: string | null; // hot / warm / …
  emailStatus: string | null; // verified | ok | bounced | null
  hasPhone: boolean;
  bestTime: string | null;
  /** Active MCA programs from signed (live_vendor) funders, MINUS any funder that
   *  already declined this deal (the funder-response override from the plan). */
  programs: ProgramGate[];
  underwriting: UnderwritingInput | null;
  /** Any submission with an offer (offer_made/approved/offer_accepted/funded). */
  hasOffer: boolean;
  declinedFunderCount: number;
}

export interface ScoreResult {
  score: number;
  grade: Grade;
  pClose: number;
  fundableAmount: number;
  expectedCommission: number;
  expectedValue: number;
  reasons: ScoreReason[];
}

const GRADE_ORDER: Grade[] = ["D", "C", "B", "A"];
const gradeMin = (a: Grade, b: Grade): Grade =>
  GRADE_ORDER[Math.min(GRADE_ORDER.indexOf(a), GRADE_ORDER.indexOf(b))];
const gradeMax = (a: Grade, b: Grade): Grade =>
  GRADE_ORDER[Math.max(GRADE_ORDER.indexOf(a), GRADE_ORDER.indexOf(b))];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// ── The v1 formula (research/PLAN_lead_scoring.md §3) ────────────────────────
export function scoreLead(i: ScoreInputs): ScoreResult {
  const reasons: ScoreReason[] = [];
  let capC = false;
  let forceD = false;

  // Underwritten truth beats stated numbers (this is what demotes a merchant whose
  // statements don't back the story — e.g. stated $20k/mo, true $12.6k).
  const uw = i.underwriting;
  const effRevenue = uw?.trueMonthlyRevenue != null && uw.trueMonthlyRevenue > 0
    ? uw.trueMonthlyRevenue
    : i.monthlyRevenue;
  const revenueIsVerified = uw?.trueMonthlyRevenue != null && uw.trueMonthlyRevenue > 0;

  // Fundable amount: sized off revenue, never the aspiration (funnelOdds semantics).
  const revCeiling = effRevenue != null && effRevenue > 0 ? effRevenue * ADVANCE_CEILING : null;
  let fundableAmount = 0;
  if (i.amountRequested != null && i.amountRequested > 0 && revCeiling != null) {
    fundableAmount = Math.min(i.amountRequested, revCeiling);
  } else if (revCeiling != null) {
    fundableAmount = revCeiling;
  } else if (i.amountRequested != null && i.amountRequested > 0) {
    fundableAmount = i.amountRequested; // no revenue known — the ask is all we have
  }
  if (uw?.maxAffordableAdvance != null && uw.maxAffordableAdvance >= 0) {
    fundableAmount = Math.min(fundableAmount, uw.maxAffordableAdvance);
  }

  // ── Factor 1: Funder fit (max 40) — the strongest close signal we have ────
  // Gate at the RESIZED ask (min(requested, revenue ceiling)): the ask-inflation
  // penalty lives in Ask realism, not here.
  const gateAsk = revCeiling != null && i.amountRequested != null
    ? Math.min(i.amountRequested, revCeiling)
    : i.amountRequested;
  let likely = 0, unknownCnt = 0;
  for (const p of i.programs) {
    const v = gateProgram(p, { revenue: effRevenue, tib: i.tibMonths, fico: i.fico, requested: gateAsk });
    if (v === "likely" || v === "stretch") likely++;
    else if (v === "unknown") unknownCnt++;
  }
  let fitPts: number;
  if (i.programs.length === 0) {
    fitPts = 15; // no program data at all — can't judge; middle score, honest note
    reasons.push({ factor: "funder_fit", points: fitPts, max: 40, note: "no active funder programs to gate against — fit unknown" });
  } else if (likely === 0) {
    fitPts = 0;
    forceD = true; // nobody can fund it = it cannot close
    reasons.push({
      factor: "funder_fit", points: 0, max: 40,
      note: `0 live funders can take this deal${i.declinedFunderCount ? ` (${i.declinedFunderCount} already declined)` : ""} — hard-capped at D`,
    });
  } else {
    fitPts = likely <= 3 ? 15 : likely <= 9 ? 28 : 40;
    reasons.push({
      factor: "funder_fit", points: fitPts, max: 40,
      note: `${likely} live funder program(s) can take this deal` +
        (unknownCnt ? ` (+${unknownCnt} with no criteria on file)` : "") +
        (i.declinedFunderCount ? `; ${i.declinedFunderCount} funder(s) already declined` : ""),
    });
  }

  // ── Factor 2: Ask realism (max 15) ─────────────────────────────────────────
  let askPts = 8;
  if (i.amountRequested != null && i.amountRequested > 0 && effRevenue != null && effRevenue > 0) {
    const multiple = i.amountRequested / effRevenue;
    if (multiple <= 1.2) { askPts = 15; reasons.push({ factor: "ask_realism", points: 15, max: 15, note: `ask is ${multiple.toFixed(1)}× monthly revenue — in range` }); }
    else if (multiple <= 1.5) { askPts = 8; reasons.push({ factor: "ask_realism", points: 8, max: 15, note: `ask is ${multiple.toFixed(1)}× monthly revenue — a stretch, expect a resize conversation` }); }
    else { askPts = 0; reasons.push({ factor: "ask_realism", points: 0, max: 15, note: `ask is ${multiple.toFixed(1)}× monthly revenue — expectation reset required` }); }
  } else {
    reasons.push({ factor: "ask_realism", points: askPts, max: 15, note: "ask or revenue unknown — assumed resizable" });
  }

  // ── Factor 3: Fundamentals (max 20) ────────────────────────────────────────
  let fundPts = 0;
  const rev = effRevenue ?? 0;
  const revPts = rev >= 50000 ? 8 : rev >= 20000 ? 6 : rev >= 10000 ? 3 : 0;
  fundPts += revPts;
  const tibPts = i.tibMonths == null ? 0 : i.tibMonths >= 24 ? 4 : i.tibMonths >= 12 ? 2 : i.tibMonths >= 6 ? 1 : 0;
  fundPts += tibPts;
  const ficoPts = i.fico == null ? 1 : i.fico >= 650 ? 4 : i.fico >= 600 ? 3 : i.fico >= 550 ? 1 : 0;
  fundPts += ficoPts;
  const stacked =
    (i.openPositions != null && i.openPositions >= 3) ||
    (i.positionsBalance != null && rev > 0 && i.positionsBalance > rev * 0.5);
  const posPts = stacked ? 0 : i.openPositions === 0 ? 4 : i.openPositions != null ? 2 : 2;
  fundPts += posPts;
  reasons.push({
    factor: "fundamentals", points: fundPts, max: 20,
    note: [
      rev > 0 ? `${revenueIsVerified ? "verified" : "stated"} ${fmtMoney(rev)}/mo` : "revenue unknown",
      i.tibMonths != null ? `${i.tibMonths} mo in business` : "TIB unknown",
      i.fico != null ? `FICO ${i.fico}` : "FICO unknown",
      stacked ? "stacked positions" : i.openPositions === 0 ? "no open positions" : i.openPositions != null ? `${i.openPositions} open position(s)` : "positions unknown",
    ].join(", "),
  });

  // ── Factor 4: Intent (max 15) ──────────────────────────────────────────────
  let intentPts = 0;
  const intentBits: string[] = [];
  if (i.needMoneyNow === true) { intentPts += 6; intentBits.push("needs money now"); }
  const uof = (i.useOfFunds ?? "").toLowerCase();
  if (/expan|equip|invent|market|grow/.test(uof)) { intentPts += 5; intentBits.push("revenue-generating use of funds"); }
  else if (/payoff|consolidat|refinanc/.test(uof)) { intentPts += 2; intentBits.push("payoff/consolidation use of funds"); }
  else { intentPts += 2; if (uof) intentBits.push(`use of funds: ${i.useOfFunds}`); }
  if (/^no\b/i.test((i.difficultyApproved ?? "").trim())) { intentPts += 2; intentBits.push("no approval difficulty history"); }
  if (/hot|live/i.test(i.temperature ?? "")) { intentPts += 2; intentBits.push("hot source"); }
  reasons.push({ factor: "intent", points: intentPts, max: 15, note: intentBits.join(", ") || "no intent signals" });

  // ── Factor 5: Reachability (max 10) ────────────────────────────────────────
  let reachPts = 0;
  const emailOk = i.emailStatus === "ok" || i.emailStatus === "verified";
  const emailBounced = i.emailStatus === "bounced";
  reachPts += emailOk ? 4 : emailBounced ? 0 : 2;
  if (i.hasPhone) reachPts += 4;
  if ((i.bestTime ?? "").trim()) reachPts += 2;
  if (emailBounced && !i.hasPhone) forceD = true; // cannot close someone we cannot reach
  reasons.push({
    factor: "reachability", points: reachPts, max: 10,
    note: [
      emailOk ? "email deliverable" : emailBounced ? "EMAIL BOUNCED" : "email unchecked",
      i.hasPhone ? "phone on file" : "NO PHONE",
      (i.bestTime ?? "").trim() ? `best time: ${i.bestTime}` : null,
    ].filter(Boolean).join(", ") + (emailBounced && !i.hasPhone ? " — unreachable, forced D" : ""),
  });

  let score = fitPts + askPts + fundPts + intentPts + reachPts;

  // ── Post-underwriting overrides (bank-statement truth beats stated) ───────
  if (uw) {
    if (revenueIsVerified && i.monthlyRevenue != null && i.monthlyRevenue > 0 &&
        Math.abs((uw.trueMonthlyRevenue ?? 0) - i.monthlyRevenue) / i.monthlyRevenue > 0.15) {
      reasons.push({
        factor: "underwriting", points: 0, max: 0,
        note: `underwriting: true revenue ${fmtMoney(uw.trueMonthlyRevenue ?? 0)}/mo vs stated ${fmtMoney(i.monthlyRevenue)} — score uses the verified number`,
      });
    }
    if (uw.riskRating === "high" || uw.criticalFlagCount > 0) {
      capC = true;
      reasons.push({
        factor: "underwriting", points: 0, max: 0,
        note: `underwriting risk ${uw.riskRating ?? "?"}${uw.criticalFlagCount ? ` with ${uw.criticalFlagCount} critical flag(s)` : ""} — grade capped at C`,
      });
    }
    if (uw.affordabilityRating === "unaffordable") {
      forceD = true;
      reasons.push({
        factor: "underwriting", points: 0, max: 0,
        note: "underwriting says the ask is UNAFFORDABLE on true revenue — forced D (resize or decline)",
      });
    }
    if (uw.riskRating === "low" && uw.criticalFlagCount === 0) {
      score = Math.min(100, score + 5);
      reasons.push({ factor: "underwriting", points: 5, max: 5, note: "statements verify the story (+5)" });
    }
  }

  score = clamp(Math.round(score), 0, 100);

  // ── Grade ──────────────────────────────────────────────────────────────────
  let grade: Grade = score >= 80 ? "A" : score >= 65 ? "B" : score >= 45 ? "C" : "D";
  if (capC) grade = gradeMin(grade, "C");
  if (forceD) grade = "D";
  // An offer in hand is ground truth — a funder already said yes. Floors B, last.
  if (i.hasOffer) {
    const before = grade;
    grade = gradeMax(grade, "B");
    reasons.push({
      factor: "funder_response", points: 0, max: 0,
      note: `a funder already made an offer — grade floored at B${before !== grade ? ` (was ${before})` : ""}`,
    });
  }

  // ── Expected value ─────────────────────────────────────────────────────────
  const points = i.isRenewal ? RENEWAL_POINTS : NEW_DEAL_POINTS;
  const expectedCommission = (fundableAmount * points) / 100;
  const stageOdds = STAGE_FUND_ODDS[i.status] ?? OFF_LADDER_ODDS[i.status] ?? 0.06;
  const pClose = clamp(stageOdds * GRADE_MULT[grade], 0.01, 0.95);
  const expectedValue = Math.round(pClose * expectedCommission);
  reasons.push({
    factor: "expected_value", points: 0, max: 0,
    note: `EV ${fmtMoney(expectedValue)} est. = ${(pClose * 100).toFixed(0)}% × ${fmtMoney(expectedCommission)} commission on ${fmtMoney(fundableAmount)} fundable (stage '${i.status}' odds ${(stageOdds * 100).toFixed(0)}% × grade ${grade})`,
  });

  return {
    score,
    grade,
    pClose: Math.round(pClose * 1000) / 1000,
    fundableAmount: Math.round(fundableAmount),
    expectedCommission: Math.round(expectedCommission),
    expectedValue,
    reasons,
  };
}

// ── Messy vendor-text parsers (shared so edge + UI read lead_qual identically) ─

/** First number in a messy vendor string ("$75,000 to $100,000" → 75000). */
export function numFromText(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = String(v).match(/\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Position counts: "No"/"None" mean ZERO; "N/A"/"" mean unknown; "1 MCA" → 1. */
export function positionsFromText(v: unknown): number | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (/^(no|none|zero|0)\b/i.test(s)) return 0;
  if (/^n\/?a$/i.test(s)) return null;
  return numFromText(s);
}

/** "5 Years" → 60, "18 months" → 18, bare "7" → assume years → 84. */
export function monthsFromOwnerText(v: unknown): number | null {
  if (v == null || v === "") return null;
  const s = String(v).toLowerCase();
  const n = numFromText(s);
  if (n == null) return null;
  if (/month|mo\b/.test(s)) return Math.round(n);
  return Math.round(n * 12); // "years" or bare number — years is how the vendor asks
}

/** Yes/No-ish vendor text → boolean or null when it says nothing. */
export function yesish(v: unknown): boolean | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (/^y(es)?\b/i.test(s)) return true;
  if (/^no?\b/i.test(s)) return false;
  return null;
}
