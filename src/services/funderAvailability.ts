// Funder Availability — "which live MCA funders can I actually submit THIS
// merchant to right now?" This judges two things:
//   1. DOC READINESS — are the funder's HARD-required docs on file (the manual
//      closer checklist deals.doc_checklist is the source of truth).
//   2. BOX FIT — does the merchant fall inside the funder's underwriting box:
//      lien position, open positions, negative days, NSFs, deposit count, min
//      revenue, TIB, min daily balance, excluded states/industries. The
//      structured criteria live on lender_programs; they're checked against the
//      deal's latest AI-underwriting metrics + the customer's state/revenue.
//
// The result splits funders into three tiers so the closer never "randomly sends
// to anybody":
//   • fits_ready   — docs on file AND every KNOWN box criterion passes.
//   • out_of_box   — docs fine but ≥1 criterion fails (with the specific reason).
//   • waiting_docs — a hard-required doc is still missing (unchanged behavior).
//
// HONESTY: a criterion can only FAIL when we hold BOTH sides — a non-null
// criterion AND a non-null deal metric. A set criterion with no deal metric is
// "unchecked (no data)", surfaced separately, never silently passed. If the deal
// has NO underwriting run at all, box-fit is unknowable, so every funder falls
// back to docs-only (tier by docs) and the widget nudges to run the underwriter.
//
// This is ADVISORY visibility. It does NOT gate the submit engine — the real
// hard gate (required_stips + signed-application) still lives in FunderPicker /
// submit-to-funders. voided-check and conditional docs never flip readiness.
import supabase from "../supabase";
import type { DealWithCustomer } from "../types/deals";

export type FunderTier = "fits_ready" | "out_of_box" | "waiting_docs";

export interface FunderReadiness {
  lenderId: string;
  name: string;
  tier: FunderTier;
  ready: boolean; // convenience alias for tier === "fits_ready"
  missing: string[]; // hard-required docs not on file, human-labeled
  advisories: string[]; // voided check + conditional/if-applicable docs (never blocking)
  boxReasons: string[]; // specific box-fit failures ("max 2 open positions — merchant has 6")
  unchecked: string[]; // criteria the funder sets but we can't check (no deal metric) — "no data"
  bankMonths: number | null; // doc_bank_statement_months, for "(3mo)" context
  conditions: string | null; // doc_conditions free-text ("CA deals: 4 months")
}

export interface FunderAvailability {
  rows: FunderReadiness[];
  hasUnderwriting: boolean; // false → box-fit couldn't run; widget shows the nudge
}

// customer_document_type slugs used as the docs-on-file vocabulary.
const DOC_LABELS: Record<string, string> = {
  application: "Signed application",
  bank_statement: "Bank statements",
  id: "Photo ID",
  business_license: "Business license",
  tax_return: "Tax return",
  voided_check: "Voided check",
};

// Rows we read off lender_programs — doc requirements + structured box criteria.
interface ProgramRow {
  lender_id: string;
  doc_bank_statement_months: number | null;
  doc_application: boolean | null;
  doc_photo_id: boolean | null;
  doc_voided_check: boolean | null;
  doc_cc_processing: string | null;
  doc_mtd_statement: boolean | null;
  doc_proof_of_ownership: boolean | null;
  doc_ar_aging: string | null;
  doc_tax_financials: string | null;
  doc_conditions: string | null;
  // Box criteria (all nullable; null = unknown / no data).
  monthly_revenue_required: number | null;
  min_credit_score: number | null;
  time_in_business_months: number | null;
  max_position: number | null;
  max_open_positions: number | null;
  max_negative_days_month: number | null;
  max_nsfs_month: number | null;
  min_monthly_deposit_count: number | null;
  excluded_states: string[] | null;
  excluded_industries: string[] | null;
  min_daily_balance: number | null;
  lenders: { id: string; company_name: string; status: string } | null;
}

// The merchant/deal facts the box criteria are checked against. Any field may be
// null — a null metric makes the matching criterion "unchecked", never a pass.
export interface DealFit {
  hasUnderwriting: boolean;
  positions: number | null; // open MCA positions
  revenue: number | null; // bank-verified true avg monthly revenue
  worstNegDays: number | null; // worst full month's negative-day count
  worstNsf: number | null; // worst full month's NSF count
  minDepositCount: number | null; // lowest full month's deposit count
  avgDailyBalance: number | null;
  state: string | null; // customer address_state
  industry: string | null;
  tibMonths: number | null;
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const moneyK = (n: number) => `$${Math.round(n / 1000)}K`;

// Docs on file for a deal — the CLOSER-CONTROLLED manual checklist
// (deals.doc_checklist) is the SOURCE OF TRUTH. A slug is present iff ticked.
function getDocsPresent(deal: DealWithCustomer): Set<string> {
  const present = new Set<string>();
  const checklist = deal.doc_checklist ?? {};
  for (const [slug, on] of Object.entries(checklist)) {
    if (on === true) present.add(slug);
  }
  return present;
}

// HARD docs / advisories, unchanged from the doc-only era.
function evaluateDocs(p: ProgramRow, docs: Set<string>): { missing: string[]; advisories: string[] } {
  const missing: string[] = [];
  const advisories: string[] = [];

  const hard: [boolean, string][] = [
    [p.doc_application === true, "application"],
    [p.doc_photo_id === true, "id"],
    [(p.doc_bank_statement_months ?? 0) > 0, "bank_statement"],
    [p.doc_proof_of_ownership === true, "business_license"],
    [p.doc_tax_financials === "required", "tax_return"],
  ];
  for (const [required, slug] of hard) {
    if (!required || docs.has(slug)) continue;
    if (slug === "bank_statement" && (p.doc_bank_statement_months ?? 0) > 0) {
      missing.push(`${DOC_LABELS.bank_statement} (${p.doc_bank_statement_months}mo)`);
    } else {
      missing.push(DOC_LABELS[slug]);
    }
  }

  if (p.doc_voided_check === true && !docs.has("voided_check")) {
    advisories.push("Voided check (a bank-portal screenshot satisfies it)");
  }
  if (p.doc_tax_financials === "conditional") {
    advisories.push("Tax return / financials may be needed for larger deals");
  }
  if (p.doc_cc_processing === "required" || p.doc_cc_processing === "if_applicable") {
    advisories.push("CC-processing statements may also be needed");
  }
  if (p.doc_ar_aging === "required" || p.doc_ar_aging === "if_applicable") {
    advisories.push("A/R aging report may also be needed");
  }
  if (p.doc_mtd_statement === true) {
    advisories.push("Month-to-date bank statement may also be needed");
  }
  return { missing, advisories };
}

// Case-insensitive token match — does the merchant's free-text industry overlap
// any of the funder's excluded-industry tokens? Substring both ways so
// "Landscaping" matches "landscap" and "Auto Sales" matches "auto sales dealer".
function matchIndustry(industry: string, excluded: string[]): string | null {
  const ind = industry.toLowerCase();
  for (const raw of excluded) {
    const tok = raw.trim().toLowerCase();
    if (!tok) continue;
    if (ind.includes(tok) || tok.includes(ind)) return raw;
  }
  return null;
}

// Check every KNOWN box criterion. Returns the specific failure reasons and the
// list of criteria we couldn't check (set on the funder, no metric on the deal).
export function evaluateBox(p: ProgramRow, fit: DealFit): { reasons: string[]; unchecked: string[] } {
  const reasons: string[] = [];
  const unchecked: string[] = [];

  // For each criterion: only judge when BOTH sides are present; otherwise, if the
  // funder sets it, record it as unchecked so the gap is visible.
  const check = (
    set: boolean,
    metric: number | string | null,
    fails: boolean,
    reason: string,
    label: string,
  ) => {
    if (!set) return;
    if (metric === null || metric === undefined) {
      unchecked.push(label);
      return;
    }
    if (fails) reasons.push(reason);
  };

  // Excluded states.
  if (p.excluded_states && p.excluded_states.length > 0) {
    if (fit.state) {
      if (p.excluded_states.map((s) => s.toUpperCase()).includes(fit.state.toUpperCase())) {
        reasons.push(`excludes ${fit.state.toUpperCase()}`);
      }
    } else {
      unchecked.push("excluded states");
    }
  }
  // Excluded industries.
  if (p.excluded_industries && p.excluded_industries.length > 0) {
    if (fit.industry) {
      const hit = matchIndustry(fit.industry, p.excluded_industries);
      if (hit) reasons.push(`industry restricted (${hit})`);
    } else {
      unchecked.push("excluded industries");
    }
  }

  check(
    p.monthly_revenue_required != null,
    fit.revenue,
    fit.revenue != null && fit.revenue < (p.monthly_revenue_required ?? 0),
    `${moneyK(p.monthly_revenue_required ?? 0)}/mo min — merchant ~${fit.revenue != null ? moneyK(fit.revenue) : "?"}`,
    "min monthly revenue",
  );
  check(
    p.time_in_business_months != null,
    fit.tibMonths,
    fit.tibMonths != null && fit.tibMonths < (p.time_in_business_months ?? 0),
    `${p.time_in_business_months}mo TIB min — merchant ${fit.tibMonths}mo`,
    "min time in business",
  );
  // Credit score: we have no verified FICO metric on the deal, so a set min is
  // always unchecked (honest — we don't pull credit here).
  check(p.min_credit_score != null, null, false, "", "min credit score");

  check(
    p.max_position != null,
    fit.positions,
    // They fund up to position N (they become position N); merchant already
    // holding N or more means the new advance would sit past their box.
    fit.positions != null && fit.positions >= (p.max_position ?? Infinity),
    `funds up to position ${p.max_position} — merchant has ${fit.positions}`,
    "max lien position",
  );
  check(
    p.max_open_positions != null,
    fit.positions,
    fit.positions != null && fit.positions > (p.max_open_positions ?? Infinity),
    `max ${p.max_open_positions} open positions — merchant has ${fit.positions}`,
    "max open positions",
  );
  check(
    p.max_negative_days_month != null,
    fit.worstNegDays,
    fit.worstNegDays != null && fit.worstNegDays > (p.max_negative_days_month ?? Infinity),
    `max ${p.max_negative_days_month} neg days/mo — merchant had ${fit.worstNegDays}`,
    "max negative days/month",
  );
  check(
    p.max_nsfs_month != null,
    fit.worstNsf,
    fit.worstNsf != null && fit.worstNsf > (p.max_nsfs_month ?? Infinity),
    `max ${p.max_nsfs_month} NSFs/mo — merchant had ${fit.worstNsf}`,
    "max NSFs/month",
  );
  check(
    p.min_monthly_deposit_count != null,
    fit.minDepositCount,
    fit.minDepositCount != null && fit.minDepositCount < (p.min_monthly_deposit_count ?? 0),
    `min ${p.min_monthly_deposit_count} deposits/mo — merchant had ${fit.minDepositCount}`,
    "min deposits/month",
  );
  check(
    p.min_daily_balance != null,
    fit.avgDailyBalance,
    fit.avgDailyBalance != null && fit.avgDailyBalance < (p.min_daily_balance ?? 0),
    `min ${money(p.min_daily_balance ?? 0)} daily balance — merchant ~${fit.avgDailyBalance != null ? money(fit.avgDailyBalance) : "?"}`,
    "min daily balance",
  );

  return { reasons, unchecked };
}

// Pull the merchant/deal facts for box-fit off the latest AI-underwriting run
// (deal_underwriting.metrics) + the customer row. hasUnderwriting=false means no
// run exists and box-fit must fall back to docs-only.
async function loadDealFit(deal: DealWithCustomer): Promise<DealFit> {
  const base: DealFit = {
    hasUnderwriting: false,
    positions: null,
    revenue: null,
    worstNegDays: null,
    worstNsf: null,
    minDepositCount: null,
    avgDailyBalance: null,
    state: null,
    industry: deal.customer?.industry ?? null,
    tibMonths: deal.customer?.time_in_business ?? null,
  };

  // address_state isn't on DealWithCustomer.customer — fetch it (+ industry/tib
  // as a fallback) straight from customers.
  if (deal.customer_id) {
    const { data: cust } = await supabase
      .from("customers")
      .select("address_state, industry, time_in_business")
      .eq("id", deal.customer_id)
      .maybeSingle();
    if (cust) {
      base.state = (cust as { address_state: string | null }).address_state ?? null;
      base.industry = base.industry ?? (cust as { industry: string | null }).industry ?? null;
      base.tibMonths = base.tibMonths ?? (cust as { time_in_business: number | null }).time_in_business ?? null;
    }
  }

  const { data: uw } = await supabase
    .from("deal_underwriting")
    .select("metrics")
    .eq("deal_id", deal.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const metrics = (uw as { metrics: Record<string, unknown> } | null)?.metrics;
  if (!metrics) return base;

  base.hasUnderwriting = true;
  const m = metrics as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

  const activeLen = Array.isArray(m.active_positions) ? m.active_positions.length : null;
  base.positions = num(m.est_open_positions) ?? activeLen;
  base.revenue = num(m.true_avg_monthly_revenue);
  base.avgDailyBalance = num(m.avg_daily_balance);

  // Per-month worst/min — drop the trailing partial month (its counts are
  // incomplete and could understate NSFs/negative days).
  if (Array.isArray(m.per_month) && m.per_month.length > 0) {
    let months = m.per_month as Array<{ negative_days?: number; nsf_count?: number; deposit_count?: number }>;
    if (m.latest_month_is_partial === true && months.length > 1) months = months.slice(0, -1);
    const negs = months.map((x) => x.negative_days).filter((v): v is number => typeof v === "number");
    const nsfs = months.map((x) => x.nsf_count).filter((v): v is number => typeof v === "number");
    const deps = months.map((x) => x.deposit_count).filter((v): v is number => typeof v === "number");
    base.worstNegDays = negs.length ? Math.max(...negs) : null;
    base.worstNsf = nsfs.length ? Math.max(...nsfs) : null;
    base.minDepositCount = deps.length ? Math.min(...deps) : null;
  }

  return base;
}

const PROGRAM_COLUMNS =
  "lender_id, doc_bank_statement_months, doc_application, doc_photo_id, doc_voided_check, doc_cc_processing, doc_mtd_statement, doc_proof_of_ownership, doc_ar_aging, doc_tax_financials, doc_conditions, monthly_revenue_required, min_credit_score, time_in_business_months, max_position, max_open_positions, max_negative_days_month, max_nsfs_month, min_monthly_deposit_count, excluded_states, excluded_industries, min_daily_balance, lenders!inner(id, company_name, status)";

// Main entry: three-tier availability for every LIVE MCA funder against this
// deal. Ordered fits → out-of-box → waiting, then by name inside each tier.
export async function getFunderAvailability(deal: DealWithCustomer): Promise<FunderAvailability> {
  const [{ data: programs }, fit] = await Promise.all([
    supabase
      .from("lender_programs")
      .select(PROGRAM_COLUMNS)
      .eq("product_type", "mca")
      .eq("is_active", true),
    loadDealFit(deal),
  ]);

  const docs = getDocsPresent(deal);
  const rows = ((programs ?? []) as unknown as ProgramRow[])
    .filter((p) => p.lenders?.status === "live_vendor")
    .map<FunderReadiness>((p) => {
      const { missing, advisories } = evaluateDocs(p, docs);
      const name = p.lenders?.company_name ?? "Funder";
      const bankMonths = p.doc_bank_statement_months ?? null;
      const conditions = p.doc_conditions?.trim() ? p.doc_conditions.trim() : null;

      // Docs come first — a missing hard doc is "waiting" regardless of fit.
      if (missing.length > 0) {
        return { lenderId: p.lender_id, name, tier: "waiting_docs", ready: false, missing, advisories, boxReasons: [], unchecked: [], bankMonths, conditions };
      }
      // No underwriting run → box-fit unknowable → docs-only "ready".
      if (!fit.hasUnderwriting) {
        return { lenderId: p.lender_id, name, tier: "fits_ready", ready: true, missing, advisories, boxReasons: [], unchecked: [], bankMonths, conditions };
      }
      const { reasons, unchecked } = evaluateBox(p, fit);
      const tier: FunderTier = reasons.length > 0 ? "out_of_box" : "fits_ready";
      return { lenderId: p.lender_id, name, tier, ready: tier === "fits_ready", missing, advisories, boxReasons: reasons, unchecked, bankMonths, conditions };
    });

  const order: Record<FunderTier, number> = { fits_ready: 0, out_of_box: 1, waiting_docs: 2 };
  rows.sort((a, b) => (order[a.tier] - order[b.tier]) || a.name.localeCompare(b.name));

  return { rows, hasUnderwriting: fit.hasUnderwriting };
}
