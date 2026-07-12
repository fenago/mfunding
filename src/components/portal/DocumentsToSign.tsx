import { PencilSquareIcon, ArrowTopRightOnSquareIcon } from "@heroicons/react/24/solid";
import type { MerchantDocument } from "../../services/portalService";
import { openGhlDoc, type Signable, type ApplicationStatus } from "../../utils/signing";
import FreshApplicationLink from "./FreshApplicationLink";

interface DocumentsToSignProps {
  /** Unified pending signables (native + GHL), already collapsed by the
   *  one-application rule. */
  pending: Signable[];
  /** Open a native agreement in the in-app signing modal. */
  onSelectNative?: (doc: MerchantDocument) => void;
  /** Resolved application — powers the "fill out a fresh one" fallback link. */
  application?: ApplicationStatus;
}

/** One unified "ready to sign" list: native in-app agreements + real GHL docs.
 *  The merchant can't tell them apart. Renders nothing when nothing is pending. */
export default function DocumentsToSign({ pending, onSelectNative, application }: DocumentsToSignProps) {
  if (pending.length === 0) return null;

  return (
    <div className="rounded-xl border-2 border-ocean-blue/40 dark:border-ocean-blue/50 bg-ocean-blue/5 dark:bg-ocean-blue/10 p-5">
      <div className="flex items-center gap-2 mb-3">
        <PencilSquareIcon className="w-5 h-5 text-ocean-blue" />
        <h3 className="font-semibold text-gray-900 dark:text-white">
          {pending.length === 1 ? "Your document is ready to sign" : "Documents ready to sign"}
        </h3>
      </div>
      <div className="space-y-2">
        {pending.map((s, i) =>
          s.source === "native" ? (
            <button
              key={`n-${s.nativeDoc?.id ?? i}`}
              type="button"
              onClick={() => s.nativeDoc && onSelectNative?.(s.nativeDoc)}
              className="w-full flex items-center justify-between gap-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-4 py-3 hover:shadow-sm transition text-left"
            >
              <span className="font-medium text-gray-900 dark:text-white truncate">{s.name}</span>
              <span className="inline-flex items-center px-3 py-1.5 rounded-lg bg-mint-green text-white text-sm font-semibold flex-shrink-0">
                Review &amp; sign
              </span>
            </button>
          ) : s.url ? (
            <button
              key={`g-${i}-${s.name}`}
              type="button"
              onClick={() => openGhlDoc(s.url)}
              className="w-full flex items-center justify-between gap-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-4 py-3 hover:shadow-sm transition text-left"
            >
              <span className="min-w-0">
                <span className="block font-medium text-gray-900 dark:text-white truncate">{s.name}</span>
                <span className="block text-xs text-gray-500">Opens in a new tab to review &amp; sign</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-mint-green text-white text-sm font-semibold flex-shrink-0">
                Review &amp; sign
                <ArrowTopRightOnSquareIcon className="w-4 h-4" />
              </span>
            </button>
          ) : (
            <div
              key={`g-${i}-${s.name}`}
              className="flex items-center justify-between gap-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-4 py-3"
            >
              <span className="font-medium text-gray-900 dark:text-white truncate">{s.name}</span>
              <span className="text-xs text-gray-400 flex-shrink-0">
                Link unavailable — ask your specialist to resend
              </span>
            </div>
          ),
        )}
      </div>
      {application && <FreshApplicationLink application={application} className="mt-3" />}
    </div>
  );
}
