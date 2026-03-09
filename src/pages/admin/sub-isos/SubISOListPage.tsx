import { useState, useEffect } from "react";
import {
  PlusIcon,
  MagnifyingGlassIcon,
  BuildingOffice2Icon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../../supabase";
import type { SubISO, SubISOStatus, SubISOFormData } from "../../../types/commissions";
import { SUB_ISO_STATUS_CONFIG, COMMISSION_DEFAULTS } from "../../../types/commissions";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

const PLATFORM_FEE_OPTIONS = [
  { value: 99, label: "Starter - $99/mo" },
  { value: 149, label: "Growth - $149/mo" },
  { value: 199, label: "Pro - $199/mo" },
];

export default function SubISOListPage() {
  const [subISOs, setSubISOs] = useState<SubISO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSubISO, setEditingSubISO] = useState<SubISO | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [formData, setFormData] = useState<SubISOFormData>({
    company_name: "",
    contact_name: "",
    email: "",
    phone: "",
    override_points: COMMISSION_DEFAULTS.SUB_ISO_OVERRIDE_POINTS,
    platform_fee_monthly: 99,
    status: "pending",
    notes: "",
  });

  useEffect(() => {
    fetchSubISOs();
  }, []);

  const fetchSubISOs = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("sub_isos")
      .select("*")
      .order("company_name", { ascending: true });

    if (error) {
      console.error("Error fetching sub-ISOs:", error);
    } else {
      setSubISOs((data || []) as SubISO[]);
    }
    setIsLoading(false);
  };

  const filteredSubISOs = subISOs.filter((iso) => {
    if (
      searchQuery &&
      !iso.company_name.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !iso.contact_name.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !iso.email.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }
    if (statusFilter && iso.status !== statusFilter) return false;
    return true;
  });

  const openAddModal = () => {
    setEditingSubISO(null);
    setFormData({
      company_name: "",
      contact_name: "",
      email: "",
      phone: "",
      override_points: COMMISSION_DEFAULTS.SUB_ISO_OVERRIDE_POINTS,
      platform_fee_monthly: 99,
      status: "pending",
      notes: "",
    });
    setIsModalOpen(true);
  };

  const openEditModal = (iso: SubISO) => {
    setEditingSubISO(iso);
    setFormData({
      company_name: iso.company_name,
      contact_name: iso.contact_name,
      email: iso.email,
      phone: iso.phone || "",
      override_points: iso.override_points,
      platform_fee_monthly: iso.platform_fee_monthly,
      agreement_start_date: iso.agreement_start_date,
      agreement_end_date: iso.agreement_end_date,
      status: iso.status,
      notes: iso.notes || "",
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (editingSubISO) {
        await supabase
          .from("sub_isos")
          .update(formData)
          .eq("id", editingSubISO.id);
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        await supabase.from("sub_isos").insert({ ...formData, created_by: user?.id });
      }
      setIsModalOpen(false);
      fetchSubISOs();
    } catch (err) {
      console.error("Error saving sub-ISO:", err);
    }
    setIsSaving(false);
  };

  // Summary stats
  const activeCount = subISOs.filter((s) => s.status === "active").length;
  const totalDeals = subISOs.reduce((sum, s) => sum + s.total_deals_funded, 0);
  const totalOverride = subISOs.reduce((sum, s) => sum + s.total_override_earned, 0);
  const monthlyPlatformRev = subISOs
    .filter((s) => s.status === "active")
    .reduce((sum, s) => sum + (s.platform_fee_monthly || 0), 0);

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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Sub-ISO Partners</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Manage Sub-ISO broker partners submitting deals through MFunding
          </p>
        </div>
        <button onClick={openAddModal} className="btn-primary flex items-center gap-2">
          <PlusIcon className="w-5 h-5" />
          Add Sub-ISO
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Active Partners</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{activeCount}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Deals Funded</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{totalDeals}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Override Earned</p>
          <p className="text-2xl font-bold text-emerald-600">{formatCurrency(totalOverride)}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Monthly Platform Rev</p>
          <p className="text-2xl font-bold text-blue-600">{formatCurrency(monthlyPlatformRev)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 max-w-xs">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search partners..."
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
          {Object.entries(SUB_ISO_STATUS_CONFIG).map(([value, config]) => (
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
      {filteredSubISOs.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <BuildingOffice2Icon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No Sub-ISO partners found
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            {searchQuery || statusFilter
              ? "Try adjusting your filters"
              : "Get started by adding your first Sub-ISO partner"}
          </p>
          {!searchQuery && !statusFilter && (
            <button onClick={openAddModal} className="btn-primary inline-flex items-center gap-2">
              <PlusIcon className="w-5 h-5" />
              Add Sub-ISO
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Company</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Contact</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Submitted</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Funded</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Override Earned</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Platform Fee</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filteredSubISOs.map((iso) => (
                  <tr key={iso.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900 dark:text-white">{iso.company_name}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{iso.email}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                      {iso.contact_name}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${SUB_ISO_STATUS_CONFIG[iso.status]?.color}`}>
                        {SUB_ISO_STATUS_CONFIG[iso.status]?.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">
                      {iso.total_deals_submitted}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">
                      {iso.total_deals_funded}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-emerald-600">
                      {formatCurrency(iso.total_override_earned)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-600 dark:text-gray-400">
                      {iso.platform_fee_monthly ? formatCurrency(iso.platform_fee_monthly) + "/mo" : "N/A"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openEditModal(iso)}
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
                {editingSubISO ? "Edit Sub-ISO Partner" : "Add Sub-ISO Partner"}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Company Name *</label>
                <input
                  type="text"
                  value={formData.company_name}
                  onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                  className="input-field"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contact Name *</label>
                  <input
                    type="text"
                    value={formData.contact_name}
                    onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
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
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={formData.phone || ""}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as SubISOStatus })}
                    className="input-field"
                  >
                    {Object.entries(SUB_ISO_STATUS_CONFIG).map(([val, cfg]) => (
                      <option key={val} value={val}>{cfg.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Agreement Terms</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Override Points (MFunding keeps)</label>
                    <input
                      type="number"
                      value={formData.override_points}
                      onChange={(e) => setFormData({ ...formData, override_points: Number(e.target.value) })}
                      className="input-field"
                      min="0"
                      max="10"
                      step="0.5"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Platform Fee</label>
                    <select
                      value={formData.platform_fee_monthly || ""}
                      onChange={(e) => setFormData({ ...formData, platform_fee_monthly: e.target.value ? Number(e.target.value) : null })}
                      className="input-field"
                    >
                      <option value="">None</option>
                      {PLATFORM_FEE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Agreement Start</label>
                    <input
                      type="date"
                      value={formData.agreement_start_date || ""}
                      onChange={(e) => setFormData({ ...formData, agreement_start_date: e.target.value || null })}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Agreement End</label>
                    <input
                      type="date"
                      value={formData.agreement_end_date || ""}
                      onChange={(e) => setFormData({ ...formData, agreement_end_date: e.target.value || null })}
                      className="input-field"
                    />
                  </div>
                </div>
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
                disabled={isSaving || !formData.company_name || !formData.contact_name || !formData.email}
                className="btn-primary disabled:opacity-50"
              >
                {isSaving ? "Saving..." : editingSubISO ? "Update" : "Add Sub-ISO"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
