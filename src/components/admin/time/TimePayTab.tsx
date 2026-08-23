import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import {
  checkIn,
  getMyRate,
  listMyEntries,
  listMyPayRuns,
  todayISO,
  weekBounds,
  type PayRun,
  type StaffRate,
  type TimeEntry,
} from "@/services/timeTracking";
import WeekStrip from "./WeekStrip";
import WeekHistory, { type WeekSummary } from "./WeekHistory";
import PayRunList from "./PayRunList";
import { addDays, fmtDate, fmtHours, fmtTimeOfDay } from "./timeUtils";

/** How far back the history goes. Keeps the read bounded on a long-tenured user. */
const HISTORY_DAYS = 182;

const QUICK_HOURS = [4, 6, 8];

export default function TimePayTab({
  userId,
  isImpersonating,
}: {
  userId?: string;
  isImpersonating: boolean;
}) {
  // "Today" is the Eastern work date the service and DB agree on — a setter in
  // Manila and payroll in Florida must be checking in against the same day.
  const today = useMemo(() => todayISO(), []);

  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [payRuns, setPayRuns] = useState<PayRun[]>([]);
  // "No rate set" and "couldn't read the rate" look identical if you collapse
  // them to null, and the first is a plausible-looking lie when the second is
  // true — it sends someone to payroll over a rate that's configured fine.
  const [rateState, setRateState] = useState<{
    status: "loading" | "ok" | "error";
    rate: StaffRate | null;
  }>({ status: "loading", rate: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [workDate, setWorkDate] = useState(today);
  const [hours, setHours] = useState("8");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{
    date: string;
    hours: number;
    at: string | null;
  } | null>(null);

  /** Re-reads time entries + pay runs. Returns the fresh entries, or throws. */
  const loadEntries = useCallback(async () => {
    const from = addDays(today, -HISTORY_DAYS);
    const [fresh, runs] = await Promise.all([listMyEntries(from), listMyPayRuns()]);
    setEntries(fresh);
    setPayRuns(runs);
    return fresh;
  }, [today]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    loadEntries()
      .then(() => {
        if (!cancelled) setLoadError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Loud, not silent: a failed read must never render as "you logged nothing".
        setLoadError(
          err instanceof Error ? err.message : "Could not load your time entries.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadEntries, userId]);

  // The worker's own rate. getMyRate() returns null only for a genuinely absent
  // row and THROWS on a read failure — keep those apart. Either way no estimate
  // is shown, so a wrong number can never reach the screen.
  useEffect(() => {
    let cancelled = false;
    setRateState({ status: "loading", rate: null });
    void (async () => {
      try {
        const r = await getMyRate();
        if (!cancelled) setRateState({ status: "ok", rate: r });
      } catch {
        if (!cancelled) setRateState({ status: "error", rate: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const entryByDate = useMemo(() => {
    const map: Record<string, TimeEntry> = {};
    for (const e of entries) map[e.work_date] = e;
    return map;
  }, [entries]);

  const existing = entryByDate[workDate] ?? null;

  // Pull the selected day's saved values into the form so an edit starts from
  // what's on file. Only re-runs when the date changes or entries reload, so it
  // never overwrites what the user is currently typing.
  useEffect(() => {
    const row = entryByDate[workDate];
    setHours(row ? fmtHours(row.hours) : "8");
    setNote(row?.note ?? "");
  }, [workDate, entryByDate]);

  // Pass the date STRING, not a Date — the string path is pure calendar math
  // with no timezone conversion to shift the week.
  const thisWeek = useMemo(() => weekBounds(today), [today]);

  const hoursByDate = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of entries) {
      map[e.work_date] = (map[e.work_date] || 0) + (Number(e.hours) || 0);
    }
    return map;
  }, [entries]);

  /** Past Mon–Sun weeks (current week lives in the strip above), newest first. */
  const pastWeeks: WeekSummary[] = useMemo(() => {
    const byWeek: Record<string, { start: string; end: string; hours: number }> = {};
    for (const e of entries) {
      const { start, end } = weekBounds(e.work_date);
      if (start === thisWeek.start) continue;
      if (!byWeek[start]) byWeek[start] = { start, end, hours: 0 };
      byWeek[start].hours += Number(e.hours) || 0;
    }
    return Object.values(byWeek)
      .sort((a, b) => (a.start < b.start ? 1 : -1))
      .map((w) => ({
        ...w,
        // Prefer a run cut for exactly this week; otherwise any run whose period
        // covers it (bi-weekly / semi-monthly payroll).
        run:
          payRuns.find((r) => r.period_start === w.start) ??
          payRuns.find((r) => r.period_start <= w.start && r.period_end >= w.end) ??
          null,
      }));
  }, [entries, payRuns, thisWeek.start]);

  const handleCheckIn = async () => {
    const h = Number(hours);
    setSubmitError(null);
    setConfirmed(null);
    if (!Number.isFinite(h) || h <= 0) {
      setSubmitError("Enter the hours you worked — for example 8.");
      return;
    }
    if (h > 24) {
      setSubmitError("That's more than 24 hours. Check the number and try again.");
      return;
    }
    setSubmitting(true);
    try {
      // checked_in_at is stamped by the DB, so the confirmation quotes the
      // server's time, not this browser's.
      const saved = await checkIn({ workDate, hours: h, note: note.trim() || undefined });
      setConfirmed({ date: workDate, hours: h, at: saved?.checked_in_at ?? null });
      try {
        await loadEntries();
        setLoadError(null);
      } catch {
        // The check-in itself succeeded — only the refresh failed. Say so rather
        // than showing a stale week strip as if it were current.
        setLoadError("Checked in, but the lists below couldn't refresh. Reload the page.");
      }
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Could not save your check-in. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {isImpersonating && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-300">
          <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>
            This tab always shows <strong>your own</strong> hours and pay — not the hours of the
            user you&apos;re viewing as.
          </span>
        </div>
      )}

      {/* --- Daily check-in: the whole point of this tab --- */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-start gap-2 mb-3">
          <ClockIcon className="w-5 h-5 flex-shrink-0 mt-0.5 text-mint-green" />
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Daily check-in</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Log your hours at the end of each shift. One entry per day — dates follow the
              company&apos;s Eastern workday.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Date
            </label>
            <input
              type="date"
              className="input-field"
              value={workDate}
              max={today}
              onChange={(e) => {
                setWorkDate(e.target.value || today);
                setConfirmed(null);
                setSubmitError(null);
              }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Hours worked
            </label>
            <input
              type="number"
              className="input-field"
              value={hours}
              min={0}
              max={24}
              step={0.25}
              onChange={(e) => {
                setHours(e.target.value);
                setConfirmed(null);
                setSubmitError(null);
              }}
            />
            <div className="flex gap-1.5 mt-1.5">
              {QUICK_HOURS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    setHours(String(q));
                    setConfirmed(null);
                  }}
                  className="rounded-full border border-gray-200 dark:border-gray-600 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:border-mint-green hover:text-mint-green transition-colors"
                >
                  {q} hrs
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              What did you work on? <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              className="input-field"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setConfirmed(null);
              }}
              placeholder="Dialed UCC list, 40 contacts"
            />
          </div>
        </div>

        {existing && (
          <p className="mt-3 inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-900/20 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            Already checked in for {fmtDate(workDate)} — saving updates that entry
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button className="btn-primary" onClick={handleCheckIn} disabled={submitting}>
            {submitting ? "Saving…" : existing ? "Update my hours" : "Check in"}
          </button>

          {confirmed && (
            <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
              <CheckCircleIcon className="w-5 h-5 flex-shrink-0" />
              <span>
                <strong>{fmtHours(confirmed.hours)} hrs</strong> logged for{" "}
                {fmtDate(confirmed.date)}
                {confirmed.at ? ` — checked in at ${fmtTimeOfDay(confirmed.at)}` : ""}
              </span>
            </span>
          )}

          {submitError && (
            <span className="flex items-center gap-1 text-sm text-red-600 dark:text-red-400">
              <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0" />
              {submitError}
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading your hours and pay…</p>
      ) : loadError ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-300">
          <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>
            <strong>Couldn&apos;t load your time records.</strong> {loadError} Your hours are not
            shown below — this is a loading problem, not an empty week.
          </span>
        </div>
      ) : (
        <>
          <WeekStrip
            weekStart={thisWeek.start}
            weekEnd={thisWeek.end}
            hoursByDate={hoursByDate}
            today={today}
          />
          <WeekHistory weeks={pastWeeks} rate={rateState.rate} rateStatus={rateState.status} />
          <PayRunList runs={payRuns} />
        </>
      )}
    </div>
  );
}
