import { useState, useEffect } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";

type CustomerStatus = "lead" | "contacted" | "application_submitted" | "in_review" | "approved" | "funded" | "declined" | "follow_up";
type LeadSource = "website" | "live_transfer" | "aged_lead" | "referral" | "cold_call" | "partner" | "marketing" | "other";

interface CustomerFormData {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address_street: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  business_name: string;
  ein: string;
  time_in_business: string;
  monthly_revenue: string;
  industry: string;
  business_type: string;
  status: CustomerStatus;
  lead_source: LeadSource;
  amount_requested: string;
  next_follow_up_date: string;
  follow_up_notes: string;
  notes: string;
}

interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  business_name: string | null;
  ein: string | null;
  time_in_business: number | null;
  monthly_revenue: number | null;
  industry: string | null;
  business_type: string | null;
  status: CustomerStatus;
  lead_source: LeadSource | null;
  amount_requested: number | null;
  next_follow_up_date: string | null;
  follow_up_notes: string | null;
  notes: string | null;
}

interface CustomerEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  customer?: Customer | null;
}

const STATUS_OPTIONS: { value: CustomerStatus; label: string }[] = [
  { value: "lead", label: "Lead" },
  { value: "contacted", label: "Contacted" },
  { value: "application_submitted", label: "Application Submitted" },
  { value: "in_review", label: "In Review" },
  { value: "approved", label: "Approved" },
  { value: "funded", label: "Funded" },
  { value: "declined", label: "Declined" },
  { value: "follow_up", label: "Follow Up" },
];

const LEAD_SOURCE_OPTIONS: { value: LeadSource; label: string }[] = [
  { value: "website", label: "Website" },
  { value: "live_transfer", label: "Live Transfer" },
  { value: "aged_lead", label: "Aged Lead" },
  { value: "referral", label: "Referral" },
  { value: "cold_call", label: "Cold Call" },
  { value: "partner", label: "Partner" },
  { value: "marketing", label: "Marketing" },
  { value: "other", label: "Other" },
];

const BUSINESS_TYPES = [
  "Sole Proprietorship",
  "Partnership",
  "LLC",
  "Corporation",
  "S-Corp",
  "Non-Profit",
];

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

const initialFormData: CustomerFormData = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  address_street: "",
  address_city: "",
  address_state: "",
  address_zip: "",
  business_name: "",
  ein: "",
  time_in_business: "",
  monthly_revenue: "",
  industry: "",
  business_type: "",
  status: "lead",
  lead_source: "website",
  amount_requested: "",
  next_follow_up_date: "",
  follow_up_notes: "",
  notes: "",
};

export default function CustomerEditModal({
  isOpen,
  onClose,
  onSave,
  customer,
}: CustomerEditModalProps) {
  const [formData, setFormData] = useState<CustomerFormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<"contact" | "business" | "funding">("contact");

  useEffect(() => {
    if (customer) {
      setFormData({
        first_name: customer.first_name || "",
        last_name: customer.last_name || "",
        email: customer.email || "",
        phone: customer.phone || "",
        address_street: customer.address_street || "",
        address_city: customer.address_city || "",
        address_state: customer.address_state || "",
        address_zip: customer.address_zip || "",
        business_name: customer.business_name || "",
        ein: customer.ein || "",
        time_in_business: customer.time_in_business?.toString() || "",
        monthly_revenue: customer.monthly_revenue?.toString() || "",
        industry: customer.industry || "",
        business_type: customer.business_type || "",
        status: customer.status || "lead",
        lead_source: customer.lead_source || "website",
        amount_requested: customer.amount_requested?.toString() || "",
        next_follow_up_date: customer.next_follow_up_date?.split("T")[0] || "",
        follow_up_notes: customer.follow_up_notes || "",
        notes: customer.notes || "",
      });
    } else {
      setFormData(initialFormData);
    }
    setActiveTab("contact");
  }, [customer, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.first_name.trim() || !formData.last_name.trim()) return;

    setIsSubmitting(true);
    try {
      const payload = {
        first_name: formData.first_name,
        last_name: formData.last_name,
        email: formData.email || null,
        phone: formData.phone || null,
        address_street: formData.address_street || null,
        address_city: formData.address_city || null,
        address_state: formData.address_state || null,
        address_zip: formData.address_zip || null,
        business_name: formData.business_name || null,
        ein: formData.ein || null,
        time_in_business: formData.time_in_business ? parseInt(formData.time_in_business) : null,
        monthly_revenue: formData.monthly_revenue ? parseFloat(formData.monthly_revenue) : null,
        industry: formData.industry || null,
        business_type: formData.business_type || null,
        status: formData.status,
        lead_source: formData.lead_source || null,
        amount_requested: formData.amount_requested ? parseFloat(formData.amount_requested) : null,
        next_follow_up_date: formData.next_follow_up_date || null,
        follow_up_notes: formData.follow_up_notes || null,
        notes: formData.notes || null,
      };

      if (customer) {
        const { error } = await supabase
          .from("customers")
          .update(payload)
          .eq("id", customer.id);

        if (error) throw error;
      } else {
        const { error } = await supabase.from("customers").insert(payload);

        if (error) throw error;
      }

      onSave();
      onClose();
    } catch (error) {
      console.error("Error saving customer:", error);
      alert("Failed to save customer. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const tabs = [
    { id: "contact", label: "Contact Info" },
    { id: "business", label: "Business Info" },
    { id: "funding", label: "Funding & Follow-up" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {customer ? "Edit Customer" : "Add Customer"}
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
            {activeTab === "contact" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      First Name *
                    </label>
                    <input
                      type="text"
                      value={formData.first_name}
                      onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                      className="input-field"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Last Name *
                    </label>
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
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Email
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Phone
                    </label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="input-field"
                      placeholder="(555) 123-4567"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Street Address
                  </label>
                  <input
                    type="text"
                    value={formData.address_street}
                    onChange={(e) => setFormData({ ...formData, address_street: e.target.value })}
                    className="input-field"
                  />
                </div>

                <div className="grid grid-cols-6 gap-4">
                  <div className="col-span-3">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      City
                    </label>
                    <input
                      type="text"
                      value={formData.address_city}
                      onChange={(e) => setFormData({ ...formData, address_city: e.target.value })}
                      className="input-field"
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      State
                    </label>
                    <select
                      value={formData.address_state}
                      onChange={(e) => setFormData({ ...formData, address_state: e.target.value })}
                      className="input-field"
                    >
                      <option value="">--</option>
                      {US_STATES.map((state) => (
                        <option key={state} value={state}>
                          {state}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      ZIP Code
                    </label>
                    <input
                      type="text"
                      value={formData.address_zip}
                      onChange={(e) => setFormData({ ...formData, address_zip: e.target.value })}
                      className="input-field"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Status
                    </label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as CustomerStatus })}
                      className="input-field"
                    >
                      {STATUS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Lead Source
                    </label>
                    <select
                      value={formData.lead_source}
                      onChange={(e) => setFormData({ ...formData, lead_source: e.target.value as LeadSource })}
                      className="input-field"
                    >
                      {LEAD_SOURCE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "business" && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Business Name
                  </label>
                  <input
                    type="text"
                    value={formData.business_name}
                    onChange={(e) => setFormData({ ...formData, business_name: e.target.value })}
                    className="input-field"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      EIN
                    </label>
                    <input
                      type="text"
                      value={formData.ein}
                      onChange={(e) => setFormData({ ...formData, ein: e.target.value })}
                      className="input-field"
                      placeholder="XX-XXXXXXX"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Business Type
                    </label>
                    <select
                      value={formData.business_type}
                      onChange={(e) => setFormData({ ...formData, business_type: e.target.value })}
                      className="input-field"
                    >
                      <option value="">Select...</option>
                      {BUSINESS_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Industry
                  </label>
                  <input
                    type="text"
                    value={formData.industry}
                    onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
                    className="input-field"
                    placeholder="e.g., Retail, Restaurant, Construction"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Time in Business (months)
                    </label>
                    <input
                      type="number"
                      value={formData.time_in_business}
                      onChange={(e) => setFormData({ ...formData, time_in_business: e.target.value })}
                      className="input-field"
                      placeholder="12"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Monthly Revenue
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input
                        type="number"
                        value={formData.monthly_revenue}
                        onChange={(e) => setFormData({ ...formData, monthly_revenue: e.target.value })}
                        className="input-field pl-7"
                        placeholder="25000"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="input-field"
                    rows={4}
                    placeholder="Additional notes about this customer..."
                  />
                </div>
              </div>
            )}

            {activeTab === "funding" && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Amount Requested
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                    <input
                      type="number"
                      value={formData.amount_requested}
                      onChange={(e) => setFormData({ ...formData, amount_requested: e.target.value })}
                      className="input-field pl-7"
                      placeholder="50000"
                    />
                  </div>
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                    Follow-up Scheduling
                  </h4>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Next Follow-up Date
                    </label>
                    <input
                      type="date"
                      value={formData.next_follow_up_date}
                      onChange={(e) => setFormData({ ...formData, next_follow_up_date: e.target.value })}
                      className="input-field"
                    />
                  </div>
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Follow-up Notes
                    </label>
                    <textarea
                      value={formData.follow_up_notes}
                      onChange={(e) => setFormData({ ...formData, follow_up_notes: e.target.value })}
                      className="input-field"
                      rows={3}
                      placeholder="What should be discussed in the follow-up?"
                    />
                  </div>
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
              disabled={isSubmitting || !formData.first_name.trim() || !formData.last_name.trim()}
              className="btn-primary disabled:opacity-50"
            >
              {isSubmitting ? "Saving..." : customer ? "Save Changes" : "Add Customer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
