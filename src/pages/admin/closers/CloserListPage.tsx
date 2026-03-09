import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  PlusIcon,
  MagnifyingGlassIcon,
  UserGroupIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../../supabase";
import type { Closer, CloserStatus, CloserFormData, Market } from "../../../types/commissions";
import {
  CLOSER_STATUS_CONFIG,
  MARKET_LABELS,
  COMMISSION_DEFAULTS,
} from "../../../types/commissions";

const ALL_MARKETS: Market[] = [
  "indianapolis",
  "phoenix",
  "columbus",
  "dc",
  "sacramento",
  "south_florida",
];

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

export default function CloserListPage() {
  const [closers, setClosers] = useState<Closer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCloser, setEditingCloser] = useState<Closer | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [formData, setFormData] = useState<CloserFormData>({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    company_lead_split: COMMISSION_DEFAULTS.COMPANY_LEAD_SPLIT,
    self_gen_split: COMMISSION_DEFAULTS.SELF_GEN_SPLIT,
    renewal_split: COMMISSION_DEFAULTS.RENEWAL_SPLIT,
    status: "active",
    markets: [],
    max_leads_per_month: 50,
    notes: "",
  });

  useEffect(() => {
    fetchClosers();
  }, []);

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

  const filteredClosers = closers.filter((closer) => {
    const fullName = `${closer.first_name} ${closer.last_name}`.toLowerCase();
    if (searchQuery && !fullName.includes(searchQuery.toLowerCase()) && !closer.email.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (statusFilter && closer.status !== statusFilter) return false;
    return true;
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
        await supabase
          .from("closers")
          .update(formData)
          .eq("id", editingCloser.id);
      } else {
        await supabase.from("closers").insert(formData);
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
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
        {(statusFilter || searchQuery) && (
          <button
            onClick={() => { setStatusFilter(""); setSearchQuery(""); }}
            className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            Clear filters
          </button>
        )}
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
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Markets</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Deals Funded</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total Commission</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Close Rate</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Split</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filteredClosers.map((closer) => (
                  <tr key={closer.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-4 py-3">
                      <Link
                        to={`/admin/closers/${closer.id}`}
                        className="font-medium text-gray-900 dark:text-white hover:text-ocean-blue"
                      >
                        {closer.first_name} {closer.last_name}
                      </Link>
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
                    <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">
                      {closer.total_deals_funded}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-emerald-600">
                      {formatCurrency(closer.total_commission_earned)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">
                      {formatPercent(closer.close_rate)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 text-sm">
                      {closer.company_lead_split}%/{closer.self_gen_split}%
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => { e.preventDefault(); openEditModal(closer); }}
                        className="text-sm text-ocean-blue hover:underline"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
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
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Commission Splits</h3>
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
                  </div>
                </div>
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
