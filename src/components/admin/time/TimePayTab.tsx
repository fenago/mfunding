import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDaysIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";
import {
  checkIn,
  computeHours,
  getMyRate,
  getMySchedule,
  listMyAudit,
  listMyEntries,
  listMyPayRuns,
  shiftWeek,
  todayISO,
  weekBounds,
  type PayRun,
  type StaffRate,
  type TimeEntry,
  type TimeEntryAudit,
} from "@/services/timeTracking";
import WeekStrip, { type DayCell } from "./WeekStrip";
import WeekHistory, { type WeekSummary } from "./WeekHistory";
import PayRunList from "./PayRunList";
import {
  addDays,
  etStampFor,
  etTimeInputValue,
  fmtClock,
  fmtDate,
  fmtHours,
  fmtTimeOfDay,
} from "./timeUtils";

/** How far back the history goes. Keeps the read bounded on a long-tenured user. */
const HISTORY_DAYS = 182;

const QUICK_HOURS = [4, 6, 8];

/** Common shifts, one click. Eastern wall-clock — the same clock payroll uses. */
const SHIFT_PRESETS = [
  { label: "9–5 · 30m lunch", in: "09:00", out: "17:00", brk: "30" },
  { label: "8–5 · 1h lunch", in: "08:00", out: "17:00", brk: "60" },
];

const DEFAULT_IN = "09:00";
const DEFAULT_OUT = "17:00";

/**
 * The overtime line when payroll hasn't set a per-worker cap — and the fallback
 * when the schedule can't be read at all. Federal-standard 40, so the notice is
 * never wrong in a way that costs anyone hours.
 */
const DEFAULT_WEEKLY_CAP = 40;

/** Whatever shape the service hands back — inferred so it stays in step with it. */
type MySchedule = NonNullable<Awaited<ReturnType<typeof getMySchedule>>>;

/** How the worker is logging the day: real shift times, or a bare hours figure. */
type LogMode = "clock" | "hours";

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
  // Same three-way split as the rate: "no schedule set" (banner hidden, nothing
  // to say) and "couldn't read the schedule" are different facts, and only the
  // first one is safe to render as silence.
  const [scheduleState, setScheduleState] = useState<{
    status: "loading" | "ok" | "error";
    schedule: MySchedule | null;
  }>({ status: "loading", schedule: null });
  // The edit trail is a nice-to-have, so a failure here must not take the tab
  // down — but it must not render as "never edited" either. See the note below
  // the week strip.
  const [auditState, setAuditState] = useState<{
    status: "ok" | "error";
    rows: TimeEntryAudit[];
  }>({ status: "ok", rows: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [workDate, setWorkDate] = useState(today);
  const [mode, setMode] = useState<LogMode>("clock");
  const [clockInVal, setClockInVal] = useState(DEFAULT_IN);
  const [clockOutVal, setClockOutVal] = useState(DEFAULT_OUT);
  const [breakVal, setBreakVal] = useState("0");
  const [hours, setHours] = useState("8");
  const [note, setNote] = useState("");
  const [contextNote, setContextNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{
    date: string;
    hours: number;
    at: string | null;
    clockIn: string | null;
    clockOut: string | null;
  } | null>(null);

  /**
   * The window we read. Floored to a MONDAY so every week the strip can page to
   * is fully loaded — a window starting mid-week would render that week's
   * earlier days as blank when they were simply outside the query.
   */
  const historyFrom = useMemo(
    () => weekBounds(addDays(today, -HISTORY_DAYS)).start,
    [today],
  );

  /** Re-reads time entries + pay runs. Returns the fresh entries, or throws. */
  const loadEntries = useCallback(async () => {
    const [fresh, runs] = await Promise.all([
      listMyEntries(historyFrom),
      listMyPayRuns(),
    ]);
    setEntries(fresh);
    setPayRuns(runs);
    return fresh;
  }, [historyFrom]);

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

  // The expected schedule the owner set for this worker, if any. A failure here
  // is cosmetic — it must never stop someone logging the hours they worked.
  useEffect(() => {
    let cancelled = false;
    setScheduleState({ status: "loading", schedule: null });
    void (async () => {
      try {
        const s = await getMySchedule();
        if (!cancelled) setScheduleState({ status: "ok", schedule: s });
      } catch {
        if (!cancelled) setScheduleState({ status: "error", schedule: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const loadAudit = useCallback(async () => {
    try {
      const rows = await listMyAudit(historyFrom);
      setAuditState({ status: "ok", rows });
    } catch {
      setAuditState({ status: "error", rows: [] });
    }
  }, [historyFrom]);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit, userId]);

  const entryByDate = useMemo(() => {
    const map: Record<string, TimeEntry> = {};
    for (const e of entries) map[e.work_date] = e;
    return map;
  }, [entries]);

  /** Work dates whose saved figures were changed after the first submission. */
  const editedDates = useMemo(() => {
    const set = new Set<string>();
    for (const a of auditState.rows) if (a.action === "update") set.add(a.work_date);
    return set;
  }, [auditState.rows]);

  const existing = entryByDate[workDate] ?? null;

  // Pull the selected day's saved values into the form so an edit starts from
  // what's on file. Only re-runs when the date changes or entries reload, so it
  // never overwrites what the user is currently typing.
  useEffect(() => {
    const row = entryByDate[workDate];
    const savedIn = etTimeInputValue(row?.clock_in);
    const savedOut = etTimeInputValue(row?.clock_out);
    setHours(row ? fmtHours(row.hours) : "8");
    setNote(row?.note ?? "");
    setContextNote(row?.context_note ?? "");
    setClockInVal(savedIn || DEFAULT_IN);
    setClockOutVal(savedOut || DEFAULT_OUT);
    setBreakVal(row?.break_minutes ? fmtHours(row.break_minutes) : "0");
    // A day already logged as bare hours reopens in the hours form; everything
    // else (including a brand-new day) defaults to logging real shift times.
    setMode(savedIn && savedOut ? "clock" : row ? "hours" : "clock");
  }, [workDate, entryByDate]);

  // --- The live shift math -------------------------------------------------
  // Derived from the SAME instants and the SAME function the service will use,
  // so the "= 7.5 hrs" preview is the number that gets stored — including
  // across a DST switch, where wall-clock subtraction would be an hour off.
  const breakMinutes = useMemo(() => {
    const n = Number(breakVal);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [breakVal]);

  const shift = useMemo(() => {
    const inIso = etStampFor(workDate, clockInVal);
    const outIso = etStampFor(workDate, clockOutVal);
    if (!inIso || !outIso) {
      return { inIso, outIso, hours: null as number | null, error: "Enter both a clock-in and a clock-out time." };
    }
    if (Date.parse(outIso) <= Date.parse(inIso)) {
      return { inIso, outIso, hours: null, error: "Clock out has to be later than clock in — same day only." };
    }
    const h = computeHours(inIso, outIso, breakMinutes);
    if (h === null || h <= 0) {
      return { inIso, outIso, hours: null, error: "That break is as long as the shift — no paid hours left." };
    }
    if (h > 24) {
      return { inIso, outIso, hours: null, error: "That's more than 24 hours. Check the times." };
    }
    return { inIso, outIso, hours: h, error: null as string | null };
  }, [workDate, clockInVal, clockOutVal, breakMinutes]);

  const clockReady = mode === "clock" && shift.hours !== null;

  // --- Week paging ---------------------------------------------------------
  // Pass the date STRING, not a Date — the string path is pure calendar math
  // with no timezone conversion to shift the week.
  const thisWeek = useMemo(() => weekBounds(today), [today]);
  const [visibleWeekStart, setVisibleWeekStart] = useState(thisWeek.start);
  const visibleWeek = useMemo(() => weekBounds(visibleWeekStart), [visibleWeekStart]);
  const isCurrentWeek = visibleWeek.start === thisWeek.start;
  // Paging stops at the loaded window: an unloaded week would render as a week
  // of dashes, which is indistinguishable from a week nobody worked.
  const canGoBack = shiftWeek(visibleWeek.start, -1).start >= historyFrom;

  const cellsByDate = useMemo(() => {
    const map: Record<string, DayCell> = {};
    for (const e of entries) {
      map[e.work_date] = {
        hours: Number(e.hours) || 0,
        clockIn: e.clock_in,
        clockOut: e.clock_out,
        edited: editedDates.has(e.work_date),
      };
    }
    return map;
  }, [entries, editedDates]);

  /** Mon–Sun weeks other than the two already on screen, newest first. */
  const pastWeeks: WeekSummary[] = useMemo(() => {
    const byWeek: Record<string, { start: string; end: string; hours: number }> = {};
    for (const e of entries) {
      const { start, end } = weekBounds(e.work_date);
      if (start === thisWeek.start || start === visibleWeek.start) continue;
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
  }, [entries, payRuns, thisWeek.start, visibleWeek.start]);

  // --- The schedule the worker is measured against -------------------------
  const schedule = scheduleState.status === "ok" ? scheduleState.schedule : null;

  /** The overtime line. A missing or unreadable schedule falls back to 40. */
  const weeklyCap = useMemo(() => {
    const c = Number(schedule?.weekly_hours_cap);
    return Number.isFinite(c) && c > 0 ? c : DEFAULT_WEEKLY_CAP;
  }, [schedule]);

  /**
   * What the banner can actually say. A row that carries neither a note nor an
   * expected figure is not a schedule anyone set — it gets no banner, since an
   * empty "Your schedule:" tells the worker less than nothing.
   */
  const scheduleBanner = useMemo(() => {
    if (!schedule) return null;
    const note = schedule.schedule_note?.trim() || null;
    const expectedNum = Number(schedule.expected_weekly_hours);
    const expected = Number.isFinite(expectedNum) && expectedNum > 0 ? expectedNum : null;
    if (!note && expected === null) return null;
    return { note, expected };
  }, [schedule]);

  const clearFeedback = () => {
    setConfirmed(null);
    setSubmitError(null);
  };

  const handleCheckIn = async () => {
    setSubmitError(null);
    setConfirmed(null);

    // Build exactly one of the two shapes the service accepts: shift times (it
    // derives the hours) or explicit hours with the shift cleared, so a stored
    // shift can never sit next to an hours figure it didn't produce.
    let payload: Parameters<typeof checkIn>[0];
    if (mode === "clock") {
      if (!shift.hours || !shift.inIso || !shift.outIso) {
        setSubmitError(shift.error ?? "Check the clock-in and clock-out times.");
        return;
      }
      payload = {
        workDate,
        clockIn: shift.inIso,
        clockOut: shift.outIso,
        breakMinutes,
        note: note.trim() || undefined,
        contextNote: contextNote.trim() || null,
      };
    } else {
      const h = Number(hours);
      if (!Number.isFinite(h) || h <= 0) {
        setSubmitError("Enter the hours you worked — for example 8.");
        return;
      }
      if (h > 24) {
        setSubmitError("That's more than 24 hours. Check the number and try again.");
        return;
      }
      payload = {
        workDate,
        hours: h,
        // Explicit nulls, not omissions: switching a day from shift times back
        // to plain hours has to wipe the old times, or the week strip would
        // keep showing a shift that no longer matches the hours.
        clockIn: null,
        clockOut: null,
        breakMinutes: 0,
        note: note.trim() || undefined,
        contextNote: contextNote.trim() || null,
      };
    }

    setSubmitting(true);
    try {
      // checked_in_at is stamped by the DB, so the confirmation quotes the
      // server's time, not this browser's — and the clock times quoted back are
      // the ones actually stored, not the ones typed.
      const saved = await checkIn(payload);
      setConfirmed({
        date: workDate,
        hours: Number(saved?.hours) || shift.hours || Number(hours),
        at: saved?.checked_in_at ?? null,
        clockIn: saved?.clock_in ?? null,
        clockOut: saved?.clock_out ?? null,
      });
      // Show the week the entry landed in, so the confirmation and the strip
      // below it never disagree.
      setVisibleWeekStart(weekBounds(workDate).start);
      try {
        await loadEntries();
        void loadAudit();
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

  const fieldLabel = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";
  const chip =
    "rounded-full border border-gray-200 dark:border-gray-600 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:border-mint-green hover:text-mint-green transition-colors";

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

      {scheduleBanner && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm dark:border-gray-700 dark:bg-gray-800/40">
          <CalendarDaysIcon className="w-4 h-4 flex-shrink-0 text-mint-green" />
          <span className="text-gray-500 dark:text-gray-400">Your schedule:</span>
          {scheduleBanner.note && (
            <strong className="text-gray-900 dark:text-white">{scheduleBanner.note}</strong>
          )}
          {scheduleBanner.note && scheduleBanner.expected !== null && (
            <span className="text-gray-300 dark:text-gray-600">·</span>
          )}
          {scheduleBanner.expected !== null && (
            <span className="text-gray-700 dark:text-gray-300">
              <strong className="text-gray-900 dark:text-white">
                {fmtHours(scheduleBanner.expected)} hrs/week
              </strong>{" "}
              expected
            </span>
          )}
        </div>
      )}

      {scheduleState.status === "error" && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Couldn&apos;t read your schedule, so it isn&apos;t shown above — that doesn&apos;t mean
          none is set. The weekly notice falls back to {DEFAULT_WEEKLY_CAP} hours.
        </p>
      )}

      {/* --- Daily check-in: the whole point of this tab --- */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div className="flex items-start gap-2">
            <ClockIcon className="w-5 h-5 flex-shrink-0 mt-0.5 text-mint-green" />
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                Daily check-in
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Log your shift at the end of each day. One entry per day — times and dates follow
                the company&apos;s <strong>Eastern</strong> workday.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="text-xs font-medium text-mint-green hover:underline"
            onClick={() => {
              setMode((m) => (m === "clock" ? "hours" : "clock"));
              clearFeedback();
            }}
          >
            {mode === "clock" ? "Just enter hours instead" : "Log exact times instead"}
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="col-span-2 md:col-span-1">
            <label className={fieldLabel}>Date</label>
            <input
              type="date"
              className="input-field"
              value={workDate}
              max={today}
              onChange={(e) => {
                setWorkDate(e.target.value || today);
                clearFeedback();
              }}
            />
          </div>

          {mode === "clock" ? (
            <>
              <div>
                <label className={fieldLabel}>Clock in</label>
                <input
                  type="time"
                  className="input-field"
                  value={clockInVal}
                  onChange={(e) => {
                    setClockInVal(e.target.value);
                    clearFeedback();
                  }}
                />
              </div>
              <div>
                <label className={fieldLabel}>Clock out</label>
                <input
                  type="time"
                  className="input-field"
                  value={clockOutVal}
                  onChange={(e) => {
                    setClockOutVal(e.target.value);
                    clearFeedback();
                  }}
                />
              </div>
              <div>
                <label className={fieldLabel}>
                  Break / lunch <span className="font-normal text-gray-400">(minutes)</span>
                </label>
                <input
                  type="number"
                  className="input-field"
                  value={breakVal}
                  min={0}
                  max={480}
                  step={5}
                  onChange={(e) => {
                    setBreakVal(e.target.value);
                    clearFeedback();
                  }}
                />
              </div>
            </>
          ) : (
            <div className="col-span-2">
              <label className={fieldLabel}>Hours worked</label>
              <input
                type="number"
                className="input-field"
                value={hours}
                min={0}
                max={24}
                step={0.25}
                onChange={(e) => {
                  setHours(e.target.value);
                  clearFeedback();
                }}
              />
              <div className="flex gap-1.5 mt-1.5">
                {QUICK_HOURS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className={chip}
                    onClick={() => {
                      setHours(String(q));
                      clearFeedback();
                    }}
                  >
                    {q} hrs
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4">
          <label className={fieldLabel}>
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

        <div className="mt-4">
          <label className={fieldLabel}>
            Anything else? <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <textarea
            className="input-field min-h-[64px]"
            value={contextNote}
            onChange={(e) => {
              setContextNote(e.target.value);
              setConfirmed(null);
            }}
            placeholder="Any context you want your manager to see — e.g. internet was down 2 hrs, left early for an appointment."
          />
        </div>

        {mode === "clock" && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {shift.hours !== null ? (
              <span className="text-sm text-gray-700 dark:text-gray-300">
                = <strong className="text-gray-900 dark:text-white">{fmtHours(shift.hours)} hrs</strong>{" "}
                <span className="text-gray-500 dark:text-gray-400">
                  {breakMinutes > 0 ? `(after a ${fmtHours(breakMinutes)} min break)` : "(no break deducted)"}
                </span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400">
                <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
                {shift.error}
              </span>
            )}
            <span className="flex flex-wrap gap-1.5">
              {SHIFT_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={chip}
                  onClick={() => {
                    setClockInVal(p.in);
                    setClockOutVal(p.out);
                    setBreakVal(p.brk);
                    clearFeedback();
                  }}
                >
                  {p.label}
                </button>
              ))}
            </span>
          </div>
        )}

        {existing && (
          <p className="mt-3 inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-900/20 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            Already checked in for {fmtDate(workDate)} — saving updates that entry
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button
            className="btn-primary"
            onClick={handleCheckIn}
            disabled={submitting || (mode === "clock" && !clockReady)}
          >
            {submitting ? "Saving…" : existing ? "Update my hours" : "Check in"}
          </button>

          {confirmed && (
            <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
              <CheckCircleIcon className="w-5 h-5 flex-shrink-0" />
              <span>
                <strong>{fmtHours(confirmed.hours)} hrs</strong> logged for{" "}
                {fmtDate(confirmed.date)}
                {confirmed.clockIn && confirmed.clockOut
                  ? ` — ${fmtClock(confirmed.clockIn)} to ${fmtClock(confirmed.clockOut)} ET`
                  : ""}
                {confirmed.at ? ` · saved at ${fmtTimeOfDay(confirmed.at)}` : ""}
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
          <div className="space-y-2">
            <WeekStrip
              weekStart={visibleWeek.start}
              weekEnd={visibleWeek.end}
              byDate={cellsByDate}
              today={today}
              selectedDate={workDate}
              isCurrentWeek={isCurrentWeek}
              canGoBack={canGoBack}
              weeklyCap={weeklyCap}
              onPrev={() => setVisibleWeekStart(shiftWeek(visibleWeek.start, -1).start)}
              onNext={() => setVisibleWeekStart(shiftWeek(visibleWeek.start, 1).start)}
              onThisWeek={() => setVisibleWeekStart(thisWeek.start)}
              onSelectDay={(d) => {
                // Pointing the form at a day from a past week is the whole reason
                // paging exists — no date-picker hunting to fix last Tuesday.
                setWorkDate(d);
                clearFeedback();
              }}
            />
            {workDate !== today && (
              // The form sits above the fold, so a click down here would
              // otherwise look like it did nothing.
              <p className="text-xs text-gray-500 dark:text-gray-400">
                The check-in form above is pointed at <strong>{fmtDate(workDate)}</strong>.
              </p>
            )}
            {auditState.status === "error" ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Couldn&apos;t read your edit history, so no day is marked as edited above — that
                doesn&apos;t mean none were.
              </p>
            ) : (
              editedDates.size > 0 && (
                <p className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                  <PencilSquareIcon className="w-3.5 h-3.5 flex-shrink-0 text-amber-500 dark:text-amber-400" />
                  Days marked with a pencil were changed after the first check-in. Payroll sees the
                  same trail.
                </p>
              )
            )}
          </div>
          <WeekHistory weeks={pastWeeks} rate={rateState.rate} rateStatus={rateState.status} />
          <PayRunList runs={payRuns} />
        </>
      )}
    </div>
  );
}
