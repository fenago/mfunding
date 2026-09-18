import { XMarkIcon, BellIcon, CheckBadgeIcon } from "@heroicons/react/24/outline";
import type { CornerAlert } from "../../lib/cornerAlert";
// Generic short-relative-time helper (it lives next to the portal's notification
// list, but it is not portal-specific — reusing it beats a fifth copy).
import { relativeTime } from "../../utils/portalNotifications";

// The unmissable corner alert stack. Fixed bottom-right, above everything — sits
// at bottom-24 so it clears the transient status toast AND the floating "switch
// lead" buttons (both at bottom-6) instead of covering them. Three kinds:
//   · new_lead     — a live transfer (red pulse) / real-time lead (mint)
//   · vendor_match — a Synergy vendor email deduped into a NOT-open deal (calm blue)
//   · app_signed   — the merchant signed their APPLICATION (green, celebratory)
// Cards persist until clicked (opens the deal) or dismissed; that persistence is
// the point.
//
// The signature card is deliberately the calm one: green, a badge icon, no pulse,
// and it states how long ago the merchant actually signed. It is good news that
// may already be an hour old, and it must never read like a live transfer.
export default function NewLeadToast({
  alerts,
  onOpen,
  onDismiss,
  desktopEnabled,
  onEnableDesktop,
}: {
  alerts: CornerAlert[];
  onOpen: (dealId: string) => void;
  /** By `key`, not deal id — one deal can hold a lead card AND a signature card. */
  onDismiss: (key: string) => void;
  desktopEnabled: boolean;
  onEnableDesktop: () => void;
}) {
  if (alerts.length === 0) return null;
  const canOfferDesktop = typeof Notification !== "undefined" && !desktopEnabled;
  return (
    <div className="fixed bottom-24 right-4 sm:right-6 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col items-stretch gap-2">
      {alerts.map((a) => (
        <AlertCard key={a.key} alert={a} onOpen={onOpen} onDismiss={onDismiss} />
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
  onDismiss: (key: string) => void;
}) {
  if (alert.kind === "app_signed" && alert.signed) {
    return <SignedCard alert={alert} signed={alert.signed} onOpen={onOpen} onDismiss={onDismiss} />;
  }
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
            onDismiss(alert.key);
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

/**
 * The APPLICATION SIGNED card.
 *
 * Green, badged, no pulse — visibly not an emergency. Three things it must get
 * right, all of them lessons paid for:
 *
 *  · WHICH DOCUMENT, spelled out. A merchant signed the Broker Compensation
 *    Disclosure twice on 2026-09-16 and thought he was done; naming the document
 *    on the card is what stops the reader making the same substitution. (Only
 *    applications reach this card at all — the SQL rule filters the rest.)
 *  · WHEN THEY SIGNED, not when we found out. Signatures are discovered by an
 *    hourly sweep, so "signed 52m ago · found 4m ago" is the honest line and
 *    "just now" would be a lie about how warm the merchant is.
 *  · WHAT TO DO NEXT. Statements on file or not is the difference between "this
 *    is already moving" and "someone has to chase right now".
 */
function SignedCard({
  alert,
  signed,
  onOpen,
  onDismiss,
}: {
  alert: CornerAlert;
  signed: NonNullable<CornerAlert["signed"]>;
  onOpen: (dealId: string) => void;
  onDismiss: (key: string) => void;
}) {
  const canOpen = !!alert.dealId;
  const signedAgo = signed.signedAt ? relativeTime(signed.signedAt) : null;
  const foundAgo = signed.seenAt ? relativeTime(signed.seenAt) : null;
  // Only worth showing the discovery lag when it is material (the sweep is
  // hourly, so it often is) — otherwise it's noise.
  const lagMs =
    signed.signedAt && signed.seenAt ? Date.parse(signed.seenAt) - Date.parse(signed.signedAt) : NaN;
  const showFound = Number.isFinite(lagMs) && lagMs > 5 * 60 * 1000;
  const needsStatements = signed.statementsCount === 0;

  return (
    <div
      role={canOpen ? "button" : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={canOpen ? () => onOpen(alert.dealId) : undefined}
      onKeyDown={(e) => {
        if (canOpen && (e.key === "Enter" || e.key === " ")) onOpen(alert.dealId);
      }}
      title={
        signed.signedAt
          ? `Signed ${new Date(signed.signedAt).toLocaleString()}${
              signed.seenAt ? ` · our copy recorded it ${new Date(signed.seenAt).toLocaleString()}` : ""
            }`
          : "Signature time not reported by the document provider"
      }
      className={`group relative rounded-xl border border-gray-200 dark:border-gray-700 border-l-4 border-l-emerald-500 bg-white dark:bg-gray-800 shadow-2xl ring-1 ring-black/5 p-3.5 transition ${
        canOpen ? "cursor-pointer hover:-translate-y-0.5" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
          <CheckBadgeIcon className="w-4 h-4" />
          Application signed
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(alert.key);
          }}
          title="Dismiss"
          className="shrink-0 -mr-1 -mt-1 rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      <p className="mt-1.5 text-sm font-bold text-gray-900 dark:text-white truncate">{alert.business}</p>

      {/* The document, named. Never let the reader assume which one it was. */}
      <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 truncate">
        <span className="font-semibold text-gray-700 dark:text-gray-200">{signed.docName}</span>
        {alert.dealNumber && <span className="text-gray-400"> · {alert.dealNumber}</span>}
      </p>

      {/* The merchant's REAL signing time — plus how late we found out. */}
      <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
        {signedAgo ? (
          <>
            signed <b className="text-gray-700 dark:text-gray-200">{signedAgo === "just now" ? "just now" : `${signedAgo} ago`}</b>
            {showFound && foundAgo && <span className="text-gray-400"> · found {foundAgo} ago</span>}
          </>
        ) : (
          <span className="text-gray-400">signing time not reported</span>
        )}
      </p>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            needsStatements
              ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
              : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
          }`}
        >
          {needsStatements
            ? "no bank statements yet"
            : `${signed.statementsCount} statement${signed.statementsCount === 1 ? "" : "s"} on file`}
        </span>
        {canOpen && (
          <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            Open →
          </span>
        )}
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
