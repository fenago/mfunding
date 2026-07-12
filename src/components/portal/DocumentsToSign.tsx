import { Link } from "react-router-dom";
import { PencilSquareIcon, ArrowTopRightOnSquareIcon } from "@heroicons/react/24/solid";
import type { MerchantDocument, GhlDocument } from "../../services/portalService";
import { nativePending, ghlPending, openGhlDoc } from "../../utils/signing";

interface DocumentsToSignProps {
  /** Native agreements — 'sent' ones await the merchant's signature. */
  documents: MerchantDocument[];
  /** Real GHL Documents & Contracts for this merchant (opened in a new tab). */
  ghlDocuments?: GhlDocument[];
  /** When provided, native cards open the signing modal in place instead of
   *  routing to the standalone /portal/sign/:id page. */
  onSelect?: (doc: MerchantDocument) => void;
}

/** One unified "ready to sign" list: native in-app agreements + real GHL docs.
 *  The merchant can't tell them apart. Renders nothing when nothing is pending. */
export default function DocumentsToSign({ documents, ghlDocuments = [], onSelect }: DocumentsToSignProps) {
  const nativeItems = nativePending(documents);
  const ghlItems = ghlPending(ghlDocuments);
  const total = nativeItems.length + ghlItems.length;
  if (total === 0) return null;

  return (
    <div className="rounded-xl border-2 border-ocean-blue/40 dark:border-ocean-blue/50 bg-ocean-blue/5 dark:bg-ocean-blue/10 p-5">
      <div className="flex items-center gap-2 mb-3">
        <PencilSquareIcon className="w-5 h-5 text-ocean-blue" />
        <h3 className="font-semibold text-gray-900 dark:text-white">
          {total === 1 ? "Your document is ready to sign" : "Documents ready to sign"}
        </h3>
      </div>
      <div className="space-y-2">
        {/* Native in-app agreements */}
        {nativeItems.map((d) =>
          onSelect ? (
            <button
              key={`n-${d.id}`}
              type="button"
              onClick={() => onSelect(d)}
              className="w-full flex items-center justify-between gap-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-4 py-3 hover:shadow-sm transition text-left"
            >
              <span className="font-medium text-gray-900 dark:text-white truncate">{d.name}</span>
              <span className="inline-flex items-center px-3 py-1.5 rounded-lg bg-mint-green text-white text-sm font-semibold flex-shrink-0">
                Review &amp; sign
              </span>
            </button>
          ) : (
            <Link
              key={`n-${d.id}`}
              to={`/portal/sign/${d.id}`}
              className="flex items-center justify-between gap-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-4 py-3 hover:shadow-sm transition"
            >
              <span className="font-medium text-gray-900 dark:text-white truncate">{d.name}</span>
              <span className="inline-flex items-center px-3 py-1.5 rounded-lg bg-mint-green text-white text-sm font-semibold flex-shrink-0">
                Review &amp; sign
              </span>
            </Link>
          ),
        )}

        {/* Real GHL documents — open the signing link in a new tab */}
        {ghlItems.map((d, i) =>
          d.url ? (
            <button
              key={`g-${i}-${d.name}`}
              type="button"
              onClick={() => openGhlDoc(d.url)}
              className="w-full flex items-center justify-between gap-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-4 py-3 hover:shadow-sm transition text-left"
            >
              <span className="min-w-0">
                <span className="block font-medium text-gray-900 dark:text-white truncate">{d.name}</span>
                <span className="block text-xs text-gray-500">Opens in a new tab to review &amp; sign</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-mint-green text-white text-sm font-semibold flex-shrink-0">
                Review &amp; sign
                <ArrowTopRightOnSquareIcon className="w-4 h-4" />
              </span>
            </button>
          ) : (
            <div
              key={`g-${i}-${d.name}`}
              className="flex items-center justify-between gap-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-4 py-3"
            >
              <span className="font-medium text-gray-900 dark:text-white truncate">{d.name}</span>
              <span className="text-xs text-gray-400 flex-shrink-0">
                Link unavailable — ask your specialist to resend
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
