import { useEffect, useState } from "react";
import { CalendarDaysIcon } from "@heroicons/react/24/outline";
import { DEFAULT_WEEKLY_HOURS_CAP, type ScheduleInput } from "@/services/timeTracking";
import type { Schedule } from "@/components/admin/time-admin/schedule";
import { formatHours } from "@/components/admin/time-admin/format";

/**
 * Per-person expected schedule: when the owner expects them in, what that should
 * come to in a week, and the cap above which the week needs his permission.
 *
 * Every field commits on blur or Enter and saves on its own, the same way the
 * hourly-rate cell does — there is no Save button to forget to press. Escape
 * restores the stored value.
 */

function InlineNumber({
  value,
  onSave,
  suffix,
  placeholder,
  title,
  /** Whether clearing the field is a real value. The cap is NOT NULL in the DB,
   *  so a blank there restores the stored number instead of trying to clear it. */
  clearable,
}: {
  value: number | null;
  onSave: (n: number | null) => Promise<void>;
  suffix: string;
  placeholder: string;
  title: string;
  clearable: boolean;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const [busy, setBusy] = useState(false);

  // Re-sync when the stored value moves under us (reload, or a failed save
  // reverting the optimistic row).
  useEffect(() => {
    setDraft(value == null ? "" : String(value));
  }, [value]);

  function restore() {
    setDraft(value == null ? "" : String(value));
  }

  async function commit() {
    const raw = draft.trim();
    if (raw === "") {
      if (!clearable) return restore();
      if (value == null) return;
      setBusy(true);
      try {
        await onSave(null);
      } finally {
        setBusy(false);
      }
      return;
    }
    const next = Number(raw);
    if (!Number.isFinite(next) || next < 0 || next > 168) return restore();
    if (next === value) return;
    setBusy(true);
    try {
      await onSave(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        min="0"
        max="168"
        step="0.5"
        inputMode="decimal"
        value={draft}
        disabled={busy}
        placeholder={placeholder}
        title={title}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            restore();
            e.currentTarget.blur();
          }
        }}
        className="w-16 text-right text-sm tabular-nums rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1 disabled:opacity-40"
      />
      <span className="text-[10px] text-gray-400">{suffix}</span>
    </span>
  );
}

function InlineText({
  value,
  onSave,
  placeholder,
}: {
  value: string | null;
  onSave: (s: string | null) => Promise<void>;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  async function commit() {
    const next = draft.trim() === "" ? null : draft.trim();
    if (next === value) return;
    setBusy(true);
    try {
      await onSave(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <input
      type="text"
      value={draft}
      disabled={busy}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value ?? "");
          e.currentTarget.blur();
        }
      }}
      className="w-full max-w-xs text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1 disabled:opacity-40"
    />
  );
}

/**
 * The one-line "when I expect them in" summary that sits under the person's
 * name, plus the toggle that opens the editor. It says "no schedule set" out
 * loud rather than leaving a blank line that reads as a missing field.
 */
export function ScheduleSummary({
  schedule,
  open,
  onToggle,
}: {
  schedule: Schedule;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
      <CalendarDaysIcon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      {schedule.scheduleNote ? (
        <span className="text-gray-600 dark:text-gray-300">{schedule.scheduleNote}</span>
      ) : (
        <span className="text-gray-400 dark:text-gray-500 italic">no schedule set</span>
      )}
      {schedule.expectedWeeklyHours != null && (
        <span className="text-gray-500 dark:text-gray-400 tabular-nums">
          · expects {formatHours(schedule.expectedWeeklyHours)}/wk
        </span>
      )}
      <span
        title={
          schedule.capStored
            ? "Hours past this need your approval"
            : `Nothing is stored for this person, so the ${DEFAULT_WEEKLY_HOURS_CAP}-hour house cap applies`
        }
        className="text-gray-500 dark:text-gray-400 tabular-nums"
      >
        · cap {formatHours(schedule.cap)}
        {schedule.capStored ? "" : " (default)"}
      </span>
      <button
        type="button"
        onClick={onToggle}
        className="text-[11px] font-semibold text-ocean-blue hover:underline"
      >
        {open ? "Hide schedule" : "Edit schedule"}
      </button>
    </div>
  );
}

export default function SchedulePanel({
  schedule,
  onSave,
}: {
  schedule: Schedule;
  /** Saves ONE field at a time — a partial patch, never a whole-row replace. */
  onSave: (patch: ScheduleInput) => Promise<void>;
}) {
  return (
    <div className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-3 py-3 max-w-xl space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Expected schedule
      </p>

      <label className="block">
        <span className="text-xs text-gray-600 dark:text-gray-300">When you expect them in</span>
        <div className="mt-1">
          <InlineText
            value={schedule.scheduleNote}
            onSave={(s) => onSave({ scheduleNote: s })}
            placeholder="Mon–Fri 9:00–5:00 ET"
          />
        </div>
      </label>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <label className="block">
          <span className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
            Expected weekly hours
          </span>
          <InlineNumber
            value={schedule.expectedWeeklyHours}
            onSave={(n) => onSave({ expectedWeeklyHours: n })}
            suffix="h/wk"
            placeholder="—"
            clearable
            title="What a normal week should come to. Leave it blank if you have not set one."
          />
        </label>

        <label className="block">
          <span className="block text-xs text-gray-600 dark:text-gray-300 mb-1">
            Weekly cap (overtime threshold)
          </span>
          <InlineNumber
            value={schedule.cap}
            onSave={(n) => onSave({ weeklyHoursCap: n })}
            suffix="h/wk"
            placeholder={String(DEFAULT_WEEKLY_HOURS_CAP)}
            clearable
            title={`Hours above this flag the week as overtime needing your approval. Clear it to go back to the ${DEFAULT_WEEKLY_HOURS_CAP}-hour default.`}
          />
        </label>
      </div>

      <p className="flex items-start gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
        <CalendarDaysIcon className="w-3.5 h-3.5 shrink-0 mt-px" />
        <span>
          Anything past{" "}
          <strong className="text-gray-700 dark:text-gray-200">{formatHours(schedule.cap)}</strong>{" "}
          in a week gets flagged until you approve it
          {schedule.capStored
            ? ""
            : ` — ${DEFAULT_WEEKLY_HOURS_CAP}h is the default because nothing is stored for this person yet`}
          . Every field saves as you leave it.
        </span>
      </p>
    </div>
  );
}
