import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeftIcon,
  PencilIcon,
  PaperAirplaneIcon,
  PhoneIcon,
  EnvelopeIcon,
  CurrencyDollarIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  DocumentCheckIcon,
} from "@heroicons/react/24/outline";
import { CheckCircleIcon as CheckCircleSolid } from "@heroicons/react/24/solid";
import supabase from "../../../supabase";
import { getDealById, updateDealStatus, submitToFunder, updateSubmission } from "../../../services/dealService";
import { getMatchingLenders } from "../../../services/lenderMatchingService";
import type { DealWithCustomer, DealSubmissionWithLender, DealStatus, SubmissionStatus } from "../../../types/deals";
import {
  DEAL_STAGES,
  DEAL_STATUS_CONFIG,
  DEAL_TYPE_CONFIG,
  MARKET_CONFIG,
  SUBMISSION_STATUS_CONFIG,
} from "../../../types/deals";
import InteractionTimeline from "../../../components/shared/InteractionTimeline";
import { useActivityLog } from "../../../hooks/useActivityLog";

// Required stip document types for a deal
const REQUIRED_STIPS = [
  { key: "bank_statement", label: "Bank Statements (3-6 months)" },
  { key: "application", label: "Signed Application" },
  { key: "id", label: "Driver's License / ID" },
  { key: "voided_check", label: "Voided Check" },
  { key: "credit_authorization", label: "Credit Authorization" },
];

export default function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [deal, setDeal] = useState<DealWithCustomer | null>(null);
  const [submissions, setSubmissions] = useState<DealSubmissionWithLender[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "submissions" | "documents" | "activity" | "notes">("overview");
  const [matchingLenders, setMatchingLenders] = useState<{ id: string; company_name: string; score: number; reasons: string[] }[]>([]);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submittingLenderId, setSubmittingLenderId] = useState<string | null>(null);
  const [submitNotes, setSubmitNotes] = useState("");
  const [documents, setDocuments] = useState<{ id: string; document_type: string; filename: string; status: string }[]>([]);
  const [noteText, setNoteText] = useState("");
  const { activities, isLoading: isLoadingActivities, addActivity } = useActivityLog("customer", deal?.customer_id);

  useEffect(() => {
    if (id) fetchDeal();
  }, [id]);

  useEffect(() => {
    if (deal?.customer_id) fetchDocuments();
  }, [deal?.customer_id]);

  const fetchDeal = async () => {
    if (!id) return;
    setIsLoading(true);
    const result = await getDealById(id);
    if (result) {
      setDeal(result.deal);
      setSubmissions(result.submissions);
      // Fetch matching lenders
      if (result.deal.customer) {
        const matches = await getMatchingLenders({
          deal_type: result.deal.deal_type,
          amount_requested: result.deal.amount_requested,
          monthly_revenue: result.deal.customer.monthly_revenue,
          time_in_business: result.deal.customer.time_in_business,
          industry: result.deal.customer.industry,
        });
        setMatchingLenders(matches);
      }
    }
    setIsLoading(false);
  };

  const fetchDocuments = async () => {
    if (!deal?.customer_id) return;
    const { data } = await supabase
      .from("customer_documents")
      .select("id, document_type, filename, status")
      .eq("customer_id", deal.customer_id)
      .order("created_at", { ascending: false });
    setDocuments(data || []);
  };

  const handleStatusChange = async (newStatus: DealStatus) => {
    if (!id) return;
    try {
      const updated = await updateDealStatus(id, newStatus);
      setDeal((prev) => (prev ? { ...prev, ...updated } : null));
    } catch {
      console.error("Failed to update status");
    }
  };

  const handleSubmitToFunder = async () => {
    if (!id || !submittingLenderId) return;
    try {
      await submitToFunder(id, submittingLenderId, submitNotes);
      setShowSubmitModal(false);
      setSubmittingLenderId(null);
      setSubmitNotes("");
      fetchDeal();
    } catch {
      console.error("Failed to submit to funder");
    }
  };

  const handleUpdateSubmissionStatus = async (submissionId: string, newStatus: SubmissionStatus) => {
    try {
      await updateSubmission(submissionId, { status: newStatus });
      fetchDeal();
    } catch {
      console.error("Failed to update submission");
    }
  };

  const handleAddNote = async () => {
    if (!noteText.trim() || !deal?.customer_id) return;
    try {
      await addActivity({
        interaction_type: "note",
        subject: `Deal ${deal.deal_number || ""}`,
        content: noteText,
      });
      setNoteText("");
    } catch {
      console.error("Failed to add note");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Deal not found</h2>
          <Link to="/admin/deals" className="text-ocean-blue hover:underline mt-2 inline-block">
            Back to deals
          </Link>
        </div>
      </div>
    );
  }

  const statusConfig = DEAL_STATUS_CONFIG[deal.status];
  const typeConfig = DEAL_TYPE_CONFIG[deal.deal_type];
  const marketConfig = deal.market ? MARKET_CONFIG[deal.market] : null;

  // Determine current stage index for the stepper
  const currentStageIndex = DEAL_STAGES.findIndex((s) => s.key === deal.status);
  const isTerminal = ["declined", "dead", "renewal_eligible"].includes(deal.status);

  // Offers that have amounts (for comparison table)
  const offersWithAmounts = submissions.filter(
    (s) => s.offer_amount && ["offer_made", "offer_accepted", "approved"].includes(s.status)
  );

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "submissions", label: `Submissions (${submissions.length})` },
    { id: "documents", label: `Documents (${documents.length})` },
    { id: "activity", label: `Activity (${activities.length})` },
    { id: "notes", label: "Notes" },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/admin/deals"
          className="inline-flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Back to deals
        </Link>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {deal.deal_number || "New Deal"}
              </h1>
              <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${statusConfig.bgColor} ${statusConfig.color}`}>
                {statusConfig.label}
              </span>
              <span className="px-2 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                {typeConfig.shortLabel}
              </span>
            </div>
            <p className="text-gray-500 dark:text-gray-400">
              {deal.customer?.first_name} {deal.customer?.last_name}
              {deal.customer?.business_name && ` - ${deal.customer.business_name}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {deal.customer && (
              <Link
                to={`/admin/customers/${deal.customer_id}`}
                className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                View Customer
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Stage Progression Timeline */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 mb-6">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">Deal Progress</h3>
        <div className="flex items-center justify-between">
          {DEAL_STAGES.map((stage, index) => {
            const isCompleted = !isTerminal && index < currentStageIndex;
            const isCurrent = stage.key === deal.status;

            return (
              <div key={stage.key} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center">
                  <button
                    onClick={() => handleStatusChange(stage.key)}
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                      isCurrent
                        ? "bg-ocean-blue text-white ring-4 ring-blue-100 dark:ring-blue-900"
                        : isCompleted
                        ? "bg-green-500 text-white"
                        : "bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-500"
                    }`}
                    title={`Move to: ${stage.label}`}
                  >
                    {isCompleted ? (
                      <CheckCircleSolid className="w-5 h-5" />
                    ) : (
                      index + 1
                    )}
                  </button>
                  <span
                    className={`mt-2 text-xs text-center whitespace-nowrap ${
                      isCurrent
                        ? "font-semibold text-ocean-blue"
                        : isCompleted
                        ? "text-green-600"
                        : "text-gray-400"
                    }`}
                  >
                    {stage.label}
                  </span>
                </div>
                {index < DEAL_STAGES.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-2 mt-[-1rem] ${
                      isCompleted ? "bg-green-500" : "bg-gray-200 dark:bg-gray-600"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
        {isTerminal && (
          <div className="mt-4 flex items-center gap-2">
            <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${statusConfig.bgColor} ${statusConfig.color}`}>
              {deal.status === "declined" && <XCircleIcon className="w-4 h-4 mr-1" />}
              {deal.status === "renewal_eligible" && <CheckCircleIcon className="w-4 h-4 mr-1" />}
              {statusConfig.label}
            </span>
            <button
              onClick={() => handleStatusChange("new")}
              className="text-xs text-ocean-blue hover:underline"
            >
              Reset to New
            </button>
          </div>
        )}
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

      {/* Tab: Overview */}
      {activeTab === "overview" && (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Deal Info */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Deal Details</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Deal Number:</span>
                <span className="font-mono text-gray-900 dark:text-white">{deal.deal_number || "-"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Product Type:</span>
                <span className="text-gray-900 dark:text-white">{typeConfig.label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Amount Requested:</span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {deal.amount_requested ? `$${deal.amount_requested.toLocaleString()}` : "-"}
                </span>
              </div>
              {deal.amount_funded && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Amount Funded:</span>
                  <span className="font-medium text-green-600">${deal.amount_funded.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Market:</span>
                <span className="text-gray-900 dark:text-white">{marketConfig?.label || "-"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Lead Source:</span>
                <span className="text-gray-900 dark:text-white">{deal.lead_source?.replace(/_/g, " ") || "-"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Use of Funds:</span>
                <span className="text-gray-900 dark:text-white">{deal.use_of_funds || "-"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Urgency:</span>
                <span className="text-gray-900 dark:text-white">{deal.urgency || "-"}</span>
              </div>
              {deal.is_renewal && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Renewal #:</span>
                  <span className="text-teal-600 font-medium">{deal.renewal_count}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Closer:</span>
                <span className="text-gray-900 dark:text-white">
                  {deal.closer
                    ? `${deal.closer.first_name || ""} ${deal.closer.last_name || ""}`.trim()
                    : "Unassigned"}
                </span>
              </div>
            </div>
          </div>

          {/* Customer Info */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Customer</h3>
            {deal.customer ? (
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Name:</span>
                  <Link to={`/admin/customers/${deal.customer_id}`} className="text-ocean-blue hover:underline">
                    {deal.customer.first_name} {deal.customer.last_name}
                  </Link>
                </div>
                {deal.customer.business_name && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Business:</span>
                    <span className="text-gray-900 dark:text-white">{deal.customer.business_name}</span>
                  </div>
                )}
                {deal.customer.industry && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Industry:</span>
                    <span className="text-gray-900 dark:text-white">{deal.customer.industry}</span>
                  </div>
                )}
                {deal.customer.monthly_revenue && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Monthly Revenue:</span>
                    <span className="text-gray-900 dark:text-white">${deal.customer.monthly_revenue.toLocaleString()}</span>
                  </div>
                )}
                {deal.customer.time_in_business && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Time in Business:</span>
                    <span className="text-gray-900 dark:text-white">{deal.customer.time_in_business} months</span>
                  </div>
                )}
                <div className="pt-3 flex gap-3">
                  {deal.customer.phone && (
                    <a href={`tel:${deal.customer.phone}`} className="flex items-center gap-1 text-sm text-ocean-blue hover:underline">
                      <PhoneIcon className="w-4 h-4" />
                      {deal.customer.phone}
                    </a>
                  )}
                  {deal.customer.email && (
                    <a href={`mailto:${deal.customer.email}`} className="flex items-center gap-1 text-sm text-ocean-blue hover:underline">
                      <EnvelopeIcon className="w-4 h-4" />
                      {deal.customer.email}
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-gray-500">No customer linked</p>
            )}
          </div>

          {/* Stage Timestamps */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <ClockIcon className="w-5 h-5 text-gray-400" />
              Stage Timeline
            </h3>
            <div className="space-y-2 text-sm">
              {[
                { label: "Created", value: deal.created_at },
                { label: "Contacted", value: deal.contacted_at },
                { label: "Qualified", value: deal.qualified_at },
                { label: "App Sent", value: deal.application_sent_at },
                { label: "Docs Collected", value: deal.docs_collected_at },
                { label: "Submitted to Funder", value: deal.submitted_at },
                { label: "Offer Received", value: deal.offer_received_at },
                { label: "Offer Presented", value: deal.offer_presented_at },
                { label: "Funded", value: deal.funded_at },
                { label: "Declined", value: deal.declined_at },
              ].map((item) => (
                <div key={item.label} className="flex justify-between">
                  <span className="text-gray-500">{item.label}:</span>
                  <span className={item.value ? "text-gray-900 dark:text-white" : "text-gray-300 dark:text-gray-600"}>
                    {item.value ? new Date(item.value).toLocaleString() : "--"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Offer Comparison */}
          {offersWithAmounts.length > 0 && (
            <div className="md:col-span-2 bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <CurrencyDollarIcon className="w-5 h-5 text-green-500" />
                Offer Comparison
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-2 pr-4 text-gray-500 font-medium">Funder</th>
                      <th className="text-right py-2 px-4 text-gray-500 font-medium">Amount</th>
                      <th className="text-right py-2 px-4 text-gray-500 font-medium">Factor Rate</th>
                      <th className="text-right py-2 px-4 text-gray-500 font-medium">Term</th>
                      <th className="text-right py-2 px-4 text-gray-500 font-medium">Daily Payment</th>
                      <th className="text-right py-2 px-4 text-gray-500 font-medium">Total Payback</th>
                      <th className="text-right py-2 px-4 text-gray-500 font-medium">Commission</th>
                      <th className="text-center py-2 pl-4 text-gray-500 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {offersWithAmounts.map((sub) => {
                      const subStatusConfig = SUBMISSION_STATUS_CONFIG[sub.status];
                      return (
                        <tr key={sub.id} className="border-b border-gray-100 dark:border-gray-700">
                          <td className="py-3 pr-4 font-medium text-gray-900 dark:text-white">
                            {sub.lender?.company_name || "Unknown"}
                          </td>
                          <td className="py-3 px-4 text-right font-medium text-green-600">
                            ${sub.offer_amount?.toLocaleString()}
                          </td>
                          <td className="py-3 px-4 text-right text-gray-900 dark:text-white">
                            {sub.factor_rate || "-"}
                          </td>
                          <td className="py-3 px-4 text-right text-gray-900 dark:text-white">
                            {sub.term_months ? `${sub.term_months} mo` : "-"}
                          </td>
                          <td className="py-3 px-4 text-right text-gray-900 dark:text-white">
                            {sub.daily_payment ? `$${sub.daily_payment.toLocaleString()}` : "-"}
                          </td>
                          <td className="py-3 px-4 text-right text-gray-900 dark:text-white">
                            {sub.total_payback ? `$${sub.total_payback.toLocaleString()}` : "-"}
                          </td>
                          <td className="py-3 px-4 text-right text-gray-900 dark:text-white">
                            {sub.commission_amount
                              ? `$${sub.commission_amount.toLocaleString()}`
                              : sub.commission_points
                              ? `${sub.commission_points} pts`
                              : "-"}
                          </td>
                          <td className="py-3 pl-4 text-center">
                            <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${subStatusConfig.bgColor} ${subStatusConfig.color}`}>
                              {subStatusConfig.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Deal Notes */}
          {deal.notes && (
            <div className="md:col-span-2 bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Deal Notes</h3>
              <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{deal.notes}</p>
            </div>
          )}
        </div>
      )}

      {/* Tab: Submissions */}
      {activeTab === "submissions" && (
        <div className="space-y-6">
          {/* Submit to Funder button */}
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 dark:text-white">Funder Submissions</h3>
            <button
              onClick={() => setShowSubmitModal(true)}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <PaperAirplaneIcon className="w-4 h-4" />
              Submit to Funder
            </button>
          </div>

          {/* Existing Submissions */}
          {submissions.length === 0 ? (
            <div className="text-center py-8 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
              <PaperAirplaneIcon className="w-10 h-10 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-500">No submissions yet. Submit this deal to funders to get offers.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {submissions.map((sub) => {
                const subStatusConfig = SUBMISSION_STATUS_CONFIG[sub.status];
                return (
                  <div key={sub.id} className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="font-semibold text-gray-900 dark:text-white">
                          {sub.lender?.company_name || "Unknown Lender"}
                        </h4>
                        <p className="text-sm text-gray-500">
                          Submitted: {sub.submitted_at ? new Date(sub.submitted_at).toLocaleString() : "-"}
                          {sub.response_at && ` | Response: ${new Date(sub.response_at).toLocaleString()}`}
                        </p>
                      </div>
                      <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${subStatusConfig.bgColor} ${subStatusConfig.color}`}>
                        {subStatusConfig.label}
                      </span>
                    </div>

                    {/* Offer details if present */}
                    {sub.offer_amount && (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg text-sm">
                        <div>
                          <span className="text-gray-500 block">Offer Amount</span>
                          <span className="font-medium text-green-600">${sub.offer_amount.toLocaleString()}</span>
                        </div>
                        {sub.factor_rate && (
                          <div>
                            <span className="text-gray-500 block">Factor Rate</span>
                            <span className="font-medium text-gray-900 dark:text-white">{sub.factor_rate}</span>
                          </div>
                        )}
                        {sub.term_months && (
                          <div>
                            <span className="text-gray-500 block">Term</span>
                            <span className="font-medium text-gray-900 dark:text-white">{sub.term_months} months</span>
                          </div>
                        )}
                        {sub.daily_payment && (
                          <div>
                            <span className="text-gray-500 block">Daily Payment</span>
                            <span className="font-medium text-gray-900 dark:text-white">${sub.daily_payment.toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {sub.decline_reason && (
                      <p className="text-sm text-red-600 mb-3">Decline reason: {sub.decline_reason}</p>
                    )}

                    {sub.notes && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{sub.notes}</p>
                    )}

                    {/* Status update actions */}
                    <div className="flex gap-2 flex-wrap">
                      {sub.status === "submitted" && (
                        <>
                          <button
                            onClick={() => handleUpdateSubmissionStatus(sub.id, "under_review")}
                            className="px-3 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200"
                          >
                            Mark Under Review
                          </button>
                          <button
                            onClick={() => handleUpdateSubmissionStatus(sub.id, "approved")}
                            className="px-3 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200"
                          >
                            Approved
                          </button>
                          <button
                            onClick={() => handleUpdateSubmissionStatus(sub.id, "declined")}
                            className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                          >
                            Declined
                          </button>
                        </>
                      )}
                      {sub.status === "under_review" && (
                        <>
                          <button
                            onClick={() => handleUpdateSubmissionStatus(sub.id, "offer_made")}
                            className="px-3 py-1 text-xs bg-orange-100 text-orange-700 rounded hover:bg-orange-200"
                          >
                            Offer Made
                          </button>
                          <button
                            onClick={() => handleUpdateSubmissionStatus(sub.id, "declined")}
                            className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                          >
                            Declined
                          </button>
                        </>
                      )}
                      {sub.status === "offer_made" && (
                        <>
                          <button
                            onClick={() => handleUpdateSubmissionStatus(sub.id, "offer_accepted")}
                            className="px-3 py-1 text-xs bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200"
                          >
                            Accept Offer
                          </button>
                          <button
                            onClick={() => handleUpdateSubmissionStatus(sub.id, "offer_declined")}
                            className="px-3 py-1 text-xs bg-rose-100 text-rose-700 rounded hover:bg-rose-200"
                          >
                            Decline Offer
                          </button>
                        </>
                      )}
                      {sub.status === "offer_accepted" && (
                        <button
                          onClick={() => handleUpdateSubmissionStatus(sub.id, "funded")}
                          className="px-3 py-1 text-xs bg-teal-100 text-teal-700 rounded hover:bg-teal-200"
                        >
                          Mark Funded
                        </button>
                      )}
                      {!["funded", "withdrawn", "offer_declined", "declined"].includes(sub.status) && (
                        <button
                          onClick={() => handleUpdateSubmissionStatus(sub.id, "withdrawn")}
                          className="px-3 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                        >
                          Withdraw
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Submit to Funder Modal */}
          {showSubmitModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Submit to Funder
                </h3>

                {/* Matching lenders */}
                <div className="space-y-2 mb-4">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Select Funder {matchingLenders.length > 0 && `(${matchingLenders.length} matches)`}
                  </label>
                  {matchingLenders.length > 0 ? (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {matchingLenders.map((lender) => {
                        const alreadySubmitted = submissions.some(
                          (s) => s.lender_id === lender.id && !["withdrawn", "declined", "offer_declined"].includes(s.status)
                        );
                        return (
                          <button
                            key={lender.id}
                            onClick={() => !alreadySubmitted && setSubmittingLenderId(lender.id)}
                            disabled={alreadySubmitted}
                            className={`w-full text-left p-3 rounded-lg border transition-colors ${
                              submittingLenderId === lender.id
                                ? "border-ocean-blue bg-blue-50 dark:bg-blue-900/20"
                                : alreadySubmitted
                                ? "border-gray-200 dark:border-gray-700 opacity-50 cursor-not-allowed"
                                : "border-gray-200 dark:border-gray-700 hover:border-ocean-blue/50"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-gray-900 dark:text-white">
                                {lender.company_name}
                              </span>
                              <span className="text-xs text-gray-500">
                                Score: {lender.score}
                                {alreadySubmitted && " (already submitted)"}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {lender.reasons.slice(0, 3).map((r, i) => (
                                <span key={i} className="text-xs text-gray-500">{r}</span>
                              ))}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No matching lenders found. Add lenders to your network first.</p>
                  )}
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Notes (optional)
                  </label>
                  <textarea
                    value={submitNotes}
                    onChange={(e) => setSubmitNotes(e.target.value)}
                    className="input-field w-full h-20"
                    placeholder="Any notes for this submission..."
                  />
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => {
                      setShowSubmitModal(false);
                      setSubmittingLenderId(null);
                      setSubmitNotes("");
                    }}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmitToFunder}
                    disabled={!submittingLenderId}
                    className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <PaperAirplaneIcon className="w-4 h-4" />
                    Submit
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Documents (Stips Checklist) */}
      {activeTab === "documents" && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <DocumentCheckIcon className="w-5 h-5 text-gray-400" />
              Required Stips Checklist
            </h3>
            <div className="space-y-3">
              {REQUIRED_STIPS.map((stip) => {
                const matchingDoc = documents.find((d) => d.document_type === stip.key);
                return (
                  <div
                    key={stip.key}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      matchingDoc
                        ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10"
                        : "border-gray-200 dark:border-gray-700"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {matchingDoc ? (
                        <CheckCircleSolid className="w-5 h-5 text-green-500" />
                      ) : (
                        <div className="w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                      )}
                      <div>
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {stip.label}
                        </span>
                        {matchingDoc && (
                          <span className="ml-2 text-xs text-gray-500">{matchingDoc.filename}</span>
                        )}
                      </div>
                    </div>
                    {matchingDoc ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">
                        {matchingDoc.status}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">Missing</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 text-sm text-gray-500">
              {documents.length} of {REQUIRED_STIPS.length} documents uploaded.
              {deal.customer_id && (
                <Link to={`/admin/customers/${deal.customer_id}`} className="ml-2 text-ocean-blue hover:underline">
                  Upload documents on customer page
                </Link>
              )}
            </div>
          </div>

          {/* All documents */}
          {documents.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4">All Documents</h3>
              <div className="space-y-2">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 rounded-lg"
                  >
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{doc.filename}</span>
                      <span className="ml-2 text-xs text-gray-500">{doc.document_type.replace(/_/g, " ")}</span>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                      {doc.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Activity */}
      {activeTab === "activity" && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <InteractionTimeline
            interactions={activities}
            onAddInteraction={async (data) => {
              await addActivity(data);
            }}
            showAddForm={true}
            isLoading={isLoadingActivities}
          />
        </div>
      )}

      {/* Tab: Notes */}
      {activeTab === "notes" && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Add Note</h3>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Type a note about this deal..."
              className="input-field w-full h-24 mb-3"
            />
            <button
              onClick={handleAddNote}
              disabled={!noteText.trim()}
              className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <PencilIcon className="w-4 h-4" />
              Add Note
            </button>
          </div>

          {/* Existing notes from activity feed */}
          <div className="space-y-3">
            {activities
              .filter((a) => a.interaction_type === "note")
              .map((note) => (
                <div
                  key={note.id}
                  className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {note.logged_by_name || "System"}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(note.created_at).toLocaleString()}
                    </span>
                  </div>
                  {note.subject && (
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {note.subject}
                    </p>
                  )}
                  <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                    {note.content}
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
