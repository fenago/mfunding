import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RectangleStackIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ArrowTopRightOnSquareIcon,
  ExclamationTriangleIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  ClipboardDocumentIcon,
  StarIcon,
  FunnelIcon,
  AcademicCapIcon,
  ArrowsPointingInIcon,
} from "@heroicons/react/24/outline";
import { Link } from "react-router-dom";
import supabase from "@/supabase";

// ── Product columns ───────────────────────────────────────────────────────────
// A product "checks" if any of its underlying lender_types is on the record.
// MCA folds in revenue_based + working_capital (all future-receivables advances,
// never "loans"); the rest map 1:1.
type Product = { id: string; label: string; types: string[] };
const PRODUCTS: Product[] = [
  { id: "mca", label: "MCA", types: ["mca", "revenue_based", "working_capital"] },
  { id: "term_loan", label: "Term", types: ["term_loan"] },
  { id: "sba", label: "SBA", types: ["sba"] },
  { id: "line_of_credit", label: "LOC", types: ["line_of_credit"] },
  { id: "equipment", label: "Equip", types: ["equipment"] },
  { id: "invoice_factoring", label: "Factoring", types: ["invoice_factoring"] },
  { id: "startup", label: "Startup", types: ["startup"] },
];

// Loan/traditional products used by the analysis buckets. MCA is deliberately
// excluded here — the analysis answers "who can do a real loan today".
const LOAN_TERM_TYPES = ["sba", "term_loan"];
const PROSPECT_TYPES = ["sba", "term_loan", "line_of_credit", "equipment", "invoice_factoring"];

// ── Status bands (render + collapse order) ────────────────────────────────────
type Band = {
  id: string;
  statuses: string[];
  label: string;
  sub: string;
  defaultOpen: boolean;
  accent: string; // dot color
};
const BANDS: Band[] = [
  { id: "live", statuses: ["live_vendor"], label: "Live Vendors", sub: "Submit to these today", defaultOpen: true, accent: "bg-mint-green" },
  { id: "referral", statuses: ["affiliate_referral"], label: "Affiliate / Referral", sub: "Refer the merchant — they close it, we earn a referral commission", defaultOpen: true, accent: "bg-emerald-400" },
  { id: "submitted", statuses: ["application_submitted"], label: "Application Submitted", sub: "Approve our ISO application to unlock — one approval away", defaultOpen: true, accent: "bg-amber-400" },
  { id: "potential", statuses: ["potential"], label: "Potential", sub: "Prospects worth applying to", defaultOpen: true, accent: "bg-ocean-blue" },
  { id: "inactive", statuses: ["inactive", "rejected"], label: "Inactive / Rejected", sub: "Out of rotation — kept for reference", defaultOpen: false, accent: "bg-gray-400" },
];

// ── Categorization payload (lenders.category jsonb) ───────────────────────────
// Written by the lender-categorization pass. Every field is optional on purpose:
// older rows have no category at all, and the page must still render.
type PaperTier = "A" | "B" | "C" | "D" | "all_credit";
type LenderCategory = {
  relationship?: string | null;
  products?: string[] | null;
  size_tier?: string | null;
  paper?: PaperTier[] | null;
  // `type` is a string on most rows but an array where a funder does both
  // structures (e.g. Funderial) — always read it through consoTypes().
  consolidation?: { type?: string | string[] | null; confidence?: string | null; note?: string | null } | null;
  flags?: {
    sba?: boolean;
    real_estate?: boolean;
    micro?: boolean;
    first_position_only?: boolean;
    high_risk_dpaper?: boolean;
    fast_funding?: boolean;
    consolidation?: boolean;
    equipment?: boolean;
    factoring?: boolean;
  } | null;
  known_for?: string | null;
  deal_fit?: string | null;
  confidence?: string | null;
};

type Lender = {
  id: string;
  company_name: string;
  status: string;
  lender_types: string[] | null;
  min_funding_amount: number | null;
  max_funding_amount: number | null;
  min_monthly_revenue: number | null;
  min_time_in_business: number | null;
  min_credit_score: number | null;
  website: string | null;
  notes: string | null;
  category?: LenderCategory | null;
};

const cat = (l: Lender): LenderCategory => l.category ?? {};
const flags = (l: Lender) => cat(l).flags ?? {};
const paperOf = (l: Lender): PaperTier[] => cat(l).paper ?? [];

// The consolidation "type" is one string on most rows and an array where a funder
// does both structures. Normalize to a lowercase list once, so the call-out and
// the filters agree on what "reverse" vs "true payoff" means.
const consoTypes = (l: Lender): string[] => {
  const t = cat(l).consolidation?.type;
  const raw = Array.isArray(t) ? t : t == null ? [] : [t];
  return raw.map((x) => String(x).toLowerCase().trim()).filter((x) => x !== "" && x !== "none");
};
const isConsolidation = (l: Lender) => flags(l).consolidation === true || consoTypes(l).length > 0;
const isReverseConso = (l: Lender) => consoTypes(l).some((t) => /reverse|both/.test(t));
const isTruePayoffConso = (l: Lender) => consoTypes(l).some((t) => /payoff|true|both/.test(t));
// Debt-relief restructure is NOT a consolidation advance — it gets its own lane.
const isRestructure = (l: Lender) => consoTypes(l).some((t) => /restructure|relief|settle/.test(t));

const consoLabel = (l: Lender) => {
  if (isRestructure(l)) return "Debt-relief restructure";
  const rev = isReverseConso(l);
  const payoff = isTruePayoffConso(l);
  if (rev && payoff) return "Reverse + true payoff";
  if (rev) return "Reverse consolidation";
  if (payoff) return "True payoff";
  return "Consolidation";
};

// ── Derivations ───────────────────────────────────────────────────────────────
const hasType = (l: Lender, types: string[]) =>
  (l.lender_types ?? []).some((t) => types.includes(t));

const doesProduct = (l: Lender, p: Product) => hasType(l, p.types);

// Red-flag phrases the owner wants surfaced inline, never buried.
const WARN_RX = /not a funder|deactivated|hard no/i;
const isWarn = (l: Lender) => !!l.notes && WARN_RX.test(l.notes);

// Referral/marketplace models fund nothing directly — they route the merchant on.
const REFERRAL_RX = /referral|marketplace|portal|aggregator|network of/i;
const isReferralModel = (l: Lender) =>
  l.status === "affiliate_referral" || (!!l.notes && REFERRAL_RX.test(l.notes));

const fmtMoney = (n: number | null) =>
  n == null ? null : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n}`;

const sizeRange = (l: Lender): string => {
  const lo = fmtMoney(l.min_funding_amount);
  const hi = fmtMoney(l.max_funding_amount);
  if (lo && hi) return `${lo}–${hi}`;
  if (hi) return `up to ${hi}`;
  if (lo) return `${lo}+`;
  return "—";
};

// The onboarding-gap line for the analysis buckets: what stands between us and
// placing a deal with this funder right now.
const gapLine = (l: Lender): string => {
  if (isReferralModel(l)) return "Referral / marketplace model — you refer, they close (referral commission)";
  switch (l.status) {
    case "live_vendor":
      return "Live — submit directly today";
    case "affiliate_referral":
      return "Referral partner — send the merchant, earn a referral commission";
    case "application_submitted":
      return "ISO application pending — approve to unlock direct submission";
    case "potential":
      return "Not yet applied — worth opening an ISO application";
    default:
      return "Out of rotation";
  }
};

// ── Status chips (used by matcher + offerings) ────────────────────────────────
const STATUS_META: Record<string, { label: string; chip: string }> = {
  live_vendor: { label: "Live", chip: "bg-mint-green/15 text-mint-green" },
  affiliate_referral: { label: "Referral", chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  application_submitted: { label: "Pending ISO approval", chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  potential: { label: "Prospect", chip: "bg-ocean-blue/15 text-ocean-blue" },
  inactive: { label: "Inactive", chip: "bg-gray-400/15 text-gray-500 dark:text-gray-400" },
  rejected: { label: "Rejected", chip: "bg-red-500/15 text-red-500" },
};
const STATUS_ORDER = ["live_vendor", "affiliate_referral", "application_submitted", "potential", "inactive", "rejected"];
const statusRank = (s: string) => {
  const i = STATUS_ORDER.indexOf(s);
  return i === -1 ? STATUS_ORDER.length : i;
};

function StatusChip({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, chip: "bg-gray-400/15 text-gray-500" };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${m.chip}`}>
      {m.label}
    </span>
  );
}

// ── Micro-MCA membership (data-driven) ────────────────────────────────────────
// A merchant-facing "small deal / low-revenue" fit: an MCA-family funder whose
// recorded box reaches down to small merchants — floor ≤ $15K/mo, OR min deal
// ≤ $10K, OR max deal ≤ $50K, OR notes explicitly flag micro/gig/freelancer.
const MCA_FAMILY = ["mca", "revenue_based", "working_capital"];
const MICRO_NOTE_RX = /\bmicro\b|\bgig\b|freelanc|sole prop/i;
const isMicroMca = (l: Lender) =>
  hasType(l, MCA_FAMILY) &&
  ((l.min_monthly_revenue != null && l.min_monthly_revenue <= 15000) ||
    (l.min_funding_amount != null && l.min_funding_amount <= 10000) ||
    (l.max_funding_amount != null && l.max_funding_amount <= 50000) ||
    (!!l.notes && MICRO_NOTE_RX.test(l.notes)));

// Curated house picks for the micro segment — the owner's intended go-tos. Both
// are pending ISO approval right now; their live status is read from the DB row.
const MICRO_HOUSE_PICKS = ["Bitty Advance", "Greenbox Capital"];

// ── Paper-tier + bucket filters ───────────────────────────────────────────────
// "all_credit" means the funder doesn't screen on grade, so it satisfies every
// tier rather than none.
const PAPER_TIERS: PaperTier[] = ["A", "B", "C", "D"];
const doesPaper = (l: Lender, tier: PaperTier) => {
  const p = paperOf(l);
  return p.includes(tier) || p.includes("all_credit");
};

const relOf = (l: Lender) => (cat(l).relationship ?? "").toLowerCase();
const catProducts = (l: Lender) => (cat(l).products ?? []).map((p) => p.toLowerCase());
const hasCatProduct = (l: Lender, rx: RegExp) => catProducts(l).some((p) => rx.test(p));

type Bucket = { id: string; label: string; test: (l: Lender) => boolean };
const BUCKETS: Bucket[] = [
  { id: "mca", label: "MCA", test: (l) => hasType(l, MCA_FAMILY) || hasCatProduct(l, /mca|advance|revenue/) },
  { id: "sba", label: "SBA", test: (l) => flags(l).sba === true || hasType(l, ["sba"]) },
  {
    id: "real_estate",
    label: "Real estate",
    test: (l) => flags(l).real_estate === true || hasCatProduct(l, /real.?estate|\bcre\b|bridge/),
  },
  {
    id: "equipment",
    label: "Equipment",
    test: (l) => flags(l).equipment === true || hasType(l, ["equipment"]) || hasCatProduct(l, /equipment/),
  },
  {
    id: "micro",
    label: "Micro",
    test: (l) => flags(l).micro === true || (cat(l).size_tier ?? "").toLowerCase() === "micro" || isMicroMca(l),
  },
  {
    id: "referral",
    label: "Referral",
    test: (l) => /referral|affiliate/.test(relOf(l)) || l.status === "affiliate_referral",
  },
  { id: "marketplace", label: "Marketplace", test: (l) => /marketplace|aggregator/.test(relOf(l)) },
  {
    id: "direct",
    label: "Direct funder",
    // Anyone who puts up the capital themselves — direct funders plus factoring
    // companies, equipment lessors and white-label programs. Excludes the
    // marketplaces and referral partners (they route the merchant on) and
    // software vendors (not funders at all). Degrades for uncategorized rows.
    test: (l) => {
      const r = relOf(l);
      if (!r) return l.status !== "affiliate_referral" && !isReferralModel(l);
      return !/marketplace|aggregator|referral|affiliate|software|vendor/.test(r);
    },
  },
];

type ConsoFilter = "any" | "consolidation" | "reverse" | "true_payoff";
const CONSO_FILTERS: { id: ConsoFilter; label: string }[] = [
  { id: "any", label: "All" },
  { id: "consolidation", label: "Consolidation only" },
  { id: "reverse", label: "Reverse only" },
  { id: "true_payoff", label: "True-payoff only" },
];

// ── Referral-channel curated links ────────────────────────────────────────────
// The specific broker/referral portals the owner works — buried in freeform
// notes, so pinned here. Each renders only if a matching live DB row exists, and
// shows that row's real status. Links are copyable.
type RefLink = { label: string; url: string };
type RefPartner = { match: string; blurb: string; links: RefLink[]; contact?: string };
const REFERRAL_PARTNERS: RefPartner[] = [
  {
    match: "ROK Financial",
    blurb:
      "Full suite via marketplace + direct — term, LOC, SBA, equipment, AR/PO, CRE. We refer; ROK runs the application and funds. 20% of ROK upfront revenue.",
    links: [{ label: "Affiliate program", url: "https://rok.biz" }],
    contact: "Tony Cimino · tonyc@rok.biz · (833) 376-5249",
  },
  {
    match: "1 West",
    blurb:
      "50+ lender marketplace (working capital, SBA, CRE, AR, LOC, equipment). Referral partner — we refer, they fund. 50% of 1WEST compensation.",
    links: [
      { label: "Merchant self-serve application", url: "https://apply.1west.com/?iso=a10PZ00000socCfYAI" },
      { label: "Broker submissions", url: "mailto:partnersubs@1west.com" },
    ],
    contact: "Michael Bernier (BD) · mike@1westfinance.com · Ria Khan (submissions) · (956) 818-8335",
  },
  {
    match: "Uplyft",
    blurb: "Micro-to-$5M advances, credit as low as 475. ISO broker intake runs through DaydreamOS.",
    links: [
      {
        label: "Broker portal",
        url: "https://www.daydreamos.com/broker/0787079a-61f4-42c4-a060-eca3bc4595a8-6f1e6c6d-7331-4bc6-a2d2-b904ac1a951f",
      },
      { label: "Broker sign-up", url: "https://daydreamos.com/broker-intake/uplyft-capital" },
    ],
    contact: "Jeff Soulouque (ISO Mgr) · (954) 834-6321 · cell (305) 776-0409",
  },
  {
    match: "Guidant Financial",
    blurb:
      "Startup capital via ROBS (401k/IRA rollover) plus SBA — our startup-funding referral path. We refer through the partner center.",
    links: [{ label: "Partner center", url: "https://app.guidantfinancial.com/partner/center" }],
    contact: "Ashley Teegarden (Account Mgr) · (888) 472-4455",
  },
];

const LENDER_COLS =
  "id, company_name, status, lender_types, min_funding_amount, max_funding_amount, min_monthly_revenue, min_time_in_business, min_credit_score, website, notes";

export default function LenderCatalogPage() {
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryMissing, setCategoryMissing] = useState(false);
  const [productFilter, setProductFilter] = useState<string | null>(null); // null = All
  const [paperFilter, setPaperFilter] = useState<PaperTier | null>(null); // null = All
  const [consoFilter, setConsoFilter] = useState<ConsoFilter>("any");
  const [bucketFilter, setBucketFilter] = useState<string | null>(null); // null = All
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [openBands, setOpenBands] = useState<Set<string>>(
    () => new Set(BANDS.filter((b) => b.defaultOpen).map((b) => b.id)),
  );

  const fetchLenders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("lenders")
        .select(`${LENDER_COLS}, category`)
        .order("company_name");
      if (err) {
        // The category column ships with the categorization migration. Until it
        // lands, fall back to the base columns so the catalog still renders —
        // but say so loudly instead of silently showing empty paper tiers.
        if (err.code === "42703" || /column .*category/i.test(err.message ?? "")) {
          const fb = await supabase.from("lenders").select(LENDER_COLS).order("company_name");
          if (fb.error) throw fb.error;
          setLenders((fb.data ?? []) as Lender[]);
          setCategoryMissing(true);
          return;
        }
        throw err;
      }
      setCategoryMissing(false);
      setLenders((data ?? []) as Lender[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load lenders");
      setLenders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLenders();
  }, [fetchLenders]);

  // Refetch on focus so status/type edits made elsewhere show up without a reload.
  useEffect(() => {
    const onFocus = () => fetchLenders();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchLenders]);

  const activeProduct = PRODUCTS.find((p) => p.id === productFilter) ?? null;
  const activeBucket = BUCKETS.find((b) => b.id === bucketFilter) ?? null;

  // All four filters AND together and narrow both the table and the analysis.
  const matchesFilter = useCallback(
    (l: Lender) => {
      if (activeProduct && !doesProduct(l, activeProduct)) return false;
      if (paperFilter && !doesPaper(l, paperFilter)) return false;
      if (activeBucket && !activeBucket.test(l)) return false;
      if (consoFilter === "consolidation" && !isConsolidation(l)) return false;
      if (consoFilter === "reverse" && !isReverseConso(l)) return false;
      if (consoFilter === "true_payoff" && !isTruePayoffConso(l)) return false;
      return true;
    },
    [activeProduct, paperFilter, activeBucket, consoFilter],
  );

  const activeFilterCount =
    (activeProduct ? 1 : 0) + (paperFilter ? 1 : 0) + (activeBucket ? 1 : 0) + (consoFilter !== "any" ? 1 : 0);

  const clearFilters = () => {
    setProductFilter(null);
    setPaperFilter(null);
    setBucketFilter(null);
    setConsoFilter("any");
  };

  // ── Consolidation shortlist — the stacked-book lifeline, always unfiltered ───
  const consolidation = useMemo(() => {
    const all = lenders
      .filter(isConsolidation)
      .sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.company_name.localeCompare(b.company_name));
    return {
      funders: all.filter((l) => !isRestructure(l)),
      restructure: all.filter(isRestructure),
    };
  }, [lenders]);

  // ── Counts strip (always over the full set, not the product filter) ─────────
  const counts = useMemo(() => {
    const c = { live: 0, referral: 0, pending: 0, prospects: 0 };
    for (const l of lenders) {
      if (l.status === "live_vendor") c.live++;
      else if (l.status === "affiliate_referral") c.referral++;
      else if (l.status === "application_submitted") c.pending++;
      else if (l.status === "potential") c.prospects++;
    }
    return c;
  }, [lenders]);

  // ── Analysis buckets (computed live, honor product filter) ──────────────────
  const analysis = useMemo(() => {
    const inFilter = lenders.filter(matchesFilter);
    // "Who can take an SBA or traditional term loan TODAY"
    const today = inFilter
      .filter((l) => ["live_vendor", "affiliate_referral"].includes(l.status) && hasType(l, LOAN_TERM_TYPES))
      .sort((a, b) => a.company_name.localeCompare(b.company_name));
    // "One approval away"
    const oneAway = inFilter
      .filter((l) => l.status === "application_submitted" && hasType(l, ["term_loan", "sba", "line_of_credit"]))
      .sort((a, b) => a.company_name.localeCompare(b.company_name));
    // "Prospects worth applying to"
    const prospects = inFilter
      .filter((l) => l.status === "potential" && hasType(l, PROSPECT_TYPES))
      .sort((a, b) => a.company_name.localeCompare(b.company_name));
    return { today, oneAway, prospects };
  }, [lenders, matchesFilter]);

  // ── Grouped table rows ──────────────────────────────────────────────────────
  const banded = useMemo(
    () =>
      BANDS.map((band) => ({
        band,
        rows: lenders
          .filter((l) => band.statuses.includes(l.status) && matchesFilter(l))
          .sort((a, b) => a.company_name.localeCompare(b.company_name)),
      })),
    [lenders, matchesFilter],
  );

  const toggleRow = (id: string) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleBand = (id: string) =>
    setOpenBands((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <RectangleStackIcon className="w-8 h-8 text-mint-green flex-shrink-0" />
        <div className="flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Lender Product Catalog</h1>
              <p className="text-gray-600 dark:text-gray-300 mt-1">
                Every lender in the network, grouped by how ready they are to fund — which products
                each one does, their size range, and their revenue / time-in-business / credit floors.
                Live and always current with the lender records. Read-only.
              </p>
            </div>
            <button
              onClick={fetchLenders}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-ocean-blue text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60 flex-shrink-0"
            >
              <ArrowPathIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {categoryMissing && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0" />
          <span>
            <b>Lender categorization not deployed yet.</b> The <code>lenders.category</code> column is
            missing, so paper tiers, the consolidation shortlist, and the paper / consolidation /
            bucket filters will come up empty. Everything else on this page is live.
          </span>
        </div>
      )}

      {/* ── Education: how to match a deal to a funder ── */}
      <PaperEducation />
      <ConsolidationEducation />

      {/* ── Consolidation shortlist ── */}
      {!loading && !error && <ConsolidationCallout groups={consolidation} />}

      {/* Counts strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: "Live vendors", value: counts.live, dot: "bg-mint-green" },
          { label: "Referral partners", value: counts.referral, dot: "bg-emerald-400" },
          { label: "Applications pending", value: counts.pending, dot: "bg-amber-400" },
          { label: "Prospects", value: counts.prospects, dot: "bg-ocean-blue" },
        ].map((s) => (
          <div key={s.label} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${s.dot}`} />
              <span className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{s.value}</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 mb-5 space-y-2.5">
        <div className="flex items-center gap-2">
          <FunnelIcon className="w-4 h-4 text-ocean-blue" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Filters</h2>
          <span
            className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
              activeFilterCount
                ? "bg-ocean-blue/15 text-ocean-blue"
                : "bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500"
            }`}
          >
            {activeFilterCount} active
          </span>
          {activeFilterCount > 0 && (
            <button
              onClick={clearFilters}
              className="ml-auto text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 underline"
            >
              Clear all
            </button>
          )}
        </div>

        <FilterRow label="Product">
          <FilterChip active={productFilter === null} onClick={() => setProductFilter(null)}>
            All
          </FilterChip>
          {PRODUCTS.map((p) => (
            <FilterChip
              key={p.id}
              active={productFilter === p.id}
              onClick={() => setProductFilter(productFilter === p.id ? null : p.id)}
            >
              {p.label}
            </FilterChip>
          ))}
        </FilterRow>

        <FilterRow label="Paper tier">
          <FilterChip active={paperFilter === null} onClick={() => setPaperFilter(null)}>
            All
          </FilterChip>
          {PAPER_TIERS.map((t) => (
            <FilterChip
              key={t}
              active={paperFilter === t}
              onClick={() => setPaperFilter(paperFilter === t ? null : t)}
            >
              {t} paper
            </FilterChip>
          ))}
        </FilterRow>

        <FilterRow label="Consolidation">
          {CONSO_FILTERS.map((c) => (
            <FilterChip key={c.id} active={consoFilter === c.id} onClick={() => setConsoFilter(c.id)}>
              {c.label}
            </FilterChip>
          ))}
        </FilterRow>

        <FilterRow label="Bucket">
          <FilterChip active={bucketFilter === null} onClick={() => setBucketFilter(null)}>
            All
          </FilterChip>
          {BUCKETS.map((b) => (
            <FilterChip
              key={b.id}
              active={bucketFilter === b.id}
              onClick={() => setBucketFilter(bucketFilter === b.id ? null : b.id)}
            >
              {b.label}
            </FilterChip>
          ))}
        </FilterRow>
      </div>

      {error ? (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-6 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : loading ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-10 text-center text-gray-500 dark:text-gray-400">
          Loading catalog…
        </div>
      ) : (
        <>
          {/* ── Analysis section ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
            <AnalysisCard
              title={activeProduct ? `${activeProduct.label}-capable today` : "SBA or term loan TODAY"}
              subtitle="Live + referral funders that can place a real loan right now"
              tone="mint"
              items={analysis.today}
            />
            <AnalysisCard
              title="One approval away"
              subtitle="Applications submitted — approve to unlock term / SBA / LOC"
              tone="amber"
              items={analysis.oneAway}
            />
            <AnalysisCard
              title="Prospects worth applying to"
              subtitle="Not yet applied — SBA / term / LOC / equipment / factoring"
              tone="blue"
              items={analysis.prospects}
            />
          </div>

          {/* ── Lender matcher ── */}
          <LenderMatcher lenders={lenders} />

          {/* ── The big table, grouped by band ── */}
          <div className="space-y-4">
            {banded.map(({ band, rows }) => {
              const open = openBands.has(band.id);
              return (
                <div
                  key={band.id}
                  className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
                >
                  <button
                    onClick={() => toggleBand(band.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40"
                  >
                    {open ? (
                      <ChevronDownIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    ) : (
                      <ChevronRightIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    )}
                    <span className={`w-2.5 h-2.5 rounded-full ${band.accent} flex-shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold text-gray-900 dark:text-white">{band.label}</span>
                      <span className="text-gray-500 dark:text-gray-400 text-sm ml-2">{band.sub}</span>
                    </div>
                    <span className="text-sm font-medium text-gray-400 tabular-nums flex-shrink-0">{rows.length}</span>
                  </button>

                  {open &&
                    (rows.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700/50">
                        {activeFilterCount ? "No lenders in this band match the current filters." : "No lenders in this band."}
                      </div>
                    ) : (
                      <div className="overflow-x-auto border-t border-gray-100 dark:border-gray-700/50">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                              <th className="py-2.5 px-4 font-semibold min-w-[220px]">Lender</th>
                              {PRODUCTS.map((p) => (
                                <th key={p.id} title={p.label} className="py-2.5 px-2 font-semibold text-center whitespace-nowrap">
                                  {p.label}
                                </th>
                              ))}
                              <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Size</th>
                              <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Rev/mo</th>
                              <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">TIB</th>
                              <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">FICO</th>
                              <th className="py-2.5 px-3 font-semibold text-center whitespace-nowrap">Site</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((l) => {
                              const expanded = expandedRows.has(l.id);
                              const warn = isWarn(l);
                              return (
                                <RowFragment
                                  key={l.id}
                                  lender={l}
                                  expanded={expanded}
                                  warn={warn}
                                  onToggle={() => toggleRow(l.id)}
                                />
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ))}
                </div>
              );
            })}
          </div>

          <p className="mt-6 text-xs text-gray-400 dark:text-gray-500">
            Product checkmarks are derived from each lender's type tags (MCA groups advance /
            revenue-based / working-capital — never "loans"). Floors show only where a lender record
            has them filled in; a dash means unspecified, not unlimited.
          </p>

          {/* ── Our offerings — products as a business ── */}
          <OfferingsSection lenders={lenders} analysis={analysis} />
        </>
      )}
    </div>
  );
}

// ── Filter primitives ─────────────────────────────────────────────────────────
function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-[92px] flex-shrink-0">{label}</span>
      {children}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
        active
          ? "bg-ocean-blue text-white border-ocean-blue"
          : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-ocean-blue"
      }`}
    >
      {children}
    </button>
  );
}

// ── Category chips ────────────────────────────────────────────────────────────
const PAPER_CHIP: Record<PaperTier, string> = {
  A: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  B: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  C: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  D: "bg-red-500/15 text-red-600 dark:text-red-400",
  all_credit: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
};

function PaperChips({ lender }: { lender: Lender }) {
  const tiers = paperOf(lender);
  if (tiers.length === 0) return null;
  return (
    <>
      {tiers.map((t) => (
        <span
          key={t}
          title={t === "all_credit" ? "Funds all credit grades" : `${t} paper`}
          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${PAPER_CHIP[t] ?? "bg-gray-400/15 text-gray-500"}`}
        >
          {t === "all_credit" ? "All credit" : t}
        </span>
      ))}
    </>
  );
}

function ConsoBadge({ lender }: { lender: Lender }) {
  if (!isConsolidation(lender)) return null;
  const restructure = isRestructure(lender);
  return (
    <span
      title={cat(lender).consolidation?.note ?? undefined}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${
        restructure
          ? "bg-purple-500/15 text-purple-600 dark:text-purple-400"
          : "bg-mint-green/15 text-mint-green"
      }`}
    >
      <ArrowsPointingInIcon className="w-3 h-3" /> {consoLabel(lender)}
    </span>
  );
}

// ── Education: paper tiers ────────────────────────────────────────────────────
// Collapsible but open by default — this is the matching guide, not reference
// material you go looking for.
function Explainer({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden mb-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40"
      >
        {open ? (
          <ChevronDownIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRightIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
        )}
        {icon}
        <span className="font-semibold text-gray-900 dark:text-white">{title}</span>
      </button>
      {open && <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700/50 pt-3">{children}</div>}
    </div>
  );
}

type PaperRow = { tier: string; chip: string; profile: string; pricing: string; who: string };
const PAPER_ROWS: PaperRow[] = [
  {
    tier: "A paper",
    chip: PAPER_CHIP.A,
    profile:
      "Strong: ~680+ FICO, 2+ yrs in business, healthy consistent revenue, no existing MCAs, clean statements (no NSFs, good balances)",
    pricing: "Low factor (~1.10–1.25), longer terms (12–18mo), often weekly/monthly",
    who: "Bank-like / prime funders (Kapitus, BriteCap, IOU, Vox, Nationwide)",
  },
  {
    tier: "B paper",
    chip: PAPER_CHIP.B,
    profile: "Good-not-perfect: ~600–680 FICO, decent revenue, 0–1 existing position, minor blemishes",
    pricing: "Factor ~1.25–1.35, terms ~6–12mo",
    who: "Most mainstream MCA funders",
  },
  {
    tier: "C paper",
    chip: PAPER_CHIP.C,
    profile: "Subprime: ~500–600 FICO, shorter history, some NSFs/negative days, 1–2 stacked positions",
    pricing: "Factor ~1.35–1.45, terms ~3–6mo, daily payments",
    who: "High-risk MCA shops",
  },
  {
    tier: "D paper",
    chip: PAPER_CHIP.D,
    profile:
      "Bottom tier: <500 FICO, heavily stacked (multiple positions), frequent NSFs/negative days, distressed",
    pricing: "Factor ~1.45–1.49+, short terms (2–4mo), daily debits, smaller amounts",
    who: "Last-resort funders who'll stack onto already-stacked merchants",
  },
];

function PaperEducation() {
  return (
    <Explainer icon={<AcademicCapIcon className="w-5 h-5 text-mint-green" />} title="What A / B / C / D paper means">
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-3 max-w-4xl leading-relaxed">
        <b>Paper</b> = the credit quality / risk grade of the merchant, which determines who'll fund
        them, at what cost, and on what terms. The single most important thing for matching a deal to
        the right funder.
      </p>

      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left bg-gray-50 dark:bg-gray-900/40 text-gray-500 dark:text-gray-400">
              <th className="py-2.5 px-3 font-semibold whitespace-nowrap">Tier</th>
              <th className="py-2.5 px-3 font-semibold min-w-[260px]">Merchant profile</th>
              <th className="py-2.5 px-3 font-semibold min-w-[220px]">Pricing &amp; terms</th>
              <th className="py-2.5 px-3 font-semibold min-w-[220px]">Who funds it</th>
            </tr>
          </thead>
          <tbody>
            {PAPER_ROWS.map((r) => (
              <tr key={r.tier} className="border-t border-gray-100 dark:border-gray-700/50 align-top">
                <td className="py-2.5 px-3">
                  <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-bold whitespace-nowrap ${r.chip}`}>
                    {r.tier}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-gray-700 dark:text-gray-200 leading-snug">{r.profile}</td>
                <td className="py-2.5 px-3 text-gray-700 dark:text-gray-200 leading-snug">{r.pricing}</td>
                <td className="py-2.5 px-3 text-gray-700 dark:text-gray-200 leading-snug">{r.who}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 rounded-xl border-l-4 border-amber-400 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300 mb-1">
          Rule of thumb
        </p>
        <p className="text-sm text-amber-900 dark:text-amber-100 leading-relaxed max-w-4xl">
          The further toward D, the worse the credit, the higher the cost, the shorter the term — but
          the more willing the funder is to touch a stacked or blemished merchant. Sending an{" "}
          <b>A-paper merchant to a D-paper funder overprices them</b> (you lose the deal); sending a{" "}
          <b>D-paper merchant to an A-paper funder gets an instant decline</b>.
        </p>
      </div>
    </Explainer>
  );
}

function ConsolidationEducation() {
  return (
    <Explainer
      icon={<ArrowsPointingInIcon className="w-5 h-5 text-mint-green" />}
      title="Consolidation / Reverse-consolidation"
    >
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-3 max-w-4xl leading-relaxed">
        A distinct product — the lifeline for over-stacked merchants. A consolidation /
        reverse-consolidation funder either pays off the merchant's multiple MCAs or advances against
        them to replace several daily debits with one lower payment.{" "}
        <span className="text-gray-500 dark:text-gray-400">
          (We saw this live with Bay Finish — stacked on CFG + SBFS, couldn't afford a new advance;
          needed a consolidation.)
        </span>
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
          <h4 className="font-semibold text-gray-900 dark:text-white text-sm mb-1">True consolidation / payoff</h4>
          <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
            The funder <b>pays the existing positions off</b> and folds them into one new advance. The
            old MCAs are gone; the merchant is left with a single balance and a single payment.
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
          <h4 className="font-semibold text-gray-900 dark:text-white text-sm mb-1">Reverse consolidation</h4>
          <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
            The funder <b>deposits money to cover the existing payments</b> as they come due — the old
            positions stay in place. The merchant makes one smaller payment to the consolidator over a
            longer term.
          </p>
        </div>
      </div>
    </Explainer>
  );
}

// ── Consolidation shortlist — the stacked-book call-out ───────────────────────
function ConsolidationCallout({ groups }: { groups: { funders: Lender[]; restructure: Lender[] } }) {
  const { funders, restructure } = groups;
  return (
    <div className="rounded-2xl border-2 border-mint-green/50 bg-mint-green/5 dark:bg-mint-green/[0.07] overflow-hidden mb-5">
      <div className="h-1 bg-mint-green" />
      <div className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <ArrowsPointingInIcon className="w-5 h-5 text-mint-green" />
          <h2 className="font-bold text-gray-900 dark:text-white">Consolidation funders — the stacked-book shortlist</h2>
          <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums ml-auto">{funders.length}</span>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Who to call when the merchant is stacked and can't carry another daily debit.
        </p>

        {funders.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 italic">
            No consolidation funders flagged in the network yet — this fills in from each lender's
            categorization.
          </p>
        ) : (
          <ul className="space-y-2">
            {funders.map((l) => (
              <li
                key={l.id}
                className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/admin/lenders/${l.id}`} className="font-semibold text-ocean-blue hover:underline text-sm">
                    {l.company_name}
                  </Link>
                  <ConsoBadge lender={l} />
                  <PaperChips lender={l} />
                  <StatusChip status={l.status} />
                  <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums ml-auto whitespace-nowrap">
                    {sizeRange(l)}
                  </span>
                </div>
                {(cat(l).consolidation?.note || cat(l).deal_fit) && (
                  <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 leading-snug">
                    {cat(l).consolidation?.note || cat(l).deal_fit}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        {restructure.length > 0 && (
          <div className="mt-4 rounded-xl border-l-4 border-purple-400 bg-purple-50 dark:bg-purple-900/20 px-3 py-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-purple-700 dark:text-purple-300 mb-1.5">
              Debt-relief referral — not a consolidation advance
            </p>
            <ul className="space-y-1.5">
              {restructure.map((l) => (
                <li key={l.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/admin/lenders/${l.id}`} className="font-semibold text-ocean-blue hover:underline text-sm">
                      {l.company_name}
                    </Link>
                    <ConsoBadge lender={l} />
                    <StatusChip status={l.status} />
                  </div>
                  <p className="text-xs text-purple-900 dark:text-purple-100 mt-0.5 leading-snug">
                    {cat(l).consolidation?.note ||
                      "Restructures the merchant's existing positions — for distressed / near-default merchants, not a reverse consolidation."}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Copyable link chip ────────────────────────────────────────────────────────
function CopyLink({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40 pl-2 pr-1 py-1 text-xs">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-ocean-blue hover:underline max-w-[220px] truncate"
        title={url}
      >
        {label}
      </a>
      <button
        type="button"
        onClick={copy}
        title="Copy link"
        className="p-0.5 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
      >
        {copied ? (
          <CheckIcon className="w-3.5 h-3.5 text-mint-green" />
        ) : (
          <ClipboardDocumentIcon className="w-3.5 h-3.5" />
        )}
      </button>
    </span>
  );
}

// ── Lender matcher — "who fits this customer?" ────────────────────────────────
// Deterministic filter over recorded criteria; no AI. A lender is a hard match
// only when every dimension the user filled has a concrete lender floor the
// input satisfies. Any dimension the user filled where the lender floor is NULL
// makes it "possibly fits (criteria unknown)" — never a hard match.
function LenderMatcher({ lenders }: { lenders: Lender[] }) {
  const [product, setProduct] = useState<string | null>(null);
  const [revenue, setRevenue] = useState("");
  const [tib, setTib] = useState("");
  const [fico, setFico] = useState("");
  const [amount, setAmount] = useState("");

  const rev = revenue.trim() === "" ? null : Number(revenue) || 0;
  const tibN = tib.trim() === "" ? null : Number(tib) || 0;
  const ficoN = fico.trim() === "" ? null : Number(fico) || 0;
  const amt = amount.trim() === "" ? null : Number(amount) || 0;
  const activeProduct = PRODUCTS.find((p) => p.id === product) ?? null;
  const anyInput = product !== null || rev !== null || tibN !== null || ficoN !== null || amt !== null;

  const result = useMemo(() => {
    if (!anyInput) return { hard: [] as Lender[], soft: [] as Lender[] };
    const hard: Lender[] = [];
    const soft: Lender[] = [];
    for (const l of lenders) {
      if (activeProduct && !doesProduct(l, activeProduct)) continue; // product is a hard gate
      let excluded = false;
      let unknown = false;
      // revenue / tib / fico: input must clear the lender's floor where both exist
      const dims: [number | null, number | null][] = [
        [rev, l.min_monthly_revenue],
        [tibN, l.min_time_in_business],
        [ficoN, l.min_credit_score],
      ];
      for (const [input, floor] of dims) {
        if (input == null) continue; // user didn't ask about this dimension
        if (floor == null) unknown = true; // lender floor unrecorded → can't confirm
        else if (input < floor) excluded = true;
      }
      // amount within the lender's recorded min/max window
      if (amt != null) {
        const hasWindow = l.min_funding_amount != null || l.max_funding_amount != null;
        if (!hasWindow) unknown = true;
        else {
          if (l.min_funding_amount != null && amt < l.min_funding_amount) excluded = true;
          if (l.max_funding_amount != null && amt > l.max_funding_amount) excluded = true;
        }
      }
      if (excluded) continue;
      (unknown ? soft : hard).push(l);
    }
    const sort = (a: Lender, b: Lender) =>
      statusRank(a.status) - statusRank(b.status) || a.company_name.localeCompare(b.company_name);
    return { hard: hard.sort(sort), soft: soft.sort(sort) };
  }, [lenders, activeProduct, rev, tibN, ficoN, amt, anyInput]);

  const reset = () => {
    setProduct(null);
    setRevenue("");
    setTib("");
    setFico("");
    setAmount("");
  };

  const numInput = "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-ocean-blue";

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 mb-8">
      <div className="flex items-center gap-2 mb-3">
        <MagnifyingGlassIcon className="w-5 h-5 text-mint-green" />
        <h2 className="font-semibold text-gray-900 dark:text-white">Lender matcher — who fits this customer?</h2>
        {anyInput && (
          <button onClick={reset} className="ml-auto text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 underline">
            Clear
          </button>
        )}
      </div>

      {/* Product chips */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Product:</span>
        <button
          onClick={() => setProduct(null)}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
            product === null ? "bg-ocean-blue text-white border-ocean-blue" : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-ocean-blue"
          }`}
        >
          Any
        </button>
        {PRODUCTS.map((p) => (
          <button
            key={p.id}
            onClick={() => setProduct(product === p.id ? null : p.id)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
              product === p.id ? "bg-ocean-blue text-white border-ocean-blue" : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-ocean-blue"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Numeric inputs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
          Monthly revenue ($)
          <input type="number" inputMode="numeric" value={revenue} onChange={(e) => setRevenue(e.target.value)} placeholder="e.g. 15000" className={`mt-1 ${numInput}`} />
        </label>
        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
          Time in business (mo)
          <input type="number" inputMode="numeric" value={tib} onChange={(e) => setTib(e.target.value)} placeholder="e.g. 8" className={`mt-1 ${numInput}`} />
        </label>
        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
          FICO
          <input type="number" inputMode="numeric" value={fico} onChange={(e) => setFico(e.target.value)} placeholder="e.g. 560" className={`mt-1 ${numInput}`} />
        </label>
        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
          Amount wanted ($)
          <input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 40000" className={`mt-1 ${numInput}`} />
        </label>
      </div>

      {!anyInput ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 italic">
          Pick a product or enter a number to see which lenders' recorded box fits.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MatchList
            title="Fits the recorded box"
            subtitle="Every filled criterion clears this lender's stated floor"
            emptyText="No lender's recorded criteria fully fit — check the 'possibly fits' list."
            items={result.hard}
          />
          <MatchList
            title="Possibly fits — criteria unknown"
            subtitle="Nothing disqualifies them, but a floor you asked about isn't recorded"
            emptyText="Nothing here."
            items={result.soft}
          />
        </div>
      )}
    </div>
  );
}

function MatchList({
  title,
  subtitle,
  emptyText,
  items,
}: {
  title: string;
  subtitle: string;
  emptyText: string;
  items: Lender[];
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{title}</h3>
        <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">{items.length}</span>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-2">{subtitle}</p>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5 max-h-72 overflow-y-auto">
          {items.map((l) => (
            <li key={l.id} className="flex items-center gap-2 text-xs">
              <Link to={`/admin/lenders/${l.id}`} className="font-semibold text-ocean-blue hover:underline flex-1 min-w-0 truncate">
                {l.company_name}
              </Link>
              <span className="text-gray-400 dark:text-gray-500 tabular-nums whitespace-nowrap">{sizeRange(l)}</span>
              <StatusChip status={l.status} />
              {isWarn(l) && <ExclamationTriangleIcon className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Our offerings — the segment view (products as a business) ─────────────────
function OfferingsSection({
  lenders,
  analysis,
}: {
  lenders: Lender[];
  analysis: { today: Lender[]; oneAway: Lender[]; prospects: Lender[] };
}) {
  const byName = (name: string) => lenders.find((l) => l.company_name.toLowerCase().includes(name.toLowerCase()));

  // Micro-MCA: curated house picks first, then everything the DB derives as micro
  // (house picks removed from the derived list so they aren't shown twice).
  const housePicks = MICRO_HOUSE_PICKS.map(byName).filter((l): l is Lender => !!l);
  const housePickIds = new Set(housePicks.map((l) => l.id));
  const microDerived = lenders
    .filter((l) => isMicroMca(l) && !housePickIds.has(l.id))
    .sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.company_name.localeCompare(b.company_name));

  const standardMcaLive = lenders.filter((l) => l.status === "live_vendor" && hasType(l, MCA_FAMILY));

  const countType = (types: string[], statuses?: string[]) =>
    lenders.filter((l) => hasType(l, types) && (statuses ? statuses.includes(l.status) : true));

  const loc = countType(["line_of_credit"]);
  const equip = countType(["equipment"]);
  const factoring = countType(["invoice_factoring"]);
  const startup = countType(["startup"]);

  // Referral partners that actually exist as live rows, with their real status.
  const refCards = REFERRAL_PARTNERS.map((rp) => ({ rp, lender: byName(rp.match) })).filter(
    (x): x is { rp: RefPartner; lender: Lender } => !!x.lender,
  );

  const liveCount = (arr: Lender[]) => arr.filter((l) => l.status === "live_vendor").length;

  return (
    <div className="mt-10">
      <div className="flex items-center gap-2 mb-1">
        <RectangleStackIcon className="w-6 h-6 text-mint-green" />
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Our offerings</h2>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
        The product lines we can actually sell, and who powers each one. Counts stay live off the
        lender records; the house picks are the owner's intended go-tos.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Micro MCA — the priority segment */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border-2 border-mint-green/40 overflow-hidden">
          <div className="h-1 bg-mint-green" />
          <div className="p-4">
            <div className="flex items-center gap-2">
              <StarIcon className="w-4 h-4 text-mint-green" />
              <h3 className="font-bold text-gray-900 dark:text-white">Micro MCA</h3>
              <span className="text-xs text-gray-500 dark:text-gray-400">small deals · low-revenue merchants</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-3">
              MCA-family funders whose box reaches small merchants: <b>≤ $15K/mo</b> floor, or
              <b> ≤ $10K</b> min deal, or <b>≤ $50K</b> max deal.
            </p>

            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">House picks</p>
            <ul className="space-y-1.5 mb-3">
              {housePicks.map((l) => (
                <li key={l.id} className="flex items-center gap-2 text-xs">
                  <StarIcon className="w-3.5 h-3.5 text-mint-green flex-shrink-0" />
                  <Link to={`/admin/lenders/${l.id}`} className="font-semibold text-ocean-blue hover:underline">
                    {l.company_name}
                  </Link>
                  <span className="text-gray-400 dark:text-gray-500 tabular-nums">{sizeRange(l)}</span>
                  <StatusChip status={l.status} />
                </li>
              ))}
              {housePicks.length === 0 && <li className="text-xs text-gray-400 italic">House picks not found in the network.</li>}
            </ul>

            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
              Also fits micro ({microDerived.length})
            </p>
            <ul className="space-y-1 max-h-52 overflow-y-auto">
              {microDerived.map((l) => (
                <li key={l.id} className="flex items-center gap-2 text-xs">
                  <Link to={`/admin/lenders/${l.id}`} className="font-semibold text-ocean-blue hover:underline flex-1 min-w-0 truncate">
                    {l.company_name}
                  </Link>
                  <span className="text-gray-400 dark:text-gray-500 tabular-nums whitespace-nowrap">{sizeRange(l)}</span>
                  <StatusChip status={l.status} />
                </li>
              ))}
              {microDerived.length === 0 && <li className="text-xs text-gray-400 italic">None derived.</li>}
            </ul>
          </div>
        </div>

        {/* Standard MCA */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="h-1 bg-ocean-blue" />
          <div className="p-4">
            <h3 className="font-bold text-gray-900 dark:text-white">Standard MCA</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-3">The main book — merchant cash advances across the live funder network.</p>
            <p className="text-3xl font-bold text-gray-900 dark:text-white tabular-nums">{standardMcaLive.length}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">live MCA funders to submit to</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
              Full per-funder criteria in the <b>Live Vendors</b> table above and the{" "}
              <Link to="/admin/funder-matrix" className="text-ocean-blue hover:underline">Funder Approval Matrix</Link>.
            </p>
          </div>
        </div>

        {/* SBA / term loans */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="h-1 bg-amber-400" />
          <div className="p-4">
            <h3 className="font-bold text-gray-900 dark:text-white">SBA &amp; business (term) loans</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-3">Real loan products — standard lending terminology applies here.</p>
            <div className="space-y-2 text-xs">
              <div>
                <span className="font-semibold text-gray-700 dark:text-gray-200">Live paths ({analysis.today.length}): </span>
                {analysis.today.length ? (
                  analysis.today.map((l, i) => (
                    <span key={l.id}>
                      {i > 0 && ", "}
                      <Link to={`/admin/lenders/${l.id}`} className="text-ocean-blue hover:underline">{l.company_name}</Link>
                    </span>
                  ))
                ) : (
                  <span className="text-gray-400">none</span>
                )}
              </div>
              <div className="text-gray-500 dark:text-gray-400">
                <b>{analysis.oneAway.length}</b> one approval away · <b>{analysis.prospects.length}</b> prospects worth applying to
              </div>
            </div>
          </div>
        </div>

        {/* Referral channel */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="h-1 bg-emerald-400" />
          <div className="p-4">
            <h3 className="font-bold text-gray-900 dark:text-white">Referral channel</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-3">
              We refer the merchant; the partner closes and funds. Each has its own sign-up / portal.
            </p>
            <ul className="space-y-3">
              {refCards.map(({ rp, lender }) => (
                <li key={lender.id} className="border-t border-gray-100 dark:border-gray-700/50 pt-2 first:border-t-0 first:pt-0">
                  <div className="flex items-center gap-2">
                    <Link to={`/admin/lenders/${lender.id}`} className="font-semibold text-ocean-blue hover:underline text-sm">
                      {lender.company_name}
                    </Link>
                    <StatusChip status={lender.status} />
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-1.5">{rp.blurb}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {rp.links.map((lk) => (
                      <CopyLink key={lk.url} label={lk.label} url={lk.url} />
                    ))}
                  </div>
                  {rp.contact && <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5">{rp.contact}</p>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Compact product-line cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-4">
        {[
          { label: "Lines of credit", arr: loc },
          { label: "Equipment financing", arr: equip },
          { label: "Invoice factoring", arr: factoring },
          { label: "Startup capital", arr: startup },
        ].map((c) => (
          <div key={c.label} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{c.arr.length}</p>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{c.label}</p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">{liveCount(c.arr)} live</p>
          </div>
        ))}
        {/* Debt relief is an internal product (VCF), not a lender_type */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Internal</p>
          <p className="text-xs font-medium text-gray-700 dark:text-gray-200 mt-0.5">Debt relief (VCF)</p>
          <Link to="/admin/unit-economics-vcf" className="text-[11px] text-ocean-blue hover:underline">
            We service this in-house
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Table row + expandable notes ──────────────────────────────────────────────
function RowFragment({
  lender,
  expanded,
  warn,
  onToggle,
}: {
  lender: Lender;
  expanded: boolean;
  warn: boolean;
  onToggle: () => void;
}) {
  const rev = fmtMoney(lender.min_monthly_revenue);
  const tib =
    lender.min_time_in_business == null
      ? "—"
      : `${lender.min_time_in_business}mo`;
  return (
    <>
      <tr className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
        <td className="py-2.5 px-4">
          <button onClick={onToggle} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-left group">
            {expanded ? (
              <ChevronDownIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            ) : (
              <ChevronRightIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            )}
            <Link
              to={`/admin/lenders/${lender.id}`}
              onClick={(e) => e.stopPropagation()}
              className="font-semibold text-ocean-blue hover:underline"
            >
              {lender.company_name}
            </Link>
            {warn && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                <ExclamationTriangleIcon className="w-3 h-3" /> Not a funder
              </span>
            )}
            <PaperChips lender={lender} />
            <ConsoBadge lender={lender} />
          </button>
          {lender.category?.known_for && (
            <p
              title={lender.category.known_for}
              className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 pl-[22px] leading-snug max-w-[340px] truncate"
            >
              {lender.category.known_for}
            </p>
          )}
        </td>
        {PRODUCTS.map((p) => (
          <td key={p.id} className="py-2.5 px-2 text-center">
            {doesProduct(lender, p) ? (
              <CheckIcon className="w-4 h-4 text-mint-green inline-block" />
            ) : (
              <span className="text-gray-300 dark:text-gray-600">·</span>
            )}
          </td>
        ))}
        <td className="py-2.5 px-3 text-right tabular-nums text-gray-700 dark:text-gray-200 whitespace-nowrap">{sizeRange(lender)}</td>
        <td className="py-2.5 px-3 text-right tabular-nums text-gray-700 dark:text-gray-200">{rev ?? "—"}</td>
        <td className="py-2.5 px-3 text-right tabular-nums text-gray-700 dark:text-gray-200">{tib}</td>
        <td className="py-2.5 px-3 text-right tabular-nums text-gray-700 dark:text-gray-200">{lender.min_credit_score ?? "—"}</td>
        <td className="py-2.5 px-3 text-center">
          {lender.website ? (
            <a
              href={lender.website}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-ocean-blue hover:text-ocean-blue/70 inline-block"
              title={lender.website}
            >
              <ArrowTopRightOnSquareIcon className="w-4 h-4" />
            </a>
          ) : (
            <span className="text-gray-300 dark:text-gray-600">—</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50 dark:bg-gray-900/30">
          <td colSpan={PRODUCTS.length + 6} className="px-4 py-3 space-y-2">
            {lender.category?.deal_fit && (
              <div className="rounded-lg border-l-4 border-mint-green bg-mint-green/10 px-3 py-2 max-w-3xl">
                <p className="text-[10px] font-bold uppercase tracking-wide text-mint-green mb-0.5">
                  What to send them
                </p>
                <p className="text-xs text-gray-700 dark:text-gray-200 leading-relaxed">{lender.category.deal_fit}</p>
              </div>
            )}
            {lender.category?.known_for && (
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-3xl">
                <span className="font-semibold text-gray-600 dark:text-gray-300">Known for:</span>{" "}
                {lender.category.known_for}
              </p>
            )}
            {lender.category?.consolidation?.note && isConsolidation(lender) && (
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-3xl">
                <span className="font-semibold text-gray-600 dark:text-gray-300">{consoLabel(lender)}:</span>{" "}
                {lender.category.consolidation.note}
              </p>
            )}
            {lender.notes ? (
              <p className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap break-words leading-relaxed max-w-3xl">
                {lender.notes}
              </p>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic">No notes on file.</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ── Analysis card ─────────────────────────────────────────────────────────────
function AnalysisCard({
  title,
  subtitle,
  tone,
  items,
}: {
  title: string;
  subtitle: string;
  tone: "mint" | "amber" | "blue";
  items: Lender[];
}) {
  const bar =
    tone === "mint" ? "bg-mint-green" : tone === "amber" ? "bg-amber-400" : "bg-ocean-blue";
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col">
      <div className={`h-1 ${bar}`} />
      <div className="p-4 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{title}</h3>
          <span className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">{items.length}</span>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-3">{subtitle}</p>
        {items.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 italic">None right now.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((l) => (
              <li key={l.id} className="text-xs">
                <div className="flex items-center gap-1.5">
                  <Link to={`/admin/lenders/${l.id}`} className="font-semibold text-ocean-blue hover:underline">
                    {l.company_name}
                  </Link>
                  {isWarn(l) && (
                    <ExclamationTriangleIcon className="w-3 h-3 text-red-500" title="Not a funder" />
                  )}
                </div>
                <p className="text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">{gapLine(l)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
