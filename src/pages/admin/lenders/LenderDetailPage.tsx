import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeftIcon,
  GlobeAltIcon,
  PhoneIcon,
  EnvelopeIcon,
  UserIcon,
  SparklesIcon,
  ArrowPathIcon,
  CpuChipIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../../supabase";
import LenderContactList from "../../../components/lenders/LenderContactList";
import DocumentUploader from "../../../components/shared/DocumentUploader";
import DocumentList from "../../../components/shared/DocumentList";
import {
  extractLenderInfo,
  fetchWebsiteContent,
  type GeminiModel,
  type LenderExtraction,
} from "../../../lib/gemini";

interface Contact {
  id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  is_primary: boolean;
}

type PaperType = "a_paper" | "b_paper" | "c_paper" | "d_paper";

interface Lender {
  id: string;
  company_name: string;
  website: string | null;
  description: string | null;
  status: string;
  lender_types: string[];
  paper_types: PaperType[];
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  contacts: Contact[];
  commission_type: string | null;
  commission_rate: number | null;
  commission_notes: string | null;
  min_funding_amount: number | null;
  max_funding_amount: number | null;
  min_time_in_business: number | null;
  min_monthly_revenue: number | null;
  min_credit_score: number | null;
  min_daily_balance: number | null;
  funding_speed: string | null;
  factor_rate_range: string | null;
  term_lengths: string | null;
  advance_rate: string | null;
  stacking_policy: string | null;
  requires_collateral: boolean | null;
  industries_restricted: string[] | null;
  industries_preferred: string[] | null;
  states_restricted: string[] | null;
  submission_email: string | null;
  submission_portal_url: string | null;
  submission_notes: string | null;
  notes: string | null;
  created_at: string;
}

interface LenderDocument {
  id: string;
  document_type: string;
  filename: string;
  storage_path: string;
  file_size: number;
  status: string;
  created_at: string;
}

const GEMINI_MODELS: { value: GeminiModel; label: string }[] = [
  { value: "gemini-2.0-flash", label: "Flash (Fast)" },
  { value: "gemini-2.0-pro-exp", label: "Pro (Quality)" },
];

type LenderStatus = "potential" | "application_submitted" | "processing" | "approved" | "live_vendor" | "rejected" | "inactive";

const PAPER_TYPE_CONFIG: Record<PaperType, { label: string; description: string; color: string }> = {
  a_paper: { label: "A Paper", description: "700+ credit, clean", color: "bg-green-100 text-green-800" },
  b_paper: { label: "B Paper", description: "600-699 credit", color: "bg-blue-100 text-blue-800" },
  c_paper: { label: "C Paper", description: "500-599 credit", color: "bg-yellow-100 text-yellow-800" },
  d_paper: { label: "D Paper", description: "Below 500, stacked", color: "bg-red-100 text-red-800" },
};

const STATUS_OPTIONS: { value: LenderStatus; label: string; color: string }[] = [
  { value: "potential", label: "Potential", color: "bg-gray-100 text-gray-800" },
  { value: "application_submitted", label: "Application Submitted", color: "bg-blue-100 text-blue-800" },
  { value: "processing", label: "Processing", color: "bg-yellow-100 text-yellow-800" },
  { value: "approved", label: "Approved", color: "bg-green-100 text-green-800" },
  { value: "live_vendor", label: "Live Vendor", color: "bg-emerald-100 text-emerald-800" },
  { value: "rejected", label: "Rejected", color: "bg-red-100 text-red-800" },
  { value: "inactive", label: "Inactive", color: "bg-gray-100 text-gray-500" },
];

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

const COMMISSION_TYPES = [
  { value: "points", label: "Points (% of funded)" },
  { value: "split", label: "Split" },
  { value: "flat", label: "Flat Fee" },
];

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
  min_daily_balance: string;
  funding_speed: string;
  factor_rate_range: string;
  term_lengths: string;
  advance_rate: string;
  stacking_policy: string;
  requires_collateral: boolean;
  industries_restricted: string;
  industries_preferred: string;
  states_restricted: string;
  submission_email: string;
  submission_portal_url: string;
  submission_notes: string;
  notes: string;
}

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
  min_daily_balance: "",
  funding_speed: "",
  factor_rate_range: "",
  term_lengths: "",
  advance_rate: "",
  stacking_policy: "",
  requires_collateral: false,
  industries_restricted: "",
  industries_preferred: "",
  states_restricted: "",
  submission_email: "",
  submission_portal_url: "",
  submission_notes: "",
  notes: "",
};

export default function LenderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [lender, setLender] = useState<Lender | null>(null);
  const [documents, setDocuments] = useState<LenderDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "contacts" | "documents" | "notes" | "ai">("overview");
  const [documentType, setDocumentType] = useState("agreement");

  // Form state for inline editing
  const [formData, setFormData] = useState<LenderFormData>(initialFormData);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // AI Extraction state
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractSuccess, setExtractSuccess] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<GeminiModel>("gemini-2.0-flash");
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [extractedData, setExtractedData] = useState<LenderExtraction | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isApplyingData, setIsApplyingData] = useState(false);

  useEffect(() => {
    if (id) {
      fetchLender();
      fetchDocuments();
    }
  }, [id]);

  // Sync form data when lender data loads
  useEffect(() => {
    if (lender) {
      setFormData({
        company_name: lender.company_name || "",
        website: lender.website || "",
        description: lender.description || "",
        status: (lender.status as LenderStatus) || "potential",
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
        min_daily_balance: lender.min_daily_balance?.toString() || "",
        funding_speed: lender.funding_speed || "",
        factor_rate_range: lender.factor_rate_range || "",
        term_lengths: lender.term_lengths || "",
        advance_rate: lender.advance_rate || "",
        stacking_policy: lender.stacking_policy || "",
        requires_collateral: lender.requires_collateral || false,
        industries_restricted: lender.industries_restricted?.join(", ") || "",
        industries_preferred: lender.industries_preferred?.join(", ") || "",
        states_restricted: lender.states_restricted?.join(", ") || "",
        submission_email: lender.submission_email || "",
        submission_portal_url: lender.submission_portal_url || "",
        submission_notes: lender.submission_notes || "",
        notes: lender.notes || "",
      });
    }
  }, [lender]);

  const fetchLender = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("lenders")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      console.error("Error fetching lender:", error);
    } else {
      setLender(data);
    }
    setIsLoading(false);
  };

  const fetchDocuments = async () => {
    const { data, error } = await supabase
      .from("lender_documents")
      .select("*")
      .eq("lender_id", id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching documents:", error);
    } else {
      setDocuments(data || []);
    }
  };

  const handleDocumentUploadComplete = () => {
    fetchDocuments();
  };

  const handleDocumentDelete = async (docId: string) => {
    const { error } = await supabase
      .from("lender_documents")
      .delete()
      .eq("id", docId);

    if (error) {
      console.error("Error deleting document:", error);
    } else {
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    }
  };

  const handleAIExtract = async () => {
    if (!lender?.website) {
      setExtractError("No website URL available for this lender");
      return;
    }

    setIsExtracting(true);
    setExtractError(null);
    setExtractSuccess(null);
    setExtractedData(null);

    try {
      let url = lender.website;
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        url = "https://" + url;
      }

      const websiteContent = await fetchWebsiteContent(url);
      const extracted = await extractLenderInfo(websiteContent, selectedModel);

      setExtractedData(extracted);
      setExtractSuccess(`Successfully extracted info using ${selectedModel === "gemini-2.0-flash" ? "Gemini Flash" : "Gemini Pro"}`);
    } catch (error) {
      console.error("Extraction error:", error);
      setExtractError(error instanceof Error ? error.message : "Failed to extract information");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleApplyExtractedData = async () => {
    if (!extractedData || !lender) {
      console.log("No extracted data or lender", { extractedData, lender });
      return;
    }

    setIsApplyingData(true);
    setExtractError(null);

    try {
      const updates: Partial<Lender> = {};

      if (extractedData.company_name) updates.company_name = extractedData.company_name;
      if (extractedData.description) updates.description = extractedData.description;
      if (extractedData.lender_types && extractedData.lender_types.length > 0) {
        updates.lender_types = extractedData.lender_types;
      }
      if (extractedData.paper_types && extractedData.paper_types.length > 0) {
        updates.paper_types = extractedData.paper_types as PaperType[];
      }
      if (extractedData.min_funding_amount) updates.min_funding_amount = extractedData.min_funding_amount;
      if (extractedData.max_funding_amount) updates.max_funding_amount = extractedData.max_funding_amount;
      if (extractedData.min_time_in_business) updates.min_time_in_business = extractedData.min_time_in_business;
      if (extractedData.min_monthly_revenue) updates.min_monthly_revenue = extractedData.min_monthly_revenue;
      if (extractedData.min_credit_score) updates.min_credit_score = extractedData.min_credit_score;
      if (extractedData.min_daily_balance) updates.min_daily_balance = extractedData.min_daily_balance;
      if (extractedData.commission_type) updates.commission_type = extractedData.commission_type;
      if (extractedData.commission_rate) updates.commission_rate = extractedData.commission_rate;
      if (extractedData.commission_notes) updates.commission_notes = extractedData.commission_notes;
      if (extractedData.funding_speed) updates.funding_speed = extractedData.funding_speed;
      if (extractedData.factor_rate_range) updates.factor_rate_range = extractedData.factor_rate_range;
      if (extractedData.term_lengths) updates.term_lengths = extractedData.term_lengths;
      if (extractedData.advance_rate) updates.advance_rate = extractedData.advance_rate;
      if (extractedData.stacking_policy) updates.stacking_policy = extractedData.stacking_policy;
      if (extractedData.requires_collateral !== undefined && extractedData.requires_collateral !== null) {
        updates.requires_collateral = extractedData.requires_collateral;
      }
      if (extractedData.industries_restricted && extractedData.industries_restricted.length > 0) {
        updates.industries_restricted = extractedData.industries_restricted;
      }
      if (extractedData.industries_preferred && extractedData.industries_preferred.length > 0) {
        updates.industries_preferred = extractedData.industries_preferred;
      }
      if (extractedData.states_restricted && extractedData.states_restricted.length > 0) {
        updates.states_restricted = extractedData.states_restricted;
      }
      if (extractedData.submission_email) updates.submission_email = extractedData.submission_email;
      if (extractedData.submission_portal_url) updates.submission_portal_url = extractedData.submission_portal_url;
      if (extractedData.primary_contact_name) updates.primary_contact_name = extractedData.primary_contact_name;
      if (extractedData.primary_contact_email) updates.primary_contact_email = extractedData.primary_contact_email;
      if (extractedData.primary_contact_phone) updates.primary_contact_phone = extractedData.primary_contact_phone;
      if (extractedData.notes) {
        updates.notes = lender.notes
          ? `${lender.notes}\n\n--- AI Extracted (${new Date().toLocaleDateString()}) ---\n${extractedData.notes}`
          : extractedData.notes;
      }

      console.log("Applying updates:", updates);

      if (Object.keys(updates).length === 0) {
        setExtractError("No data to apply");
        return;
      }

      const { error } = await supabase
        .from("lenders")
        .update(updates)
        .eq("id", lender.id);

      if (error) {
        console.error("Supabase error:", error);
        throw error;
      }

      setExtractSuccess("Data applied successfully!");
      setExtractedData(null);
      fetchLender();
    } catch (error) {
      console.error("Error applying data:", error);
      setExtractError(`Failed to apply extracted data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsApplyingData(false);
    }
  };

  const handleStatusChange = async (newStatus: LenderStatus) => {
    if (!lender) return;
    setIsUpdatingStatus(true);

    try {
      const { error } = await supabase
        .from("lenders")
        .update({ status: newStatus })
        .eq("id", lender.id);

      if (error) throw error;
      setFormData((prev) => ({ ...prev, status: newStatus }));
      fetchLender();
    } catch (error) {
      console.error("Error updating status:", error);
      alert("Failed to update status");
    } finally {
      setIsUpdatingStatus(false);
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

  const handleSaveAll = async () => {
    if (!lender) return;
    setIsSaving(true);
    setSaveSuccess(false);

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
        min_daily_balance: formData.min_daily_balance ? parseInt(formData.min_daily_balance) : null,
        funding_speed: formData.funding_speed || null,
        factor_rate_range: formData.factor_rate_range || null,
        term_lengths: formData.term_lengths || null,
        advance_rate: formData.advance_rate || null,
        stacking_policy: formData.stacking_policy || null,
        requires_collateral: formData.requires_collateral || false,
        industries_restricted: formData.industries_restricted ? formData.industries_restricted.split(",").map(s => s.trim()).filter(Boolean) : null,
        industries_preferred: formData.industries_preferred ? formData.industries_preferred.split(",").map(s => s.trim()).filter(Boolean) : null,
        states_restricted: formData.states_restricted ? formData.states_restricted.split(",").map(s => s.trim()).filter(Boolean) : null,
        submission_email: formData.submission_email || null,
        submission_portal_url: formData.submission_portal_url || null,
        submission_notes: formData.submission_notes || null,
        notes: formData.notes || null,
      };

      const { error } = await supabase
        .from("lenders")
        .update(payload)
        .eq("id", lender.id);

      if (error) throw error;
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
      fetchLender();
    } catch (error) {
      console.error("Error saving lender:", error);
      alert("Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  if (!lender) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Lender not found</h2>
          <Link to="/admin/lenders" className="text-ocean-blue hover:underline mt-2 inline-block">
            Back to lenders
          </Link>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "contacts", label: `Contacts (${lender.contacts?.length || 0})` },
    { id: "documents", label: `Documents (${documents.length})` },
    { id: "notes", label: "Notes" },
    { id: "ai", label: "AI Extract" },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/admin/lenders"
          className="inline-flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Back to lenders
        </Link>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {lender.company_name}
              </h1>
              {/* Status Dropdown */}
              <div className="relative">
                <select
                  value={lender.status}
                  onChange={(e) => handleStatusChange(e.target.value as LenderStatus)}
                  disabled={isUpdatingStatus}
                  className={`appearance-none cursor-pointer px-3 py-1 pr-8 text-sm font-medium rounded-full border-0 focus:ring-2 focus:ring-ocean-blue ${
                    STATUS_OPTIONS.find((s) => s.value === lender.status)?.color || "bg-gray-100 text-gray-800"
                  } ${isUpdatingStatus ? "opacity-50" : ""}`}
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                  {isUpdatingStatus ? (
                    <ArrowPathIcon className="w-3 h-3 animate-spin" />
                  ) : (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                </div>
              </div>
            </div>
            {lender.website && (
              <a
                href={lender.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-ocean-blue hover:underline"
              >
                <GlobeAltIcon className="w-4 h-4" />
                {lender.website}
              </a>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* AI Extract Button */}
            {lender.website && (
              <button
                onClick={() => {
                  setActiveTab("ai");
                  handleAIExtract();
                }}
                disabled={isExtracting}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-700 bg-purple-100 hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50 rounded-lg transition-colors"
              >
                {isExtracting ? (
                  <ArrowPathIcon className="w-4 h-4 animate-spin" />
                ) : (
                  <SparklesIcon className="w-4 h-4" />
                )}
                {isExtracting ? "Extracting..." : "AI Extract"}
              </button>
            )}
            {saveSuccess && (
              <span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                <CheckIcon className="w-4 h-4" />
                Saved
              </span>
            )}
            <button
              onClick={handleSaveAll}
              disabled={isSaving}
              className="btn-primary flex items-center gap-2"
            >
              {isSaving ? (
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
              ) : (
                <CheckIcon className="w-4 h-4" />
              )}
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
        <nav className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`pb-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
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

      {/* Tab Content */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Company Info Section */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-ocean-blue rounded-full"></span>
              Company Information
            </h3>

            <div className="grid md:grid-cols-2 gap-4">
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
                  {formData.website && (
                    <a
                      href={formData.website.startsWith("http") ? formData.website : `https://${formData.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center px-3 py-2 bg-ocean-blue text-white rounded-lg hover:bg-ocean-blue/90 transition-colors"
                      title="Open website in new tab"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                    </a>
                  )}
                </div>
              </div>
              <div className="md:col-span-2">
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
            </div>

            {/* Primary Contact */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
              <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <UserIcon className="w-4 h-4 text-gray-400" />
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
                  <div className="relative">
                    <EnvelopeIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="email"
                      value={formData.primary_contact_email}
                      onChange={(e) => setFormData({ ...formData, primary_contact_email: e.target.value })}
                      className="input-field text-sm pl-9"
                      placeholder="john@lender.com"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Phone</label>
                  <div className="relative">
                    <PhoneIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="tel"
                      value={formData.primary_contact_phone}
                      onChange={(e) => setFormData({ ...formData, primary_contact_phone: e.target.value })}
                      className="input-field text-sm pl-9"
                      placeholder="(555) 123-4567"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Products & Paper Types */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-mint-green rounded-full"></span>
              Products & Credit Quality
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Lender Types (Products Offered)
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
                  Paper Types (Credit Quality Tiers)
                </label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {Object.entries(PAPER_TYPE_CONFIG).map(([value, config]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => handlePaperTypeToggle(value as PaperType)}
                      className={`px-3 py-2 text-sm rounded-lg border transition-colors text-left ${
                        formData.paper_types.includes(value as PaperType)
                          ? config.color + " border-2 border-current"
                          : "bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-gray-400"
                      }`}
                    >
                      <span className="font-medium">{config.label}</span>
                      <span className="block text-xs opacity-75">{config.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Funding Requirements */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-teal rounded-full"></span>
              Funding Requirements
            </h3>

            <div className="grid md:grid-cols-2 gap-4 mb-4">
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
          </div>

          {/* Commission Section */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
              Commission Details
            </h3>

            <div className="grid md:grid-cols-2 gap-4 mb-4">
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
                rows={3}
                placeholder="Details about commission structure, tiers, bonuses, etc."
              />
            </div>
          </div>

          {/* Terms & Policies Section */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
              Terms & Policies
            </h3>

            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Funding Speed
                </label>
                <input
                  type="text"
                  value={formData.funding_speed}
                  onChange={(e) => setFormData({ ...formData, funding_speed: e.target.value })}
                  className="input-field"
                  placeholder="e.g. 24-48 hours"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Factor Rate Range
                </label>
                <input
                  type="text"
                  value={formData.factor_rate_range}
                  onChange={(e) => setFormData({ ...formData, factor_rate_range: e.target.value })}
                  className="input-field"
                  placeholder="e.g. 1.15 - 1.45"
                />
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
                  placeholder="e.g. 3-18 months"
                />
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Advance Rate
                </label>
                <input
                  type="text"
                  value={formData.advance_rate}
                  onChange={(e) => setFormData({ ...formData, advance_rate: e.target.value })}
                  className="input-field"
                  placeholder="e.g. Up to 150% of monthly revenue"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Stacking Policy
                </label>
                <input
                  type="text"
                  value={formData.stacking_policy}
                  onChange={(e) => setFormData({ ...formData, stacking_policy: e.target.value })}
                  className="input-field"
                  placeholder="e.g. No stacking, 2nd position OK"
                />
              </div>
              <div className="flex items-end gap-4">
                <div className="flex-1">
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
                      placeholder="0"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 pb-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.requires_collateral}
                    onChange={(e) => setFormData({ ...formData, requires_collateral: e.target.checked })}
                    className="w-4 h-4 text-ocean-blue rounded border-gray-300 focus:ring-ocean-blue"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Requires Collateral</span>
                </label>
              </div>
            </div>
          </div>

          {/* Industry & Geographic Coverage */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-teal-500 rounded-full"></span>
              Industry & Geographic Coverage
            </h3>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Preferred Industries
                </label>
                <input
                  type="text"
                  value={formData.industries_preferred}
                  onChange={(e) => setFormData({ ...formData, industries_preferred: e.target.value })}
                  className="input-field"
                  placeholder="e.g. Construction, Restaurant, Trucking"
                />
                <p className="text-xs text-gray-400 mt-1">Comma-separated list</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Restricted Industries
                </label>
                <input
                  type="text"
                  value={formData.industries_restricted}
                  onChange={(e) => setFormData({ ...formData, industries_restricted: e.target.value })}
                  className="input-field"
                  placeholder="e.g. Cannabis, Adult Entertainment, Gambling"
                />
                <p className="text-xs text-gray-400 mt-1">Comma-separated list</p>
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Restricted States
              </label>
              <input
                type="text"
                value={formData.states_restricted}
                onChange={(e) => setFormData({ ...formData, states_restricted: e.target.value })}
                className="input-field"
                placeholder="e.g. NY, CA, VT"
              />
              <p className="text-xs text-gray-400 mt-1">Comma-separated state abbreviations</p>
            </div>
          </div>

          {/* Deal Submission */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-indigo-500 rounded-full"></span>
              Deal Submission
            </h3>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Submission Email
                </label>
                <input
                  type="email"
                  value={formData.submission_email}
                  onChange={(e) => setFormData({ ...formData, submission_email: e.target.value })}
                  className="input-field"
                  placeholder="deals@lender.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Broker Portal URL
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={formData.submission_portal_url}
                    onChange={(e) => setFormData({ ...formData, submission_portal_url: e.target.value })}
                    className="input-field flex-1"
                    placeholder="https://portal.lender.com"
                  />
                  {formData.submission_portal_url && (
                    <a
                      href={formData.submission_portal_url.startsWith("http") ? formData.submission_portal_url : `https://${formData.submission_portal_url}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-2 bg-ocean-blue text-white rounded-lg hover:bg-ocean-blue/90 text-sm flex items-center gap-1"
                    >
                      <GlobeAltIcon className="w-4 h-4" />
                      Open
                    </a>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Submission Notes
              </label>
              <textarea
                value={formData.submission_notes}
                onChange={(e) => setFormData({ ...formData, submission_notes: e.target.value })}
                className="input-field"
                rows={2}
                placeholder="How to submit deals, required documents, etc."
              />
            </div>
          </div>
        </div>
      )}

      {activeTab === "contacts" && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <LenderContactList
            lenderId={lender.id}
            contacts={lender.contacts || []}
            onUpdate={fetchLender}
          />
        </div>
      )}

      {activeTab === "documents" && (
        <div className="space-y-6">
          {/* Upload Section */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Upload Document</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Document Type
              </label>
              <select
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                className="input-field w-48"
              >
                <option value="agreement">Agreement</option>
                <option value="terms">Terms & Conditions</option>
                <option value="rate_sheet">Rate Sheet</option>
                <option value="commission_schedule">Commission Schedule</option>
                <option value="application_template">Application Template</option>
                <option value="marketing_material">Marketing Material</option>
                <option value="other">Other</option>
              </select>
            </div>
            <DocumentUploader
              entityType="lender"
              entityId={lender.id}
              bucket="lender-documents"
              documentType={documentType}
              onUploadComplete={handleDocumentUploadComplete}
              onError={(error) => alert(error)}
            />
          </div>

          {/* Documents List */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Documents</h3>
            <DocumentList
              documents={documents}
              bucket="lender-documents"
              onDelete={handleDocumentDelete}
              canDelete={true}
              showStatus={true}
            />
          </div>
        </div>
      )}

      {activeTab === "notes" && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 dark:text-white">Notes</h3>
          </div>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            placeholder="Add notes about this lender..."
            rows={12}
            className="input-field w-full resize-y min-h-[200px] font-mono text-sm"
          />
          <p className="text-xs text-gray-500 mt-2">
            Use this space to track important details, conversation history, or any other relevant information about this lender.
            Click "Save Changes" in the header to save your notes.
          </p>
        </div>
      )}

      {activeTab === "ai" && (
        <div className="space-y-6">
          {/* AI Extraction Card */}
          <div className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-xl p-6 border border-purple-200 dark:border-purple-700">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-purple-100 dark:bg-purple-900/50 rounded-lg">
                <SparklesIcon className="w-8 h-8 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  AI Website Extraction
                </h3>
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  Extract or refresh lender information from their website using AI.
                  This will analyze the website content and extract funding details, requirements, and product offerings.
                </p>

                {lender.website ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <GlobeAltIcon className="w-4 h-4" />
                      <a href={lender.website} target="_blank" rel="noopener noreferrer" className="text-ocean-blue hover:underline">
                        {lender.website}
                      </a>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleAIExtract}
                        disabled={isExtracting}
                        className="btn-primary flex items-center gap-2"
                      >
                        {isExtracting ? (
                          <ArrowPathIcon className="w-4 h-4 animate-spin" />
                        ) : (
                          <SparklesIcon className="w-4 h-4" />
                        )}
                        {isExtracting ? "Extracting..." : "Extract from Website"}
                      </button>

                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowModelSelect(!showModelSelect)}
                          className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                          title="Select AI Model"
                        >
                          <CpuChipIcon className="w-5 h-5" />
                        </button>

                        {showModelSelect && (
                          <div className="absolute top-full left-0 mt-1 w-40 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-10">
                            {GEMINI_MODELS.map((model) => (
                              <button
                                key={model.value}
                                onClick={() => {
                                  setSelectedModel(model.value);
                                  setShowModelSelect(false);
                                }}
                                className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 first:rounded-t-lg last:rounded-b-lg ${
                                  selectedModel === model.value
                                    ? "bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                                    : "text-gray-700 dark:text-gray-300"
                                }`}
                              >
                                {model.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {extractError && (
                      <p className="text-sm text-red-600 dark:text-red-400">{extractError}</p>
                    )}
                    {extractSuccess && !extractedData && (
                      <p className="text-sm text-green-600 dark:text-green-400">{extractSuccess}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-amber-600 dark:text-amber-400">
                    No website URL set for this lender. Add a website URL to enable AI extraction.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Extracted Data Preview */}
          {extractedData && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <SparklesIcon className="w-5 h-5 text-purple-500" />
                  Extracted Data Preview
                </h3>
                <button
                  onClick={handleApplyExtractedData}
                  disabled={isApplyingData}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50"
                >
                  {isApplyingData ? (
                    <ArrowPathIcon className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckIcon className="w-4 h-4" />
                  )}
                  {isApplyingData ? "Applying..." : "Apply to Lender"}
                </button>
              </div>

              <div className="space-y-4">
                {extractedData.company_name && (
                  <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
                    <span className="text-gray-500">Company Name</span>
                    <span className="text-gray-900 dark:text-white font-medium">{extractedData.company_name}</span>
                  </div>
                )}
                {extractedData.description && (
                  <div className="py-2 border-b border-gray-100 dark:border-gray-700">
                    <span className="text-gray-500 block mb-1">Description</span>
                    <p className="text-gray-900 dark:text-white">{extractedData.description}</p>
                  </div>
                )}
                {extractedData.lender_types && extractedData.lender_types.length > 0 && (
                  <div className="py-2 border-b border-gray-100 dark:border-gray-700">
                    <span className="text-gray-500 block mb-2">Products Offered</span>
                    <div className="flex flex-wrap gap-2">
                      {extractedData.lender_types.map((type) => (
                        <span key={type} className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded text-sm">
                          {type.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {(extractedData.min_funding_amount || extractedData.max_funding_amount) && (
                  <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
                    <span className="text-gray-500">Funding Range</span>
                    <span className="text-gray-900 dark:text-white font-medium">
                      ${(extractedData.min_funding_amount || 0).toLocaleString()} - ${(extractedData.max_funding_amount || 0).toLocaleString()}
                    </span>
                  </div>
                )}
                {extractedData.min_time_in_business && (
                  <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
                    <span className="text-gray-500">Min Time in Business</span>
                    <span className="text-gray-900 dark:text-white font-medium">{extractedData.min_time_in_business} months</span>
                  </div>
                )}
                {extractedData.min_monthly_revenue && (
                  <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
                    <span className="text-gray-500">Min Monthly Revenue</span>
                    <span className="text-gray-900 dark:text-white font-medium">${extractedData.min_monthly_revenue.toLocaleString()}</span>
                  </div>
                )}
                {extractedData.min_credit_score && (
                  <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
                    <span className="text-gray-500">Min Credit Score</span>
                    <span className="text-gray-900 dark:text-white font-medium">{extractedData.min_credit_score}</span>
                  </div>
                )}
                {extractedData.notes && (
                  <div className="py-2">
                    <span className="text-gray-500 block mb-1">Additional Notes</span>
                    <p className="text-gray-900 dark:text-white">{extractedData.notes}</p>
                  </div>
                )}
              </div>

              {extractSuccess && (
                <p className="text-sm text-green-600 dark:text-green-400 mt-4">{extractSuccess}</p>
              )}
            </div>
          )}

          {/* Last Extraction Info */}
          {lender.notes?.includes("--- AI Extracted") && (
            <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
              <p className="text-sm text-gray-500">
                <SparklesIcon className="w-4 h-4 inline mr-1" />
                This lender has been previously analyzed by AI. Check the Notes tab for extraction history.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
