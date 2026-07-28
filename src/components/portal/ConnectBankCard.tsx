import { useCallback, useEffect, useState } from "react";
import {
  BuildingLibraryIcon,
  ShieldCheckIcon,
  ArrowPathIcon,
  BoltIcon,
} from "@heroicons/react/24/outline";
import { CheckBadgeIcon } from "@heroicons/react/24/solid";
import { getMyPlaidItem, type PlaidItem } from "../../services/portalService";
import { usePlaidConnect } from "../../hooks/usePlaidConnect";

interface Props {
  /** The signed-in merchant's customer id (from getMyCustomer). */
  customerId: string;
  /** Optional deal to attach the connection to; omit → backend uses latest deal. */
  dealId?: string | null;
  /** Tighter padding for the dashboard action area. */
  compact?: boolean;
  /** Bubble up so the parent page can refresh its own state after a connect. */
  onConnected?: () => void;
}

/**
 * ConnectBankCard — "Connect your bank (60 seconds)".
 *
 * Bank statements are the #1 place funding requests stall (days of back-and-forth
 * chasing PDFs). This lets the merchant connect their bank through Plaid's own
 * secure flow so we can verify business revenue in about a minute — WE never see
 * or store their bank login credentials.
 *
 * States: already-connected (green, no button) · needs-reconnect (error/revoked)
 * · not-connected (the prominent CTA). All copy is MCA-compliant — this verifies
 * revenue, it is never described as a loan.
 */
export default function ConnectBankCard({ customerId, dealId, compact, onConnected }: Props) {
  const [item, setItem] = useState<PlaidItem | null>(null);
  const [loading, setLoading] = useState(true);

  const loadItem = useCallback(async () => {
    try {
      setItem(await getMyPlaidItem(customerId));
    } catch {
      // Non-blocking: a status read failure shouldn't hide the connect option.
      setItem(null);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void loadItem();
  }, [loadItem]);

  const { start, busy, error, reset } = usePlaidConnect({
    createBody: dealId ? { dealId } : {},
    exchangeBody: dealId ? { dealId } : {},
    onConnected: () => {
      void loadItem();
      onConnected?.();
    },
  });

  const pad = compact ? "p-5" : "p-6";

  if (loading) {
    return (
      <div className={`bg-white dark:bg-gray-800 rounded-xl ${pad} border border-gray-200 dark:border-gray-700`}>
        <div className="flex items-center gap-3 text-gray-400">
          <ArrowPathIcon className="w-5 h-5 animate-spin" />
          <span className="text-sm">Checking your bank connection…</span>
        </div>
      </div>
    );
  }

  // ── Connected & healthy — reassure, don't nag ────────────────────────────
  if (item && item.status === "active") {
    const pulled = item.last_pull_at ? new Date(item.last_pull_at).toLocaleDateString() : null;
    const txns = item.transactions_count ?? 0;
    return (
      <div className={`rounded-xl ${pad} border border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20`}>
        <div className="flex items-start gap-3">
          <CheckBadgeIcon className="w-7 h-7 text-emerald-500 flex-shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold text-emerald-800 dark:text-emerald-200">
              Bank connected{item.institution_name ? ` — ${item.institution_name}` : ""}
            </p>
            <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-0.5">
              Your business revenue is verified — thank you. Nothing else to send.
              {pulled && txns > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400">
                  {" "}Last synced {pulled}
                  {txns > 0 ? ` · ${txns.toLocaleString()} transactions on file` : ""}.
                </span>
              )}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Connected but broken (error / revoked) — offer a quiet reconnect ─────
  if (item && (item.status === "error" || item.status === "revoked")) {
    return (
      <div className={`rounded-xl ${pad} border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20`}>
        <div className="flex items-start gap-3">
          <BuildingLibraryIcon className="w-7 h-7 text-amber-500 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-amber-800 dark:text-amber-200">
              Your bank connection needs a quick refresh
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-0.5">
              Reconnect{item.institution_name ? ` ${item.institution_name}` : " your bank"} so we can keep your revenue verified.
            </p>
            {error && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{error}</p>}
            <button
              type="button"
              onClick={() => (error ? reset() : start())}
              disabled={busy}
              className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-amber-400 dark:border-amber-600 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowPathIcon className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
              {busy ? "Connecting…" : error ? "Try again" : "Reconnect"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Not connected — the prominent 60-second CTA ──────────────────────────
  return (
    <div className={`rounded-xl ${pad} border border-ocean-blue/30 dark:border-ocean-blue/40 bg-gradient-to-br from-blue-50 to-white dark:from-blue-900/20 dark:to-gray-800`}>
      <div className="flex items-start gap-3">
        <div className="p-2 bg-ocean-blue/10 dark:bg-ocean-blue/20 rounded-lg flex-shrink-0">
          <BoltIcon className="w-6 h-6 text-ocean-blue" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 dark:text-white">
            Connect your bank (60 seconds)
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
            The fastest way to move forward: connect your bank to verify your business revenue
            instead of digging up and uploading statements.
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <ShieldCheckIcon className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            Bank-level security via Plaid. We never see or store your bank login credentials.
          </p>

          {error && (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <button
            type="button"
            onClick={() => (error ? reset() : start())}
            disabled={busy}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-ocean-blue rounded-lg hover:bg-ocean-blue/90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? (
              <>
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
                Connecting…
              </>
            ) : error ? (
              "Try again"
            ) : (
              <>
                <BuildingLibraryIcon className="w-4 h-4" />
                Connect your bank
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
