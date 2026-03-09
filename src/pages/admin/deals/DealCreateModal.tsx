import { useState, useEffect } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import supabase from "../../../supabase";
import { createDeal } from "../../../services/dealService";
import type { DealType, Market, CreateDealData } from "../../../types/deals";
import { DEAL_TYPE_CONFIG, MARKET_CONFIG } from "../../../types/deals";

interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  business_name: string | null;
}

interface DealCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  preselectedCustomerId?: string;
}

export default function DealCreateModal({
  isOpen,
  onClose,
  onSave,
  preselectedCustomerId,
}: DealCreateModalProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [closers, setClosers] = useState<{ id: string; first_name: string | null; last_name: string | null }[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState<{
    customer_id: string;
    deal_type: DealType;
    amount_requested: string;
    use_of_funds: string;
    urgency: string;
    lead_source: string;
    lead_source_detail: string;
    market: Market | "";
    assigned_closer_id: string;
    is_renewal: boolean;
    notes: string;
  }>({
    customer_id: preselectedCustomerId || "",
    deal_type: "mca",
    amount_requested: "",
    use_of_funds: "",
    urgency: "",
    lead_source: "",
    lead_source_detail: "",
    market: "",
    assigned_closer_id: "",
    is_renewal: false,
    notes: "",
  });

  useEffect(() => {
    if (isOpen) {
      fetchCustomers();
      fetchClosers();
      if (preselectedCustomerId) {
        setFormData((f) => ({ ...f, customer_id: preselectedCustomerId }));
      }
    }
  }, [isOpen, preselectedCustomerId]);

  const fetchCustomers = async () => {
    const { data } = await supabase
      .from("customers")
      .select("id, first_name, last_name, business_name")
      .order("first_name", { ascending: true })
      .limit(200);
    setCustomers(data || []);
  };

  const fetchClosers = async () => {
    const { data } = await supabase
      .from("closers")
      .select("id, first_name, last_name")
      .eq("status", "active")
      .order("first_name", { ascending: true });
    setClosers(data || []);
  };

  const filteredCustomers = customers.filter((c) => {
    if (!customerSearch) return true;
    const search = customerSearch.toLowerCase();
    const fullName = `${c.first_name} ${c.last_name}`.toLowerCase();
    const biz = (c.business_name || "").toLowerCase();
    return fullName.includes(search) || biz.includes(search);
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.customer_id) {
      setError("Please select a customer");
      return;
    }

    setIsSaving(true);
    try {
      const data: CreateDealData = {
        customer_id: formData.customer_id,
        deal_type: formData.deal_type,
        amount_requested: formData.amount_requested ? parseFloat(formData.amount_requested) : undefined,
        use_of_funds: formData.use_of_funds || undefined,
        urgency: formData.urgency || undefined,
        lead_source: formData.lead_source || undefined,
        lead_source_detail: formData.lead_source_detail || undefined,
        market: formData.market || undefined,
        assigned_closer_id: formData.assigned_closer_id || undefined,
        is_renewal: formData.is_renewal,
        notes: formData.notes || undefined,
      };

      await createDeal(data);
      onSave();

      // Reset form
      setFormData({
        customer_id: "",
        deal_type: "mca",
        amount_requested: "",
        use_of_funds: "",
        urgency: "",
        lead_source: "",
        lead_source_detail: "",
        market: "",
        assigned_closer_id: "",
        is_renewal: false,
        notes: "",
      });
    } catch {
      setError("Failed to create deal. Please try again.");
    }
    setIsSaving(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Create New Deal
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Customer Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Customer *
            </label>
            <input
              type="text"
              placeholder="Search customers..."
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              className="input-field w-full mb-2"
            />
            <select
              value={formData.customer_id}
              onChange={(e) => setFormData((f) => ({ ...f, customer_id: e.target.value }))}
              className="input-field w-full"
              required
            >
              <option value="">Select a customer</option>
              {filteredCustomers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.first_name} {c.last_name}
                  {c.business_name ? ` - ${c.business_name}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Deal Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Product Type *
              </label>
              <select
                value={formData.deal_type}
                onChange={(e) => setFormData((f) => ({ ...f, deal_type: e.target.value as DealType }))}
                className="input-field w-full"
                required
              >
                {Object.entries(DEAL_TYPE_CONFIG).map(([value, config]) => (
                  <option key={value} value={value}>
                    {config.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Amount Requested */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Amount Requested
              </label>
              <input
                type="number"
                value={formData.amount_requested}
                onChange={(e) => setFormData((f) => ({ ...f, amount_requested: e.target.value }))}
                className="input-field w-full"
                placeholder="50000"
                min="0"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Market */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Market
              </label>
              <select
                value={formData.market}
                onChange={(e) => setFormData((f) => ({ ...f, market: e.target.value as Market | "" }))}
                className="input-field w-full"
              >
                <option value="">Select market</option>
                {Object.entries(MARKET_CONFIG).map(([value, config]) => (
                  <option key={value} value={value}>
                    {config.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Assigned Closer */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Assigned Closer
              </label>
              <select
                value={formData.assigned_closer_id}
                onChange={(e) => setFormData((f) => ({ ...f, assigned_closer_id: e.target.value }))}
                className="input-field w-full"
              >
                <option value="">Unassigned</option>
                {closers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.first_name} {c.last_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Lead Source */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Lead Source
              </label>
              <select
                value={formData.lead_source}
                onChange={(e) => setFormData((f) => ({ ...f, lead_source: e.target.value }))}
                className="input-field w-full"
              >
                <option value="">Select source</option>
                <option value="live_transfer">Live Transfer</option>
                <option value="google_ads">Google Ads</option>
                <option value="website">Website</option>
                <option value="aged_lead">Aged Lead</option>
                <option value="ucc_lead">UCC Filing</option>
                <option value="referral">Referral</option>
                <option value="cold_call">Cold Call</option>
                <option value="repeat_customer">Repeat Customer</option>
                <option value="other">Other</option>
              </select>
            </div>

            {/* Urgency */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Urgency
              </label>
              <select
                value={formData.urgency}
                onChange={(e) => setFormData((f) => ({ ...f, urgency: e.target.value }))}
                className="input-field w-full"
              >
                <option value="">Select urgency</option>
                <option value="immediate">Immediate (24-48 hrs)</option>
                <option value="this_week">This Week</option>
                <option value="this_month">This Month</option>
                <option value="exploring">Just Exploring</option>
              </select>
            </div>
          </div>

          {/* Use of Funds */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Use of Funds
            </label>
            <input
              type="text"
              value={formData.use_of_funds}
              onChange={(e) => setFormData((f) => ({ ...f, use_of_funds: e.target.value }))}
              className="input-field w-full"
              placeholder="e.g. Working capital, equipment, payroll, expansion..."
            />
          </div>

          {/* Renewal */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_renewal"
              checked={formData.is_renewal}
              onChange={(e) => setFormData((f) => ({ ...f, is_renewal: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-300"
            />
            <label htmlFor="is_renewal" className="text-sm text-gray-700 dark:text-gray-300">
              This is a renewal deal
            </label>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Notes
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData((f) => ({ ...f, notes: e.target.value }))}
              className="input-field w-full h-20"
              placeholder="Any additional notes..."
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? "Creating..." : "Create Deal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
