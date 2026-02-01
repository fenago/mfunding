import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeftIcon,
  PencilIcon,
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
import LenderEditModal from "../../../components/lenders/LenderEditModal";
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

interface Lender {
  id: string;
  company_name: string;
  website: string | null;
  description: string | null;
  status: string;
  lender_types: string[];
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

const STATUS_OPTIONS: { value: LenderStatus; label: string; color: string }[] = [
  { value: "potential", label: "Potential", color: "bg-gray-100 text-gray-800" },
  { value: "application_submitted", label: "Application Submitted", color: "bg-blue-100 text-blue-800" },
  { value: "processing", label: "Processing", color: "bg-yellow-100 text-yellow-800" },
  { value: "approved", label: "Approved", color: "bg-green-100 text-green-800" },
  { value: "live_vendor", label: "Live Vendor", color: "bg-emerald-100 text-emerald-800" },
  { value: "rejected", label: "Rejected", color: "bg-red-100 text-red-800" },
  { value: "inactive", label: "Inactive", color: "bg-gray-100 text-gray-500" },
];

export default function LenderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [lender, setLender] = useState<Lender | null>(null);
  const [documents, setDocuments] = useState<LenderDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "contacts" | "documents" | "notes" | "ai">("overview");
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [documentType, setDocumentType] = useState("agreement");

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
      if (extractedData.min_funding_amount) updates.min_funding_amount = extractedData.min_funding_amount;
      if (extractedData.max_funding_amount) updates.max_funding_amount = extractedData.max_funding_amount;
      if (extractedData.min_time_in_business) updates.min_time_in_business = extractedData.min_time_in_business;
      if (extractedData.min_monthly_revenue) updates.min_monthly_revenue = extractedData.min_monthly_revenue;
      if (extractedData.min_credit_score) updates.min_credit_score = extractedData.min_credit_score;
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
      fetchLender();
    } catch (error) {
      console.error("Error updating status:", error);
      alert("Failed to update status");
    } finally {
      setIsUpdatingStatus(false);
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
            <button
              onClick={() => setIsEditModalOpen(true)}
              className="btn-primary flex items-center gap-2"
            >
              <PencilIcon className="w-4 h-4" />
              Edit
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
        <div className="grid md:grid-cols-2 gap-6">
          {/* Company Info */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Company Info</h3>

            {lender.description && (
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                {lender.description}
              </p>
            )}

            <div className="space-y-3">
              {lender.primary_contact_name && (
                <div className="flex items-center gap-3">
                  <UserIcon className="w-5 h-5 text-gray-400" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {lender.primary_contact_name}
                  </span>
                </div>
              )}
              {lender.primary_contact_email && (
                <div className="flex items-center gap-3">
                  <EnvelopeIcon className="w-5 h-5 text-gray-400" />
                  <a
                    href={`mailto:${lender.primary_contact_email}`}
                    className="text-sm text-ocean-blue hover:underline"
                  >
                    {lender.primary_contact_email}
                  </a>
                </div>
              )}
              {lender.primary_contact_phone && (
                <div className="flex items-center gap-3">
                  <PhoneIcon className="w-5 h-5 text-gray-400" />
                  <a
                    href={`tel:${lender.primary_contact_phone}`}
                    className="text-sm text-ocean-blue hover:underline"
                  >
                    {lender.primary_contact_phone}
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Funding Details */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Funding Details</h3>

            <div className="space-y-3 text-sm">
              {lender.lender_types && lender.lender_types.length > 0 && (
                <div>
                  <span className="text-gray-500">Products:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {lender.lender_types.map((type) => (
                      <span
                        key={type}
                        className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs"
                      >
                        {type.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {(lender.min_funding_amount || lender.max_funding_amount) && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Funding Range:</span>
                  <span className="text-gray-900 dark:text-white">
                    ${lender.min_funding_amount?.toLocaleString() || "0"} - $
                    {lender.max_funding_amount?.toLocaleString() || "∞"}
                  </span>
                </div>
              )}

              {lender.commission_rate && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Commission:</span>
                  <span className="text-gray-900 dark:text-white">
                    {lender.commission_rate}% {lender.commission_type}
                  </span>
                </div>
              )}

              {lender.min_time_in_business && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Min Time in Business:</span>
                  <span className="text-gray-900 dark:text-white">
                    {lender.min_time_in_business} months
                  </span>
                </div>
              )}

              {lender.min_monthly_revenue && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Min Monthly Revenue:</span>
                  <span className="text-gray-900 dark:text-white">
                    ${lender.min_monthly_revenue.toLocaleString()}
                  </span>
                </div>
              )}

              {lender.min_credit_score && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Min Credit Score:</span>
                  <span className="text-gray-900 dark:text-white">
                    {lender.min_credit_score}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Commission Details */}
          {(lender.commission_rate || lender.commission_notes) && (
            <div className="md:col-span-2 bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Commission Details</h3>
              <div className="space-y-2">
                {lender.commission_rate && (
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    <strong>Rate:</strong> {lender.commission_rate}% ({lender.commission_type || "points"})
                  </p>
                )}
                {lender.commission_notes && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                    {lender.commission_notes}
                  </p>
                )}
              </div>
            </div>
          )}
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
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Notes</h3>
          {lender.notes ? (
            <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{lender.notes}</p>
          ) : (
            <p className="text-gray-500">No notes yet. Click Edit to add notes.</p>
          )}
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

      {/* Edit Modal */}
      <LenderEditModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSave={fetchLender}
        lender={lender as Parameters<typeof LenderEditModal>[0]["lender"]}
      />
    </div>
  );
}
