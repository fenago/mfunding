import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  DocumentMagnifyingGlassIcon, EyeIcon, CheckCircleIcon, XCircleIcon,
} from "@heroicons/react/24/outline";
import {
  getDocumentsForReview, setDocumentStatus, getDocumentUrl,
  type ReviewDoc, type DocReviewStatus,
} from "../../services/documentService";

const DOC_LABELS: Record<string, string> = {
  bank_statement: "Bank Statement", application: "Application", id: "ID / License",
  voided_check: "Voided Check", credit_authorization: "Credit Authorization", other: "Other",
};

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  reviewed: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

export default function DocumentReviewPage() {
  const [docs, setDocs] = useState<ReviewDoc[]>([]);
  const [showAll, setShowAll] = useState(true); // default to ALL documents (uncheck to see only what needs review)
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try { setDocs(await getDocumentsForReview(showAll)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [showAll]);

  async function act(id: string, status: DocReviewStatus) {
    setBusyId(id);
    try { await setDocumentStatus(id, status); await load(); } finally { setBusyId(null); }
  }

  async function view(path: string) {
    const url = await getDocumentUrl(path);
    if (url) window.open(url, "_blank", "noopener");
  }

  const fmtSize = (b: number | null) => (b ? `${(b / 1024).toFixed(0)} KB` : "");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <DocumentMagnifyingGlassIcon className="w-6 h-6 text-ocean-blue" /> Document Review
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Review uploaded merchant documents and approve or reject them.</p>
        </div>
        <label className="text-sm text-gray-500 flex items-center gap-2">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : docs.length === 0 ? (
        <div className="text-center py-10 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <CheckCircleIcon className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
          <p className="text-gray-500">{showAll ? "No documents." : "Nothing to review — all caught up."}</p>
        </div>
      ) : (
        <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
                <th className="py-3 px-4">Merchant</th><th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">File</th><th className="py-3 px-4">Status</th><th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-b border-gray-50 dark:border-gray-800">
                  <td className="py-3 px-4">
                    <Link to={`/admin/customers/${d.customer_id}`} className="text-gray-900 dark:text-white hover:text-ocean-blue">
                      {d.customer?.business_name || `${d.customer?.first_name ?? ""} ${d.customer?.last_name ?? ""}`.trim() || "Merchant"}
                    </Link>
                  </td>
                  <td className="py-3 px-4 text-gray-700 dark:text-gray-300">{DOC_LABELS[d.document_type] ?? d.document_type}</td>
                  <td className="py-3 px-4 text-gray-500">
                    <button onClick={() => view(d.storage_path)} className="inline-flex items-center gap-1 text-ocean-blue hover:underline">
                      <EyeIcon className="w-4 h-4" /> {d.filename}
                    </button>
                    <span className="ml-1 text-xs text-gray-400">{fmtSize(d.file_size)}</span>
                  </td>
                  <td className="py-3 px-4"><span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[d.status]}`}>{d.status}</span></td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => act(d.id, "approved")} disabled={busyId === d.id}
                        className="px-2.5 py-1 text-xs font-medium text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:opacity-60 inline-flex items-center gap-1">
                        <CheckCircleIcon className="w-4 h-4" /> Approve
                      </button>
                      <button onClick={() => act(d.id, "rejected")} disabled={busyId === d.id}
                        className="px-2.5 py-1 text-xs font-medium text-red-600 border border-red-300 dark:border-red-700 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-60 inline-flex items-center gap-1">
                        <XCircleIcon className="w-4 h-4" /> Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
