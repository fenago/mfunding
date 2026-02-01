import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeftIcon,
  PencilIcon,
  PhoneIcon,
  EnvelopeIcon,
  BuildingOfficeIcon,
  CurrencyDollarIcon,
  ClockIcon,
  CalendarIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../../supabase";
import CustomerEditModal from "../../../components/customers/CustomerEditModal";
import CustomerAIRecommendation from "../../../components/customers/CustomerAIRecommendation";
import InteractionTimeline from "../../../components/shared/InteractionTimeline";
import DocumentUploader from "../../../components/shared/DocumentUploader";
import DocumentList from "../../../components/shared/DocumentList";
import StatusBadge from "../../../components/shared/StatusBadge";

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
  status: string;
  lead_source: string | null;
  amount_requested: number | null;
  amount_funded: number | null;
  next_follow_up_date: string | null;
  follow_up_notes: string | null;
  notes: string | null;
  created_at: string;
}

interface Interaction {
  id: string;
  interaction_type: string;
  subject: string | null;
  content: string | null;
  old_status: string | null;
  new_status: string | null;
  call_duration: number | null;
  call_outcome: string | null;
  follow_up_date: string | null;
  logged_by: string | null;
  logged_by_name?: string;
  created_at: string;
}

interface CustomerDocument {
  id: string;
  document_type: string;
  filename: string;
  storage_path: string;
  file_size: number;
  status: string;
  created_at: string;
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [documents, setDocuments] = useState<CustomerDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingInteractions, setIsLoadingInteractions] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "timeline" | "documents" | "funding" | "ai">("overview");
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [documentType, setDocumentType] = useState("bank_statement");

  useEffect(() => {
    if (id) {
      fetchCustomer();
      fetchInteractions();
      fetchDocuments();
    }
  }, [id]);

  const fetchCustomer = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      console.error("Error fetching customer:", error);
    } else {
      setCustomer(data);
    }
    setIsLoading(false);
  };

  const fetchInteractions = async () => {
    setIsLoadingInteractions(true);
    const { data, error } = await supabase
      .from("customer_interactions")
      .select(`
        *,
        profiles:logged_by (
          first_name,
          last_name
        )
      `)
      .eq("customer_id", id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching interactions:", error);
    } else {
      // Map logged_by profile to logged_by_name
      const interactionsWithNames = data?.map((i) => ({
        ...i,
        logged_by_name: i.profiles
          ? `${i.profiles.first_name || ""} ${i.profiles.last_name || ""}`.trim()
          : null,
      })) || [];
      setInteractions(interactionsWithNames);
    }
    setIsLoadingInteractions(false);
  };

  const fetchDocuments = async () => {
    const { data, error } = await supabase
      .from("customer_documents")
      .select("*")
      .eq("customer_id", id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching documents:", error);
    } else {
      setDocuments(data || []);
    }
  };

  const handleAddInteraction = async (data: {
    interaction_type: string;
    subject?: string;
    content: string;
    follow_up_date?: string;
  }) => {
    const { error } = await supabase.from("customer_interactions").insert({
      customer_id: id,
      interaction_type: data.interaction_type,
      subject: data.subject || null,
      content: data.content,
      follow_up_date: data.follow_up_date || null,
    });

    if (error) {
      console.error("Error adding interaction:", error);
      throw error;
    }

    // Update customer follow-up date if provided
    if (data.follow_up_date) {
      await supabase
        .from("customers")
        .update({ next_follow_up_date: data.follow_up_date })
        .eq("id", id);
    }

    fetchInteractions();
    fetchCustomer();
  };

  const handleDocumentUploadComplete = () => {
    fetchDocuments();
  };

  const handleDocumentDelete = async (docId: string) => {
    const { error } = await supabase
      .from("customer_documents")
      .delete()
      .eq("id", docId);

    if (error) {
      console.error("Error deleting document:", error);
    } else {
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Customer not found</h2>
          <Link to="/admin/customers" className="text-ocean-blue hover:underline mt-2 inline-block">
            Back to customers
          </Link>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "timeline", label: `Timeline (${interactions.length})` },
    { id: "documents", label: `Documents (${documents.length})` },
    { id: "funding", label: "Funding" },
    { id: "ai", label: "AI Assist" },
  ];

  const isFollowUpDue = customer.next_follow_up_date && new Date(customer.next_follow_up_date) <= new Date();

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/admin/customers"
          className="inline-flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Back to customers
        </Link>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {customer.first_name} {customer.last_name}
              </h1>
              <StatusBadge status={customer.status} type="customer" />
            </div>
            {customer.business_name && (
              <p className="text-gray-500 dark:text-gray-400">
                {customer.business_name}
              </p>
            )}
            {customer.lead_source && (
              <p className="text-sm text-gray-400 mt-1">
                Source: {customer.lead_source.replace(/_/g, " ")}
              </p>
            )}
          </div>
          <button
            onClick={() => setIsEditModalOpen(true)}
            className="btn-primary flex items-center gap-2"
          >
            <PencilIcon className="w-4 h-4" />
            Edit
          </button>
        </div>
      </div>

      {/* Follow-up Alert */}
      {isFollowUpDue && (
        <div className="mb-6 p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded-xl flex items-center gap-3">
          <ClockIcon className="w-6 h-6 text-orange-500" />
          <div>
            <p className="font-medium text-orange-800 dark:text-orange-200">
              Follow-up is due!
            </p>
            <p className="text-sm text-orange-600 dark:text-orange-300">
              Scheduled for {new Date(customer.next_follow_up_date!).toLocaleDateString()}
              {customer.follow_up_notes && ` — ${customer.follow_up_notes}`}
            </p>
          </div>
        </div>
      )}

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
          {/* Contact Info */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Contact Info</h3>

            <div className="space-y-3">
              {customer.email && (
                <div className="flex items-center gap-3">
                  <EnvelopeIcon className="w-5 h-5 text-gray-400" />
                  <a
                    href={`mailto:${customer.email}`}
                    className="text-sm text-ocean-blue hover:underline"
                  >
                    {customer.email}
                  </a>
                </div>
              )}
              {customer.phone && (
                <div className="flex items-center gap-3">
                  <PhoneIcon className="w-5 h-5 text-gray-400" />
                  <a
                    href={`tel:${customer.phone}`}
                    className="text-sm text-ocean-blue hover:underline"
                  >
                    {customer.phone}
                  </a>
                </div>
              )}
              {(customer.address_street || customer.address_city) && (
                <div className="flex items-start gap-3">
                  <BuildingOfficeIcon className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    {customer.address_street && <div>{customer.address_street}</div>}
                    {customer.address_city && (
                      <div>
                        {customer.address_city}, {customer.address_state} {customer.address_zip}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Business Info */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Business Info</h3>

            <div className="space-y-3 text-sm">
              {customer.business_name && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Business Name:</span>
                  <span className="text-gray-900 dark:text-white">{customer.business_name}</span>
                </div>
              )}
              {customer.business_type && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Business Type:</span>
                  <span className="text-gray-900 dark:text-white">{customer.business_type}</span>
                </div>
              )}
              {customer.industry && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Industry:</span>
                  <span className="text-gray-900 dark:text-white">{customer.industry}</span>
                </div>
              )}
              {customer.ein && (
                <div className="flex justify-between">
                  <span className="text-gray-500">EIN:</span>
                  <span className="text-gray-900 dark:text-white">{customer.ein}</span>
                </div>
              )}
              {customer.time_in_business && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Time in Business:</span>
                  <span className="text-gray-900 dark:text-white">{customer.time_in_business} months</span>
                </div>
              )}
              {customer.monthly_revenue && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Monthly Revenue:</span>
                  <span className="text-gray-900 dark:text-white">${customer.monthly_revenue.toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>

          {/* Follow-up */}
          {customer.next_follow_up_date && (
            <div className={`bg-white dark:bg-gray-800 rounded-xl p-6 border ${isFollowUpDue ? "border-orange-300 dark:border-orange-700" : "border-gray-200 dark:border-gray-700"}`}>
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <CalendarIcon className={`w-5 h-5 ${isFollowUpDue ? "text-orange-500" : "text-gray-400"}`} />
                Next Follow-up
              </h3>
              <p className={`text-lg font-medium ${isFollowUpDue ? "text-orange-600" : "text-gray-900 dark:text-white"}`}>
                {new Date(customer.next_follow_up_date).toLocaleDateString()}
              </p>
              {customer.follow_up_notes && (
                <p className="text-sm text-gray-500 mt-2">{customer.follow_up_notes}</p>
              )}
            </div>
          )}

          {/* Funding Request */}
          {customer.amount_requested && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <CurrencyDollarIcon className="w-5 h-5 text-green-500" />
                Funding Request
              </h3>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                ${customer.amount_requested.toLocaleString()}
              </p>
              <p className="text-sm text-gray-500">Requested Amount</p>
            </div>
          )}

          {/* Notes */}
          {customer.notes && (
            <div className="md:col-span-2 bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Notes</h3>
              <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{customer.notes}</p>
            </div>
          )}
        </div>
      )}

      {activeTab === "timeline" && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <InteractionTimeline
            interactions={interactions}
            onAddInteraction={handleAddInteraction}
            showAddForm={true}
            isLoading={isLoadingInteractions}
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
                <option value="bank_statement">Bank Statement</option>
                <option value="application">Application</option>
                <option value="tax_return">Tax Return</option>
                <option value="id">ID / Driver's License</option>
                <option value="business_license">Business License</option>
                <option value="voided_check">Voided Check</option>
                <option value="credit_authorization">Credit Authorization</option>
                <option value="personal_guarantee">Personal Guarantee</option>
                <option value="other">Other</option>
              </select>
            </div>
            <DocumentUploader
              entityType="customer"
              entityId={customer.id}
              bucket="customer-documents"
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
              bucket="customer-documents"
              onDelete={handleDocumentDelete}
              canDelete={true}
              showStatus={true}
            />
          </div>
        </div>
      )}

      {activeTab === "funding" && (
        <div className="space-y-6">
          {/* Funding Summary */}
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Amount Requested</h3>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">
                {customer.amount_requested ? `$${customer.amount_requested.toLocaleString()}` : "-"}
              </p>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Total Funded</h3>
              {customer.amount_funded ? (
                <div className="flex items-center gap-3">
                  <CurrencyDollarIcon className="w-8 h-8 text-green-500" />
                  <div>
                    <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                      ${customer.amount_funded.toLocaleString()}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-gray-500">No funding yet</p>
              )}
            </div>
          </div>

          {/* Funding History - Placeholder */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Funding History</h3>
            <p className="text-gray-500">Detailed funding history and renewal tracking coming soon...</p>
          </div>
        </div>
      )}

      {activeTab === "ai" && (
        <div className="space-y-6">
          <CustomerAIRecommendation
            customer={{
              first_name: customer.first_name,
              last_name: customer.last_name,
              business_name: customer.business_name,
              industry: customer.industry,
              business_type: customer.business_type,
              time_in_business: customer.time_in_business,
              monthly_revenue: customer.monthly_revenue,
              amount_requested: customer.amount_requested,
              lead_source: customer.lead_source,
              status: customer.status,
              notes: customer.notes,
            }}
          />
        </div>
      )}

      {/* Edit Modal */}
      <CustomerEditModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSave={fetchCustomer}
        customer={customer as Parameters<typeof CustomerEditModal>[0]["customer"]}
      />
    </div>
  );
}
