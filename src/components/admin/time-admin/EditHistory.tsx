/**
 * The audit trail for logged hours.
 *
 * The owner's ask, verbatim: "if somebody puts in two hours and then comes back
 * four days later and updates that to four hours, I need to know about that."
 * So every piece here answers three questions in this order — WHAT changed,
 * WHEN it was changed, and HOW LATE that was relative to the day worked.
 *
 * An entry that was logged once and never touched shows nothing at all. Silence
 * here means "clean", which is only safe because the caller renders a separate,
 * explicit state when the audit rows could not be READ.
 */

import { ClockIcon, PencilSquareIcon } from "@heroicons/react/24/outline";
import type { TimeEntryAudit } from "@/services/timeTracking";
import {
  editEvents,
  firstLoggedByEntry,
  summarize,
  type AuditChange,
  type EditEvent,
} from "./auditDiff";
import {
  formatHours,
  instantWithTime,
  lateLabel,
  LATE_TONE_CLASS,
  shortDate,
} from "./format";

export type NameFor = (userId: string | null) => string | null;

function byWhom(userId: string | null, nameFor?: NameFor): string {
  const name = userId && nameFor ? nameFor(userId) : null;
  if (name) return name;
  return userId ? "an unknown user" : "unknown";
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

/**
 * The amber "edited" chip. Count is the number of edits; `late` drives the
 * colour, because one edit that landed four days later matters more than five
 * that landed the same afternoon.
 */
export function EditedBadge({
  count,
  late,
  onClick,
  compact = false,
}: {
  count: number;
  late: number;
  onClick?: () => void;
  compact?: boolean;
}) {
  if (count <= 0) return null;
  const tone =
    late > 0
      ? "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700"
      : "bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600";
  const label = `edited${count > 1 ? ` ×${count}` : ""}`;
  const title =
    late > 0
      ? `${late} of ${count} ${count === 1 ? "edit" : "edits"} landed 2+ days after the day worked`
      : `${count} ${count === 1 ? "edit" : "edits"}, all same-day or next-day`;

  const cls = `inline-flex items-center gap-1 rounded-full border font-semibold ${tone} ${
    compact ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-[11px]"
  } ${onClick ? "hover:brightness-95 cursor-pointer" : ""}`;

  if (!onClick) {
    return (
      <span className={cls} title={title}>
        <PencilSquareIcon className="w-3 h-3" /> {label}
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} title={`${title} — click to see them`}>
      <PencilSquareIcon className="w-3 h-3" /> {label}
    </button>
  );
}

/** "4 days later" — red past 4 days, amber at 2–3, quiet before that. */
export function LatenessChip({ days }: { days: number | null }) {
  const tone = days == null ? "unknown" : days >= 4 ? "very-late" : days >= 2 ? "late" : "ok";
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${LATE_TONE_CLASS[tone]}`}
      title="How long after the day worked this change was made"
    >
      {lateLabel(days)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// One change: "Hours 2h → 4h (+2h)"
// ---------------------------------------------------------------------------

function ChangeBit({ change, alarm }: { change: AuditChange; alarm: boolean }) {
  const added = (change.deltaHours ?? 0) > 0;
  const valueTone = alarm && added
    ? "text-red-700 dark:text-red-300"
    : "text-gray-900 dark:text-white";
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-gray-500 dark:text-gray-400">{change.label}</span>
      {change.from && (
        <>
          <span className="text-gray-400 line-through tabular-nums">{change.from}</span>
          <span className="text-gray-400">→</span>
        </>
      )}
      <strong className={`tabular-nums ${valueTone}`}>{change.to}</strong>
      {change.deltaHours != null && change.deltaHours !== 0 && (
        <span
          className={`text-[10px] font-semibold tabular-nums ${
            added ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"
          }`}
        >
          ({added ? "+" : "−"}
          {formatHours(Math.abs(change.deltaHours))})
        </span>
      )}
    </span>
  );
}

function EventRow({ event, nameFor }: { event: EditEvent; nameFor?: NameFor }) {
  const a = event.audit;
  return (
    <div
      className={`px-3 py-2 text-xs ${
        event.tone === "very-late"
          ? "bg-red-50 dark:bg-red-900/15"
          : event.tone === "late"
            ? "bg-amber-50 dark:bg-amber-900/15"
            : ""
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="w-24 shrink-0 font-medium text-gray-700 dark:text-gray-200">
          {shortDate(a.work_date)}
        </span>
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {event.changes.map((c) => (
            <ChangeBit key={c.field} change={c} alarm={event.isLate} />
          ))}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-24 text-[11px] text-gray-500 dark:text-gray-400">
        <span>changed {instantWithTime(a.changed_at)}</span>
        <span>by {byWhom(a.changed_by, nameFor)}</span>
        <LatenessChip days={event.daysLate} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

/**
 * Every edit one person made to this week's hours, newest first. `rows` must be
 * ONE person's audit rows — the header's "first logged" is derived from them,
 * and a week-wide list would report someone else's earliest entry.
 */
export default function EditHistoryPanel({
  rows,
  nameFor,
}: {
  rows: TimeEntryAudit[];
  nameFor?: NameFor;
}) {
  const events = editEvents(rows);
  const summary = summarize(events);
  const firstLogged = firstLoggedByEntry(rows);

  if (events.length === 0) {
    return (
      <div className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-3 py-2 text-xs text-gray-500 dark:text-gray-400 max-w-3xl">
        No edits — every entry this week is as it was first logged.
      </div>
    );
  }

  const earliest = [...firstLogged.values()].sort((a, b) => a.localeCompare(b))[0];

  return (
    <div className="mt-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-gray-900/40 max-w-3xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
        <PencilSquareIcon className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        <span className="text-xs font-bold text-amber-800 dark:text-amber-300">
          Edit history — {summary.total} {summary.total === 1 ? "change" : "changes"}
        </span>
        {summary.late > 0 ? (
          <span className="text-xs font-semibold text-red-700 dark:text-red-300">
            {summary.late} landed <u>2+ days after the day worked</u>
            {summary.lateHoursAdded > 0
              ? `, adding ${formatHours(summary.lateHoursAdded)}`
              : ""}
          </span>
        ) : (
          <span className="text-xs text-gray-600 dark:text-gray-400">
            all same-day or next-day
          </span>
        )}
        {earliest && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
            <ClockIcon className="w-3 h-3" /> first logged {instantWithTime(earliest)}
          </span>
        )}
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {events.map((e) => (
          <EventRow key={e.audit.id} event={e} nameFor={nameFor} />
        ))}
      </div>
    </div>
  );
}

/**
 * Page-level tamper view: every edit in the visible week that landed 2+ days
 * after the day worked, all staff together. Closed by default (house rule), and
 * it never renders "clean" on unread data — `unreadable` is its own branch.
 */
export function RecentEditsStrip({
  rows,
  unreadable,
  nameFor,
  open,
  onToggle,
}: {
  rows: TimeEntryAudit[] | null;
  unreadable: string | null;
  nameFor?: NameFor;
  open: boolean;
  onToggle: () => void;
}) {
  if (unreadable || rows == null) {
    return (
      <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
        <strong>Edit history unavailable.</strong>{" "}
        {unreadable ?? "The audit trail could not be read."} Treat this week's hours as{" "}
        <u>unverified</u> — this is not the same as “nobody edited anything”.
      </div>
    );
  }

  const all = editEvents(rows);
  const late = all.filter((e) => e.isLate);

  if (all.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">
        <strong className="text-gray-700 dark:text-gray-200">No edits this week.</strong> Every
        entry stands as it was first logged.
      </div>
    );
  }

  const addedHours = late.reduce((t, e) => t + Math.max(0, e.hoursDelta ?? 0), 0);

  return (
    <div
      className={`rounded-xl border overflow-hidden ${
        late.length > 0
          ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20"
          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left"
      >
        <PencilSquareIcon
          className={`w-4 h-4 ${late.length > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-400"}`}
        />
        <span className="text-sm font-bold text-gray-900 dark:text-white">
          {late.length > 0 ? `${late.length} late ${late.length === 1 ? "edit" : "edits"}` : "Recent edits"}
        </span>
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {late.length > 0 ? (
            <>
              changed <u>2+ days after the day worked</u>
              {addedHours > 0 && (
                <>
                  {" "}
                  · <strong className="text-red-700 dark:text-red-300">
                    +{formatHours(addedHours)}
                  </strong>{" "}
                  added after the fact
                </>
              )}
            </>
          ) : (
            `${all.length} ${all.length === 1 ? "edit" : "edits"} this week, all same-day or next-day`
          )}
        </span>
        <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
          {open ? "Hide" : "Show"}
        </span>
      </button>
      {open && (
        <div className="border-t border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-800">
          {(late.length > 0 ? late : all).map((e) => (
            <div key={e.audit.id} className="px-4 py-2">
              <div className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">
                {nameFor?.(e.audit.user_id) ?? "Unnamed"}
              </div>
              <EventRow event={e} nameFor={nameFor} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
