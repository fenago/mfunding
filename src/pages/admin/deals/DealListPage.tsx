import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  PlusIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  CurrencyDollarIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../../supabase";
import { getAllDeals, getDealStats } from "../../../services/dealService";
import type { DealWithCustomer, DealFilters, DealStatus, DealType, Market } from "../../../types/deals";
import {
  DEAL_STATUS_CONFIG,
  DEAL_TYPE_CONFIG,
  MARKET_CONFIG,
} from "../../../types/deals";
import DealCreateModal from "./DealCreateModal";

export default function DealListPage() {
  const [deals, setDeals] = useState<DealWithCustomer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<DealFilters>({});
  const [stats, setStats] = useState<{ total: number; byStatus: Record<string, number>; totalPipeline: number; totalFunded: number } | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [closers, setClosers] = useState<{ id: string; first_name: string | null; last_name: string | null }[]>([]);

  useEffect(() => {
    fetchDeals();
    fetchStats();
    fetchClosers();
  }, []);

  useEffect(() => {
    fetchDeals();
  }, [filters]);

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

  const fetchClosers = async () => {
    const { data } = await supabase
      .from("closers")
      .select("id, first_name, last_name")
      .eq("status", "active")
      .order("first_name", { ascending: true });
    setClosers(data || []);
  };

  const handleDealCreated = () => {
    setIsCreateModalOpen(false);
    fetchDeals();
    fetchStats();
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
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Deal Pipeline</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Manage funding deals from lead to close
          </p>
        </div>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="btn-primary flex items-center gap-2"
        >
          <PlusIcon className="w-5 h-5" />
          New Deal
        </button>
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
          value={filters.assigned_closer_id || ""}
          onChange={(e) => setFilters((f) => ({ ...f, assigned_closer_id: e.target.value || undefined }))}
          className="input-field w-40"
        >
          <option value="">All Closers</option>
          {closers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.first_name} {c.last_name}
            </option>
          ))}
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
                {deals.map((deal) => {
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
                        <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${statusConfig.bgColor} ${statusConfig.color}`}>
                          {statusConfig.label}
                        </span>
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
                        {deal.amount_funded && (
                          <div className="text-xs text-green-600">
                            Funded: ${deal.amount_funded.toLocaleString()}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
                        {marketConfig?.label || "-"}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
                        {deal.closer
                          ? `${deal.closer.first_name || ""} ${deal.closer.last_name || ""}`.trim()
                          : "-"}
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
