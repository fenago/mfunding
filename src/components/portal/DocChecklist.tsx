import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDownIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { CheckCircleIcon as CheckCircleSolid } from "@heroicons/react/24/solid";
import { CameraIcon, ArrowUpTrayIcon } from "@heroicons/react/24/outline";
import { useSession } from "../../context/SessionContext";
import supabase from "../../supabase";
import { mustWrite } from "@/supabase/writes";
import {
  getMyDocRequests,
  markDocRequestUploaded,
  notifyMerchantDocUploaded,
  type DocRequest,
  type DocRequestStatus,
} from "../../services/portalService";
import { docTypeHelp, MAX_UPLOAD_BYTES, DOCUMENT_TYPES, friendlyUploadError } from "../../data/docRequests";
import Countdown from "./Countdown";

/** Scroll a just-surfaced error into view so the merchant can't miss it. */
function scrollToError(id: string) {
  setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
}

// Merchant-facing chips for each checklist request status.
const REQUEST_STATUS_CHIP: Record<DocRequestStatus, { label: string; className: string }> = {
  requested: { label: "Needed", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  uploaded: { label: "Received", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  under_review: { label: "Being reviewed", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  approved: { label: "Approved", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  rejected: { label: "Needs another look", className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
};

/** A request counts as "done" once uploaded/under review/approved. */
function isDone(status: DocRequestStatus): boolean {
  return status === "uploaded" || status === "under_review" || status === "approved";
}

/** Chip for a request — optional-but-not-yet-uploaded items get the softer
 *  "Optional — helps your file" treatment instead of the urgent "Needed". */
function chipFor(req: DocRequest): { label: string; className: string } {
  if (req.status === "requested" && !req.required) {
    return {
      label: "Optional — helps your file",
      className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    };
  }
  return REQUEST_STATUS_CHIP[req.status];
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

interface DocChecklistProps {
  customerId: string;
  /** When set, only this deal's requests are shown (dashboard, per-deal card). */
  dealId?: string;
  /** Show the "upload something else" ad-hoc uploader. */
  includeAdHoc?: boolean;
  /** Show the progress-ring header above the cards. */
  showProgress?: boolean;
  /** Called after any upload so a host can refresh aggregate counts / lists. */
  onChanged?: () => void;
}

/**
 * The merchant's upload checklist — the per-request cards with Choose file /
 * Take a photo, progress ring, rejection reasons, and an optional ad-hoc
 * uploader. Self-contained (fetches its own requests, owns upload state) so it
 * can live inline on BOTH the dashboard deal card and the Documents page.
 */
export default function DocChecklist({
  customerId,
  dealId,
  includeAdHoc = false,
  showProgress = true,
  onChanged,
}: DocChecklistProps) {
  const { session } = useSession();
  const [requests, setRequests] = useState<DocRequest[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [cardError, setCardError] = useState<Record<string, string>>({});
  const [adHocType, setAdHocType] = useState("bank_statement");
  const [showAdHoc, setShowAdHoc] = useState(false);

  const fetchRequests = useCallback(async () => {
    try {
      const all = await getMyDocRequests(customerId);
      setRequests(dealId ? all.filter((r) => r.deal_id === dealId) : all);
    } catch (e) {
      console.error("Failed to load document checklist:", e);
      setRequests([]);
    } finally {
      setLoaded(true);
    }
  }, [customerId, dealId]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  /** Store the file, record it in customer_documents, return the new id. */
  const uploadFile = async (file: File, docType: string): Promise<string> => {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error("That file is over 10MB. Please upload a smaller photo or PDF.");
    }
    const fileExt = file.name.split(".").pop();
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
      void notifyMerchantDocUploaded(docId);
      await fetchRequests();
      onChanged?.();
    } catch (e) {
      setCardError((m) => ({ ...m, [req.id]: friendlyUploadError(e) }));
      scrollToError(`docerr-${req.id}`);
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
      await fetchRequests();
      onChanged?.();
    } catch (e) {
      setCardError((m) => ({ ...m, adhoc: friendlyUploadError(e) }));
      scrollToError("docerr-adhoc");
    } finally {
      setUploadingId(null);
    }
  };

  const approvedRequests = requests.filter((r) => r.status === "approved");
  // Required items first, then optional; approved drop to the quiet list.
  const openRequests = requests
    .filter((r) => r.status !== "approved")
    .sort((a, b) => Number(b.required) - Number(a.required));

  const requiredReqs = requests.filter((r) => r.required);
  const optionalReqs = requests.filter((r) => !r.required);
  const reqDone = requiredReqs.filter((r) => isDone(r.status)).length;
  const optDone = optionalReqs.filter((r) => isDone(r.status)).length;
  const openRequiredCount = requiredReqs.filter((r) => !isDone(r.status)).length;
  const openOptionalCount = optionalReqs.filter((r) => !isDone(r.status)).length;
  // The ring tracks REQUIRED progress (optional never gates); fall back to
  // optional only when there are no required items at all.
  const primaryDone = requiredReqs.length > 0 ? reqDone : optDone;
  const primaryTotal = requiredReqs.length > 0 ? requiredReqs.length : optionalReqs.length;

  if (!loaded) {
    return <p className="text-sm text-gray-400">Loading your checklist…</p>;
  }

  return (
    <div className="space-y-4">
      {/* Progress header — required is the primary number; optional is secondary */}
      {showProgress && requests.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 flex items-center gap-4">
          <ProgressRing done={primaryDone} total={primaryTotal} />
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              {requiredReqs.length > 0
                ? `${reqDone} of ${requiredReqs.length} needed in`
                : `${optDone} of ${optionalReqs.length} optional in`}
              {requiredReqs.length > 0 && optionalReqs.length > 0 && (
                <span className="font-normal text-gray-400"> · {optDone} of {optionalReqs.length} optional</span>
              )}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {openRequiredCount > 0
                ? `${openRequiredCount} required item${openRequiredCount === 1 ? "" : "s"} still need your attention.`
                : openOptionalCount > 0
                  ? `You're all set on required items — ${openOptionalCount} optional item${openOptionalCount === 1 ? "" : "s"} could strengthen your file.`
                  : "Everything's in — nothing else needed from you right now."}
            </p>
          </div>
        </div>
      )}

      {/* Open checklist cards */}
      {openRequests.map((req) => {
        const chip = chipFor(req);
        const busy = uploadingId === req.id;
        const err = cardError[req.id];
        const isRejected = req.status === "rejected";
        const needsUpload = req.status === "requested" || req.status === "rejected";
        return (
          <div
            key={req.id}
            className={`bg-white dark:bg-gray-800 rounded-xl p-5 border ${
              err
                ? "border-red-400 dark:border-red-600 ring-1 ring-red-300 dark:ring-red-700"
                : isRejected
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
                <p className="text-sm font-medium text-red-700 dark:text-red-300">We need this one again:</p>
                <p className="text-sm text-red-700 dark:text-red-300 mt-0.5">{req.rejection_reason}</p>
              </div>
            )}

            {needsUpload ? (
              <>
                <div className="mb-3">
                  <p className="text-sm text-gray-500 dark:text-gray-400">{docTypeHelp(req.doc_type)}</p>
                  {!req.required && (
                    <p className="text-xs text-gray-400 mt-1">
                      Not required — but it strengthens your file with funding partners.
                    </p>
                  )}
                </div>
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

            {err && (
              <div
                id={`docerr-${req.id}`}
                className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 px-3 py-2"
              >
                <ExclamationTriangleIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm font-medium text-red-700 dark:text-red-300">{err}</p>
              </div>
            )}
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

      {requests.length === 0 && !includeAdHoc && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400">
          No documents have been requested right now.
        </div>
      )}

      {/* Ad-hoc "upload something else" */}
      {includeAdHoc && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={() => setShowAdHoc((v) => !v)}
            className="w-full flex items-center justify-between p-5"
          >
            <span className="font-semibold text-gray-900 dark:text-white">Upload something else</span>
            <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${showAdHoc ? "rotate-180" : ""}`} />
          </button>
          {showAdHoc && (
            <div className="px-5 pb-5 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">What is it?</label>
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
              {cardError.adhoc && (
                <div
                  id="docerr-adhoc"
                  className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 px-3 py-2"
                >
                  <ExclamationTriangleIcon className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm font-medium text-red-700 dark:text-red-300">{cardError.adhoc}</p>
                </div>
              )}
              <p className="text-xs text-gray-400">Photos or PDFs up to 10MB.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
