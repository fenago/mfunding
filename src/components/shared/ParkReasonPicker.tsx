import { useState } from "react";
import { LOST_REASON_OPTIONS, type LostReason } from "@/types/deals";

/**
 * The reason a deal is being parked, collected inline.
 *
 * deals.lost_reason was NULL on all 274 nurture deals because no park path
 * accepted a reason. This is the one place that asks, so every park screen
 * asks the same question the same way.
 *
 * INLINE, NOT A MODAL. Two reasons. The house rule is no browser popups —
 * parks already use the two-step "arm then fire" pattern, and this slots into
 * the armed state rather than replacing it. And a setter hitting "Not
 * interested" mid-call must not get a dialog: that path passes its reason in
 * code and never renders this at all.
 *
 * No default is pre-selected. A pre-filled dropdown is how you get 274 rows
 * that all say the same thing — the operator picks, or nothing happens.
 */
export default function ParkReasonPicker({
  label = "Why?",
  confirmLabel = "Move to nurture",
  busy = false,
  onCancel,
  onConfirm,
}: {
  label?: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: LostReason) => void;
}) {
  const [reason, setReason] = useState<LostReason | "">("");

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 dark:border-amber-700 dark:bg-amber-900/20">
      <span className="text-xs font-semibold text-amber-800 dark:text-amber-200">{label}</span>
      <select
        className="input-field h-8 py-0 text-xs"
        value={reason}
        disabled={busy}
        autoFocus
        onChange={(e) => setReason(e.target.value as LostReason | "")}
      >
        <option value="">Pick a reason…</option>
        {LOST_REASON_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-xs btn-warning"
        disabled={busy || reason === ""}
        onClick={() => reason !== "" && onConfirm(reason)}
      >
        {busy ? "Working…" : confirmLabel}
      </button>
      <button type="button" className="btn btn-xs btn-ghost" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
