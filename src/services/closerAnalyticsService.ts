import supabase from "@/supabase";
import type { DealStatus } from "@/types/deals";
import type { PaymentStatus } from "@/types/commissions";

/**
 * Per-closer performance analytics for /admin/closers.
 *
 * Design note on queries: everything is fetched in FOUR flat queries (closers,
 * deals, commissions, activity_log) filtered with `.in(...)` over the full ID
 * set, then bucketed in memory by closer. There is deliberately no per-closer
 * query — adding closers does not add round-trips.
 *
 * Data-model note: `deals.assigned_closer_id` FKs to `profiles.id` (the closer's
 * auth user), while `commissions.closer_id` FKs to `closers.id`. We therefore
 * index deals by BOTH `closers.id` and `closers.user_id` so the join works no
 * matter which id was written onto the deal.
 */

// ---------------------------------------------------------------------------
// Benchmarks (CLAUDE.md "Overall Close Rate Targets" + "The Golden Ratio")
// ---------------------------------------------------------------------------

/** Target close % by closer tenure (months since start_date). */
export function targetCloseRate(tenureMonths: number): number {
  if (tenureMonths < 3) return 8;
  if (tenureMonths < 6) return 10;
  if (tenureMonths < 12) return 12;
  return 14;
}

export const BENCHMARKS = {
  /** CLAUDE.md core economics: $50K average advance. */
  AVG_DEAL_SIZE: 50_000,
  /** 8 points on the average deal = $4,000 gross commission. */
  AVG_GROSS_COMMISSION: 4_000,
  /** A ramped closer should be funding ~2 deals/month. */
  TARGET_DEALS_PER_MONTH: 2,
  /** Speed-to-contact: under 1 hour is the standard; 24h is failing. */
  TARGET_FIRST_CONTACT_HOURS: 1,
  MAX_FIRST_CONTACT_HOURS: 24,
  /** Lead → funded in a week is the MCA promise; 21 days is failing. */
  TARGET_DAYS_TO_FUND: 7,
  MAX_DAYS_TO_FUND: 21,
  /** Logged touches per open deal per week. */
  TARGET_TOUCHES_PER_OPEN_DEAL: 3,
} as const;

export type Grade = "green" | "amber" | "red" | "none";

/** Higher-is-better grading: green at/above target, amber within 70%, else red. */
export function gradeAbove(value: number, target: number, sampleSize = 1): Grade {
  if (sampleSize <= 0 || target <= 0) return "none";
  if (value >= target) return "green";
  if (value >= target * 0.7) return "amber";
  return "red";
}

/** Lower-is-better grading: green at/below target, amber up to the hard max. */
export function gradeBelow(value: number | null, target: number, max: number): Grade {
  if (value === null || !Number.isFinite(value)) return "none";
  if (value <= target) return "green";
  if (value <= max) return "amber";
  return "red";
}

export const GRADE_CLASSES: Record<Grade, string> = {
  green:
    "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800",
  amber:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800",
  red:
    "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800",
  none:
    "bg-gray-50 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700",
};

export const GRADE_DOT: Record<Grade, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
  none: "bg-gray-300 dark:bg-gray-600",
};

// ---------------------------------------------------------------------------
// Funnel definition
// ---------------------------------------------------------------------------

/** MCA funnel steps, in order, keyed by the deal timestamp column that proves it. */
export const FUNNEL_STEPS: { key: string; label: string; column: string }[] = [
  { key: "contacted", label: "Contacted", column: "contacted_at" },
  { key: "qualified", label: "Qualified", column: "qualified_at" },
  { key: "app_sent", label: "App Sent", column: "application_sent_at" },
  { key: "docs", label: "Docs In", column: "docs_collected_at" },
  { key: "submitted", label: "Submitted", column: "submitted_at" },
  { key: "offer", label: "Offer", column: "offer_received_at" },
  { key: "presented", label: "Presented", column: "offer_presented_at" },
  { key: "accepted", label: "Accepted", column: "offer_accepted_at" },
  { key: "funded", label: "Funded", column: "funded_at" },
];

export interface FunnelStep {
  key: string;
  label: string;
  count: number;
  /** % of assigned deals that reached this step. */
  pctOfAssigned: number;
  /** % of the deals that reached the PREVIOUS step which also reached this one. */
  pctOfPrevious: number;
}

const CLOSED_LOST: DealStatus[] = ["declined", "dead"];
const PARKED: DealStatus[] = ["nurture"];

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface CloserScorecard {
  closerId: string;
  userId: string | null;

  // MONEY
  totalFunded: number;
  grossCommission: number;
  companyRevenue: number;
  payoutPaid: number;
  payoutApproved: number;
  payoutPending: number;
  payoutOnHold: number;
  clawbacks: number;

  // CONVERSION
  dealsAssigned: number;
  dealsWorked: number;
  dealsFunded: number;
  dealsLost: number;
  closeRate: number; // %
  funnel: FunnelStep[];

  // VELOCITY (null when there is no sample)
  avgHoursToFirstContact: number | null;
  avgDaysToFund: number | null;

  // PIPELINE
  openDeals: number;
  pipelineValue: number;

  // ACTIVITY
  activityCount: number;
  callCount: number;
  activityPerOpenDeal: number;

  // DERIVED
  avgDealSize: number;
  tenureMonths: number;
  dealsPerMonth: number;
  renewals: number;
  selfGenDeals: number;
  lastActivityAt: string | null;

  // ASSESSMENT
  targetCloseRate: number;
  closeRateGrade: Grade;
  runRateGrade: Grade;
  speedToContactGrade: Grade;
  timeToFundGrade: Grade;
  activityGrade: Grade;
  /** 0–100 composite used for the contribution ranking. */
  overallScore: number;
  hasData: boolean;
}

export interface CloserAnalytics {
  byCloser: Record<string, CloserScorecard>;
  /** closer ids sorted by contribution (funded $ desc, then score). */
  ranking: string[];
  totalFundedAllClosers: number;
  refreshedAt: string;
}

// ---------------------------------------------------------------------------
// Row shapes (only the columns we select)
// ---------------------------------------------------------------------------

interface DealRow {
  id: string;
  assigned_closer_id: string | null;
  status: DealStatus;
  amount_requested: number | null;
  amount_funded: number | null;
  is_renewal: boolean | null;
  lead_source: string | null;
  created_at: string;
  contacted_at: string | null;
  qualified_at: string | null;
  application_sent_at: string | null;
  docs_collected_at: string | null;
  submitted_at: string | null;
  offer_received_at: string | null;
  offer_presented_at: string | null;
  offer_accepted_at: string | null;
  funded_at: string | null;
}

interface CommissionRow {
  closer_id: string | null;
  gross_commission: number | null;
  closer_amount: number | null;
  company_amount: number | null;
  payment_status: PaymentStatus;
  clawback_amount: number | null;
}

interface ActivityRow {
  entity_id: string | null;
  interaction_type: string | null;
  logged_by: string | null;
  created_at: string;
}

interface CloserIdRow {
  id: string;
  user_id: string | null;
  start_date: string | null;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function hoursBetween(a: string, b: string): number | null {
  const start = new Date(a).getTime();
  const end = new Date(b).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return (end - start) / 3_600_000;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function emptyScorecard(closerId: string, userId: string | null, tenureMonths: number): CloserScorecard {
  return {
    closerId,
    userId,
    totalFunded: 0,
    grossCommission: 0,
    companyRevenue: 0,
    payoutPaid: 0,
    payoutApproved: 0,
    payoutPending: 0,
    payoutOnHold: 0,
    clawbacks: 0,
    dealsAssigned: 0,
    dealsWorked: 0,
    dealsFunded: 0,
    dealsLost: 0,
    closeRate: 0,
    funnel: FUNNEL_STEPS.map((s) => ({
      key: s.key,
      label: s.label,
      count: 0,
      pctOfAssigned: 0,
      pctOfPrevious: 0,
    })),
    avgHoursToFirstContact: null,
    avgDaysToFund: null,
    openDeals: 0,
    pipelineValue: 0,
    activityCount: 0,
    callCount: 0,
    activityPerOpenDeal: 0,
    avgDealSize: 0,
    tenureMonths,
    dealsPerMonth: 0,
    renewals: 0,
    selfGenDeals: 0,
    lastActivityAt: null,
    targetCloseRate: targetCloseRate(tenureMonths),
    closeRateGrade: "none",
    runRateGrade: "none",
    speedToContactGrade: "none",
    timeToFundGrade: "none",
    activityGrade: "none",
    overallScore: 0,
    hasData: false,
  };
}

// ---------------------------------------------------------------------------
// Main fetch — 4 queries total, regardless of closer count
// ---------------------------------------------------------------------------

export async function getCloserAnalytics(): Promise<CloserAnalytics> {
  const refreshedAt = new Date().toISOString();

  // 1. Closer identity + tenure basis.
  const { data: closerRows, error: closerErr } = await supabase
    .from("closers")
    .select("id, user_id, start_date");
  if (closerErr) throw closerErr;

  const closers = (closerRows || []) as CloserIdRow[];
  if (closers.length === 0) {
    return { byCloser: {}, ranking: [], totalFundedAllClosers: 0, refreshedAt };
  }

  const now = Date.now();
  const scorecards: Record<string, CloserScorecard> = {};
  /** any id that could appear on a deal → the owning closers.id */
  const dealKeyToCloser: Record<string, string> = {};
  const userIds: string[] = [];

  for (const c of closers) {
    const tenureMonths = c.start_date
      ? Math.max(0, (now - new Date(c.start_date).getTime()) / (1000 * 60 * 60 * 24 * 30.44))
      : 0;
    scorecards[c.id] = emptyScorecard(c.id, c.user_id, tenureMonths);
    dealKeyToCloser[c.id] = c.id;
    if (c.user_id) {
      dealKeyToCloser[c.user_id] = c.id;
      userIds.push(c.user_id);
    }
  }

  const dealKeys = Object.keys(dealKeyToCloser);
  const closerIds = closers.map((c) => c.id);

  // 2 + 3. Deals and commissions — one `.in()` sweep each.
  const [dealsRes, commissionsRes] = await Promise.all([
    supabase
      .from("deals")
      .select(
        "id, assigned_closer_id, status, amount_requested, amount_funded, is_renewal, lead_source, created_at, contacted_at, qualified_at, application_sent_at, docs_collected_at, submitted_at, offer_received_at, offer_presented_at, offer_accepted_at, funded_at",
      )
      .in("assigned_closer_id", dealKeys),
    supabase
      .from("commissions")
      .select("closer_id, gross_commission, closer_amount, company_amount, payment_status, clawback_amount")
      .in("closer_id", closerIds),
  ]);

  if (dealsRes.error) throw dealsRes.error;
  if (commissionsRes.error) throw commissionsRes.error;

  const deals = (dealsRes.data || []) as DealRow[];
  const commissions = (commissionsRes.data || []) as CommissionRow[];

  // 4. Activity logged BY these closers (profile ids). Skipped when no closer is
  //    linked to a profile yet.
  let activity: ActivityRow[] = [];
  if (userIds.length > 0) {
    const { data, error } = await supabase
      .from("activity_log")
      .select("entity_id, interaction_type, logged_by, created_at")
      .in("logged_by", userIds);
    if (error) throw error;
    activity = (data || []) as ActivityRow[];
  }

  // --- Bucket deals -------------------------------------------------------
  const contactLags: Record<string, number[]> = {};
  const fundLags: Record<string, number[]> = {};
  const funnelCounts: Record<string, Record<string, number>> = {};

  for (const id of closerIds) {
    contactLags[id] = [];
    fundLags[id] = [];
    funnelCounts[id] = Object.fromEntries(FUNNEL_STEPS.map((s) => [s.key, 0]));
  }

  for (const deal of deals) {
    const key = deal.assigned_closer_id;
    if (!key) continue;
    const closerId = dealKeyToCloser[key];
    if (!closerId) continue;
    const sc = scorecards[closerId];

    sc.dealsAssigned += 1;
    sc.hasData = true;

    if (deal.contacted_at) sc.dealsWorked += 1;

    const isFunded = deal.status === "funded" || Boolean(deal.funded_at);
    const isLost = CLOSED_LOST.includes(deal.status);
    const isParked = PARKED.includes(deal.status);

    if (isFunded) {
      sc.dealsFunded += 1;
      sc.totalFunded += num(deal.amount_funded);
      if (deal.is_renewal) sc.renewals += 1;
    } else if (isLost) {
      sc.dealsLost += 1;
    } else if (!isParked) {
      sc.openDeals += 1;
      // Projected value: what the funder is likely to advance, falling back to
      // what the merchant asked for.
      sc.pipelineValue += num(deal.amount_funded) || num(deal.amount_requested);
    }

    if (deal.lead_source === "self_gen" || deal.lead_source === "closer_self_gen") {
      sc.selfGenDeals += 1;
    }

    // Funnel: a step counts if its timestamp exists.
    const stamps: Record<string, string | null> = {
      contacted: deal.contacted_at,
      qualified: deal.qualified_at,
      app_sent: deal.application_sent_at,
      docs: deal.docs_collected_at,
      submitted: deal.submitted_at,
      offer: deal.offer_received_at,
      presented: deal.offer_presented_at,
      accepted: deal.offer_accepted_at,
      funded: deal.funded_at,
    };
    for (const step of FUNNEL_STEPS) {
      if (stamps[step.key]) funnelCounts[closerId][step.key] += 1;
    }

    // Velocity.
    if (deal.contacted_at) {
      const h = hoursBetween(deal.created_at, deal.contacted_at);
      if (h !== null) contactLags[closerId].push(h);
    }
    if (deal.funded_at) {
      const h = hoursBetween(deal.created_at, deal.funded_at);
      if (h !== null) fundLags[closerId].push(h / 24);
    }
  }

  // --- Bucket commissions -------------------------------------------------
  for (const c of commissions) {
    if (!c.closer_id) continue;
    const sc = scorecards[c.closer_id];
    if (!sc) continue;

    sc.hasData = true;
    sc.grossCommission += num(c.gross_commission);
    sc.companyRevenue += num(c.company_amount);
    sc.clawbacks += num(c.clawback_amount);

    const amount = num(c.closer_amount);
    switch (c.payment_status) {
      case "closer_paid":
      case "completed":
        sc.payoutPaid += amount;
        break;
      case "approved":
      case "funder_paid":
        sc.payoutApproved += amount;
        break;
      case "on_hold":
        sc.payoutOnHold += amount;
        break;
      case "pending":
        sc.payoutPending += amount;
        break;
      case "clawback":
        break;
    }
  }

  // --- Bucket activity ----------------------------------------------------
  const profileToCloser: Record<string, string> = {};
  for (const c of closers) {
    if (c.user_id) profileToCloser[c.user_id] = c.id;
  }
  for (const a of activity) {
    const closerId = a.logged_by ? profileToCloser[a.logged_by] : undefined;
    if (!closerId) continue;
    const sc = scorecards[closerId];
    sc.activityCount += 1;
    if (a.interaction_type === "call") sc.callCount += 1;
    if (!sc.lastActivityAt || a.created_at > sc.lastActivityAt) {
      sc.lastActivityAt = a.created_at;
    }
  }

  // --- Derive + grade -----------------------------------------------------
  for (const id of closerIds) {
    const sc = scorecards[id];

    sc.closeRate = sc.dealsAssigned > 0 ? (sc.dealsFunded / sc.dealsAssigned) * 100 : 0;
    sc.avgDealSize = sc.dealsFunded > 0 ? sc.totalFunded / sc.dealsFunded : 0;

    const months = Math.max(1, sc.tenureMonths);
    sc.dealsPerMonth = sc.dealsFunded / months;

    sc.avgHoursToFirstContact = mean(contactLags[id]);
    sc.avgDaysToFund = mean(fundLags[id]);

    sc.activityPerOpenDeal = sc.openDeals > 0 ? sc.activityCount / sc.openDeals : 0;

    // Funnel percentages (guarded: assigned can be 0).
    let prevCount = sc.dealsAssigned;
    sc.funnel = FUNNEL_STEPS.map((step) => {
      const count = funnelCounts[id][step.key];
      const pctOfAssigned = sc.dealsAssigned > 0 ? (count / sc.dealsAssigned) * 100 : 0;
      const pctOfPrevious = prevCount > 0 ? (count / prevCount) * 100 : 0;
      prevCount = count;
      return { key: step.key, label: step.label, count, pctOfAssigned, pctOfPrevious };
    });

    sc.targetCloseRate = targetCloseRate(sc.tenureMonths);

    // A close rate only means something once there is a real denominator.
    sc.closeRateGrade =
      sc.dealsAssigned >= 5 ? gradeAbove(sc.closeRate, sc.targetCloseRate, sc.dealsAssigned) : "none";
    sc.runRateGrade =
      sc.dealsFunded > 0 ? gradeAbove(sc.dealsPerMonth, BENCHMARKS.TARGET_DEALS_PER_MONTH) : "none";
    sc.speedToContactGrade = gradeBelow(
      sc.avgHoursToFirstContact,
      BENCHMARKS.TARGET_FIRST_CONTACT_HOURS,
      BENCHMARKS.MAX_FIRST_CONTACT_HOURS,
    );
    sc.timeToFundGrade = gradeBelow(
      sc.avgDaysToFund,
      BENCHMARKS.TARGET_DAYS_TO_FUND,
      BENCHMARKS.MAX_DAYS_TO_FUND,
    );
    sc.activityGrade =
      sc.openDeals > 0
        ? gradeAbove(sc.activityPerOpenDeal, BENCHMARKS.TARGET_TOUCHES_PER_OPEN_DEAL)
        : "none";

    // Composite score: close rate vs target (40), run-rate vs target (30),
    // speed to contact (15), activity (15). Each capped at its weight.
    const closeComponent =
      sc.targetCloseRate > 0 ? Math.min(1, sc.closeRate / sc.targetCloseRate) * 40 : 0;
    const runComponent = Math.min(1, sc.dealsPerMonth / BENCHMARKS.TARGET_DEALS_PER_MONTH) * 30;
    const speedComponent =
      sc.avgHoursToFirstContact === null
        ? 0
        : Math.min(1, BENCHMARKS.TARGET_FIRST_CONTACT_HOURS / Math.max(0.25, sc.avgHoursToFirstContact)) * 15;
    const activityComponent =
      Math.min(1, sc.activityPerOpenDeal / BENCHMARKS.TARGET_TOUCHES_PER_OPEN_DEAL) * 15;
    sc.overallScore = Math.round(closeComponent + runComponent + speedComponent + activityComponent);

    if (sc.activityCount > 0) sc.hasData = true;
  }

  const ranking = [...closerIds].sort((a, b) => {
    const A = scorecards[a];
    const B = scorecards[b];
    if (B.totalFunded !== A.totalFunded) return B.totalFunded - A.totalFunded;
    if (B.overallScore !== A.overallScore) return B.overallScore - A.overallScore;
    return B.pipelineValue - A.pipelineValue;
  });

  const totalFundedAllClosers = closerIds.reduce((s, id) => s + scorecards[id].totalFunded, 0);

  return { byCloser: scorecards, ranking, totalFundedAllClosers, refreshedAt };
}
