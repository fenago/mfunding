import { useState, useEffect } from "react";
import {
  XMarkIcon,
  GlobeAltIcon,
  ArrowPathIcon,
  SparklesIcon,
  CpuChipIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import {
  extractLenderInfo,
  fetchWebsiteContent,
  type GeminiModel,
} from "../../lib/gemini";

type LenderStatus = "potential" | "application_submitted" | "processing" | "approved" | "live_vendor" | "rejected" | "inactive";

type PaperType = "a_paper" | "b_paper" | "c_paper" | "d_paper";

interface LenderFormData {
  company_name: string;
  website: string;
  description: string;
  status: LenderStatus;
  lender_types: string[];
  paper_types: PaperType[];
  primary_contact_name: string;
  primary_contact_email: string;
  primary_contact_phone: string;
  commission_type: string;
  commission_rate: string;
  commission_notes: string;
  min_funding_amount: string;
  max_funding_amount: string;
  min_time_in_business: string;
  min_monthly_revenue: string;
  min_credit_score: string;
  notes: string;
}

interface Lender {
  id: string;
  company_name: string;
  website: string | null;
  description: string | null;
  status: LenderStatus;
  lender_types: string[];
  paper_types: PaperType[];
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  commission_type: string | null;
  commission_rate: number | null;
  commission_notes: string | null;
  min_funding_amount: number | null;
  max_funding_amount: number | null;
  min_time_in_business: number | null;
  min_monthly_revenue: number | null;
  min_credit_score: number | null;
  notes: string | null;
}

interface LenderEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  lender?: Lender | null;
}

const LENDER_TYPES = [
  { value: "mca", label: "MCA" },
  { value: "term_loan", label: "Term Loan" },
  { value: "line_of_credit", label: "Line of Credit" },
  { value: "equipment_financing", label: "Equipment Financing" },
  { value: "invoice_factoring", label: "Invoice Factoring" },
  { value: "sba_loan", label: "SBA Loan" },
  { value: "revenue_based", label: "Revenue Based" },
  { value: "real_estate", label: "Real Estate" },
];

const PAPER_TYPES: { value: PaperType; label: string; description: string; color: string }[] = [
  { value: "a_paper", label: "A Paper", description: "700+ credit, clean", color: "bg-green-100 text-green-800 border-green-300" },
  { value: "b_paper", label: "B Paper", description: "600-699 credit", color: "bg-blue-100 text-blue-800 border-blue-300" },
  { value: "c_paper", label: "C Paper", description: "500-599 credit", color: "bg-yellow-100 text-yellow-800 border-yellow-300" },
  { value: "d_paper", label: "D Paper", description: "Below 500, stacked", color: "bg-red-100 text-red-800 border-red-300" },
];

const STATUS_OPTIONS: { value: LenderStatus; label: string }[] = [
  { value: "potential", label: "Potential" },
  { value: "application_submitted", label: "Application Submitted" },
  { value: "processing", label: "Processing" },
  { value: "approved", label: "Approved" },
  { value: "live_vendor", label: "Live Vendor" },
  { value: "rejected", label: "Rejected" },
  { value: "inactive", label: "Inactive" },
];

const COMMISSION_TYPES = [
  { value: "points", label: "Points (% of funded)" },
  { value: "split", label: "Split" },
  { value: "flat", label: "Flat Fee" },
];

const GEMINI_MODELS: { value: GeminiModel; label: string }[] = [
  { value: "gemini-2.0-flash", label: "Gemini Flash (Fast)" },
  { value: "gemini-2.0-pro-exp", label: "Gemini Pro (Better)" },
];

const initialFormData: LenderFormData = {
  company_name: "",
  website: "",
  description: "",
  status: "potential",
  lender_types: [],
  paper_types: [],
  primary_contact_name: "",
  primary_contact_email: "",
  primary_contact_phone: "",
  commission_type: "points",
  commission_rate: "",
  commission_notes: "",
  min_funding_amount: "",
  max_funding_amount: "",
  min_time_in_business: "",
  min_monthly_revenue: "",
  min_credit_score: "",
  notes: "",
};

export default function LenderEditModal({
  isOpen,
  onClose,
  onSave,
  lender,
}: LenderEditModalProps) {
  const [formData, setFormData] = useState<LenderFormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractSuccess, setExtractSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"basic" | "funding" | "commission">("basic");
  const [selectedModel, setSelectedModel] = useState<GeminiModel>("gemini-2.0-flash");
  const [showModelSelect, setShowModelSelect] = useState(false);

  useEffect(() => {
    if (lender) {
      setFormData({
        company_name: lender.company_name || "",
        website: lender.website || "",
        description: lender.description || "",
        status: lender.status || "potential",
        lender_types: lender.lender_types || [],
        paper_types: lender.paper_types || [],
        primary_contact_name: lender.primary_contact_name || "",
        primary_contact_email: lender.primary_contact_email || "",
        primary_contact_phone: lender.primary_contact_phone || "",
        commission_type: lender.commission_type || "points",
        commission_rate: lender.commission_rate?.toString() || "",
        commission_notes: lender.commission_notes || "",
        min_funding_amount: lender.min_funding_amount?.toString() || "",
        max_funding_amount: lender.max_funding_amount?.toString() || "",
        min_time_in_business: lender.min_time_in_business?.toString() || "",
        min_monthly_revenue: lender.min_monthly_revenue?.toString() || "",
        min_credit_score: lender.min_credit_score?.toString() || "",
        notes: lender.notes || "",
      });
    } else {
      setFormData(initialFormData);
    }
    setActiveTab("basic");
    setExtractError(null);
    setExtractSuccess(null);
  }, [lender, isOpen]);

  const handleExtractFromUrl = async () => {
    if (!formData.website) {
      setExtractError("Please enter a website URL first");
      return;
    }

    setIsExtracting(true);
    setExtractError(null);
    setExtractSuccess(null);

    try {
      // Normalize the URL
      let url = formData.website;
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        url = "https://" + url;
      }

      // Update the URL field with normalized URL
      setFormData((prev) => ({ ...prev, website: url }));

      // Fetch website content
      const websiteContent = await fetchWebsiteContent(url);

      // Extract info using Gemini AI
      const extracted = await extractLenderInfo(websiteContent, selectedModel);

      // Update form with extracted data (only fill in empty fields or improve existing)
      setFormData((prev) => ({
        ...prev,
        company_name: extracted.company_name || prev.company_name,
        description: extracted.description || prev.description,
        lender_types: extracted.lender_types && extracted.lender_types.length > 0
          ? extracted.lender_types
          : prev.lender_types,
        min_funding_amount: extracted.min_funding_amount?.toString() || prev.min_funding_amount,
        max_funding_amount: extracted.max_funding_amount?.toString() || prev.max_funding_amount,
        min_time_in_business: extracted.min_time_in_business?.toString() || prev.min_time_in_business,
        min_monthly_revenue: extracted.min_monthly_revenue?.toString() || prev.min_monthly_revenue,
        min_credit_score: extracted.min_credit_score?.toString() || prev.min_credit_score,
        notes: extracted.notes
          ? prev.notes
            ? `${prev.notes}\n\n--- AI Extracted ---\n${extracted.notes}`
            : extracted.notes
          : prev.notes,
      }));

      setExtractSuccess(`Successfully extracted info using ${selectedModel === "gemini-2.0-flash" ? "Gemini Flash" : "Gemini Pro"}`);
    } catch (error) {
      console.error("Extraction error:", error);
      setExtractError(error instanceof Error ? error.message : "Failed to extract information");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleLenderTypeToggle = (type: string) => {
    setFormData((prev) => ({
      ...prev,
      lender_types: prev.lender_types.includes(type)
        ? prev.lender_types.filter((t) => t !== type)
        : [...prev.lender_types, type],
    }));
  };

  const handlePaperTypeToggle = (type: PaperType) => {
    setFormData((prev) => ({
      ...prev,
      paper_types: prev.paper_types.includes(type)
        ? prev.paper_types.filter((t) => t !== type)
        : [...prev.paper_types, type],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.company_name.trim()) return;

    setIsSubmitting(true);
    try {
      const payload = {
        company_name: formData.company_name,
        website: formData.website || null,
        description: formData.description || null,
        status: formData.status,
        lender_types: formData.lender_types,
        paper_types: formData.paper_types,
        primary_contact_name: formData.primary_contact_name || null,
        primary_contact_email: formData.primary_contact_email || null,
        primary_contact_phone: formData.primary_contact_phone || null,
        commission_type: formData.commission_type || null,
        commission_rate: formData.commission_rate ? parseFloat(formData.commission_rate) : null,
        commission_notes: formData.commission_notes || null,
        min_funding_amount: formData.min_funding_amount ? parseFloat(formData.min_funding_amount) : null,
        max_funding_amount: formData.max_funding_amount ? parseFloat(formData.max_funding_amount) : null,
        min_time_in_business: formData.min_time_in_business ? parseInt(formData.min_time_in_business) : null,
        min_monthly_revenue: formData.min_monthly_revenue ? parseFloat(formData.min_monthly_revenue) : null,
        min_credit_score: formData.min_credit_score ? parseInt(formData.min_credit_score) : null,
        notes: formData.notes || null,
      };

      if (lender) {
        // Update existing lender
        const { error } = await supabase
          .from("lenders")
          .update(payload)
          .eq("id", lender.id);

        if (error) throw error;
      } else {
        // Create new lender
        const { error } = await supabase.from("lenders").insert(payload);

        if (error) throw error;
      }

      onSave();
      onClose();
    } catch (error) {
      console.error("Error saving lender:", error);
      alert("Failed to save lender. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const tabs = [
    { id: "basic", label: "Basic Info" },
    { id: "funding", label: "Funding Details" },
    { id: "commission", label: "Commission" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {lender ? "Edit Lender" : "Add Lender"}
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
                {/* URL Extraction with AI */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Website URL
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <GlobeAltIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={formData.website}
                        onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                        placeholder="https://lender-website.com"
                        className="input-field pl-9"
                      />
                    </div>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={handleExtractFromUrl}
                        disabled={isExtracting || !formData.website}
                        className="btn-primary flex items-center gap-2 whitespace-nowrap disabled:opacity-50"
                      >
                        {isExtracting ? (
                          <ArrowPathIcon className="w-4 h-4 animate-spin" />
                        ) : (
                          <SparklesIcon className="w-4 h-4" />
                        )}
                        {isExtracting ? "Extracting..." : "AI Extract"}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowModelSelect(!showModelSelect)}
                      className="p-2 text-gray-500 hover:text-ocean-blue border border-gray-300 dark:border-gray-600 rounded-lg hover:border-ocean-blue"
                      title="Select AI Model"
                    >
                      <CpuChipIcon className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Model Selector Dropdown */}
                  {showModelSelect && (
                    <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                      <label className="block text-xs font-medium text-gray-500 mb-2">
                        AI Model Selection
                      </label>
                      <div className="flex gap-2">
                        {GEMINI_MODELS.map((model) => (
                          <button
                            key={model.value}
                            type="button"
                            onClick={() => {
                              setSelectedModel(model.value);
                              setShowModelSelect(false);
                            }}
                            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                              selectedModel === model.value
                                ? "bg-ocean-blue text-white border-ocean-blue"
                                : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-ocean-blue"
                            }`}
                          >
                            {model.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {extractError && (
                    <p className="text-sm mt-1 text-red-500">
                      {extractError}
                    </p>
                  )}
                  {extractSuccess && (
                    <p className="text-sm mt-1 text-green-600">
                      {extractSuccess}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Company Name *
                  </label>
                  <input
                    type="text"
                    value={formData.company_name}
                    onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                    className="input-field"
                    required
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
                    placeholder="What products do they offer? What makes them unique?"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Status
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as LenderStatus })}
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Lender Types
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {LENDER_TYPES.map((type) => (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => handleLenderTypeToggle(type.value)}
                        className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                          formData.lender_types.includes(type.value)
                            ? "bg-ocean-blue text-white border-ocean-blue"
                            : "bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-ocean-blue"
                        }`}
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Paper Types (Credit Quality)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {PAPER_TYPES.map((type) => (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => handlePaperTypeToggle(type.value)}
                        className={`px-3 py-2 text-sm rounded-lg border transition-colors text-left ${
                          formData.paper_types.includes(type.value)
                            ? type.color + " border-2"
                            : "bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-gray-400"
                        }`}
                      >
                        <span className="font-medium">{type.label}</span>
                        <span className="block text-xs opacity-75">{type.description}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                    Primary Contact
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Name</label>
                      <input
                        type="text"
                        value={formData.primary_contact_name}
                        onChange={(e) => setFormData({ ...formData, primary_contact_name: e.target.value })}
                        className="input-field text-sm"
                        placeholder="John Smith"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Email</label>
                      <input
                        type="email"
                        value={formData.primary_contact_email}
                        onChange={(e) => setFormData({ ...formData, primary_contact_email: e.target.value })}
                        className="input-field text-sm"
                        placeholder="john@lender.com"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Phone</label>
                      <input
                        type="tel"
                        value={formData.primary_contact_phone}
                        onChange={(e) => setFormData({ ...formData, primary_contact_phone: e.target.value })}
                        className="input-field text-sm"
                        placeholder="(555) 123-4567"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "funding" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Min Funding Amount
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input
                        type="number"
                        value={formData.min_funding_amount}
                        onChange={(e) => setFormData({ ...formData, min_funding_amount: e.target.value })}
                        className="input-field pl-7"
                        placeholder="5000"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Max Funding Amount
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input
                        type="number"
                        value={formData.max_funding_amount}
                        onChange={(e) => setFormData({ ...formData, max_funding_amount: e.target.value })}
                        className="input-field pl-7"
                        placeholder="500000"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Min Time in Business
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={formData.min_time_in_business}
                        onChange={(e) => setFormData({ ...formData, min_time_in_business: e.target.value })}
                        className="input-field pr-16"
                        placeholder="6"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">months</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Min Monthly Revenue
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input
                        type="number"
                        value={formData.min_monthly_revenue}
                        onChange={(e) => setFormData({ ...formData, min_monthly_revenue: e.target.value })}
                        className="input-field pl-7"
                        placeholder="15000"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Min Credit Score
                    </label>
                    <input
                      type="number"
                      value={formData.min_credit_score}
                      onChange={(e) => setFormData({ ...formData, min_credit_score: e.target.value })}
                      className="input-field"
                      placeholder="500"
                    />
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
                    placeholder="Additional notes about this lender's requirements, preferences, etc."
                  />
                </div>
              </div>
            )}

            {activeTab === "commission" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Commission Type
                    </label>
                    <select
                      value={formData.commission_type}
                      onChange={(e) => setFormData({ ...formData, commission_type: e.target.value })}
                      className="input-field"
                    >
                      {COMMISSION_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Commission Rate
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.1"
                        value={formData.commission_rate}
                        onChange={(e) => setFormData({ ...formData, commission_rate: e.target.value })}
                        className="input-field pr-8"
                        placeholder="10"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">%</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Commission Notes
                  </label>
                  <textarea
                    value={formData.commission_notes}
                    onChange={(e) => setFormData({ ...formData, commission_notes: e.target.value })}
                    className="input-field"
                    rows={4}
                    placeholder="Details about commission structure, tiers, bonuses, etc."
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
              disabled={isSubmitting || !formData.company_name.trim()}
              className="btn-primary disabled:opacity-50"
            >
              {isSubmitting ? "Saving..." : lender ? "Save Changes" : "Add Lender"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
