import { useState, useEffect } from "react";
import {
  DocumentIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";
import { CheckCircleIcon as CheckCircleSolid, DocumentCheckIcon, ArrowTopRightOnSquareIcon } from "@heroicons/react/24/solid";
import { useSession } from "../../context/SessionContext";
import supabase from "../../supabase";
import {
  getMyCustomer,
  getMyDocRequests,
  getMyMerchantDocuments,
  getMyGhlDocuments,
  type DocRequest,
  type MerchantDocument,
  type GhlDocument,
} from "../../services/portalService";
import { DOCUMENT_TYPES } from "../../data/docRequests";
import { unifyDocs, openGhlDoc } from "../../utils/signing";
import DocChecklist from "../../components/portal/DocChecklist";
import DocumentsToSign from "../../components/portal/DocumentsToSign";
import SignDocumentModal from "../../components/portal/SignDocumentModal";

interface CustomerDocument {
  id: string;
  document_type: string;
  filename: string;
  status: string;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  pending: { label: "Pending Review", icon: ClockIcon, color: "text-yellow-500" },
  reviewed: { label: "Reviewed", icon: CheckCircleIcon, color: "text-blue-500" },
  approved: { label: "Approved", icon: CheckCircleIcon, color: "text-green-500" },
  rejected: { label: "Rejected", icon: XCircleIcon, color: "text-red-500" },
};

export default function PortalDocumentsPage() {
  const { session } = useSession();
  const [documents, setDocuments] = useState<CustomerDocument[]>([]);
  const [requests, setRequests] = useState<DocRequest[]>([]);
  const [merchantDocs, setMerchantDocs] = useState<MerchantDocument[]>([]);
  const [ghlDocs, setGhlDocs] = useState<GhlDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [showOnFile, setShowOnFile] = useState(false);
  const [signingDoc, setSigningDoc] = useState<MerchantDocument | null>(null);

  useEffect(() => {
    if (session?.user?.id) fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const fetchAll = async () => {
    setIsLoading(true);
    const customer = await getMyCustomer().catch((e) => {
      console.error("Failed to load account details:", e);
      return null;
    });

    if (customer) {
      setCustomerId(customer.id);
      const [{ data: docs }, reqs, mDocs, gDocs] = await Promise.all([
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
        getMyGhlDocuments(),
      ]);
      setDocuments(docs || []);
      setRequests(reqs);
      setMerchantDocs(mDocs);
      setGhlDocs(gDocs);
    }
    setIsLoading(false);
  };

  // Refresh when the merchant returns from a GHL signing tab.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && session?.user?.id) fetchAll();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  // One unified, one-application-collapsed view of signable docs.
  const unified = unifyDocs(merchantDocs, ghlDocs);
  const signedDocs = unified.signedNative;
  const ghlDone = unified.signedGhl;
  const ghlDead = unified.expiredGhl;
  const hasPendingSign = unified.pending.length > 0;
  // All-clear only when there's nothing to sign (native OR GHL) AND nothing requested.
  const allClear = !hasPendingSign && requests.length === 0;
  const onFileCount = signedDocs.length + documents.length + ghlDone.length + ghlDead.length;

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

          {/* ── SECTION 1: To sign (native agreements + real GHL docs) ──────── */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">To sign</h2>
            {hasPendingSign ? (
              <DocumentsToSign pending={unified.pending} onSelectNative={setSigningDoc} />
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400">
                No documents are waiting for your signature right now.
              </div>
            )}
          </section>

          {/* ── SECTION 2: To upload (shared checklist + ad-hoc) ────────────── */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">To upload</h2>
            <DocChecklist customerId={customerId} includeAdHoc onChanged={fetchAll} />
          </section>

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
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => setSigningDoc(d)}
                          className="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
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
                        </button>
                      ))}

                      {/* Completed GHL documents — open the signed copy in a new tab */}
                      {ghlDone.map((d, i) => (
                        <button
                          key={`gd-${i}-${d.name}`}
                          type="button"
                          onClick={() => openGhlDoc(d.url)}
                          disabled={!d.url}
                          className="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors disabled:cursor-default"
                        >
                          <div className="flex items-center gap-4 min-w-0">
                            <div className="p-2 bg-emerald-100 dark:bg-emerald-900/40 rounded-lg flex-shrink-0">
                              <DocumentCheckIcon className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900 dark:text-white truncate">{d.name}</p>
                              <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                                ✓ Signed — thank you
                                {d.updatedAt ? (
                                  <span className="font-normal text-gray-500">
                                    {" • "}{new Date(d.updatedAt).toLocaleDateString()}
                                  </span>
                                ) : ""}
                              </p>
                            </div>
                          </div>
                          {d.url && (
                            <span className="inline-flex items-center gap-1 text-sm font-medium text-ocean-blue flex-shrink-0">
                              View
                              <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                            </span>
                          )}
                        </button>
                      ))}

                      {/* Expired GHL links — muted, needs a resend */}
                      {ghlDead.map((d, i) => (
                        <div key={`gx-${i}-${d.name}`} className="p-4 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-4 min-w-0">
                            <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg flex-shrink-0">
                              <DocumentCheckIcon className="w-6 h-6 text-gray-400" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-gray-500 dark:text-gray-400 truncate">{d.name}</p>
                              <p className="text-sm text-gray-400">Link expired — ask your specialist to resend</p>
                            </div>
                          </div>
                        </div>
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

      {signingDoc && (
        <SignDocumentModal
          documentId={signingDoc.id}
          onClose={() => setSigningDoc(null)}
          onSigned={() => fetchAll()}
        />
      )}
    </div>
  );
}
