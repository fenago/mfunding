import { useEffect } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import SignDocumentPanel from "./SignDocumentPanel";
import type { MerchantDocument } from "../../services/portalService";

interface SignDocumentModalProps {
  documentId: string;
  onClose: () => void;
  /** Fired after a successful signature so the dashboard can refresh in place. */
  onSigned?: (doc: MerchantDocument) => void;
}

/**
 * Full-screen overlay that hosts the signing panel so the merchant can review
 * and sign a contract without leaving the dashboard. On completion the caller
 * refreshes and the merchant closes back to where they were. The standalone
 * /portal/sign/:id route still exists for email deep links.
 */
export default function SignDocumentModal({ documentId, onClose, onSigned }: SignDocumentModalProps) {
  // Lock body scroll + close on Escape while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full sm:max-w-2xl bg-gray-50 dark:bg-gray-900 sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[94vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur">
          <span className="text-sm font-semibold text-gray-900 dark:text-white">Review &amp; sign</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6">
          <SignDocumentPanel documentId={documentId} onSigned={onSigned} />
        </div>

        <div className="px-4 sm:px-6 pb-5">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            Back to your dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
