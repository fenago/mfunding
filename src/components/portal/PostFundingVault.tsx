import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  FolderIcon,
  ChevronDownIcon,
  DocumentCheckIcon,
  DocumentIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import type { PortalDeal, MerchantDocument } from "../../services/portalService";

interface PostFundingVaultProps {
  deal: PortalDeal;
  customerId: string | null;
  /** All of the merchant's merchant_documents (any deal). Filtered to this
   *  deal's signed agreements inside. */
  signedDocuments: MerchantDocument[];
}

interface UploadedDoc {
  id: string;
  filename: string;
  document_type: string;
  created_at: string;
}

function fmtDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** A quiet, collapsed "Your documents" drawer for funded deals: signed
 *  agreements, everything the merchant uploaded, and a funding summary. Reads
 *  are all through existing tables/services — this is arrangement, not new
 *  plumbing. */
export default function PostFundingVault({
  deal,
  customerId,
  signedDocuments,
}: PostFundingVaultProps) {
  const [open, setOpen] = useState(false);
  const [uploaded, setUploaded] = useState<UploadedDoc[]>([]);

  // Signed agreements for THIS deal (or unassigned merchant docs, which still
  // belong to the merchant). merchant_documents.deal_id may be null on legacy rows.
  const signed = signedDocuments.filter(
    (d) => d.status === "signed" && (d.deal_id === deal.id || d.deal_id == null),
  );

  useEffect(() => {
    if (!open || !customerId) return;
    let alive = true;
    supabase
      .from("customer_documents")
      .select("id, filename, document_type, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (alive) setUploaded((data as UploadedDoc[]) ?? []);
      });
    return () => {
      alive = false;
    };
  }, [open, customerId]);

  return (
    <div className="mt-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4"
      >
        <span className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
          <FolderIcon className="w-5 h-5 text-gray-400" />
          Your documents
        </span>
        <ChevronDownIcon
          className={`w-5 h-5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          {/* Funding summary */}
          {deal.amount_funded != null && (
            <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 px-4 py-3">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                <span className="font-bold text-gray-900 dark:text-white">
                  ${deal.amount_funded.toLocaleString()}
                </span>{" "}
                funded
                {deal.funded_at ? ` on ${fmtDate(deal.funded_at)}` : ""}
              </p>
            </div>
          )}

          {/* Signed agreements */}
          {signed.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 mb-2">Signed agreements</p>
              <div className="space-y-2">
                {signed.map((d) => (
                  <Link
                    key={d.id}
                    to={`/portal/sign/${d.id}`}
                    className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition"
                  >
                    <DocumentCheckIcon className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                    <span className="text-sm text-gray-900 dark:text-white truncate">{d.name}</span>
                    <span className="ml-auto text-xs text-emerald-600 dark:text-emerald-400 font-medium flex-shrink-0">
                      Signed{d.signed_at ? ` ${fmtDate(d.signed_at)}` : ""}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Uploaded documents */}
          <div>
            <p className="text-xs font-medium text-gray-400 mb-2">What you uploaded</p>
            {uploaded.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Nothing on file here yet.
              </p>
            ) : (
              <div className="space-y-2">
                {uploaded.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2.5"
                  >
                    <DocumentIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    <span className="text-sm text-gray-900 dark:text-white truncate">
                      {doc.filename}
                    </span>
                    <span className="ml-auto text-xs text-gray-400 flex-shrink-0">
                      {fmtDate(doc.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
