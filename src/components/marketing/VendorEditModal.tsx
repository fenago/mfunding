import { useState, useEffect } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";

type VendorStatus = "researching" | "testing" | "active" | "paused" | "discontinued";

interface VendorFormData {
  vendor_name: string;
  website: string;
  description: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  status: VendorStatus;
  lead_types: string[];
  cost_per_lead: string;
  notes: string;
}

interface MarketingVendor {
  id: string;
  vendor_name: string;
  website: string | null;
  description: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  status: VendorStatus;
  lead_types: string[];
  cost_per_lead: number | null;
  leads_purchased: number;
  deals_funded: number;
  total_spend: number;
  total_revenue: number;
  notes: string | null;
}

interface VendorEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  vendor?: MarketingVendor | null;
}

const STATUS_OPTIONS: { value: VendorStatus; label: string }[] = [
  { value: "researching", label: "Researching" },
  { value: "testing", label: "Testing" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "discontinued", label: "Discontinued" },
];

const LEAD_TYPES = [
  { value: "live_transfer", label: "Live Transfer" },
  { value: "aged_lead", label: "Aged Lead" },
  { value: "data_lead", label: "Data Lead" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "web_form", label: "Web Form" },
  { value: "inbound_call", label: "Inbound Call" },
];

const initialFormData: VendorFormData = {
  vendor_name: "",
  website: "",
  description: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  status: "researching",
  lead_types: [],
  cost_per_lead: "",
  notes: "",
};

export default function VendorEditModal({
  isOpen,
  onClose,
  onSave,
  vendor,
}: VendorEditModalProps) {
  const [formData, setFormData] = useState<VendorFormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<"basic" | "pricing" | "notes">("basic");

  useEffect(() => {
    if (vendor) {
      setFormData({
        vendor_name: vendor.vendor_name || "",
        website: vendor.website || "",
        description: vendor.description || "",
        contact_name: vendor.contact_name || "",
        contact_email: vendor.contact_email || "",
        contact_phone: vendor.contact_phone || "",
        status: vendor.status || "researching",
        lead_types: vendor.lead_types || [],
        cost_per_lead: vendor.cost_per_lead?.toString() || "",
        notes: vendor.notes || "",
      });
    } else {
      setFormData(initialFormData);
    }
    setActiveTab("basic");
  }, [vendor, isOpen]);

  const handleLeadTypeToggle = (type: string) => {
    setFormData((prev) => ({
      ...prev,
      lead_types: prev.lead_types.includes(type)
        ? prev.lead_types.filter((t) => t !== type)
        : [...prev.lead_types, type],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.vendor_name.trim()) return;

    setIsSubmitting(true);
    try {
      const payload = {
        vendor_name: formData.vendor_name,
        website: formData.website || null,
        description: formData.description || null,
        contact_name: formData.contact_name || null,
        contact_email: formData.contact_email || null,
        contact_phone: formData.contact_phone || null,
        status: formData.status,
        lead_types: formData.lead_types,
        cost_per_lead: formData.cost_per_lead ? parseFloat(formData.cost_per_lead) : null,
        notes: formData.notes || null,
      };

      if (vendor) {
        const { error } = await supabase
          .from("marketing_vendors")
          .update(payload)
          .eq("id", vendor.id);

        if (error) throw error;
      } else {
        const { error } = await supabase.from("marketing_vendors").insert(payload);

        if (error) throw error;
      }

      onSave();
      onClose();
    } catch (error) {
      console.error("Error saving vendor:", error);
      alert("Failed to save vendor. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const tabs = [
    { id: "basic", label: "Basic Info" },
    { id: "pricing", label: "Pricing & Types" },
    { id: "notes", label: "Notes" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {vendor ? "Edit Vendor" : "Add Vendor"}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 dark:border-gray-700 px-6">
          <nav className="flex gap-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  activeTab === tab.id
                    ? "border-ocean-blue text-ocean-blue"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
            {activeTab === "basic" && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Vendor Name *
                  </label>
                  <input
                    type="text"
                    value={formData.vendor_name}
                    onChange={(e) => setFormData({ ...formData, vendor_name: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Website
                  </label>
                  <input
                    type="url"
                    value={formData.website}
                    onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                    className="input-field"
                    placeholder="https://vendor-website.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="input-field"
                    rows={3}
                    placeholder="What does this vendor offer?"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Status
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as VendorStatus })}
                    className="input-field"
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                    Contact Information
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Name</label>
                      <input
                        type="text"
                        value={formData.contact_name}
                        onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })}
                        className="input-field text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Email</label>
                      <input
                        type="email"
                        value={formData.contact_email}
                        onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                        className="input-field text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Phone</label>
                      <input
                        type="tel"
                        value={formData.contact_phone}
                        onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                        className="input-field text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "pricing" && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Cost Per Lead
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.cost_per_lead}
                      onChange={(e) => setFormData({ ...formData, cost_per_lead: e.target.value })}
                      className="input-field pl-7"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Lead Types Offered
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {LEAD_TYPES.map((type) => (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => handleLeadTypeToggle(type.value)}
                        className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                          formData.lead_types.includes(type.value)
                            ? "bg-ocean-blue text-white border-ocean-blue"
                            : "bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-ocean-blue"
                        }`}
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>
                </div>

                {vendor && (
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                    <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                      Performance Metrics
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                        <p className="text-lg font-semibold text-gray-900 dark:text-white">
                          {vendor.leads_purchased}
                        </p>
                        <p className="text-xs text-gray-500">Leads Purchased</p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                        <p className="text-lg font-semibold text-gray-900 dark:text-white">
                          {vendor.deals_funded}
                        </p>
                        <p className="text-xs text-gray-500">Deals Funded</p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                        <p className="text-lg font-semibold text-gray-900 dark:text-white">
                          ${vendor.total_spend.toLocaleString()}
                        </p>
                        <p className="text-xs text-gray-500">Total Spend</p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                        <p className="text-lg font-semibold text-gray-900 dark:text-white">
                          ${vendor.total_revenue.toLocaleString()}
                        </p>
                        <p className="text-xs text-gray-500">Total Revenue</p>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      * To update metrics, record leads and deals in the Customers module
                    </p>
                  </div>
                )}
              </div>
            )}

            {activeTab === "notes" && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="input-field"
                    rows={10}
                    placeholder="Contract details, pricing tiers, special offers, notes from calls..."
                  />
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !formData.vendor_name.trim()}
              className="btn-primary disabled:opacity-50"
            >
              {isSubmitting ? "Saving..." : vendor ? "Save Changes" : "Add Vendor"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
