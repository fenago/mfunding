import { useState, useEffect } from "react";
import {
  PlusIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  DocumentPlusIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import { mustWrite } from "@/supabase/writes";
import { useSession } from "../../context/SessionContext";
import { DOC_REQUEST_TEMPLATES } from "../../data/docRequests";
import type { DocRequest, DocRequestStatus } from "../../services/portalService";

interface DealDocRequestsProps {
  dealId: string;
  customerId: string | null;
}

const STATUS_BADGE: Record<DocRequestStatus, { label: string; className: string }> = {
  requested: { label: "Requested", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  uploaded: { label: "Uploaded", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  under_review: { label: "Under review", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  approved: { label: "Approved", className: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
  rejected: { label: "Rejected", className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
};

const DOC_REQUEST_COLUMNS =
  "id, deal_id, customer_id, doc_type, label, status, rejection_reason, due_at, requested_by, document_id, created_at";

export default function DealDocRequests({ dealId, customerId }: DealDocRequestsProps) {
  const { session } = useSession();
  const [requests, setRequests] = useState<DocRequest[]>([]);
  const [available, setAvailable] = useState(true); // false once we learn the table isn't deployed
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New-request form
  const [customLabel, setCustomLabel] = useState("");
  const [dueDate, setDueDate] = useState("");

  // Reject flow
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    fetchRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  const fetchRequests = async () => {
    setIsLoading(true);
    const { data, error: err } = await supabase
      .from("deal_doc_requests")
      .select(DOC_REQUEST_COLUMNS)
      .eq("deal_id", dealId)
      .order("created_at", { ascending: true });
    if (err) {
      // Table not deployed yet (backend in parallel) — hide the panel gracefully.
      if (
        err.code === "42P01" ||
        err.code === "PGRST205" ||
        /could not find the table|relation .* does not exist/i.test(err.message || "")
      ) {
        setAvailable(false);
      } else {
        setError(err.message);
      }
      setRequests([]);
    } else {
      setRequests((data ?? []) as unknown as DocRequest[]);
    }
    setIsLoading(false);
  };

  const createRequest = async (doc_type: string, label: string, defaultDueHours?: number) => {
    if (!customerId || !label.trim()) return;
    setBusy(true);
    setError(null);
    // Bank statements default to a 24-hour turnaround (owner preference). A date
    // the closer typed in the field always wins; other templates get no default.
    const dueAt = dueDate
      ? dueDate
      : defaultDueHours
        ? new Date(Date.now() + defaultDueHours * 3600 * 1000).toISOString()
        : null;
    try {
      await mustWrite(
        "request document",
        supabase.from("deal_doc_requests").insert({
          deal_id: dealId,
          customer_id: customerId,
          doc_type,
          label: label.trim(),
          status: "requested",
          due_at: dueAt,
          requested_by: session?.user?.id ?? null,
        }),
      );
      setCustomLabel("");
      setDueDate("");
      await fetchRequests();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the request.");
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (id: string, status: DocRequestStatus, rejection_reason?: string) => {
    setBusy(true);
    setError(null);
    try {
      await mustWrite(
        "update document request",
        supabase
          .from("deal_doc_requests")
          .update({ status, rejection_reason: rejection_reason ?? null })
          .eq("id", id),
      );
      // On a rejection, email the merchant to re-upload (fire-and-forget; the
      // portal message is created by triggers — this only adds the email). Never
      // block the status change or surface a failure to staff.
      if (status === "rejected") {
        try {
          void supabase.functions.invoke("notify-merchant", {
            body: { deal_id: dealId, kind: "doc_rejected" },
          });
        } catch (e) {
          console.warn("[notify-merchant] doc_rejected failed (non-blocking):", e);
        }
      }
      setRejectingId(null);
      setRejectReason("");
      await fetchRequests();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update the request.");
    } finally {
      setBusy(false);
    }
  };

  if (!available) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
      <h3 className="font-semibold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
        <DocumentPlusIcon className="w-5 h-5 text-ocean-blue" />
        Request documents from the merchant
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        These appear as an upload checklist in the merchant's portal. Use this for funder stips too.
      </p>

      {!customerId && (
        <p className="text-sm text-red-500 mb-4">
          Link a customer to this deal before requesting documents.
        </p>
      )}

      {/* Quick-pick templates */}
      <div className="flex flex-wrap gap-2 mb-4">
        {DOC_REQUEST_TEMPLATES.map((t) => {
          const already = requests.some(
            (r) => r.doc_type === t.doc_type && r.status !== "rejected",
          );
          return (
            <button
              key={t.doc_type + t.label}
              type="button"
              disabled={busy || !customerId || already}
              onClick={() =>
                createRequest(t.doc_type, t.label, t.doc_type === "bank_statement" ? 24 : undefined)
              }
              title={
                already
                  ? "Already requested"
                  : t.doc_type === "bank_statement"
                    ? `Request: ${t.label} (due in 24 hours)`
                    : `Request: ${t.label}`
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-ocean-blue hover:text-ocean-blue disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <PlusIcon className="w-4 h-4" />
              {t.label}
              {already && " ✓"}
            </button>
          );
        })}
      </div>

      {/* Custom request (free text) — also how a specific funder stip gets sent */}
      <div className="flex flex-col sm:flex-row gap-2 mb-2">
        <input
          type="text"
          value={customLabel}
          onChange={(e) => setCustomLabel(e.target.value)}
          placeholder="Custom request (e.g. Most recent merchant processing statement)"
          disabled={busy || !customerId}
          className="flex-1 input-field text-sm"
        />
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          disabled={busy || !customerId}
          title="Optional due date"
          className="input-field text-sm sm:w-44"
        />
        <button
          type="button"
          disabled={busy || !customerId || !customLabel.trim()}
          onClick={() => createRequest("other", customLabel)}
          className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <PlusIcon className="w-4 h-4" />
          Request
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-5">
        A due date is optional; it shows the merchant a countdown. Phrase custom requests
        in merchant-friendly language.
      </p>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

      {/* Existing requests */}
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading requests…</p>
      ) : requests.length === 0 ? (
        <p className="text-sm text-gray-500">No documents requested yet.</p>
      ) : (
        <div className="space-y-2">
          {requests.map((req) => {
            const badge = STATUS_BADGE[req.status];
            const canReview = req.status === "uploaded" || req.status === "under_review";
            return (
              <div
                key={req.id}
                className="rounded-lg border border-gray-200 dark:border-gray-700 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{req.label}</span>
                    {req.due_at && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs text-gray-400">
                        <ClockIcon className="w-3.5 h-3.5" />
                        due {new Date(req.due_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <span className={`inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full flex-shrink-0 ${badge.className}`}>
                    {badge.label}
                  </span>
                </div>

                {req.status === "rejected" && req.rejection_reason && (
                  <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                    Rejected: {req.rejection_reason}
                  </p>
                )}

                {/* Review controls once the merchant has uploaded */}
                {canReview && rejectingId !== req.id && (
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setStatus(req.id, "approved")}
                      className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-50"
                    >
                      <CheckCircleIcon className="w-4 h-4" />
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setRejectingId(req.id);
                        setRejectReason("");
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
                    >
                      <XCircleIcon className="w-4 h-4" />
                      Reject
                    </button>
                  </div>
                )}

                {/* Reject reason (required) */}
                {rejectingId === req.id && (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Why does the merchant need to re-upload? (shown to them)"
                      className="input-field w-full h-16 text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy || !rejectReason.trim()}
                        onClick={() => setStatus(req.id, "rejected", rejectReason.trim())}
                        className="px-3 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Send back to merchant
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejectingId(null)}
                        className="px-3 py-1 text-xs rounded text-gray-500 hover:text-gray-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
