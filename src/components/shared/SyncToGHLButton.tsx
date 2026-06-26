import { useState } from "react";
import { ArrowPathIcon, CheckCircleIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { syncCustomerToGHL, syncDealToGHL, type GhlSyncResult } from "../../services/ghlService";

interface SyncToGHLButtonProps {
  entity: "customer" | "deal";
  id: string;
  /** Optional callback after a successful sync (e.g. to refetch the record). */
  onSynced?: (result: GhlSyncResult) => void;
  className?: string;
}

/**
 * "Sync to GHL" button. Pushes the customer/deal into GoHighLevel via the
 * `ghl-sync` edge function (token stays server-side). Shows inline status.
 */
export default function SyncToGHLButton({ entity, id, onSynced, className }: SyncToGHLButtonProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [result, setResult] = useState<GhlSyncResult | null>(null);

  async function handleSync() {
    setIsSyncing(true);
    setResult(null);
    try {
      const res = entity === "customer" ? await syncCustomerToGHL(id) : await syncDealToGHL(id);
      setResult(res);
      if (res.ok) onSynced?.(res);
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsSyncing(false);
    }
  }

  const ok = result?.ok && !result.error;

  return (
    <div className="flex items-center gap-2">
      {result && (
        <span
          className={`inline-flex items-center gap-1 text-xs font-medium ${
            ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
          }`}
          title={result.error || result.warning || ""}
        >
          {ok ? <CheckCircleIcon className="w-4 h-4" /> : <ExclamationTriangleIcon className="w-4 h-4" />}
          {ok
            ? result.warning
              ? "Contact synced (no pipeline)"
              : entity === "deal"
                ? `Synced${result.stage ? ` → ${result.stage}` : ""}`
                : "Contact synced"
            : "Sync issue"}
        </span>
      )}
      <button
        onClick={handleSync}
        disabled={isSyncing}
        className={
          className ??
          "px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60 inline-flex items-center gap-2"
        }
        title="Push this record to GoHighLevel"
      >
        <ArrowPathIcon className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`} />
        {isSyncing ? "Syncing…" : "Sync to GHL"}
      </button>
    </div>
  );
}
