import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  PlusIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  CurrencyDollarIcon,
  DocumentTextIcon,
  ArrowDownTrayIcon,
  ArrowUturnLeftIcon,
} from "@heroicons/react/24/outline";
import { getAllDeals, getDealStats, reactivateDeal, listActiveCloserOptions, type CloserOption } from "../../../services/dealService";
import { exportToCsv } from "../../../lib/csv";
import type { DealWithCustomer, DealFilters, DealStatus, DealType, Market } from "../../../types/deals";
import {
  DEAL_STATUS_CONFIG,
  DEAL_TYPE_CONFIG,
  MARKET_CONFIG,
} from "../../../types/deals";
import DealCreateModal from "./DealCreateModal";
import { expectedCommissionInPlay } from "../../../types/commissions";
import LeadGradeChip from "../../../components/admin/LeadGradeChip";

// Sentinel for the closer <select>: "" already means "All Closers", so the
// unassigned-only view needs its own value (a real profile id can never collide).
const UNASSIGNED = "__unassigned__";

export default function DealListPage() {
  const [deals, setDeals] = useState<DealWithCustomer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<DealFilters>({});
  const [stats, setStats] = useState<{ total: number; byStatus: Record<string, number>; totalPipeline: number; totalFunded: number; commissionInPlay: number; unassigned: number } | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [closers, setClosers] = useState<CloserOption[]>([]);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  // "Best first (EV)" — sort by expected value (est.) instead of newest-first.
  // Client-side on the already-fetched rows; unscored deals sink to the bottom.
  const [sortBestFirst, setSortBestFirst] = useState(false);

  useEffect(() => {
    fetchDeals();
    fetchStats();
    fetchClosers();
  }, []);

  useEffect(() => {
    fetchDeals();
  }, [filters]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  const fetchDeals = async () => {
    setIsLoading(true);
    try {
      const data = await getAllDeals(filters);
      setDeals(data);
    } catch {
      console.error("Failed to fetch deals");
    }
    setIsLoading(false);
  };

  const fetchStats = async () => {
    try {
      const data = await getDealStats();
      setStats(data);
    } catch {
      // Stats are optional
    }
  };

  // Options come from the service so the <option value> is the PROFILE id.
  // (This filter used to submit closers.id into a column that holds profiles.id,
  // so filtering by a closer matched zero deals.)
  const fetchClosers = async () => {
    try {
      setClosers(await listActiveCloserOptions());
    } catch {
      setClosers([]);
    }
  };

  const handleDealCreated = () => {
    setIsCreateModalOpen(false);
    fetchDeals();
    fetchStats();
  };

  // Bring back is safe + reversible (just re-park it), so no confirmation gate —
  // one click does it, with an in-app toast instead of a native browser popup.
  const handleReactivate = async (dealId: string) => {
    setReactivatingId(dealId);
    setFlash(null);
    try {
      const deal = await reactivateDeal(dealId);
      await fetchDeals();
      fetchStats();
      const label = DEAL_STATUS_CONFIG[deal.status as DealStatus]?.label ?? "the pipeline";
      setFlash({ msg: `Brought back to ${label}.`, kind: "ok" });
    } catch (e) {
      setFlash({ msg: `Couldn't bring it back: ${e instanceof Error ? e.message : "unknown error"}`, kind: "err" });
    } finally {
      setReactivatingId(null);
    }
  };

  if (isLoading && deals.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {flash && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white ${flash.kind === "ok" ? "bg-emerald-600" : "bg-red-600"}`}
          role="status"
        >
          {flash.msg}
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Deal Pipeline</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Manage funding deals from lead to close
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportToCsv(`deals-${new Date().toISOString().slice(0, 10)}`, deals.map((d) => ({
              deal_number: d.deal_number ?? "",
              business: d.customer?.business_name ?? "",
              contact: `${d.customer?.first_name ?? ""} ${d.customer?.last_name ?? ""}`.trim(),
              deal_type: d.deal_type,
              status: d.status,
              market: d.market ?? "",
              amount_requested: d.amount_requested ?? "",
              amount_funded: d.amount_funded ?? "",
              lead_grade: d.lead_grade ?? "",
              expected_value_est: d.expected_value ?? "",
              created_at: d.created_at,
            })))}
            disabled={deals.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <ArrowDownTrayIcon className="w-4 h-4" /> Export CSV
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="btn-primary flex items-center gap-2"
          >
            <PlusIcon className="w-5 h-5" />
            New Deal
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">Total Deals</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">Pipeline Value</p>
            <p className="text-2xl font-bold text-ocean-blue">${stats.totalPipeline.toLocaleString()}</p>
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
              ≈ ${Math.round(stats.commissionInPlay).toLocaleString()} commission in play
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">Total Funded</p>
            <p className="text-2xl font-bold text-green-600">${stats.totalFunded.toLocaleString()}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">Active Deals</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {Object.entries(stats.byStatus)
                .filter(([s]) => !["funded", "declined", "dead"].includes(s))
                .reduce((sum, [, c]) => sum + c, 0)}
            </p>
          </div>
        </div>
      )}

      {/* Untagged deals can't pay a closer and don't show up in closer analytics —
          surface them loudly with a one-click way to go clear them. */}
      {stats && stats.unassigned > 0 && !filters.unassigned && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3">
          <p className="text-sm text-red-800 dark:text-red-200">
            <span className="font-bold">{stats.unassigned}</span>{" "}
            {stats.unassigned === 1 ? "deal has" : "deals have"} <span className="font-bold">no owning closer</span> — commission and closer analytics can't attribute {stats.unassigned === 1 ? "it" : "them"}.
          </p>
          <button
            onClick={() => setFilters((f) => ({ ...f, unassigned: true, assigned_closer_id: undefined }))}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700"
          >
            Show them
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 max-w-xs">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search deals..."
            value={filters.search || ""}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value || undefined }))}
            className="input-field pl-9"
          />
        </div>
        <select
          value={filters.status || ""}
          onChange={(e) => setFilters((f) => ({ ...f, status: (e.target.value || undefined) as DealStatus | undefined }))}
          className="input-field w-40"
        >
          <option value="">All Status</option>
          {Object.entries(DEAL_STATUS_CONFIG).map(([value, config]) => (
            <option key={value} value={value}>
              {config.label}
            </option>
          ))}
        </select>
        <select
          value={filters.deal_type || ""}
          onChange={(e) => setFilters((f) => ({ ...f, deal_type: (e.target.value || undefined) as DealType | undefined }))}
          className="input-field w-36"
        >
          <option value="">All Types</option>
          {Object.entries(DEAL_TYPE_CONFIG).map(([value, config]) => (
            <option key={value} value={value}>
              {config.shortLabel}
            </option>
          ))}
        </select>
        <select
          value={filters.market || ""}
          onChange={(e) => setFilters((f) => ({ ...f, market: (e.target.value || undefined) as Market | undefined }))}
          className="input-field w-40"
        >
          <option value="">All Markets</option>
          {Object.entries(MARKET_CONFIG).map(([value, config]) => (
            <option key={value} value={value}>
              {config.label}
            </option>
          ))}
        </select>
        <select
          value={filters.unassigned ? UNASSIGNED : filters.assigned_closer_id || ""}
          onChange={(e) => {
            const v = e.target.value;
            setFilters((f) => ({
              ...f,
              // The two are mutually exclusive — an unassigned deal has no closer to match.
              unassigned: v === UNASSIGNED ? true : undefined,
              assigned_closer_id: v && v !== UNASSIGNED ? v : undefined,
            }));
          }}
          className="input-field w-44"
        >
          <option value="">All Closers</option>
          <option value={UNASSIGNED}>⚠ Unassigned only</option>
          {closers.map((c) => (
            <option key={c.closerId} value={c.profileId}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={sortBestFirst ? "ev" : "newest"}
          onChange={(e) => setSortBestFirst(e.target.value === "ev")}
          className="input-field w-44"
          title="Best first ranks by expected value (est.) — P(close) × commission in play"
        >
          <option value="newest">Newest first</option>
          <option value="ev">Best first (EV)</option>
        </select>
        {Object.values(filters).some(Boolean) && (
          <button
            onClick={() => setFilters({})}
            className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white flex items-center gap-1"
          >
            <FunnelIcon className="w-4 h-4" />
            Clear
          </button>
        )}
      </div>

      {/* Deals Table */}
      {deals.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <DocumentTextIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No deals found
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            {Object.values(filters).some(Boolean)
              ? "Try adjusting your filters"
              : "Get started by creating your first deal"}
          </p>
          {!Object.values(filters).some(Boolean) && (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="btn-primary inline-flex items-center gap-2"
            >
              <PlusIcon className="w-5 h-5" />
              New Deal
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                    Deal
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                    Customer
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3" title="v1 rules-based lead quality — estimate, not measured">
                    Grade
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                    Status
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                    Type
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                    Amount
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                    Market
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                    Closer
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {(sortBestFirst
                  ? [...deals].sort((a, b) => (b.expected_value ?? -1) - (a.expected_value ?? -1))
                  : deals
                ).map((deal) => {
                  const statusConfig = DEAL_STATUS_CONFIG[deal.status];
                  const typeConfig = DEAL_TYPE_CONFIG[deal.deal_type];
                  const marketConfig = deal.market ? MARKET_CONFIG[deal.market] : null;
                  return (
                    <tr
                      key={deal.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                    >
                      <td className="px-6 py-4">
                        <Link to={`/admin/deals/${deal.id}`} className="block">
                          <span className="font-mono text-sm font-medium text-ocean-blue">
                            {deal.deal_number || "---"}
                          </span>
                          {deal.is_renewal && (
                            <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-teal-100 text-teal-700">
                              Renewal
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <Link to={`/admin/deals/${deal.id}`} className="block">
                          <div className="font-medium text-gray-900 dark:text-white">
                            {deal.customer?.first_name} {deal.customer?.last_name}
                          </div>
                          {deal.customer?.business_name && (
                            <div className="text-sm text-gray-500">{deal.customer.business_name}</div>
                          )}
                        </Link>
                      </td>
                      <td className="px-6 py-4">
                        <LeadGradeChip
                          grade={deal.lead_grade}
                          expectedValue={deal.expected_value}
                          reasons={deal.score_reasons}
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${statusConfig.bgColor} ${statusConfig.color}`}>
                            {statusConfig.label}
                          </span>
                          {["nurture", "declined", "dead"].includes(deal.status) && (
                            <button
                              onClick={() => handleReactivate(deal.id)}
                              disabled={reactivatingId === deal.id}
                              title="Bring this deal back into the active pipeline"
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-ocean-blue border border-ocean-blue/40 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50"
                            >
                              <ArrowUturnLeftIcon className="w-3.5 h-3.5" />
                              {reactivatingId === deal.id ? "Bringing back…" : "Bring back"}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
                        {typeConfig.shortLabel}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1 text-sm font-medium text-gray-900 dark:text-white">
                          <CurrencyDollarIcon className="w-4 h-4 text-green-500" />
                          {deal.amount_requested
                            ? `${deal.amount_requested.toLocaleString()}`
                            : "-"}
                        </div>
                        {deal.amount_funded ? (
                          <div className="text-xs text-green-600">
                            Funded: ${deal.amount_funded.toLocaleString()}
                          </div>
                        ) : deal.amount_requested && !["declined", "dead"].includes(deal.status) ? (
                          <div className="text-xs text-emerald-600 dark:text-emerald-400" title="Potential gross commission (amount × points)">
                            ≈ ${Math.round(expectedCommissionInPlay(deal.amount_requested, deal.is_renewal)).toLocaleString()} in play
                          </div>
                        ) : null}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
                        {marketConfig?.label || "-"}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
                        {deal.assigned_closer_id ? (
                          `${deal.closer?.first_name || ""} ${deal.closer?.last_name || ""}`.trim() || "—"
                        ) : (
                          // Never let an untagged deal read as a blank cell — it
                          // costs the closer their commission and skews analytics.
                          <Link
                            to={`/admin/deals/${deal.id}`}
                            title="No closer owns this deal — commission and closer analytics can't attribute it. Click to assign."
                            className="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60"
                          >
                            Unassigned
                          </Link>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {new Date(deal.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <DealCreateModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSave={handleDealCreated}
      />
    </div>
  );
}
