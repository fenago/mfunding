import { useState } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/solid";
import type { WeeklyApproval } from "@/services/timeTracking";
import ArmedButton from "@/components/admin/time-admin/ArmedButton";
import { isApproved } from "@/components/admin/time-admin/schedule";
import { formatHours, instantWithTime } from "@/components/admin/time-admin/format";

/**
 * The over-40 flag for one person's week.
 *
 * Loud when it should be: a week past the cap with no permission gets a bold
 * red chip. Approving it turns the chip amber and records who signed off. It
 * never blocks payment — the owner can still pay a flagged week, he just can't
 * miss that it is flagged.
 *
 * When the approvals table could not be read, the chip says so in grey rather
 * than claiming the week is unapproved. "We don't know" is not "not approved".
 */
export default function OvertimeFlag({
  hours,
  cap,
  overBy,
  approval,
  approvalsReadable,
  approverName,
  onApprove,
  onRevoke,
}: {
  hours: number;
  cap: number;
  /** Hours past the cap; 0 when the week is inside it. */
  overBy: number;
  approval: WeeklyApproval | null;
  /** false when the week's approvals could not be read at all. */
  approvalsReadable: boolean;
  approverName: string | null;
  onApprove: (note?: string) => Promise<void>;
  onRevoke: () => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const approved = isApproved(approval);
  const over = overBy > 0;

  if (!over && !approved) return null;

  // Over the cap but we could not read whether it was approved. Flagging it red
  // would accuse someone on the strength of a failed query.
  if (over && !approvalsReadable) {
    return (
      <span
        title="The overtime approvals could not be read, so this week's approval state is unknown."
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
      >
        OVER CAP — {formatHours(hours)} / {formatHours(cap)} · approval unknown
      </span>
    );
  }

  // Who decided it and when — shown for an approval AND for an explicit denial,
  // so a "no" is as attributable as a "yes".
  const decidedBy = approval ? (
    <span className="text-[11px] text-gray-500 dark:text-gray-400">
      {approverName ? `by ${approverName}` : "decided"}
      {approval.approved_at ? ` · ${instantWithTime(approval.approved_at)}` : ""}
      {approval.note ? ` · “${approval.note}”` : ""}
    </span>
  ) : null;

  if (approved) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span
          className={
            over
              ? "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
              : "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
          }
        >
          {over ? `OT approved (${formatHours(hours)})` : "OT pre-approved"}
        </span>
        {decidedBy}
        <ArmedButton
          label="Revoke"
          confirmLabel="Revoke approval?"
          title="Remove this week's overtime approval — the red flag comes back"
          onFire={onRevoke}
          className="border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          armedClassName="border border-red-400 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"
        />
      </span>
    );
  }

  const denied = approval != null && approval.approved === false;

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        title={
          denied
            ? `${formatHours(overBy)} past this person's ${formatHours(cap)} weekly cap, and explicitly denied`
            : `${formatHours(overBy)} past this person's ${formatHours(cap)} weekly cap, with no approval on file`
        }
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300 ring-1 ring-red-300 dark:ring-red-700"
      >
        <ExclamationTriangleIcon className="w-3.5 h-3.5" />
        {denied ? "OT DENIED — " : "OVER CAP — "}
        {formatHours(hours)} / {formatHours(cap)}
      </span>
      {denied && decidedBy}
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="reason (optional)"
        className="w-40 text-[11px] rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1"
      />
      <ArmedButton
        label="Approve overtime"
        confirmLabel={`Approve ${formatHours(overBy)} over?`}
        title="Sign off on this week's extra hours"
        onFire={async () => {
          await onApprove(note.trim() || undefined);
          setNote("");
        }}
        className="border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30"
        armedClassName="bg-amber-500 text-white hover:bg-amber-600"
      />
    </span>
  );
}
