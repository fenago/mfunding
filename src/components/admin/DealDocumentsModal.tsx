import { useCallback, useEffect, useState } from "react";
import {
  XMarkIcon,
  DocumentIcon,
  EyeIcon,
  ArrowDownTrayIcon,
  SparklesIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import DocumentUploader from "../shared/DocumentUploader";

/**
 * Deal Documents manager — every piece of paperwork on a merchant's file, in one
 * place inside the Revenue Playbook so the closer never leaves the deal to see, add,
 * or make sense of a document.
 *
 * Shows every customer_documents row for the deal's customer with: filename, the
 * human document-type label, review status, when it landed, AND the content
 * classifier's verdict where present ("What is this?" — the classified type + the
 * one-sentence evidence the model read off the first page). Uploads happen right
 * here (drag-drop / picker, any type, multiple) via the shared DocumentUploader,
 * which fire-and-forgets classify-document after each upload. "Analyze all" runs
 * the classifier over any doc that has no stored verdict yet.
 *
 * The classifier verdict is persisted on customer_documents.classification by
 * reconcileDocumentType (docClassify.ts); this component only reads it.
 */

const DOC_TYPE_LABELS: Record<string, string> = {
  bank_statement: "Bank Statement",
  application: "Application",
  tax_return: "Tax Return",
  id: "ID / Driver's License",
  business_license: "Business License",
  voided_check: "Voided Check",
  credit_authorization: "Credit Authorization",
  personal_guarantee: "Personal Guarantee",
  other: "Other / Unsorted",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  reviewed: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  rejected: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
};

interface Classification {
  type: string | null;
  confidence?: number;
  evidence?: string;
  bank_hint?: { account_last4: string | null; statement_month: string | null } | null;
  model?: string | null;
  authority?: string;
  classified_at?: string;
}

interface DocRow {
  id: string;
  filename: string;
  document_type: string;
  status: string;
  file_size: number | null;
  mime_type: string | null;
  storage_path: string;
  created_at: string;
  classification: Classification | null;
}

function docTypeLabel(t: string): string {
  return DOC_TYPE_LABELS[t] || t;
}

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function whenUploaded(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * The "📄 Documents (N)" button for the deal context bar. Self-contained: loads the
 * live document count for the customer, opens the manager modal, and refreshes the
 * count when the modal closes (an upload inside may have changed it).
 */
export function DealDocumentsButton({
  customerId,
  merchantName,
}: {
  customerId: string;
  merchantName?: string | null;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  const loadCount = useCallback(async () => {
    const { count: c } = await supabase
      .from("customer_documents")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId);
    setCount(c ?? 0);
  }, [customerId]);

  useEffect(() => {
    void loadCount();
  }, [loadCount]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Every document on this deal — view, upload, and see what each file is"
        className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 transition-colors"
      >
        <DocumentIcon className="w-3 h-3" /> Documents{count !== null ? ` (${count})` : ""}
      </button>
      <DealDocumentsModal
        isOpen={open}
        onClose={() => {
          setOpen(false);
          void loadCount();
        }}
        customerId={customerId}
        merchantName={merchantName}
      />
    </>
  );
}

export default function DealDocumentsModal({
  isOpen,
  onClose,
  customerId,
  merchantName,
}: {
  isOpen: boolean;
  onClose: () => void;
  customerId: string;
  merchantName?: string | null;
}) {
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<{ done: number; total: number } | null>(null);
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoadError(null);
    const { data, error } = await supabase
      .from("customer_documents")
      .select("id, filename, document_type, status, file_size, mime_type, storage_path, created_at, classification")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });
    if (error) {
      setLoadError(error.message);
      setDocs([]);
      return;
    }
    setDocs((data as DocRow[]) ?? []);
  }, [customerId]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  const openSigned = useCallback(async (doc: DocRow, download: boolean) => {
    const { data, error } = await supabase.storage
      .from("customer-documents")
      .createSignedUrl(doc.storage_path, 60, download ? { download: doc.filename } : undefined);
    if (error || !data?.signedUrl) {
      alert("Could not open the file. It may have been moved or removed.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }, []);

  // Run the content classifier over one document, then refresh its row. Uses
  // authority 'human' so a specific ops-selected type is never overwritten — but the
  // verdict is still persisted (docClassify writes classification for both
  // authorities), which is all this view needs.
  const analyzeOne = useCallback(async (docId: string): Promise<void> => {
    setAnalyzingIds((prev) => new Set(prev).add(docId));
    try {
      await supabase.functions.invoke("classify-document", {
        body: { document_id: docId, authority: "human" },
      });
    } catch (e) {
      console.warn("[DealDocumentsModal] classify failed:", e);
    } finally {
      setAnalyzingIds((prev) => {
        const next = new Set(prev);
        next.delete(docId);
        return next;
      });
    }
  }, []);

  const analyzeAll = useCallback(async () => {
    if (!docs) return;
    const pending = docs.filter((d) => !d.classification || d.classification.type == null);
    if (pending.length === 0) return;
    setAnalyzing(true);
    setAnalyzeProgress({ done: 0, total: pending.length });
    // Sequential — the classifier calls a vision model per doc; don't stampede it.
    for (let i = 0; i < pending.length; i++) {
      await analyzeOne(pending[i].id);
      setAnalyzeProgress({ done: i + 1, total: pending.length });
    }
    await load();
    setAnalyzing(false);
    setAnalyzeProgress(null);
  }, [docs, analyzeOne, load]);

  const analyzeSingle = useCallback(async (docId: string) => {
    await analyzeOne(docId);
    await load();
  }, [analyzeOne, load]);

  if (!isOpen) return null;

  const unanalyzed = (docs ?? []).filter((d) => !d.classification || d.classification.type == null).length;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/50 overflow-y-auto">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-3xl my-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <DocumentIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              Documents
              {docs && <span className="text-gray-400 font-normal">({docs.length})</span>}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Every file on {merchantName || "this merchant"}'s deal — upload, view, and see what each one is.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void analyzeAll()}
              disabled={analyzing || unanalyzed === 0}
              title={unanalyzed === 0 ? "Every document already has a verdict" : `Read ${unanalyzed} document(s) that have no verdict yet`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {analyzing ? (
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
              ) : (
                <SparklesIcon className="w-4 h-4" />
              )}
              {analyzing && analyzeProgress
                ? `Analyzing ${analyzeProgress.done}/${analyzeProgress.total}…`
                : `Analyze all${unanalyzed > 0 ? ` (${unanalyzed})` : ""}`}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Upload */}
          <div>
            <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">Add documents</p>
            <DocumentUploader
              entityType="customer"
              entityId={customerId}
              bucket="customer-documents"
              multiple
              onUploadComplete={() => void load()}
              onError={(msg) => setLoadError(msg)}
            />
            <p className="mt-1 text-[11px] text-gray-400">
              Each upload is read automatically to sort it. Use <span className="font-medium">Analyze all</span> above if a verdict is missing.
            </p>
          </div>

          {/* List */}
          <div>
            <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">On file</p>

            {loadError && (
              <p className="mb-2 flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400">
                <ExclamationCircleIcon className="w-4 h-4 flex-shrink-0" /> {loadError}
              </p>
            )}

            {docs === null ? (
              <div className="py-8 text-center text-sm text-gray-400">Loading documents…</div>
            ) : docs.length === 0 ? (
              <div className="py-8 text-center bg-gray-50 dark:bg-gray-900/40 rounded-lg">
                <DocumentIcon className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">No documents yet. Drop the merchant's paperwork above.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {docs.map((doc) => {
                  const cls = doc.classification;
                  const hasVerdict = !!cls && cls.type != null;
                  const isAnalyzing = analyzingIds.has(doc.id);
                  return (
                    <div
                      key={doc.id}
                      className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex items-start gap-3">
                          <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 flex-shrink-0">
                            <DocumentIcon className="w-5 h-5 text-gray-500" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{doc.filename}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                              <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                                {docTypeLabel(doc.document_type)}
                              </span>
                              <span className={`px-2 py-0.5 rounded-full ${STATUS_STYLES[doc.status] || "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}>
                                {doc.status}
                              </span>
                              <span className="text-gray-400">{formatBytes(doc.file_size)}</span>
                              <span className="text-gray-400">·</span>
                              <span className="text-gray-400">{whenUploaded(doc.created_at)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => void openSigned(doc, false)}
                            title="View"
                            className="p-1.5 text-gray-400 hover:text-ocean-blue hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                          >
                            <EyeIcon className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => void openSigned(doc, true)}
                            title="Download"
                            className="p-1.5 text-gray-400 hover:text-ocean-blue hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                          >
                            <ArrowDownTrayIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* "What is this?" — the content classifier's verdict */}
                      <div className="mt-2 pl-1">
                        {hasVerdict ? (
                          <div className="rounded-md bg-violet-50 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-900/40 px-2.5 py-1.5">
                            <div className="flex items-center gap-1.5 text-[11px]">
                              <SparklesIcon className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
                              <span className="font-semibold text-violet-800 dark:text-violet-300">
                                Reads as {docTypeLabel(cls!.type as string)}
                              </span>
                              {typeof cls!.confidence === "number" && (
                                <span className="text-violet-500 dark:text-violet-400">
                                  {Math.round((cls!.confidence || 0) * 100)}% confident
                                </span>
                              )}
                              {cls!.type !== doc.document_type && (
                                <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 font-semibold">
                                  ⚠ differs from filed type
                                </span>
                              )}
                            </div>
                            {cls!.evidence && (
                              <p className="mt-0.5 text-[11px] text-violet-700/90 dark:text-violet-300/80">{cls!.evidence}</p>
                            )}
                            {cls!.bank_hint && (cls!.bank_hint.account_last4 || cls!.bank_hint.statement_month) && (
                              <p className="mt-0.5 text-[10px] text-violet-500 dark:text-violet-400">
                                {[cls!.bank_hint.statement_month, cls!.bank_hint.account_last4 ? `••${cls!.bank_hint.account_last4}` : null]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => void analyzeSingle(doc.id)}
                            disabled={isAnalyzing || analyzing}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:underline disabled:opacity-50 disabled:no-underline"
                          >
                            {isAnalyzing ? (
                              <>
                                <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" /> Reading…
                              </>
                            ) : (
                              <>
                                <SparklesIcon className="w-3.5 h-3.5" /> What is this?
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 rounded-b-xl">
          <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
            <CheckCircleIcon className="w-3.5 h-3.5" /> Uploads sort themselves automatically
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
