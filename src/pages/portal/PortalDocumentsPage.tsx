import { useState, useEffect } from "react";
import {
  DocumentArrowUpIcon,
  DocumentIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { useSession } from "../../context/SessionContext";
import supabase from "../../supabase";

interface CustomerDocument {
  id: string;
  document_type: string;
  filename: string;
  status: string;
  created_at: string;
}

const DOCUMENT_TYPES = [
  { value: "bank_statement", label: "Bank Statement" },
  { value: "application", label: "Application" },
  { value: "tax_return", label: "Tax Return" },
  { value: "id", label: "ID / Driver's License" },
  { value: "business_license", label: "Business License" },
  { value: "voided_check", label: "Voided Check" },
  { value: "other", label: "Other" },
];

const STATUS_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  pending: { label: "Pending Review", icon: ClockIcon, color: "text-yellow-500" },
  reviewed: { label: "Reviewed", icon: CheckCircleIcon, color: "text-blue-500" },
  approved: { label: "Approved", icon: CheckCircleIcon, color: "text-green-500" },
  rejected: { label: "Rejected", icon: XCircleIcon, color: "text-red-500" },
};

export default function PortalDocumentsPage() {
  const { session } = useSession();
  const [documents, setDocuments] = useState<CustomerDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);

  useEffect(() => {
    if (session?.user?.id) {
      fetchCustomerAndDocuments();
    }
  }, [session]);

  const fetchCustomerAndDocuments = async () => {
    setIsLoading(true);

    // First get customer ID
    const { data: customer } = await supabase
      .from("customers")
      .select("id")
      .eq("user_id", session?.user?.id)
      .single();

    if (customer) {
      setCustomerId(customer.id);

      // Then get documents
      const { data: docs } = await supabase
        .from("customer_documents")
        .select("id, document_type, filename, status, created_at")
        .eq("customer_id", customer.id)
        .order("created_at", { ascending: false });

      setDocuments(docs || []);
    }

    setIsLoading(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !customerId) return;

    setIsUploading(true);

    try {
      // Upload to Supabase Storage
      const fileExt = file.name.split(".").pop();
      const fileName = `${customerId}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("customer-documents")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // Create document record
      const { error: dbError } = await supabase.from("customer_documents").insert({
        customer_id: customerId,
        document_type: "other",
        filename: file.name,
        storage_path: fileName,
        file_size: file.size,
        mime_type: file.type,
        uploaded_by: session?.user?.id,
      });

      if (dbError) throw dbError;

      // Refresh documents
      fetchCustomerAndDocuments();
    } catch (error) {
      console.error("Upload error:", error);
      alert("Failed to upload document. Please try again.");
    }

    setIsUploading(false);
    e.target.value = "";
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Documents</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Upload and manage your funding documents
        </p>
      </div>

      {/* Upload Section */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Upload Documents
        </h2>

        <label className="block">
          <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center cursor-pointer hover:border-mint-green transition-colors">
            <DocumentArrowUpIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 dark:text-gray-400 mb-2">
              {isUploading ? "Uploading..." : "Click or drag to upload"}
            </p>
            <p className="text-sm text-gray-500">PDF, JPG, PNG up to 10MB</p>
          </div>
          <input
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={handleFileUpload}
            disabled={isUploading || !customerId}
          />
        </label>

        {!customerId && (
          <p className="text-sm text-red-500 mt-2">
            You need an active application to upload documents.
          </p>
        )}
      </div>

      {/* Documents List */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-white">
            Uploaded Documents ({documents.length})
          </h2>
        </div>

        {documents.length === 0 ? (
          <div className="p-8 text-center">
            <DocumentIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">No documents uploaded yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {documents.map((doc) => {
              const statusConfig = STATUS_CONFIG[doc.status] || STATUS_CONFIG.pending;
              const StatusIcon = statusConfig.icon;

              return (
                <div
                  key={doc.id}
                  className="p-4 flex items-center justify-between"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
                      <DocumentIcon className="w-6 h-6 text-gray-500" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">
                        {doc.filename}
                      </p>
                      <p className="text-sm text-gray-500">
                        {DOCUMENT_TYPES.find((t) => t.value === doc.document_type)?.label ||
                          doc.document_type}
                        {" • "}
                        {new Date(doc.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className={`flex items-center gap-1 ${statusConfig.color}`}>
                      <StatusIcon className="w-5 h-5" />
                      <span className="text-sm">{statusConfig.label}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
