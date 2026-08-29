// MCA / ISO INDUSTRY BENCHMARKS — the owner's figures, defined ONCE.
//
// WHY THIS FILE EXISTS. Setter Performance is full of measured numbers with no
// outside reference: "1.4% of dials reached a human" is a fact with nothing to
// judge it against, so a manager reading it has to already know what normal
// looks like. These are the owner-supplied industry bands for an MCA/ISO shop —
// the second opinion that turns a bare number into "ahead" or "behind".
//
// ── WHAT THESE ARE, AND WHAT THEY ARE NOT ────────────────────────────────────
// They are RULES OF THUMB for the industry, not this shop's targets. The page's
// own thresholds live in platform_settings.ph_dialer_kpi_targets and remain the
// only thing that colours a KPI red. A benchmark can only ever paint an extra,
// separately-labelled chip, and it uses a DELIBERATELY DIFFERENT palette rule:
//
//   green = the shop meets or beats the industry band
//   amber = the shop is below it
//   grey  = there is no comparable number on this page  ← never green, never red
//
// There is no RED here on purpose. Red on this page means "well off the owner's
// own target"; an industry rule of thumb has not earned that verdict.
//
// ── THE COMPARE BAND IS OPTIONAL, AND USUALLY ABSENT ─────────────────────────
// Several of these (commission points, factor rates, ISO survival) have nothing
// on this page to compare against, and two more (renewal rate, cost per funded
// deal) would need a query this page deliberately does not run. Those carry
// `compare: null` and render as a plain reference line with "(no live number
// here yet)" — a stated absence, never a fabricated comparison.

export type BenchmarkUnit = "%" | "usd" | "deals";

export interface BenchmarkBand {
  low: number;
  high: number;
  /** "higher" — the band is met by reaching AT LEAST `low`.
   *  "lower"  — the band is met by staying AT OR UNDER `high`. */
  direction: "higher" | "lower";
  unit: BenchmarkUnit;
}

export type BenchmarkId =
  | "avg_advance"
  | "commission_points"
  | "factor_rate"
  | "contact_rate"
  | "app_per_conversation"
  | "app_to_fund_cold"
  | "app_to_fund_warm"
  | "statements_leakage"
  | "renewal_rate"
  | "cost_per_funded_deal"
  | "deals_per_rep_month"
  | "iso_survival";

export interface IndustryBenchmark {
  id: BenchmarkId;
  /** The metric, named the way the owner named it. */
  label: string;
  /** The band VERBATIM. Rendered as text and never re-derived from `compare`,
   *  so the words the owner wrote are the words on the screen. */
  band: string;
  /** One line — the tooltip. What the band means and why it sits there. */
  note: string;
  /** The numeric read. null = context-only: nothing on this page compares to
   *  it, so it renders as a reference line and never colours. */
  compare: BenchmarkBand | null;
}

export const INDUSTRY_BENCHMARKS: Record<BenchmarkId, IndustryBenchmark> = {
  avg_advance: {
    id: "avg_advance",
    label: "Average advance",
    band: "$20K–$50K · $30–40K typical ISO average",
    note: "What a small merchant actually takes. Well under $20K usually means the book is too small to carry the acquisition cost; well over $50K means a different funder tier entirely.",
    compare: { low: 20000, high: 50000, direction: "higher", unit: "usd" },
  },
  commission_points: {
    id: "commission_points",
    label: "Broker commission",
    band: "8–12 points · 10 standard",
    note: "Points paid by the funder, plus upsell points on some deals. First-position advances pay less than 2nd/3rd position — the riskier the paper, the fatter the points.",
    compare: null,
  },
  factor_rate: {
    id: "factor_rate",
    label: "Factor rates & terms",
    band: "1.2–1.45 factor · 3–12 month terms",
    note: "The multiplier on the advance and how long the merchant pays it back. Context for what a merchant is being offered — nothing on this page measures it.",
    compare: null,
  },
  contact_rate: {
    id: "contact_rate",
    label: "Cold-dial contact rate",
    band: "3–5% of dials",
    note: "Share of cold dials that reach a live decision-maker. Below 3% is a list or a caller-ID problem far more often than a script problem.",
    compare: { low: 3, high: 5, direction: "higher", unit: "%" },
  },
  app_per_conversation: {
    id: "app_per_conversation",
    label: "Application rate per conversation",
    band: "2–4% of conversations",
    note: "Share of real conversations that produce an application. This is the rung a script actually moves.",
    compare: { low: 2, high: 4, direction: "higher", unit: "%" },
  },
  app_to_fund_cold: {
    id: "app_to_fund_cold",
    label: "Application → funded (cold)",
    band: "8–15% of applications",
    note: "Cold-originated applications that reach funding. Most of the loss between the two is documents, not underwriting.",
    compare: { low: 8, high: 15, direction: "higher", unit: "%" },
  },
  app_to_fund_warm: {
    id: "app_to_fund_warm",
    label: "Application → funded (warm / inbound)",
    band: "20–30% of applications",
    note: "A warm transfer or inbound lead should convert at roughly twice a cold dial. A warm source converting like a cold one is the finding.",
    compare: { low: 20, high: 30, direction: "higher", unit: "%" },
  },
  statements_leakage: {
    id: "statements_leakage",
    label: "Where applications die",
    band: "40–60% of all leakage is at STATEMENTS",
    note: "Most applications die because the merchant never sends bank statements — not because a funder declined. This is the industry's #1 leak and it is this shop's documented #1 leak too.",
    compare: null,
  },
  renewal_rate: {
    id: "renewal_rate",
    label: "Renewal rate",
    band: "30–50% of funded merchants renew",
    note: "Renewal commissions are where most ISO profit actually comes from — the first advance often only pays for the acquisition.",
    compare: { low: 30, high: 50, direction: "higher", unit: "%" },
  },
  cost_per_funded_deal: {
    id: "cost_per_funded_deal",
    label: "Cost per funded deal",
    band: "$500–$1,500 blended · under $500 excellent",
    note: "Blended acquisition cost per funded advance for an outbound shop. Above $1,500 against a ~$4,000 commission is the number that kills new ISOs.",
    compare: { low: 500, high: 1500, direction: "lower", unit: "usd" },
  },
  deals_per_rep_month: {
    id: "deals_per_rep_month",
    label: "Deals per rep",
    band: "4–8 funded/month decent · 10+ strong",
    note: "What one competent closer funds in a month. A rep well under 4 is either short of leads or short of skill — the funnel above says which.",
    compare: { low: 4, high: 8, direction: "higher", unit: "deals" },
  },
  iso_survival: {
    id: "iso_survival",
    label: "New-ISO survival",
    band: "Most new ISOs fail inside 12 months",
    note: "Almost always from cash burn on leads and reps before the renewal book is built. The reason cost-per-funded-deal and renewal rate matter more than dial volume.",
    compare: null,
  },
};

/** The owner's NINE benchmarks, in the order they were given. Item 4 (the
 *  funnel) carries four bands, which is why the flat id list above is longer
 *  than nine — the grouping is what a reader is shown. */
export interface IndustryBenchmarkGroup {
  n: number;
  title: string;
  members: BenchmarkId[];
}

export const INDUSTRY_BENCHMARK_GROUPS: IndustryBenchmarkGroup[] = [
  { n: 1, title: "Average advance", members: ["avg_advance"] },
  { n: 2, title: "Broker commission", members: ["commission_points"] },
  { n: 3, title: "Factor rates & terms", members: ["factor_rate"] },
  { n: 4, title: "Funnel conversion", members: ["contact_rate", "app_per_conversation", "app_to_fund_cold", "app_to_fund_warm"] },
  { n: 5, title: "Decline / leakage", members: ["statements_leakage"] },
  { n: 6, title: "Renewals", members: ["renewal_rate"] },
  { n: 7, title: "Cost per funded deal", members: ["cost_per_funded_deal"] },
  { n: 8, title: "Rep economics", members: ["deals_per_rep_month"] },
  { n: 9, title: "Survival", members: ["iso_survival"] },
];

/** Green when the shop meets or beats the band, amber when it is below, GREY
 *  when there is no comparable number. Never red — see the header. */
export type BenchmarkRag = "green" | "amber" | "none";

export function benchmarkRag(value: number | null | undefined, bm: IndustryBenchmark): BenchmarkRag {
  if (!bm.compare) return "none";
  if (value === null || value === undefined || !Number.isFinite(value)) return "none";
  return bm.compare.direction === "lower"
    ? value <= bm.compare.high ? "green" : "amber"
    : value >= bm.compare.low ? "green" : "amber";
}

/** A shop-side value rendered in the benchmark's own unit. */
export function formatBenchmarkValue(value: number | null | undefined, bm: IndustryBenchmark): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const unit = bm.compare?.unit ?? "%";
  if (unit === "usd") {
    return value >= 1000
      ? `$${Math.round(value / 1000).toLocaleString()}K`
      : `$${Math.round(value).toLocaleString()}`;
  }
  if (unit === "deals") return value.toFixed(1);
  return `${value.toFixed(value < 10 ? 2 : 1)}%`;
}

/** The verdict word, so the chip's colour is never the only thing carrying it. */
export function benchmarkVerdict(rag: BenchmarkRag, bm: IndustryBenchmark): string {
  if (rag === "none") return "no comparable number here yet";
  if (rag === "green") return bm.compare?.direction === "lower" ? "at or under the industry band" : "at or above the industry band";
  return bm.compare?.direction === "lower" ? "above the industry band" : "below the industry band";
}
