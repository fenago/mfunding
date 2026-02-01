import { useState } from "react";
import {
  DocumentIcon,
  ArrowDownTrayIcon,
  TrashIcon,
  EyeIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import StatusBadge from "./StatusBadge";
import ConfirmModal from "./ConfirmModal";

interface Document {
  id: string;
  document_type: string;
  filename: string;
  storage_path: string;
  file_size: number;
  status: string;
  created_at: string;
}

interface DocumentListProps {
  documents: Document[];
  bucket: string;
  onDelete?: (id: string) => void;
  canDelete?: boolean;
  showStatus?: boolean;
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  agreement: "Agreement",
  terms: "Terms & Conditions",
  rate_sheet: "Rate Sheet",
  commission_schedule: "Commission Schedule",
  application_template: "Application Template",
  marketing_material: "Marketing Material",
  bank_statement: "Bank Statement",
  application: "Application",
  tax_return: "Tax Return",
  id: "ID / Driver's License",
  business_license: "Business License",
  voided_check: "Voided Check",
  credit_authorization: "Credit Authorization",
  personal_guarantee: "Personal Guarantee",
  other: "Other",
};

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function DocumentList({
  documents,
  bucket,
  onDelete,
  canDelete = true,
  showStatus = true,
}: DocumentListProps) {
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<Document | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDownload = async (doc: Document) => {
    try {
      const { data, error } = await supabase.storage
        .from(bucket)
        .download(doc.storage_path);

      if (error) throw error;

      // Create download link
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download error:", error);
      alert("Failed to download file");
    }
  };

  const handlePreview = async (doc: Document) => {
    try {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(doc.storage_path, 60); // 60 second expiry

      if (error) throw error;

      window.open(data.signedUrl, "_blank");
    } catch (error) {
      console.error("Preview error:", error);
      alert("Failed to preview file");
    }
  };

  const handleDeleteClick = (doc: Document) => {
    setDocumentToDelete(doc);
    setDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!documentToDelete) return;

    setIsDeleting(true);
    try {
      // Delete from storage
      await supabase.storage.from(bucket).remove([documentToDelete.storage_path]);

      // Callback to parent to handle DB deletion
      onDelete?.(documentToDelete.id);
    } catch (error) {
      console.error("Delete error:", error);
      alert("Failed to delete file");
    } finally {
      setIsDeleting(false);
      setDeleteModalOpen(false);
      setDocumentToDelete(null);
    }
  };

  if (documents.length === 0) {
    return (
      <div className="text-center py-8 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <DocumentIcon className="w-12 h-12 text-gray-400 mx-auto mb-3" />
        <p className="text-gray-500 dark:text-gray-400">No documents uploaded</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {documents.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
          >
            <div className="flex items-center gap-4 min-w-0">
              <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg">
                <DocumentIcon className="w-6 h-6 text-gray-500" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-gray-900 dark:text-white truncate">
                  {doc.filename}
                </p>
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <span>{DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type}</span>
                  <span>•</span>
                  <span>{formatFileSize(doc.file_size)}</span>
                  <span>•</span>
                  <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {showStatus && (
                <StatusBadge status={doc.status} type="document" size="sm" />
              )}
              <button
                onClick={() => handlePreview(doc)}
                className="p-2 text-gray-400 hover:text-ocean-blue hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                title="Preview"
              >
                <EyeIcon className="w-5 h-5" />
              </button>
              <button
                onClick={() => handleDownload(doc)}
                className="p-2 text-gray-400 hover:text-ocean-blue hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                title="Download"
              >
                <ArrowDownTrayIcon className="w-5 h-5" />
              </button>
              {canDelete && onDelete && (
                <button
                  onClick={() => handleDeleteClick(doc)}
                  className="p-2 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                  title="Delete"
                >
                  <TrashIcon className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <ConfirmModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleConfirmDelete}
        title="Delete Document"
        message={`Are you sure you want to delete "${documentToDelete?.filename}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        isLoading={isDeleting}
      />
    </>
  );
}
