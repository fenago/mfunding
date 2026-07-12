import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  DocumentIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
  CameraIcon,
  ArrowUpTrayIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";
import { CheckCircleIcon as CheckCircleSolid, DocumentCheckIcon } from "@heroicons/react/24/solid";
import { useSession } from "../../context/SessionContext";
import supabase from "../../supabase";
import { mustWrite } from "@/supabase/writes";
import {
  getMyCustomer,
  getMyDocRequests,
  getMyMerchantDocuments,
  markDocRequestUploaded,
  notifyMerchantDocUploaded,
  type DocRequest,
  type DocRequestStatus,
  type MerchantDocument,
} from "../../services/portalService";
import { docTypeHelp, MAX_UPLOAD_BYTES } from "../../data/docRequests";
import Countdown from "../../components/portal/Countdown";
import DocumentsToSign from "../../components/portal/DocumentsToSign";

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
  { value: "other", label: "Something else" },
];

const STATUS_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  pending: { label: "Pending Review", icon: ClockIcon, color: "text-yellow-500" },
  reviewed: { label: "Reviewed", icon: CheckCircleIcon, color: "text-blue-500" },
  approved: { label: "Approved", icon: CheckCircleIcon, color: "text-green-500" },
  rejected: { label: "Rejected", icon: XCircleIcon, color: "text-red-500" },
};

// Merchant-facing chips for each checklist request status. Compliance-clean,
// reassuring language ("Received", "Being reviewed").
const REQUEST_STATUS_CHIP: Record<DocRequestStatus, { label: string; className: string }> = {
  requested: {
    label: "Needed",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  },
  uploaded: {
    label: "Received",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  },
  under_review: {
    label: "Being reviewed",
    className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  },
  approved: {
    label: "Approved",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
  rejected: {
    label: "Needs another look",
    className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  },
};

/** A request counts as "done" (merchant's part complete) once it's uploaded,
 *  under review, or approved. requested/rejected are still outstanding. */
function isDone(status: DocRequestStatus): boolean {
  return status === "uploaded" || status === "under_review" || status === "approved";
}

// ── Upload slot: choose a file OR open the camera directly (mobile) ───────────
function UploadSlot({
  onFile,
  busy,
  primaryLabel = "Choose file",
}: {
  onFile: (file: File) => void;
  busy: boolean;
  primaryLabel?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-mint-green text-white text-sm font-semibold hover:bg-mint-green/90 disabled:opacity-50 transition-colors"
      >
        <ArrowUpTrayIcon className="w-5 h-5" />
        {busy ? "Uploading…" : primaryLabel}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => cameraRef.current?.click()}
        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors sm:flex-none"
      >
        <CameraIcon className="w-5 h-5" />
        Take a photo
      </button>
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept="image/*,.pdf"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        className="hidden"
        accept="image/*"
        capture="environment"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ── Progress ring ─────────────────────────────────────────────────────────────
function ProgressRing({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? done / total : 0;
  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <div className="relative w-20 h-20 flex-shrink-0">
      <svg viewBox="0 0 64 64" className="w-20 h-20 -rotate-90">
        <circle cx="32" cy="32" r={R} fill="none" strokeWidth="6" className="stroke-gray-200 dark:stroke-gray-700" />
        <circle
          cx="32"
          cy="32"
          r={R}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          className="stroke-mint-green transition-all duration-500"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-gray-900 dark:text-white">
        {done}/{total}
      </span>
    </div>
  );
}

export default function PortalDocumentsPage() {
  const { session } = useSession();
  const [documents, setDocuments] = useState<CustomerDocument[]>([]);
  const [requests, setRequests] = useState<DocRequest[]>([]);
  const [merchantDocs, setMerchantDocs] = useState<MerchantDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [customerId, setCustomerId] = useState<string | null>(null);

  // Per-card upload/error state (keyed by request id; "adhoc" for the general slot).
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [cardError, setCardError] = useState<Record<string, string>>({});
  const [adHocType, setAdHocType] = useState("bank_statement");
  const [showAdHoc, setShowAdHoc] = useState(false);
  const [showOnFile, setShowOnFile] = useState(false);

  useEffect(() => {
    if (session?.user?.id) fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const fetchAll = async () => {
    setIsLoading(true);
    // customers has no merchant row-level SELECT anymore — resolve identity via
    // the SECURITY DEFINER RPC (safe column projection).
    const customer = await getMyCustomer().catch((e) => {
      console.error("Failed to load account details:", e);
      return null;
    });

    if (customer) {
      setCustomerId(customer.id);
      const [{ data: docs }, reqs, mDocs] = await Promise.all([
        supabase
          .from("customer_documents")
          .select("id, document_type, filename, status, created_at")
          .eq("customer_id", customer.id)
          .order("created_at", { ascending: false }),
        getMyDocRequests(customer.id).catch((e) => {
          console.error("Failed to load document checklist:", e);
          return [] as DocRequest[];
        }),
        getMyMerchantDocuments().catch((e) => {
          console.error("Failed to load agreements:", e);
          return [] as MerchantDocument[];
        }),
      ]);
      setDocuments(docs || []);
      setRequests(reqs);
      setMerchantDocs(mDocs);
    }
    setIsLoading(false);
  };

  /** Shared upload: validates size, stores the file, records it with the given
   *  document_type, and returns the new customer_documents id. */
  const uploadFile = async (file: File, docType: string): Promise<string> => {
    if (!customerId) throw new Error("You need an active application to upload documents.");
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error("That file is over 10MB. Please upload a smaller photo or PDF.");
    }
    const fileExt = file.name.split(".").pop();
    // Keep the existing portal path convention: <customerId>/<filename>.
    const fileName = `${customerId}/${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage
      .from("customer-documents")
      .upload(fileName, file);
    if (uploadError) throw uploadError;

    const rows = await mustWrite(
      "create document record",
      supabase.from("customer_documents").insert({
        customer_id: customerId,
        document_type: docType,
        filename: file.name,
        storage_path: fileName,
        file_size: file.size,
        mime_type: file.type,
        uploaded_by: session?.user?.id,
      }),
    );
    return (rows[0] as { id: string }).id;
  };

  const handleChecklistUpload = async (req: DocRequest, file: File) => {
    setUploadingId(req.id);
    setCardError((m) => ({ ...m, [req.id]: "" }));
    try {
      const docId = await uploadFile(file, req.doc_type);
      await markDocRequestUploaded(req.id, docId);
      // Backend notify (activity_log + underwriter re-run) — fire-and-forget.
      void notifyMerchantDocUploaded(docId);
      await fetchAll();
    } catch (e) {
      setCardError((m) => ({
        ...m,
        [req.id]: e instanceof Error ? e.message : "Upload failed. Please try again.",
      }));
    } finally {
      setUploadingId(null);
    }
  };

  const handleAdHocUpload = async (file: File) => {
    setUploadingId("adhoc");
    setCardError((m) => ({ ...m, adhoc: "" }));
    try {
      const docId = await uploadFile(file, adHocType);
      void notifyMerchantDocUploaded(docId);
      await fetchAll();
    } catch (e) {
      setCardError((m) => ({
        ...m,
        adhoc: e instanceof Error ? e.message : "Upload failed. Please try again.",
      }));
    } finally {
      setUploadingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  const openRequests = requests.filter((r) => r.status !== "approved");
  const approvedRequests = requests.filter((r) => r.status === "approved");
  const doneCount = requests.filter((r) => isDone(r.status)).length;
  // Agreements: 'sent' still needs a signature; 'signed' is on file for reference.
  const toSign = merchantDocs.filter((d) => d.status === "sent");
  const signedDocs = merchantDocs.filter((d) => d.status === "signed");
  // The all-clear only holds when there's nothing to sign AND nothing requested.
  const allClear = toSign.length === 0 && requests.length === 0;
  const onFileCount = signedDocs.length + documents.length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Your documents</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Everything to sign, upload, and keep on file — all in one place.
        </p>
      </div>

      {!customerId && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 text-center">
          <p className="text-gray-500 dark:text-gray-400">
            You'll be able to sign and upload documents once your application is started.
          </p>
        </div>
      )}

      {customerId && (
        <>
          {/* All-clear — only when nothing to sign AND nothing requested to upload */}
          {allClear && (
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-8 border border-emerald-200 dark:border-emerald-700 text-center">
              <CheckCircleSolid className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <p className="font-semibold text-emerald-800 dark:text-emerald-200">
                Nothing needs your signature or an upload right now.
              </p>
              <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-1">
                If your specialist needs anything, it'll show up here. You can still upload something below anytime.
              </p>
            </div>
          )}

          {/* ── SECTION 1: To sign (most prominent, top) ───────────────────── */}
          {!allClear && (
            <section className="space-y-3">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">To sign</h2>
              {toSign.length > 0 ? (
                <DocumentsToSign documents={merchantDocs} />
              ) : (
                <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400">
                  No agreements are waiting for your signature right now.
                </div>
              )}
            </section>
          )}

          {/* ── SECTION 2: To upload (the checklist) ───────────────────────── */}
          {!allClear && (
            <section className="space-y-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">To upload</h2>

              {requests.length > 0 ? (
                <>
                  {/* Checklist header + progress */}
                  <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 flex items-center gap-4">
                    <ProgressRing done={doneCount} total={requests.length} />
                    <div>
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                        {doneCount} of {requests.length} done
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {openRequests.length === 0
                          ? "Everything's in — nothing else needed from you right now."
                          : `${openRequests.length} item${openRequests.length === 1 ? "" : "s"} still need your attention.`}
                      </p>
                    </div>
                  </div>

                  {/* Open checklist cards */}
                  {openRequests.map((req) => {
                    const chip = REQUEST_STATUS_CHIP[req.status];
                    const busy = uploadingId === req.id;
                    const err = cardError[req.id];
                    const isRejected = req.status === "rejected";
                    const needsUpload = req.status === "requested" || req.status === "rejected";
                    return (
                      <div
                        key={req.id}
                        className={`bg-white dark:bg-gray-800 rounded-xl p-5 border ${
                          isRejected
                            ? "border-red-300 dark:border-red-700"
                            : "border-gray-200 dark:border-gray-700"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <h3 className="font-semibold text-gray-900 dark:text-white">{req.label}</h3>
                          <span className={`inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full flex-shrink-0 ${chip.className}`}>
                            {chip.label}
                          </span>
                        </div>

                        {req.due_at && needsUpload && (
                          <div className="mb-2">
                            <Countdown target={req.due_at} label="Due" variant="urgent" />
                          </div>
                        )}

                        {isRejected && req.rejection_reason && (
                          <div className="mb-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2">
                            <p className="text-sm font-medium text-red-700 dark:text-red-300">
                              We need this one again:
                            </p>
                            <p className="text-sm text-red-700 dark:text-red-300 mt-0.5">{req.rejection_reason}</p>
                          </div>
                        )}

                        {needsUpload ? (
                          <>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{docTypeHelp(req.doc_type)}</p>
                            <UploadSlot
                              onFile={(f) => handleChecklistUpload(req, f)}
                              busy={busy}
                              primaryLabel={isRejected ? "Upload again" : "Upload"}
                            />
                          </>
                        ) : (
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            Got it — your specialist is reviewing this. We'll let you know if anything else is needed.
                          </p>
                        )}

                        {err && <p className="text-sm text-red-500 mt-2">{err}</p>}
                      </div>
                    );
                  })}

                  {/* Approved — collapsed, quiet ✓ */}
                  {approvedRequests.length > 0 && (
                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                      {approvedRequests.map((req) => (
                        <div key={req.id} className="flex items-center gap-3 p-4">
                          <CheckCircleSolid className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                          <span className="text-sm text-gray-700 dark:text-gray-200">{req.label}</span>
                          <span className="ml-auto text-xs text-emerald-600 dark:text-emerald-400 font-medium">Approved</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400">
                  No documents have been requested right now. You can still add something below anytime.
                </div>
              )}
            </section>
          )}

          {/* Ad-hoc "upload something else" */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setShowAdHoc((v) => !v)}
              className="w-full flex items-center justify-between p-5"
            >
              <span className="font-semibold text-gray-900 dark:text-white">Upload something else</span>
              <ChevronDownIcon
                className={`w-5 h-5 text-gray-400 transition-transform ${showAdHoc ? "rotate-180" : ""}`}
              />
            </button>
            {showAdHoc && (
              <div className="px-5 pb-5 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    What is it?
                  </label>
                  <select
                    value={adHocType}
                    onChange={(e) => setAdHocType(e.target.value)}
                    className="w-full text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2"
                  >
                    {DOCUMENT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <UploadSlot onFile={handleAdHocUpload} busy={uploadingId === "adhoc"} />
                {cardError.adhoc && <p className="text-sm text-red-500">{cardError.adhoc}</p>}
                <p className="text-xs text-gray-400">Photos or PDFs up to 10MB.</p>
              </div>
            )}
          </div>

          {/* ── SECTION 3: On file (signed agreements + uploads, collapsed) ── */}
          <section>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setShowOnFile((v) => !v)}
                className="w-full flex items-center justify-between p-5"
              >
                <span className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
                  On file
                  <span className="text-sm font-normal text-gray-400">({onFileCount})</span>
                </span>
                <ChevronDownIcon
                  className={`w-5 h-5 text-gray-400 transition-transform ${showOnFile ? "rotate-180" : ""}`}
                />
              </button>

              {showOnFile && (
                <div className="border-t border-gray-200 dark:border-gray-700">
                  {onFileCount === 0 ? (
                    <p className="p-5 text-sm text-gray-500 dark:text-gray-400">
                      Nothing on file yet. Signed agreements and documents you upload will be kept here.
                    </p>
                  ) : (
                    <div className="divide-y divide-gray-200 dark:divide-gray-700">
                      {/* Signed agreements — tap to view the signed copy */}
                      {signedDocs.map((d) => (
                        <Link
                          key={d.id}
                          to={`/portal/sign/${d.id}`}
                          className="p-4 flex items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                        >
                          <div className="flex items-center gap-4 min-w-0">
                            <div className="p-2 bg-emerald-100 dark:bg-emerald-900/40 rounded-lg flex-shrink-0">
                              <DocumentCheckIcon className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900 dark:text-white truncate">{d.name}</p>
                              <p className="text-sm text-gray-500">
                                Signed agreement
                                {d.signed_at ? ` • ${new Date(d.signed_at).toLocaleDateString()}` : ""}
                              </p>
                            </div>
                          </div>
                          <span className="text-sm font-medium text-ocean-blue flex-shrink-0">View</span>
                        </Link>
                      ))}

                      {/* Documents you've uploaded */}
                      {documents.map((doc) => {
                        const statusConfig = STATUS_CONFIG[doc.status] || STATUS_CONFIG.pending;
                        const StatusIcon = statusConfig.icon;
                        return (
                          <div key={doc.id} className="p-4 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-4 min-w-0">
                              <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg flex-shrink-0">
                                <DocumentIcon className="w-6 h-6 text-gray-500" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-gray-900 dark:text-white truncate">{doc.filename}</p>
                                <p className="text-sm text-gray-500">
                                  {DOCUMENT_TYPES.find((t) => t.value === doc.document_type)?.label ||
                                    doc.document_type.replace(/_/g, " ")}
                                  {" • "}
                                  {new Date(doc.created_at).toLocaleDateString()}
                                </p>
                              </div>
                            </div>
                            <div className={`flex items-center gap-1 flex-shrink-0 ${statusConfig.color}`}>
                              <StatusIcon className="w-5 h-5" />
                              <span className="text-sm hidden sm:inline">{statusConfig.label}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
