import { Link } from "react-router-dom";
import { PencilSquareIcon } from "@heroicons/react/24/solid";
import type { MerchantDocument } from "../../services/portalService";

interface DocumentsToSignProps {
  /** Documents in the 'sent' state — awaiting the merchant's signature. */
  documents: MerchantDocument[];
}

/** Dashboard card listing agreements ready for the merchant to sign. Renders
 *  nothing when there's nothing pending. */
export default function DocumentsToSign({ documents }: DocumentsToSignProps) {
  const pending = documents.filter((d) => d.status === "sent");
  if (pending.length === 0) return null;

  return (
    <div className="rounded-xl border-2 border-ocean-blue/40 dark:border-ocean-blue/50 bg-ocean-blue/5 dark:bg-ocean-blue/10 p-5">
      <div className="flex items-center gap-2 mb-3">
        <PencilSquareIcon className="w-5 h-5 text-ocean-blue" />
        <h3 className="font-semibold text-gray-900 dark:text-white">
          {pending.length === 1 ? "Your agreement is ready to sign" : "Agreements ready to sign"}
        </h3>
      </div>
      <div className="space-y-2">
        {pending.map((d) => (
          <Link
            key={d.id}
            to={`/portal/sign/${d.id}`}
            className="flex items-center justify-between gap-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-4 py-3 hover:shadow-sm transition"
          >
            <span className="font-medium text-gray-900 dark:text-white truncate">{d.name}</span>
            <span className="inline-flex items-center px-3 py-1.5 rounded-lg bg-mint-green text-white text-sm font-semibold flex-shrink-0">
              Review &amp; sign
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
