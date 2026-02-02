import { useState, useEffect } from "react";
import {
  XMarkIcon,
  GlobeAltIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../supabase";

type LenderStatus = "potential" | "application_submitted" | "processing" | "approved" | "live_vendor" | "rejected" | "inactive";
type PaperType = "a_paper" | "b_paper" | "c_paper" | "d_paper";

interface LenderFormData {
  company_name: string;
  website: string;
  description: string;
  status: LenderStatus;
  lender_types: string[];
  paper_types: PaperType[];
  funding_products: string[];
  primary_contact_name: string;
  primary_contact_email: string;
  primary_contact_phone: string;
  // Funding range
  min_funding_amount: string;
  max_funding_amount: string;
  // Requirements
  min_time_in_business: string;
  min_monthly_revenue: string;
  min_daily_balance: string;
  min_credit_score: string;
  requires_collateral: boolean;
  // Pricing/Terms
  commission_structure: string;
  factor_rate_range: string;
  term_lengths: string;
  advance_rate: string;
  // Operations
  funding_speed: string;
  stacking_policy: string;
  industries_restricted: string[];
  industries_preferred: string[];
  states_restricted: string[];
  // Submission
  submission_email: string;
  submission_portal_url: string;
  submission_notes: string;
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
  funding_products: string[] | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  min_funding_amount: number | null;
  max_funding_amount: number | null;
  min_time_in_business: number | null;
  min_monthly_revenue: number | null;
  min_daily_balance: number | null;
  min_credit_score: number | null;
  requires_collateral: boolean | null;
  commission_structure: string | null;
  factor_rate_range: string | null;
  term_lengths: string | null;
  advance_rate: string | null;
  funding_speed: string | null;
  stacking_policy: string | null;
  industries_restricted: string[] | null;
  industries_preferred: string[] | null;
  states_restricted: string[] | null;
  submission_email: string | null;
  submission_portal_url: string | null;
  submission_notes: string | null;
  notes: string | null;
}

interface LenderEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  lender?: Lender | null;
}

const FUNDING_PRODUCTS = [
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

const STACKING_OPTIONS = [
  { value: "", label: "Select..." },
  { value: "no_stacking", label: "No Stacking" },
  { value: "2nd_position", label: "2nd Position OK" },
  { value: "will_stack", label: "Will Stack" },
  { value: "case_by_case", label: "Case by Case" },
];

const initialFormData: LenderFormData = {
  company_name: "",
  website: "",
  description: "",
  status: "potential",
  lender_types: [],
  paper_types: [],
  funding_products: [],
  primary_contact_name: "",
  primary_contact_email: "",
  primary_contact_phone: "",
  min_funding_amount: "",
  max_funding_amount: "",
  min_time_in_business: "",
  min_monthly_revenue: "",
  min_daily_balance: "",
  min_credit_score: "",
  requires_collateral: false,
  commission_structure: "",
  factor_rate_range: "",
  term_lengths: "",
  advance_rate: "",
  funding_speed: "",
  stacking_policy: "",
  industries_restricted: [],
  industries_preferred: [],
  states_restricted: [],
  submission_email: "",
  submission_portal_url: "",
  submission_notes: "",
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
  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<"basic" | "requirements" | "terms" | "submission">("basic");

  useEffect(() => {
    if (lender) {
      setFormData({
        company_name: lender.company_name || "",
        website: lender.website || "",
        description: lender.description || "",
        status: lender.status || "potential",
        lender_types: lender.lender_types || [],
        paper_types: lender.paper_types || [],
        funding_products: lender.funding_products || [],
        primary_contact_name: lender.primary_contact_name || "",
        primary_contact_email: lender.primary_contact_email || "",
        primary_contact_phone: lender.primary_contact_phone || "",
        min_funding_amount: lender.min_funding_amount?.toString() || "",
        max_funding_amount: lender.max_funding_amount?.toString() || "",
        min_time_in_business: lender.min_time_in_business?.toString() || "",
        min_monthly_revenue: lender.min_monthly_revenue?.toString() || "",
        min_daily_balance: lender.min_daily_balance?.toString() || "",
        min_credit_score: lender.min_credit_score?.toString() || "",
        requires_collateral: lender.requires_collateral || false,
        commission_structure: lender.commission_structure || "",
        factor_rate_range: lender.factor_rate_range || "",
        term_lengths: lender.term_lengths || "",
        advance_rate: lender.advance_rate || "",
        funding_speed: lender.funding_speed || "",
        stacking_policy: lender.stacking_policy || "",
        industries_restricted: lender.industries_restricted || [],
        industries_preferred: lender.industries_preferred || [],
        states_restricted: lender.states_restricted || [],
        submission_email: lender.submission_email || "",
        submission_portal_url: lender.submission_portal_url || "",
        submission_notes: lender.submission_notes || "",
        notes: lender.notes || "",
      });
    } else {
      setFormData(initialFormData);
    }
    setActiveTab("basic");
    setScanMessage(null);
  }, [lender, isOpen]);

  const handleScanWebsite = async () => {
    if (!formData.website) {
      setScanMessage({ type: "error", text: "Please enter a website URL first" });
      return;
    }

    setIsScanning(true);
    setScanMessage(null);

    try {
      const url = formData.website.startsWith("http") ? formData.website : `https://${formData.website}`;

      const { data, error } = await supabase.functions.invoke("scan-lender-website", {
        body: { url },
      });

      if (error) throw error;

      if (data.success && data.data) {
        const extracted = data.data;

        setFormData((prev) => ({
          ...prev,
          company_name: extracted.company_name || prev.company_name,
          description: extracted.description || prev.description,
          primary_contact_name: extracted.primary_contact_name || prev.primary_contact_name,
          primary_contact_email: extracted.primary_contact_email || prev.primary_contact_email,
          primary_contact_phone: extracted.primary_contact_phone || prev.primary_contact_phone,
          funding_products: extracted.funding_products?.length > 0 ? extracted.funding_products : prev.funding_products,
          min_funding_amount: extracted.min_funding_amount?.toString() || prev.min_funding_amount,
          max_funding_amount: extracted.max_funding_amount?.toString() || prev.max_funding_amount,
          min_time_in_business: extracted.min_time_in_business?.toString() || prev.min_time_in_business,
          min_monthly_revenue: extracted.min_monthly_revenue?.toString() || prev.min_monthly_revenue,
          min_credit_score: extracted.min_credit_score?.toString() || prev.min_credit_score,
          commission_structure: extracted.commission_structure || prev.commission_structure,
          factor_rate_range: extracted.factor_rate_range || prev.factor_rate_range,
          term_lengths: extracted.term_lengths || prev.term_lengths,
          advance_rate: extracted.advance_rate || prev.advance_rate,
          funding_speed: extracted.funding_speed || prev.funding_speed,
          stacking_policy: extracted.stacking_policy || prev.stacking_policy,
          industries_restricted: extracted.industries_restricted?.length > 0 ? extracted.industries_restricted : prev.industries_restricted,
          industries_preferred: extracted.industries_preferred?.length > 0 ? extracted.industries_preferred : prev.industries_preferred,
          states_restricted: extracted.states_restricted?.length > 0 ? extracted.states_restricted : prev.states_restricted,
          submission_email: extracted.submission_email || prev.submission_email,
          submission_portal_url: extracted.submission_portal_url || prev.submission_portal_url,
          notes: extracted.notes
            ? (prev.notes ? `${extracted.notes}\n\n---\n\nPREVIOUS NOTES:\n${prev.notes}` : extracted.notes)
            : prev.notes,
        }));

        setScanMessage({ type: "success", text: "Website scanned! Review the extracted data." });
      } else {
        throw new Error(data.error || "Failed to extract data");
      }
    } catch (error) {
      console.error("Scan error:", error);
      setScanMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to scan website" });
    } finally {
      setIsScanning(false);
    }
  };

  const handleProductToggle = (product: string) => {
    setFormData((prev) => ({
      ...prev,
      funding_products: prev.funding_products.includes(product)
        ? prev.funding_products.filter((p) => p !== product)
        : [...prev.funding_products, product],
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
        funding_products: formData.funding_products,
        primary_contact_name: formData.primary_contact_name || null,
        primary_contact_email: formData.primary_contact_email || null,
        primary_contact_phone: formData.primary_contact_phone || null,
        min_funding_amount: formData.min_funding_amount ? parseFloat(formData.min_funding_amount) : null,
        max_funding_amount: formData.max_funding_amount ? parseFloat(formData.max_funding_amount) : null,
        min_time_in_business: formData.min_time_in_business ? parseInt(formData.min_time_in_business) : null,
        min_monthly_revenue: formData.min_monthly_revenue ? parseFloat(formData.min_monthly_revenue) : null,
        min_daily_balance: formData.min_daily_balance ? parseFloat(formData.min_daily_balance) : null,
        min_credit_score: formData.min_credit_score ? parseInt(formData.min_credit_score) : null,
        requires_collateral: formData.requires_collateral,
        commission_structure: formData.commission_structure || null,
        factor_rate_range: formData.factor_rate_range || null,
        term_lengths: formData.term_lengths || null,
        advance_rate: formData.advance_rate || null,
        funding_speed: formData.funding_speed || null,
        stacking_policy: formData.stacking_policy || null,
        industries_restricted: formData.industries_restricted,
        industries_preferred: formData.industries_preferred,
        states_restricted: formData.states_restricted,
        submission_email: formData.submission_email || null,
        submission_portal_url: formData.submission_portal_url || null,
        submission_notes: formData.submission_notes || null,
        notes: formData.notes || null,
      };

      if (lender) {
        const { error } = await supabase.from("lenders").update(payload).eq("id", lender.id);
        if (error) throw error;
      } else {
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
    { id: "requirements", label: "Requirements" },
    { id: "terms", label: "Terms & Pricing" },
    { id: "submission", label: "Submission" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {lender ? "Edit Lender" : "Add Lender"}
          </h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 dark:border-gray-700 px-6">
          <nav className="flex gap-4 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`py-3 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
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
                {/* Website + AI Scan */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Website
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <GlobeAltIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={formData.website}
                        onChange={(e) => {
                          setFormData({ ...formData, website: e.target.value });
                          setScanMessage(null);
                        }}
                        className="input-field pl-9"
                        placeholder="https://lender-website.com"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleScanWebsite}
                      disabled={isScanning || !formData.website}
                      className="px-4 py-2 bg-gradient-to-r from-purple-600 to-ocean-blue text-white font-medium rounded-lg hover:from-purple-700 hover:to-ocean-blue/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all"
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
                    rows={2}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
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
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Funding Speed
                    </label>
                    <input
                      type="text"
                      value={formData.funding_speed}
                      onChange={(e) => setFormData({ ...formData, funding_speed: e.target.value })}
                      className="input-field"
                      placeholder="Same day, 24-48 hours..."
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Funding Products
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {FUNDING_PRODUCTS.map((product) => (
                      <button
                        key={product.value}
                        type="button"
                        onClick={() => handleProductToggle(product.value)}
                        className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                          formData.funding_products.includes(product.value)
                            ? "bg-ocean-blue text-white border-ocean-blue"
                            : "bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-ocean-blue"
                        }`}
                      >
                        {product.label}
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
                            : "bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600"
                        }`}
                      >
                        <span className="font-medium">{type.label}</span>
                        <span className="block text-xs opacity-75">{type.description}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Contact */}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Primary Contact</h4>
                  <div className="grid grid-cols-3 gap-3">
                    <input
                      type="text"
                      value={formData.primary_contact_name}
                      onChange={(e) => setFormData({ ...formData, primary_contact_name: e.target.value })}
                      className="input-field text-sm"
                      placeholder="Name"
                    />
                    <input
                      type="email"
                      value={formData.primary_contact_email}
                      onChange={(e) => setFormData({ ...formData, primary_contact_email: e.target.value })}
                      className="input-field text-sm"
                      placeholder="Email"
                    />
                    <input
                      type="tel"
                      value={formData.primary_contact_phone}
                      onChange={(e) => setFormData({ ...formData, primary_contact_phone: e.target.value })}
                      className="input-field text-sm"
                      placeholder="Phone"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === "requirements" && (
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

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Min Time in Business (months)
                    </label>
                    <input
                      type="number"
                      value={formData.min_time_in_business}
                      onChange={(e) => setFormData({ ...formData, min_time_in_business: e.target.value })}
                      className="input-field"
                      placeholder="6"
                    />
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
                </div>

                <div className="grid grid-cols-2 gap-4">
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
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Min Daily Balance
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                      <input
                        type="number"
                        value={formData.min_daily_balance}
                        onChange={(e) => setFormData({ ...formData, min_daily_balance: e.target.value })}
                        className="input-field pl-7"
                        placeholder="1000"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Stacking Policy
                    </label>
                    <select
                      value={formData.stacking_policy}
                      onChange={(e) => setFormData({ ...formData, stacking_policy: e.target.value })}
                      className="input-field"
                    >
                      {STACKING_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center pt-6">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.requires_collateral}
                        onChange={(e) => setFormData({ ...formData, requires_collateral: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300 text-ocean-blue focus:ring-ocean-blue"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">Requires Collateral</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Industries Restricted (won't fund)
                  </label>
                  <input
                    type="text"
                    value={formData.industries_restricted.join(", ")}
                    onChange={(e) => setFormData({ ...formData, industries_restricted: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                    className="input-field"
                    placeholder="Gambling, Cannabis, Adult..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Industries Preferred (specialize in)
                  </label>
                  <input
                    type="text"
                    value={formData.industries_preferred.join(", ")}
                    onChange={(e) => setFormData({ ...formData, industries_preferred: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                    className="input-field"
                    placeholder="Restaurants, Retail, Medical..."
                  />
                </div>
              </div>
            )}

            {activeTab === "terms" && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Commission Structure
                  </label>
                  <input
                    type="text"
                    value={formData.commission_structure}
                    onChange={(e) => setFormData({ ...formData, commission_structure: e.target.value })}
                    className="input-field"
                    placeholder="2-4 points, 10% of funded amount..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Factor Rate Range
                    </label>
                    <input
                      type="text"
                      value={formData.factor_rate_range}
                      onChange={(e) => setFormData({ ...formData, factor_rate_range: e.target.value })}
                      className="input-field"
                      placeholder="1.15 - 1.45"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Advance Rate
                    </label>
                    <input
                      type="text"
                      value={formData.advance_rate}
                      onChange={(e) => setFormData({ ...formData, advance_rate: e.target.value })}
                      className="input-field"
                      placeholder="Up to 150% of monthly revenue"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Term Lengths
                  </label>
                  <input
                    type="text"
                    value={formData.term_lengths}
                    onChange={(e) => setFormData({ ...formData, term_lengths: e.target.value })}
                    className="input-field"
                    placeholder="3-18 months"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="input-field"
                    rows={6}
                  />
                </div>
              </div>
            )}

            {activeTab === "submission" && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Submission Email
                  </label>
                  <input
                    type="email"
                    value={formData.submission_email}
                    onChange={(e) => setFormData({ ...formData, submission_email: e.target.value })}
                    className="input-field"
                    placeholder="submissions@lender.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Submission Portal URL
                  </label>
                  <input
                    type="url"
                    value={formData.submission_portal_url}
                    onChange={(e) => setFormData({ ...formData, submission_portal_url: e.target.value })}
                    className="input-field"
                    placeholder="https://portal.lender.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    States Restricted
                  </label>
                  <input
                    type="text"
                    value={formData.states_restricted.join(", ")}
                    onChange={(e) => setFormData({ ...formData, states_restricted: e.target.value.split(",").map(s => s.trim().toUpperCase()).filter(Boolean) })}
                    className="input-field"
                    placeholder="ND, SD, VT..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Submission Notes
                  </label>
                  <textarea
                    value={formData.submission_notes}
                    onChange={(e) => setFormData({ ...formData, submission_notes: e.target.value })}
                    className="input-field"
                    rows={4}
                    placeholder="Required documents, submission process notes..."
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
