import { XMarkIcon } from "@heroicons/react/24/outline";
import type { MatchBanner } from "../../hooks/useNewLeadAlert";

// Compact money: $25K above a grand, else the raw dollars. Big enough to read at
// a glance mid-call.
const money = (n: number | null | undefined) =>
  n && n > 0 ? (n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n)}`) : "—";

/**
 * The SPECIAL in-playbook banner: the Synergy vendor email for the deal the closer
 * is working just landed and merged. The closer is ON THE PHONE, so this doesn't
 * just announce the refresh — it puts the mid-call essentials (revenue, ask,
 * credit, best time) in front of them at a glance. Mint→gold pulse, dismissible,
 * auto-fades on its own (the hook clears it after ~30s).
 */
export default function VendorEmailBanner({ banner, onDismiss }: { banner: MatchBanner; onDismiss: () => void }) {
  const stats: { label: string; value: string }[] = [
    { label: "Monthly revenue", value: money(banner.monthlyRevenue) },
    { label: "Ask", value: money(banner.ask) },
    { label: "Credit", value: banner.creditScore?.trim() || "—" },
    { label: "Best time to call", value: banner.bestTime?.trim() || "—" },
  ];
  return (
    <div className="relative mb-3 overflow-hidden rounded-xl border border-mint-green/50 bg-gradient-to-r from-mint-green/10 via-amber-100/40 to-amber-200/20 dark:from-mint-green/15 dark:via-amber-500/10 dark:to-amber-400/5 shadow-lg">
      {/* Pulsing mint→gold left accent — the "it just landed" motion. */}
      <span className="pointer-events-none absolute inset-y-0 left-0 w-1.5 animate-pulse bg-gradient-to-b from-mint-green to-amber-400" />
      <div className="p-4 pl-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-extrabold text-gray-900 dark:text-white">
              <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint-green opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-mint-green" />
              </span>
              <span aria-hidden>📩</span>
              The vendor email for THIS deal just landed — lead data refreshed
            </p>
            <p className="mt-0.5 truncate text-xs text-gray-600 dark:text-gray-300">
              {banner.business}
              {banner.dealNumber && <span className="text-gray-400"> · {banner.dealNumber}</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            title="Dismiss"
            className="shrink-0 rounded p-0.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>

        {/* The mid-call strip — big values, readable while talking. */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-lg border border-gray-200/70 dark:border-gray-700/70 bg-white/70 dark:bg-gray-900/40 px-3 py-2"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{s.label}</p>
              <p className="text-lg font-bold leading-tight text-gray-900 dark:text-white truncate" title={s.value}>
                {s.value}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
          If you'd already typed data, any differences the vendor sent are preserved in the deal notes.
        </p>
      </div>
    </div>
  );
}
