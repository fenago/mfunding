import { useEffect, useRef, useState } from "react";
import { CalendarDaysIcon, ClockIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { dateTimeET, etDateTimeLocalToUtcIso, etDateTimeLocalValue, tomorrowAtEtIso } from "@/utils/time";

/**
 * SchedulePicker — an in-app date-time control for setting a callback or an
 * appointment. NO browser popups: it opens a small inline panel with a
 * <input type="datetime-local"> (interpreted in Eastern Time, the app's TZ) and a
 * Save button. Setting a time is non-destructive, so no armed two-step is needed.
 */

type Kind = "callback" | "appointment";

interface Props {
  kind: Kind;
  /** Current value (UTC ISO) or null. */
  value: string | null;
  /** Persist a new value (UTC ISO). Resolve to throw on failure so we can surface it. */
  onSave: (utcIso: string) => Promise<void>;
  /** Compact table-row styling vs. a fuller drawer button. */
  compact?: boolean;
}

export default function SchedulePicker({ kind, value, onSave, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  const isCallback = kind === "callback";
  const Icon = isCallback ? ClockIcon : CalendarDaysIcon;
  const noun = isCallback ? "callback" : "appointment";

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setLocal(value ? etDateTimeLocalValue(value) : etDateTimeLocalValue(tomorrowAtEtIso(10, 0)));
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, value]);

  const save = async () => {
    const iso = etDateTimeLocalToUtcIso(local);
    if (!iso) {
      setErr("Pick a valid date & time.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSave(iso);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : `Couldn't set the ${noun}.`);
    } finally {
      setBusy(false);
    }
  };

  const hasVal = !!value;
  const btnCls = compact
    ? `inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full border transition-colors ${
        hasVal
          ? "border-ocean-blue/50 text-ocean-blue"
          : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-ocean-blue hover:text-ocean-blue"
      }`
    : `inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
        hasVal
          ? "border-ocean-blue/50 text-ocean-blue"
          : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-ocean-blue hover:text-ocean-blue"
      }`;

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={btnCls}
        title={hasVal ? `${noun} ${dateTimeET(value!)} ET — click to change` : `Set a ${noun}`}
      >
        <Icon className="w-3.5 h-3.5" />
        {hasVal ? (compact ? dateTimeET(value!) : `${dateTimeET(value!)} ET`) : `Set ${noun}`}
      </button>

      {open && (
        <div className="absolute z-30 mt-1 right-0 w-64 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-900 dark:text-white capitalize">{noun}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>
          <input
            type="datetime-local"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-gray-900 dark:text-white"
          />
          <p className="mt-1 text-[10px] text-gray-400">Eastern Time</p>
          {err && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{err}</p>}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-ocean-blue text-white hover:bg-deep-sea disabled:opacity-50"
            >
              {busy ? <span className="loading loading-spinner loading-xs" /> : `Save ${noun}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
