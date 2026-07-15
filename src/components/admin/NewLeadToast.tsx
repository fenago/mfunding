import { XMarkIcon, BellIcon } from "@heroicons/react/24/outline";
import type { CornerAlert } from "../../hooks/useNewLeadAlert";

// The unmissable corner alert stack. Fixed bottom-right, above everything — sits
// at bottom-24 so it clears the transient status toast AND the floating "switch
// lead" buttons (both at bottom-6) instead of covering them. Two kinds:
//   · new_lead     — a live transfer (red pulse) / real-time lead (mint)
//   · vendor_match — a Synergy vendor email deduped into a NOT-open deal (calm blue)
// Cards persist until clicked (opens the deal) or dismissed; that persistence is
// the point.
export default function NewLeadToast({
  alerts,
  onOpen,
  onDismiss,
  desktopEnabled,
  onEnableDesktop,
}: {
  alerts: CornerAlert[];
  onOpen: (dealId: string) => void;
  onDismiss: (dealId: string) => void;
  desktopEnabled: boolean;
  onEnableDesktop: () => void;
}) {
  if (alerts.length === 0) return null;
  const canOfferDesktop = typeof Notification !== "undefined" && !desktopEnabled;
  return (
    <div className="fixed bottom-24 right-4 sm:right-6 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col items-stretch gap-2">
      {alerts.map((a) => (
        <AlertCard key={a.dealId} alert={a} onOpen={onOpen} onDismiss={onDismiss} />
      ))}
      {/* Opt-in desktop alerts — permission is requested ON CLICK only, never
          auto-prompted. Rides along with the first live alert so it never nags. */}
      {canOfferDesktop && (
        <button
          type="button"
          onClick={onEnableDesktop}
          className="inline-flex items-center justify-center gap-1.5 self-end rounded-full border border-gray-300 dark:border-gray-600 bg-white/90 dark:bg-gray-800/90 px-3 py-1 text-[11px] font-medium text-gray-600 dark:text-gray-300 shadow-md backdrop-blur hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <BellIcon className="w-3.5 h-3.5" />
          Enable desktop alerts
        </button>
      )}
    </div>
  );
}

function AlertCard({
  alert,
  onOpen,
  onDismiss,
}: {
  alert: CornerAlert;
  onOpen: (dealId: string) => void;
  onDismiss: (dealId: string) => void;
}) {
  const isMatch = alert.kind === "vendor_match";
  const isLive = alert.leadSource === "live_transfer";
  const ask = alert.ask && alert.ask > 0 ? `$${Math.round(alert.ask / 1000)}K` : null;

  // Left-edge accent + header tone by kind: red for a live transfer, mint for a
  // real-time lead, calmer blue for a vendor-email match on a deal you're not on.
  const edge = isMatch ? "border-l-ocean-blue" : isLive ? "border-l-red-500" : "border-l-mint-green";
  const headTone = isMatch ? "text-ocean-blue" : isLive ? "text-red-600 dark:text-red-400" : "text-mint-green";
  const label = isMatch ? "Vendor email matched" : isLive ? "New live transfer" : "New real-time lead";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(alert.dealId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen(alert.dealId);
      }}
      title={`Open ${alert.business} in the playbook`}
      className={`group relative cursor-pointer rounded-xl border border-gray-200 dark:border-gray-700 border-l-4 ${edge} bg-white dark:bg-gray-800 shadow-2xl ring-1 ring-black/5 p-3.5 hover:-translate-y-0.5 transition`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide ${headTone}`}>
          {isMatch ? <span aria-hidden>📩</span> : isLive ? <PulseDot /> : <span aria-hidden>⏱</span>}
          {label}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(alert.dealId);
          }}
          title="Dismiss"
          className="shrink-0 -mr-1 -mt-1 rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      <p className="mt-1.5 text-sm font-bold text-gray-900 dark:text-white truncate">{alert.business}</p>

      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {isMatch ? (
            "deal refreshed"
          ) : ask ? (
            <>
              asking <b className="text-gray-700 dark:text-gray-200">{ask}</b>
            </>
          ) : isLive ? (
            "on the line now"
          ) : (
            "email within 5 min"
          )}
          {alert.dealNumber && <span className="text-gray-400"> · {alert.dealNumber}</span>}
        </span>
        <span className="text-[11px] font-semibold text-ocean-blue opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          Open →
        </span>
      </div>
    </div>
  );
}

// Red ping dot — the "they're on the line" urgency marker for live transfers.
function PulseDot() {
  return (
    <span className="relative flex h-2.5 w-2.5" aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
    </span>
  );
}
