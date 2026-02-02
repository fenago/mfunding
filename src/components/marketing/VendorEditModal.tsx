import { useState, useEffect } from "react";
import { XMarkIcon, SparklesIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";

type VendorStatus = "researching" | "testing" | "active" | "paused" | "discontinued";

interface PricingProduct {
  product: string;
  price: string;
  minimum: string;
  notes: string;
}

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
  // New enhanced fields
  pricing_products: PricingProduct[];
  minimum_order: string;
  return_policy: string;
  exclusivity: string;
  lead_generation_method: string;
  volume_available: string;
  industries_served: string[];
  additional_services: string[];
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
  // New enhanced fields
  pricing_products: PricingProduct[] | null;
  minimum_order: string | null;
  return_policy: string | null;
  exclusivity: string | null;
  lead_generation_method: string | null;
  volume_available: string | null;
  industries_served: string[] | null;
  additional_services: string[] | null;
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
  { value: "exclusive_lead", label: "Exclusive Lead" },
  { value: "data_lead", label: "Data Lead" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "web_form", label: "Web Form" },
  { value: "web_lead", label: "Web Lead" },
  { value: "inbound_call", label: "Inbound Call" },
  { value: "appointment", label: "Appointment" },
  { value: "ucc_lead", label: "UCC Lead" },
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
  // New enhanced fields
  pricing_products: [],
  minimum_order: "",
  return_policy: "",
  exclusivity: "",
  lead_generation_method: "",
  volume_available: "",
  industries_served: [],
  additional_services: [],
};

export default function VendorEditModal({
  isOpen,
  onClose,
  onSave,
  vendor,
}: VendorEditModalProps) {
  const [formData, setFormData] = useState<VendorFormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<"basic" | "pricing" | "details" | "notes">("basic");
  const [newIndustry, setNewIndustry] = useState("");
  const [newService, setNewService] = useState("");

  const handleScanWebsite = async () => {
    if (!formData.website) {
      setScanMessage({ type: "error", text: "Please enter a website URL first" });
      return;
    }

    // Validate URL
    try {
      new URL(formData.website.startsWith("http") ? formData.website : `https://${formData.website}`);
    } catch {
      setScanMessage({ type: "error", text: "Please enter a valid URL" });
      return;
    }

    setIsScanning(true);
    setScanMessage(null);

    try {
      const url = formData.website.startsWith("http") ? formData.website : `https://${formData.website}`;

      const { data, error } = await supabase.functions.invoke("scan-vendor-website", {
        body: { url },
      });

      if (error) throw error;

      if (data.success && data.data) {
        const extracted = data.data;

        setFormData((prev) => ({
          ...prev,
          vendor_name: extracted.vendor_name || prev.vendor_name,
          description: extracted.description || prev.description,
          contact_name: extracted.contact_name || prev.contact_name,
          contact_email: extracted.contact_email || prev.contact_email,
          contact_phone: extracted.contact_phone || prev.contact_phone,
          lead_types: extracted.lead_types?.length > 0
            ? [...new Set([...prev.lead_types, ...extracted.lead_types])]
            : prev.lead_types,
          cost_per_lead: extracted.cost_per_lead || prev.cost_per_lead,
          notes: extracted.notes
            ? (prev.notes ? `${extracted.notes}\n\n---\n\nPREVIOUS NOTES:\n${prev.notes}` : extracted.notes)
            : prev.notes,
          // New enhanced fields
          pricing_products: extracted.pricing_products?.length > 0
            ? extracted.pricing_products
            : prev.pricing_products,
          minimum_order: extracted.minimum_order || prev.minimum_order,
          return_policy: extracted.return_policy || prev.return_policy,
          exclusivity: extracted.exclusivity || prev.exclusivity,
          lead_generation_method: extracted.lead_generation_method || prev.lead_generation_method,
          volume_available: extracted.volume_available || prev.volume_available,
          industries_served: extracted.industries_served?.length > 0
            ? extracted.industries_served
            : prev.industries_served,
          additional_services: extracted.additional_services?.length > 0
            ? extracted.additional_services
            : prev.additional_services,
        }));

        const productCount = extracted.pricing_products?.length || 0;
        setScanMessage({
          type: "success",
          text: productCount > 0
            ? `Extracted ${productCount} products with pricing! Review all tabs.`
            : "Website scanned successfully! Review the extracted data."
        });

        // Switch to pricing tab if we found products
        setActiveTab(productCount > 0 ? "pricing" : "basic");
      } else {
        throw new Error(data.error || "Failed to extract data");
      }
    } catch (error) {
      console.error("Scan error:", error);
      setScanMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to scan website. Please try again."
      });
    } finally {
      setIsScanning(false);
    }
  };

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
        // New enhanced fields
        pricing_products: vendor.pricing_products || [],
        minimum_order: vendor.minimum_order || "",
        return_policy: vendor.return_policy || "",
        exclusivity: vendor.exclusivity || "",
        lead_generation_method: vendor.lead_generation_method || "",
        volume_available: vendor.volume_available || "",
        industries_served: vendor.industries_served || [],
        additional_services: vendor.additional_services || [],
      });
    } else {
      setFormData(initialFormData);
    }
    setActiveTab("basic");
    setScanMessage(null);
    setIsScanning(false);
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
        // New enhanced fields
        pricing_products: formData.pricing_products.length > 0 ? formData.pricing_products : null,
        minimum_order: formData.minimum_order || null,
        return_policy: formData.return_policy || null,
        exclusivity: formData.exclusivity || null,
        lead_generation_method: formData.lead_generation_method || null,
        volume_available: formData.volume_available || null,
        industries_served: formData.industries_served.length > 0 ? formData.industries_served : null,
        additional_services: formData.additional_services.length > 0 ? formData.additional_services : null,
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
    { id: "pricing", label: "Products & Pricing" },
    { id: "details", label: "Details" },
    { id: "notes", label: "Notes" },
  ];

  // Pricing products management
  const addPricingProduct = () => {
    setFormData((prev) => ({
      ...prev,
      pricing_products: [
        ...prev.pricing_products,
        { product: "", price: "", minimum: "", notes: "" },
      ],
    }));
  };

  const updatePricingProduct = (index: number, field: keyof PricingProduct, value: string) => {
    setFormData((prev) => ({
      ...prev,
      pricing_products: prev.pricing_products.map((p, i) =>
        i === index ? { ...p, [field]: value } : p
      ),
    }));
  };

  const removePricingProduct = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      pricing_products: prev.pricing_products.filter((_, i) => i !== index),
    }));
  };

  // Industries/services management
  const addIndustry = () => {
    if (newIndustry.trim() && !formData.industries_served.includes(newIndustry.trim())) {
      setFormData((prev) => ({
        ...prev,
        industries_served: [...prev.industries_served, newIndustry.trim()],
      }));
      setNewIndustry("");
    }
  };

  const removeIndustry = (industry: string) => {
    setFormData((prev) => ({
      ...prev,
      industries_served: prev.industries_served.filter((i) => i !== industry),
    }));
  };

  const addService = () => {
    if (newService.trim() && !formData.additional_services.includes(newService.trim())) {
      setFormData((prev) => ({
        ...prev,
        additional_services: [...prev.additional_services, newService.trim()],
      }));
      setNewService("");
    }
  };

  const removeService = (service: string) => {
    setFormData((prev) => ({
      ...prev,
      additional_services: prev.additional_services.filter((s) => s !== service),
    }));
  };

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
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={formData.website}
                      onChange={(e) => {
                        setFormData({ ...formData, website: e.target.value });
                        setScanMessage(null);
                      }}
                      className="input-field flex-1"
                      placeholder="https://vendor-website.com"
                    />
                    <button
                      type="button"
                      onClick={handleScanWebsite}
                      disabled={isScanning || !formData.website}
                      className="px-4 py-2 bg-gradient-to-r from-purple-600 to-ocean-blue text-white font-medium rounded-lg hover:from-purple-700 hover:to-ocean-blue/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all"
                      title="Scan website with AI to auto-fill vendor information"
                    >
                      {isScanning ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span className="hidden sm:inline">Scanning...</span>
                        </>
                      ) : (
                        <>
                          <SparklesIcon className="w-4 h-4" />
                          <span className="hidden sm:inline">AI Scan</span>
                        </>
                      )}
                    </button>
                  </div>
                  {scanMessage && (
                    <p className={`text-sm mt-2 ${scanMessage.type === "success" ? "text-green-600" : "text-red-600"}`}>
                      {scanMessage.text}
                    </p>
                  )}
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
                {/* Pricing Products Table */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Products & Pricing
                    </label>
                    <button
                      type="button"
                      onClick={addPricingProduct}
                      className="flex items-center gap-1 text-sm text-ocean-blue hover:text-ocean-blue/80"
                    >
                      <PlusIcon className="w-4 h-4" />
                      Add Product
                    </button>
                  </div>

                  {formData.pricing_products.length === 0 ? (
                    <div className="text-center py-6 bg-gray-50 dark:bg-gray-900 rounded-lg border border-dashed border-gray-300 dark:border-gray-600">
                      <p className="text-sm text-gray-500">No products added yet</p>
                      <button
                        type="button"
                        onClick={addPricingProduct}
                        className="mt-2 text-sm text-ocean-blue hover:text-ocean-blue/80"
                      >
                        + Add your first product
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {formData.pricing_products.map((product, index) => (
                        <div
                          key={index}
                          className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700"
                        >
                          <div className="flex items-start gap-2">
                            <div className="flex-1 grid grid-cols-2 gap-2">
                              <input
                                type="text"
                                value={product.product}
                                onChange={(e) => updatePricingProduct(index, "product", e.target.value)}
                                placeholder="Product name (e.g., Live Transfer)"
                                className="input-field text-sm"
                              />
                              <input
                                type="text"
                                value={product.price}
                                onChange={(e) => updatePricingProduct(index, "price", e.target.value)}
                                placeholder="Price (e.g., $35/lead)"
                                className="input-field text-sm"
                              />
                              <input
                                type="text"
                                value={product.minimum}
                                onChange={(e) => updatePricingProduct(index, "minimum", e.target.value)}
                                placeholder="Minimum order"
                                className="input-field text-sm"
                              />
                              <input
                                type="text"
                                value={product.notes}
                                onChange={(e) => updatePricingProduct(index, "notes", e.target.value)}
                                placeholder="Notes"
                                className="input-field text-sm"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => removePricingProduct(index)}
                              className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                            >
                              <TrashIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Legacy cost per lead (kept for backward compatibility) */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Default Cost Per Lead
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
                  <p className="text-xs text-gray-500 mt-1">
                    Average/default cost for quick reference
                  </p>
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
                      <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                        <p className="text-lg font-semibold text-gray-900 dark:text-white">
                          {vendor.leads_purchased}
                        </p>
                        <p className="text-xs text-gray-500">Leads Purchased</p>
                      </div>
                      <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                        <p className="text-lg font-semibold text-gray-900 dark:text-white">
                          {vendor.deals_funded}
                        </p>
                        <p className="text-xs text-gray-500">Deals Funded</p>
                      </div>
                      <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                        <p className="text-lg font-semibold text-gray-900 dark:text-white">
                          ${vendor.total_spend.toLocaleString()}
                        </p>
                        <p className="text-xs text-gray-500">Total Spend</p>
                      </div>
                      <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
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

            {activeTab === "details" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Minimum Order
                    </label>
                    <input
                      type="text"
                      value={formData.minimum_order}
                      onChange={(e) => setFormData({ ...formData, minimum_order: e.target.value })}
                      className="input-field"
                      placeholder="e.g., 50 leads, $500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Volume Available
                    </label>
                    <input
                      type="text"
                      value={formData.volume_available}
                      onChange={(e) => setFormData({ ...formData, volume_available: e.target.value })}
                      className="input-field"
                      placeholder="e.g., 500/day, 2000/week"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Exclusivity
                    </label>
                    <input
                      type="text"
                      value={formData.exclusivity}
                      onChange={(e) => setFormData({ ...formData, exclusivity: e.target.value })}
                      className="input-field"
                      placeholder="e.g., Exclusive, Shared 3x"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Return Policy
                    </label>
                    <input
                      type="text"
                      value={formData.return_policy}
                      onChange={(e) => setFormData({ ...formData, return_policy: e.target.value })}
                      className="input-field"
                      placeholder="e.g., 100% refund bad data"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Lead Generation Method
                  </label>
                  <textarea
                    value={formData.lead_generation_method}
                    onChange={(e) => setFormData({ ...formData, lead_generation_method: e.target.value })}
                    className="input-field"
                    rows={2}
                    placeholder="How do they generate leads? (SEO, paid ads, call centers, etc.)"
                  />
                </div>

                {/* Industries Served */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Industries Served
                  </label>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={newIndustry}
                      onChange={(e) => setNewIndustry(e.target.value)}
                      onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), addIndustry())}
                      className="input-field flex-1 text-sm"
                      placeholder="Add industry (e.g., MCA, Equipment)"
                    />
                    <button
                      type="button"
                      onClick={addIndustry}
                      className="px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                    >
                      <PlusIcon className="w-4 h-4" />
                    </button>
                  </div>
                  {formData.industries_served.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {formData.industries_served.map((industry) => (
                        <span
                          key={industry}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 text-sm rounded"
                        >
                          {industry}
                          <button
                            type="button"
                            onClick={() => removeIndustry(industry)}
                            className="hover:text-blue-600"
                          >
                            <XMarkIcon className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Additional Services */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Additional Services
                  </label>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={newService}
                      onChange={(e) => setNewService(e.target.value)}
                      onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), addService())}
                      className="input-field flex-1 text-sm"
                      placeholder="Add service (e.g., CRM, Dialer)"
                    />
                    <button
                      type="button"
                      onClick={addService}
                      className="px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                    >
                      <PlusIcon className="w-4 h-4" />
                    </button>
                  </div>
                  {formData.additional_services.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {formData.additional_services.map((service) => (
                        <span
                          key={service}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 text-sm rounded"
                        >
                          {service}
                          <button
                            type="button"
                            onClick={() => removeService(service)}
                            className="hover:text-purple-600"
                          >
                            <XMarkIcon className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
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
