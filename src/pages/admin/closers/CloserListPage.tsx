import { Fragment, useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  PlusIcon,
  MagnifyingGlassIcon,
  UserGroupIcon,
  XMarkIcon,
  ChevronRightIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../../supabase";
import { mustWrite } from "@/supabase/writes";
import type { Closer, CloserStatus, CloserFormData, Market } from "../../../types/commissions";
import {
  CLOSER_STATUS_CONFIG,
  MARKET_LABELS,
  COMMISSION_DEFAULTS,
} from "../../../types/commissions";
import {
  getCloserAnalytics,
  GRADE_CLASSES,
  GRADE_DOT,
  BENCHMARKS,
  type CloserAnalytics,
  type CloserScorecard,
  type Grade,
} from "@/services/closerAnalyticsService";

const ALL_MARKETS: Market[] = [
  "indianapolis",
  "phoenix",
  "columbus",
  "dc",
  "sacramento",
  "south_florida",
];

/** How often the scorecards re-pull from Supabase. */
const REFRESH_MS = 60_000;

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatHours(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function formatDays(days: number | null): string {
  if (days === null) return "—";
  return `${days.toFixed(1)}d`;
}

// ---------------------------------------------------------------------------
// Scorecard building blocks
// ---------------------------------------------------------------------------

function MetricTile({
  label,
  value,
  sub,
  grade = "none",
  emphasize = false,
}: {
  label: string;
  value: string;
  sub?: string;
  grade?: Grade;
  emphasize?: boolean;
}) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${GRADE_CLASSES[grade]}`}>
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${GRADE_DOT[grade]}`} />
        <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{label}</p>
      </div>
      <p className={`mt-1 font-bold tabular-nums ${emphasize ? "text-lg" : "text-base"}`}>{value}</p>
      {sub && <p className="text-[11px] opacity-75 leading-tight">{sub}</p>}
    </div>
  );
}

function PlainTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="mt-1 text-base font-bold tabular-nums text-gray-900 dark:text-white">{value}</p>
      {sub && <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">{sub}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
      {children}
    </h4>
  );
}

function FunnelBars({ sc }: { sc: CloserScorecard }) {
  if (sc.dealsAssigned === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        No deals assigned yet — the funnel fills in as leads route to this closer.
      </p>
    );
  }
  const max = Math.max(sc.dealsAssigned, 1);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-[11px] text-gray-500 dark:text-gray-400">Assigned</span>
        <div className="flex-1 h-4 rounded bg-gray-100 dark:bg-gray-700 overflow-hidden">
          <div className="h-full bg-ocean-blue/70" style={{ width: "100%" }} />
        </div>
        <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-gray-600 dark:text-gray-300">
          {sc.dealsAssigned}
        </span>
      </div>
      {sc.funnel.map((step) => {
        const width = (step.count / max) * 100;
        const dropped = step.pctOfPrevious < 50 && step.count < max;
        return (
          <div key={step.key} className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-[11px] text-gray-500 dark:text-gray-400">
              {step.label}
            </span>
            <div className="flex-1 h-4 rounded bg-gray-100 dark:bg-gray-700 overflow-hidden">
              <div
                className={`h-full ${
                  step.key === "funded" ? "bg-mint-green" : dropped ? "bg-amber-400" : "bg-ocean-blue/50"
                }`}
                style={{ width: `${width}%` }}
              />
            </div>
            <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-gray-600 dark:text-gray-300">
              {step.count}
              <span className="opacity-60"> · {formatPercent(step.pctOfAssigned)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CloserScorecardPanel({
  sc,
  closer,
  rank,
  shareOfFunded,
}: {
  sc: CloserScorecard;
  closer: Closer;
  rank: number;
  shareOfFunded: number;
}) {
  const commissionOwed = sc.payoutApproved + sc.payoutPending + sc.payoutOnHold;

  return (
    <div className="p-5 bg-gray-50/80 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700 space-y-5">
      {/* Assessment strip */}
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-midnight-blue text-white dark:bg-white dark:text-midnight-blue">
            #{rank} by contribution
          </span>
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200">
            Score {sc.overallScore}/100
          </span>
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200">
            {sc.tenureMonths < 1 ? "New this month" : `${sc.tenureMonths.toFixed(0)} mo tenure`}
          </span>
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200">
            {formatPercent(shareOfFunded)} of company funded $
          </span>
          {!sc.hasData && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
              No activity on record yet
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <MetricTile
            label="Close rate"
            value={sc.dealsAssigned > 0 ? formatPercent(sc.closeRate) : "—"}
            sub={
              sc.dealsAssigned === 0
                ? "no deals assigned"
                : sc.dealsAssigned < 5
                  ? `${sc.dealsAssigned} deals — too few to grade`
                  : `target ${sc.targetCloseRate}%`
            }
            grade={sc.closeRateGrade}
            emphasize
          />
          <MetricTile
            label="Run rate"
            value={sc.dealsFunded > 0 ? `${sc.dealsPerMonth.toFixed(1)}/mo` : "—"}
            sub={sc.dealsFunded > 0 ? `target ${BENCHMARKS.TARGET_DEALS_PER_MONTH}/mo` : "no funded deals yet"}
            grade={sc.runRateGrade}
            emphasize
          />
          <MetricTile
            label="Speed to contact"
            value={formatHours(sc.avgHoursToFirstContact)}
            sub={
              sc.avgHoursToFirstContact === null
                ? "no contacts logged"
                : `target < ${BENCHMARKS.TARGET_FIRST_CONTACT_HOURS}h`
            }
            grade={sc.speedToContactGrade}
          />
          <MetricTile
            label="Time to fund"
            value={formatDays(sc.avgDaysToFund)}
            sub={
              sc.avgDaysToFund === null
                ? "no funded deals yet"
                : `target < ${BENCHMARKS.TARGET_DAYS_TO_FUND}d`
            }
            grade={sc.timeToFundGrade}
          />
          <MetricTile
            label="Touches / open deal"
            value={sc.openDeals > 0 ? sc.activityPerOpenDeal.toFixed(1) : "—"}
            sub={
              sc.openDeals > 0
                ? `target ${BENCHMARKS.TARGET_TOUCHES_PER_OPEN_DEAL}+`
                : "no open deals"
            }
            grade={sc.activityGrade}
          />
        </div>
      </div>

      {/* Money */}
      <div>
        <SectionTitle>Money</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <PlainTile
            label="Funded volume"
            value={formatCurrency(sc.totalFunded)}
            sub={sc.dealsFunded > 0 ? `${sc.dealsFunded} deals` : "no funded deals yet"}
          />
          <PlainTile
            label="Gross commission"
            value={formatCurrency(sc.grossCommission)}
            sub={sc.grossCommission > 0 ? "generated for Momentum" : "nothing booked yet"}
          />
          <PlainTile
            label="Company keeps"
            value={formatCurrency(sc.companyRevenue)}
            sub={`${closer.company_lead_split}% co-lead split`}
          />
          <PlainTile
            label="Paid out"
            value={formatCurrency(sc.payoutPaid)}
            sub={sc.payoutPaid > 0 ? "closer paid / completed" : "nothing paid yet"}
          />
          <PlainTile
            label="Owed"
            value={formatCurrency(commissionOwed)}
            sub={`${formatCurrency(sc.payoutApproved)} appr · ${formatCurrency(sc.payoutPending)} pend · ${formatCurrency(sc.payoutOnHold)} hold`}
          />
          <PlainTile
            label="Clawbacks"
            value={formatCurrency(sc.clawbacks)}
            sub={sc.clawbacks > 0 ? "deducted from payouts" : "none"}
          />
        </div>
      </div>

      {/* Pipeline + activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <SectionTitle>Pipeline &amp; conversion</SectionTitle>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <PlainTile
              label="Open deals"
              value={String(sc.openDeals)}
              sub={sc.openDeals > 0 ? "in flight" : "pipeline empty"}
            />
            <PlainTile
              label="Projected value"
              value={formatCurrency(sc.pipelineValue)}
              sub={sc.openDeals > 0 ? "requested / offered" : "—"}
            />
            <PlainTile
              label="Avg deal size"
              value={sc.dealsFunded > 0 ? formatCurrency(sc.avgDealSize) : "—"}
              sub={
                sc.dealsFunded > 0
                  ? `benchmark ${formatCurrency(BENCHMARKS.AVG_DEAL_SIZE)}`
                  : "no funded deals yet"
              }
            />
            <PlainTile
              label="Renewals"
              value={String(sc.renewals)}
              sub={closer.renewals_enabled ? "renewals enabled" : "renewals off"}
            />
          </div>
          <FunnelBars sc={sc} />
        </div>

        <div>
          <SectionTitle>Work &amp; activity</SectionTitle>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <PlainTile
              label="Deals worked"
              value={String(sc.dealsWorked)}
              sub={`of ${sc.dealsAssigned} assigned`}
            />
            <PlainTile
              label="Lost / declined"
              value={String(sc.dealsLost)}
              sub={sc.dealsLost > 0 ? "closed lost" : "none"}
            />
            <PlainTile
              label="Logged touches"
              value={String(sc.activityCount)}
              sub={`${sc.callCount} calls`}
            />
            <PlainTile
              label="Self-gen deals"
              value={String(sc.selfGenDeals)}
              sub={`${closer.self_gen_split}% split`}
            />
          </div>
          {!sc.userId && (
            <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
              No portal login linked to this closer — deals and logged activity can&apos;t be attributed
              until <span className="font-semibold">user_id</span> is set.
            </p>
          )}
          {sc.userId && sc.activityCount === 0 && (
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              No calls or notes logged yet. Activity appears here as soon as this closer logs work on a
              deal.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CloserListPage() {
  const [closers, setClosers] = useState<Closer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCloser, setEditingCloser] = useState<Closer | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Performance analytics (auto-refreshing)
  const [analytics, setAnalytics] = useState<CloserAnalytics | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"contribution" | "name">("contribution");

  const [formData, setFormData] = useState<CloserFormData>({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    company_lead_split: COMMISSION_DEFAULTS.COMPANY_LEAD_SPLIT,
    self_gen_split: COMMISSION_DEFAULTS.SELF_GEN_SPLIT,
    renewal_split: COMMISSION_DEFAULTS.RENEWAL_SPLIT,
    renewals_enabled: false,
    status: "active",
    markets: [],
    max_leads_per_month: 50,
    notes: "",
  });

  const refreshAnalytics = useCallback(async () => {
    try {
      const data = await getCloserAnalytics();
      setAnalytics(data);
      setAnalyticsError(null);
    } catch (err) {
      console.error("Error loading closer analytics:", err);
      setAnalyticsError(err instanceof Error ? err.message : "Could not load performance data");
    }
  }, []);

  useEffect(() => {
    fetchClosers();
  }, []);

  // Live scorecards: initial pull + interval refresh.
  useEffect(() => {
    void refreshAnalytics();
    const timer = setInterval(() => {
      void refreshAnalytics();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refreshAnalytics]);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const fetchClosers = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("closers")
      .select("*")
      .order("first_name", { ascending: true });

    if (error) {
      console.error("Error fetching closers:", error);
    } else {
      setClosers((data || []) as Closer[]);
    }
    setIsLoading(false);
  };

  const rankById: Record<string, number> = {};
  (analytics?.ranking || []).forEach((id, i) => {
    rankById[id] = i + 1;
  });

  const filteredClosers = closers
    .filter((closer) => {
      const fullName = `${closer.first_name} ${closer.last_name}`.toLowerCase();
      if (searchQuery && !fullName.includes(searchQuery.toLowerCase()) && !closer.email.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      if (statusFilter && closer.status !== statusFilter) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "name") {
        return `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`);
      }
      const ra = rankById[a.id] ?? Number.MAX_SAFE_INTEGER;
      const rb = rankById[b.id] ?? Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });

  const openAddModal = () => {
    setEditingCloser(null);
    setFormData({
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      company_lead_split: COMMISSION_DEFAULTS.COMPANY_LEAD_SPLIT,
      self_gen_split: COMMISSION_DEFAULTS.SELF_GEN_SPLIT,
      renewal_split: COMMISSION_DEFAULTS.RENEWAL_SPLIT,
      renewals_enabled: false,
      status: "active",
      markets: [],
      max_leads_per_month: 50,
      notes: "",
    });
    setIsModalOpen(true);
  };

  const openEditModal = (closer: Closer) => {
    setEditingCloser(closer);
    setFormData({
      first_name: closer.first_name,
      last_name: closer.last_name,
      email: closer.email,
      phone: closer.phone || "",
      company_lead_split: closer.company_lead_split,
      self_gen_split: closer.self_gen_split,
      renewal_split: closer.renewal_split,
      renewals_enabled: closer.renewals_enabled,
      draw_amount: closer.draw_amount,
      status: closer.status,
      start_date: closer.start_date,
      markets: closer.markets,
      max_leads_per_month: closer.max_leads_per_month,
      notes: closer.notes || "",
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (editingCloser) {
        await mustWrite(
          "update closer",
          supabase.from("closers").update(formData).eq("id", editingCloser.id),
        );
      } else {
        await mustWrite("create closer", supabase.from("closers").insert(formData));
      }
      setIsModalOpen(false);
      fetchClosers();
    } catch (err) {
      console.error("Error saving closer:", err);
    }
    setIsSaving(false);
  };

  const toggleMarket = (market: Market) => {
    setFormData((prev) => ({
      ...prev,
      markets: prev.markets.includes(market)
        ? prev.markets.filter((m) => m !== market)
        : [...prev.markets, market],
    }));
  };

  // Summary stats
  const activeCount = closers.filter((c) => c.status === "active").length;
  const totalDeals = closers.reduce((sum, c) => sum + c.total_deals_funded, 0);
  const totalCommission = closers.reduce((sum, c) => sum + c.total_commission_earned, 0);
  const liveCards = analytics ? Object.values(analytics.byCloser) : [];
  const liveOpenDeals = liveCards.reduce((sum, sc) => sum + sc.openDeals, 0);
  const livePipelineValue = liveCards.reduce((sum, sc) => sum + sc.pipelineValue, 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Closers</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Manage 1099 independent contractor sales reps
          </p>
        </div>
        <button onClick={openAddModal} className="btn-primary flex items-center gap-2">
          <PlusIcon className="w-5 h-5" />
          Add Closer
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Active Closers</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{activeCount}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Deals Funded</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{totalDeals}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Commission Earned</p>
          <p className="text-2xl font-bold text-emerald-600">{formatCurrency(totalCommission)}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Funded Volume</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {analytics && analytics.totalFundedAllClosers > 0
              ? formatCurrency(analytics.totalFundedAllClosers)
              : "$0"}
          </p>
          <p className="text-xs text-gray-400">
            {analytics && analytics.totalFundedAllClosers > 0 ? "across all closers" : "no funded deals yet"}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Open Pipeline</p>
          <p className="text-2xl font-bold text-ocean-blue">
            {formatCurrency(livePipelineValue)}
          </p>
          <p className="text-xs text-gray-400">
            {liveOpenDeals > 0 ? `${liveOpenDeals} open deals` : "no open deals assigned"}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 max-w-xs">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search closers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-field pl-9"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input-field w-40"
        >
          <option value="">All Status</option>
          {Object.entries(CLOSER_STATUS_CONFIG).map(([value, config]) => (
            <option key={value} value={value}>
              {config.label}
            </option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "contribution" | "name")}
          className="input-field w-48"
        >
          <option value="contribution">Sort: Contribution</option>
          <option value="name">Sort: Name</option>
        </select>
        {(statusFilter || searchQuery) && (
          <button
            onClick={() => { setStatusFilter(""); setSearchQuery(""); }}
            className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            Clear filters
          </button>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {analyticsError ? (
            <span className="text-rose-600 dark:text-rose-400">
              Performance data unavailable: {analyticsError}
            </span>
          ) : (
            <>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-mint-green opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-mint-green" />
              </span>
              <span>
                Live —{" "}
                {analytics
                  ? new Date(analytics.refreshedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })
                  : "loading"}
              </span>
            </>
          )}
          <button
            onClick={() => { void refreshAnalytics(); fetchClosers(); }}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Refresh now"
          >
            <ArrowPathIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Table */}
      {filteredClosers.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <UserGroupIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No closers found
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            {searchQuery || statusFilter
              ? "Try adjusting your filters"
              : "Get started by adding your first closer"}
          </p>
          {!searchQuery && !statusFilter && (
            <button onClick={openAddModal} className="btn-primary inline-flex items-center gap-2">
              <PlusIcon className="w-5 h-5" />
              Add Closer
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="px-2 py-3"></th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Markets</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Funded $</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Deals Funded</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total Commission</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Close Rate</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Pipeline</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Split</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filteredClosers.map((closer) => {
                  const sc = analytics?.byCloser[closer.id];
                  const isOpen = expanded.has(closer.id);
                  const dealsFunded = sc ? sc.dealsFunded : closer.total_deals_funded;
                  const commission = sc && sc.grossCommission > 0
                    ? sc.grossCommission
                    : closer.total_commission_earned;
                  const closeRate = sc ? sc.closeRate : closer.close_rate;
                  const grade: Grade = sc ? sc.closeRateGrade : "none";

                  return (
                    <Fragment key={closer.id}>
                      <tr
                        onClick={() => toggleExpanded(closer.id)}
                        className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 ${
                          isOpen ? "bg-gray-50 dark:bg-gray-700/30" : ""
                        }`}
                      >
                        <td className="pl-3 pr-1 py-3">
                          <ChevronRightIcon
                            className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? "rotate-90" : ""}`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {analytics && rankById[closer.id] && (
                              <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 tabular-nums">
                                #{rankById[closer.id]}
                              </span>
                            )}
                            <Link
                              to={`/admin/closers/${closer.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="font-medium text-gray-900 dark:text-white hover:text-ocean-blue"
                            >
                              {closer.first_name} {closer.last_name}
                            </Link>
                          </div>
                          <p className="text-sm text-gray-500 dark:text-gray-400">{closer.email}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${CLOSER_STATUS_CONFIG[closer.status]?.color}`}>
                            {CLOSER_STATUS_CONFIG[closer.status]?.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {closer.markets.slice(0, 2).map((m) => (
                              <span key={m} className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">
                                {MARKET_LABELS[m]?.split(",")[0] || m}
                              </span>
                            ))}
                            {closer.markets.length > 2 && (
                              <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">
                                +{closer.markets.length - 2}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-white tabular-nums">
                          {sc && sc.totalFunded > 0 ? formatCurrency(sc.totalFunded) : (
                            <span className="text-gray-400 dark:text-gray-500 font-normal">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white tabular-nums">
                          {dealsFunded}
                        </td>
                        <td className="px-4 py-3 text-right font-medium tabular-nums">
                          {commission > 0 ? (
                            <span className="text-emerald-600">{formatCurrency(commission)}</span>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-500">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-semibold tabular-nums ${GRADE_CLASSES[grade]}`}
                            title={sc ? `Target ${sc.targetCloseRate}% at this tenure` : undefined}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${GRADE_DOT[grade]}`} />
                            {sc && sc.dealsAssigned === 0 ? "No deals" : formatPercent(closeRate)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-sm tabular-nums text-gray-700 dark:text-gray-300">
                          {sc && sc.openDeals > 0 ? (
                            <>
                              {sc.openDeals}
                              <span className="text-gray-400 dark:text-gray-500">
                                {" "}· {formatCurrency(sc.pipelineValue)}
                              </span>
                            </>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-500">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 text-sm">
                          <div className="flex items-center justify-end gap-2">
                            {closer.renewals_enabled && (
                              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" title="Renewals enabled">
                                ↻ Renewals
                              </span>
                            )}
                            <span>{closer.company_lead_split}%/{closer.self_gen_split}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); openEditModal(closer); }}
                            className="text-sm text-ocean-blue hover:underline"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={11} className="p-0">
                            {sc ? (
                              <CloserScorecardPanel
                                sc={sc}
                                closer={closer}
                                rank={rankById[closer.id] ?? filteredClosers.length}
                                shareOfFunded={
                                  analytics && analytics.totalFundedAllClosers > 0
                                    ? (sc.totalFunded / analytics.totalFundedAllClosers) * 100
                                    : 0
                                }
                              />
                            ) : (
                              <div className="p-6 text-sm text-gray-500 dark:text-gray-400 bg-gray-50/80 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
                                {analyticsError
                                  ? `Performance data unavailable: ${analyticsError}`
                                  : "Loading performance data…"}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                {editingCloser ? "Edit Closer" : "Add Closer"}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">First Name *</label>
                  <input
                    type="text"
                    value={formData.first_name}
                    onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Last Name *</label>
                  <input
                    type="text"
                    value={formData.last_name}
                    onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email *</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={formData.phone || ""}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="input-field"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as CloserStatus })}
                  className="input-field"
                >
                  {Object.entries(CLOSER_STATUS_CONFIG).map(([val, cfg]) => (
                    <option key={val} value={val}>{cfg.label}</option>
                  ))}
                </select>
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Commission Splits</h3>
                <p className="text-xs text-gray-400 mb-3">Set per closer. New closers default to 30% on company leads (the Momentum Standard) — override here anytime.</p>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Company Lead %</label>
                    <input
                      type="number"
                      value={formData.company_lead_split}
                      onChange={(e) => setFormData({ ...formData, company_lead_split: Number(e.target.value) })}
                      className="input-field"
                      min="0"
                      max="100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Self-Gen %</label>
                    <input
                      type="number"
                      value={formData.self_gen_split}
                      onChange={(e) => setFormData({ ...formData, self_gen_split: Number(e.target.value) })}
                      className="input-field"
                      min="0"
                      max="100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Renewal %</label>
                    <input
                      type="number"
                      value={formData.renewal_split}
                      onChange={(e) => setFormData({ ...formData, renewal_split: Number(e.target.value) })}
                      className="input-field"
                      min="0"
                      max="100"
                    />
                    <label className="mt-2 flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.renewals_enabled}
                        onChange={(e) => setFormData({ ...formData, renewals_enabled: e.target.checked })}
                        className="rounded border-gray-300 dark:border-gray-600 text-ocean-blue focus:ring-ocean-blue"
                      />
                      <span className="text-xs text-gray-600 dark:text-gray-300">Renewals enabled</span>
                    </label>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  When off, this closer can't see the Renewals page or the renewal option in their commission calculator.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Markets</label>
                <div className="flex flex-wrap gap-2">
                  {ALL_MARKETS.map((market) => (
                    <button
                      key={market}
                      type="button"
                      onClick={() => toggleMarket(market)}
                      className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                        formData.markets.includes(market)
                          ? "bg-ocean-blue text-white border-ocean-blue"
                          : "bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-ocean-blue"
                      }`}
                    >
                      {MARKET_LABELS[market]?.split(",")[0] || market}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Max Leads/Month</label>
                <input
                  type="number"
                  value={formData.max_leads_per_month}
                  onChange={(e) => setFormData({ ...formData, max_leads_per_month: Number(e.target.value) })}
                  className="input-field w-32"
                  min="1"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
                <textarea
                  value={formData.notes || ""}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="input-field"
                  rows={3}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || !formData.first_name || !formData.last_name || !formData.email}
                className="btn-primary disabled:opacity-50"
              >
                {isSaving ? "Saving..." : editingCloser ? "Update" : "Add Closer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
