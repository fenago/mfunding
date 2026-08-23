import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  createPendingRun,
  listAllEntries,
  listAllPayRuns,
  listStaffWithRates,
  markPaid,
  shiftWeek,
  upsertRate,
  weekBounds,
  type PayRun,
  type StaffWithRate,
  type TimeEntry,
} from "@/services/timeTracking";
import ArmedButton from "@/components/admin/time-admin/ArmedButton";
import PaymentHistory from "@/components/admin/time-admin/PaymentHistory";
import {
  displayName,
  formatHours,
  formatMoney,
  formatRange,
  instantWithTime,
  loggedLate,
  ROLE_BADGE,
  shortDate,
  shortInstant,
} from "@/components/admin/time-admin/format";

// ---------------------------------------------------------------------------
// Rate cell — inline-editable, commits on blur or Enter, optimistic upstream.
// ---------------------------------------------------------------------------

function RateInput({
  value,
  currency,
  onSave,
}: {
  value: number | null;
  currency: string | null;
  onSave: (rate: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const [busy, setBusy] = useState(false);

  // Re-sync when the row's rate changes underneath us (reload, failed save revert).
  useEffect(() => {
    setDraft(value == null ? "" : String(value));
  }, [value]);

  async function commit() {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n) || n < 0) {
      setDraft(value == null ? "" : String(value)); // reject junk, restore truth
      return;
    }
    if (value != null && n === value) return;
    setBusy(true);
    try {
      await onSave(n);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <span className="text-xs text-gray-400">{(currency || "USD") === "USD" ? "$" : currency}</span>
      <input
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        value={draft}
        disabled={busy}
        placeholder="—"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(value == null ? "" : String(value));
            e.currentTarget.blur();
          }
        }}
        className="w-20 text-right text-sm tabular-nums rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1 disabled:opacity-40"
      />
      <span className="text-[10px] text-gray-400">/hr</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Row = {
  staff: StaffWithRate;
  entries: TimeEntry[];
  hours: number;
  rate: number | null;
  /** null when no rate is set — an unknown cost, NOT a zero cost. */
  cost: number | null;
  run: PayRun | null;
  lateCount: number;
};

export default function TimePayPage() {
  const [staff, setStaff] = useState<StaffWithRate[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [runs, setRuns] = useState<PayRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // The Monday of the week being run. weekBounds() owns the Monday-start rule.
  const [weekStart, setWeekStart] = useState<string>(() => weekBounds(new Date()).start);
  // weekStart is already a calendar date, so it goes through weekBounds as a
  // STRING — handing it back as a Date would re-read it as an instant in
  // Eastern and shift it a day (and, on a Monday, a whole week).
  const week = useMemo(() => weekBounds(weekStart), [weekStart]);
  const thisWeekStart = useMemo(() => weekBounds(new Date()).start, []);

  const notify = (text: string, tone: "ok" | "error" = "ok") => setToast({ text, tone });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, e, r] = await Promise.all([
        listStaffWithRates(),
        listAllEntries(week.start, week.end),
        listAllPayRuns(),
      ]);
      setStaff(s);
      setEntries(e);
      setRuns(r);
    } catch (err) {
      // Surface the failure — an empty table must never be mistaken for "nobody
      // worked this week" when the truth is "we could not read the hours".
      setError(err instanceof Error ? err.message : "Could not load time & pay data.");
    } finally {
      setLoading(false);
    }
  }, [week.start, week.end]);

  useEffect(() => {
    void load();
  }, [load]);

  function goWeek(deltaWeeks: number) {
    setWeekStart(shiftWeek(weekStart, deltaWeeks).start);
    setExpanded(new Set());
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // --- derived ------------------------------------------------------------

  const entriesByUser = useMemo(() => {
    const m = new Map<string, TimeEntry[]>();
    for (const e of entries) {
      const list = m.get(e.user_id);
      if (list) list.push(e);
      else m.set(e.user_id, [e]);
    }
    for (const list of m.values()) list.sort((a, b) => a.work_date.localeCompare(b.work_date));
    return m;
  }, [entries]);

  /** The pay run covering THIS week, per user. A paid run outranks a pending one. */
  const runForWeek = useMemo(() => {
    const m = new Map<string, PayRun>();
    for (const r of runs) {
      if (r.period_start !== week.start || r.period_end !== week.end) continue;
      const prev = m.get(r.user_id);
      if (
        !prev ||
        (prev.status !== "paid" && r.status === "paid") ||
        (prev.status === r.status && (r.created_at || "") > (prev.created_at || ""))
      ) {
        m.set(r.user_id, r);
      }
    }
    return m;
  }, [runs, week.start, week.end]);

  const rows = useMemo<Row[]>(
    () =>
      staff.map((s) => {
        const es = entriesByUser.get(s.id) ?? [];
        const hours = es.reduce((t, e) => t + (Number(e.hours) || 0), 0);
        const rate = s.hourly_rate == null ? null : Number(s.hourly_rate);
        return {
          staff: s,
          entries: es,
          hours,
          rate,
          cost: rate == null ? null : hours * rate,
          run: runForWeek.get(s.id) ?? null,
          lateCount: es.filter((e) => loggedLate(e.work_date, e.checked_in_at)).length,
        };
      }),
    [staff, entriesByUser, runForWeek]
  );

  // Someone with a pay run but no hours still shows — a recorded payment must
  // never disappear behind the zero-hours filter.
  const visibleRows = useMemo(
    () => (showAll ? rows : rows.filter((r) => r.hours > 0 || r.run)),
    [rows, showAll]
  );

  const totalHours = rows.reduce((t, r) => t + r.hours, 0);
  const totalCost = rows.reduce((t, r) => t + (r.cost ?? 0), 0);
  const unpaidCost = rows
    .filter((r) => r.run?.status !== "paid")
    .reduce((t, r) => t + (r.cost ?? 0), 0);
  const workedCount = rows.filter((r) => r.hours > 0).length;
  const missingRateCount = rows.filter((r) => r.hours > 0 && r.rate == null).length;
  const lateTotal = rows.reduce((t, r) => t + r.lateCount, 0);

  // --- actions ------------------------------------------------------------

  async function saveRate(s: StaffWithRate, rate: number) {
    const before = s.hourly_rate;
    setStaff((prev) => prev.map((x) => (x.id === s.id ? { ...x, hourly_rate: rate } : x)));
    try {
      await upsertRate(s.id, rate, s.currency ?? undefined);
      notify(`${displayName(s)} set to ${formatMoney(rate, s.currency)}/hr`);
    } catch (err) {
      setStaff((prev) => prev.map((x) => (x.id === s.id ? { ...x, hourly_rate: before } : x)));
      notify(err instanceof Error ? err.message : "Could not save the rate.", "error");
    }
  }

  async function recordRun(row: Row, mode: "paid" | "pending") {
    if (row.rate == null || row.cost == null) return;
    const args = {
      userId: row.staff.id,
      periodStart: week.start,
      periodEnd: week.end,
      hours: row.hours,
      hourlyRate: row.rate,
      amount: row.cost,
    };
    try {
      if (mode === "paid") await markPaid(args);
      else await createPendingRun(args);
      // Re-read rather than patching locally: the run row's id/paid_at/status
      // are set server-side and the history section reads the same list.
      setRuns(await listAllPayRuns());
      notify(
        mode === "paid"
          ? `${displayName(row.staff)} marked paid — ${formatMoney(row.cost, row.staff.currency)}`
          : `${displayName(row.staff)} staged as pending — ${formatMoney(row.cost, row.staff.currency)}`
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not record the pay run.", "error");
    }
  }

  // --- render -------------------------------------------------------------

  const isThisWeek = week.start === thisWeekStart;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ClockIcon className="w-6 h-6 text-ocean-blue" /> Time &amp; Pay
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            One screen to run weekly payroll — hours logged, hourly rate, what it costs, and what
            has actually been paid.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1 text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <ArrowPathIcon className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Week picker */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
        <button
          onClick={() => goWeek(-1)}
          title="Previous week"
          className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
        <div className="min-w-[16rem]">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Week of
          </p>
          <p className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">
            {formatRange(week.start, week.end)}
          </p>
        </div>
        <button
          onClick={() => goWeek(1)}
          title="Next week"
          className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <ChevronRightIcon className="w-4 h-4" />
        </button>

        {isThisWeek ? (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            This week
          </span>
        ) : (
          <button
            onClick={() => {
              setWeekStart(thisWeekStart);
              setExpanded(new Set());
            }}
            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            This week
          </button>
        )}

        <label className="ml-auto flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
            className="rounded border-gray-300 dark:border-gray-600"
          />
          Show all staff
        </label>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0" />
          <span>
            <strong>Could not load this week.</strong> {error}
          </span>
        </div>
      )}

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Hours this week
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums text-gray-900 dark:text-white">
            {formatHours(totalHours)}
          </p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">
            {workedCount} {workedCount === 1 ? "person" : "people"} logged time
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Total cost
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums text-gray-900 dark:text-white">
            {formatMoney(totalCost)}
          </p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">
            {missingRateCount > 0 ? (
              <span className="text-amber-600 dark:text-amber-400">
                excludes {missingRateCount} with no rate
              </span>
            ) : (
              "every person with hours has a rate"
            )}
          </p>
        </div>
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Still unpaid
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums text-amber-800 dark:text-amber-300">
            {formatMoney(unpaidCost)}
          </p>
          <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 leading-tight">
            what you still owe for this week
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Logged late
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums text-gray-900 dark:text-white">
            {lateTotal}
          </p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">
            {lateTotal === 0 ? "all entries logged same-day" : "entries backfilled 2+ days later"}
          </p>
        </div>
      </div>

      {/* Staff table */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        {loading ? (
          <p className="p-6 text-sm text-gray-400">Loading hours…</p>
        ) : visibleRows.length === 0 ? (
          <p className="p-6 text-sm text-gray-500 dark:text-gray-400">
            {rows.length === 0
              ? "No staff found."
              : "Nobody logged hours this week. Turn on “Show all staff” to see everyone."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">Staff</th>
                  <th className="px-4 py-3 font-medium text-right">Hours</th>
                  <th className="px-4 py-3 font-medium text-right">Rate</th>
                  <th className="px-4 py-3 font-medium text-right">Cost</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {visibleRows.map((row) => {
                  const s = row.staff;
                  const isOpen = expanded.has(s.id);
                  const daySummary = row.entries
                    .map((e) => `${shortDate(e.work_date)}: ${formatHours(Number(e.hours) || 0)}`)
                    .join("\n");

                  return (
                    <tr
                      key={s.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700/40 align-top"
                    >
                      <td className="px-4 py-3" colSpan={isOpen ? 6 : 1}>
                        <div className="flex items-start gap-2">
                          <button
                            onClick={() => toggleExpanded(s.id)}
                            disabled={row.entries.length === 0}
                            title={
                              row.entries.length === 0
                                ? "No entries this week"
                                : isOpen
                                  ? "Hide the day-by-day breakdown"
                                  : "Show the day-by-day breakdown"
                            }
                            className="mt-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-25 disabled:cursor-default"
                          >
                            {isOpen ? (
                              <ChevronDownIcon className="w-4 h-4" />
                            ) : (
                              <ChevronRightIcon className="w-4 h-4" />
                            )}
                          </button>
                          <div>
                            <div className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                              {displayName(s)}
                              {row.lateCount > 0 && (
                                <span
                                  title={`${row.lateCount} ${row.lateCount === 1 ? "entry was" : "entries were"} logged late`}
                                  className="inline-block w-2 h-2 rounded-full bg-amber-500"
                                />
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-gray-500 dark:text-gray-400">
                                {s.email ?? "—"}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  ROLE_BADGE[s.role] ??
                                  "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                                }`}
                              >
                                {s.role}
                              </span>
                            </div>

                            {/* Day-by-day, with the time each entry was RECORDED so
                                backfilled hours are obvious before they get paid. */}
                            {isOpen && (
                              <div className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 divide-y divide-gray-200 dark:divide-gray-700 max-w-3xl">
                                {row.entries.map((e) => {
                                  const late = loggedLate(e.work_date, e.checked_in_at);
                                  return (
                                    <div
                                      key={e.id}
                                      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-xs"
                                    >
                                      <span className="w-24 font-medium text-gray-700 dark:text-gray-200">
                                        {shortDate(e.work_date)}
                                      </span>
                                      <span className="w-14 text-right tabular-nums font-semibold text-gray-900 dark:text-white">
                                        {formatHours(Number(e.hours) || 0)}
                                      </span>
                                      <span className="text-gray-500 dark:text-gray-400">
                                        logged {instantWithTime(e.checked_in_at)}
                                      </span>
                                      {late && (
                                        <span
                                          title="logged late"
                                          className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"
                                        >
                                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                                          logged late
                                        </span>
                                      )}
                                      {e.note && (
                                        <span className="text-gray-500 dark:text-gray-400 italic">
                                          {e.note}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* When expanded the row goes full-width, so the money
                            columns move onto their own line underneath. */}
                        {isOpen && (
                          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 pl-6">
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              Week total{" "}
                              <strong className="text-gray-900 dark:text-white tabular-nums">
                                {formatHours(row.hours)}
                              </strong>
                            </span>
                            <RateInput
                              value={row.rate}
                              currency={s.currency}
                              onSave={(n) => saveRate(s, n)}
                            />
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              Cost{" "}
                              <strong className="text-gray-900 dark:text-white tabular-nums">
                                {row.cost == null ? "—" : formatMoney(row.cost, s.currency)}
                              </strong>
                            </span>
                            <StatusCell run={row.run} />
                            <span className="flex items-center gap-2">
                              <ActionCell row={row} onRecord={recordRun} />
                            </span>
                          </div>
                        )}
                      </td>

                      {!isOpen && (
                        <>
                          <td className="px-4 py-3 text-right">
                            <span
                              className="tabular-nums font-semibold text-gray-900 dark:text-white"
                              title={daySummary || "No entries this week"}
                            >
                              {formatHours(row.hours)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <RateInput
                              value={row.rate}
                              currency={s.currency}
                              onSave={(n) => saveRate(s, n)}
                            />
                          </td>
                          <td className="px-4 py-3 text-right">
                            {row.cost == null ? (
                              <span
                                className="text-xs text-amber-600 dark:text-amber-400"
                                title="Set an hourly rate to compute this week's cost"
                              >
                                set a rate
                              </span>
                            ) : (
                              <span className="tabular-nums font-bold text-gray-900 dark:text-white">
                                {formatMoney(row.cost, s.currency)}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <StatusCell run={row.run} />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-2">
                              <ActionCell row={row} onRecord={recordRun} />
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-gray-900 border-t-2 border-gray-200 dark:border-gray-700">
                <tr>
                  <td className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">
                    Week total
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-bold text-gray-900 dark:text-white">
                    {formatHours(totalHours)}
                  </td>
                  <td />
                  <td className="px-4 py-3 text-right tabular-nums font-bold text-gray-900 dark:text-white">
                    {formatMoney(totalCost)}
                  </td>
                  <td className="px-4 py-3 text-xs text-amber-700 dark:text-amber-400 font-semibold">
                    {unpaidCost > 0 ? `${formatMoney(unpaidCost)} unpaid` : "all settled"}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <PaymentHistory runs={runs} staff={staff} loading={loading} />

      {/* Status toast — bottom-right, auto-dismisses. */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-lg bg-gray-900 dark:bg-gray-700 text-white shadow-xl px-4 py-3 flex items-start gap-3">
          {toast.tone === "error" ? (
            <ExclamationTriangleIcon className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          ) : (
            <CheckCircleIcon className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          )}
          <p className="text-sm">{toast.text}</p>
          <button onClick={() => setToast(null)} className="shrink-0 text-gray-400 hover:text-white">
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row pieces — shared by the collapsed (table cell) and expanded (inline) layouts.
// ---------------------------------------------------------------------------

function StatusCell({ run }: { run: PayRun | null }) {
  if (!run) return <span className="text-gray-400">—</span>;
  if (run.status === "paid") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
        Paid{run.paid_at ? ` ${shortInstant(run.paid_at)}` : ""}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
      Pending
    </span>
  );
}

function ActionCell({
  row,
  onRecord,
}: {
  row: Row;
  onRecord: (row: Row, mode: "paid" | "pending") => Promise<void>;
}) {
  if (row.run?.status === "paid") {
    return (
      <span className="text-xs text-gray-400 tabular-nums">
        {formatMoney(Number(row.run.amount) || 0, row.run.currency)}
      </span>
    );
  }

  const noRate = row.cost == null;
  const noHours = row.hours <= 0;
  const blocked = noRate || noHours;
  const why = noRate
    ? "Set an hourly rate first"
    : noHours
      ? "No hours logged this week"
      : undefined;

  return (
    <>
      {!row.run && (
        <ArmedButton
          label="Mark pending"
          confirmLabel="Confirm pending?"
          disabled={blocked}
          title={why ?? "Stage this week without paying it yet"}
          onFire={() => onRecord(row, "pending")}
          className="border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          armedClassName="border border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
        />
      )}
      <ArmedButton
        label="Mark paid"
        confirmLabel={`Confirm ${row.cost == null ? "" : formatMoney(row.cost, row.staff.currency)}?`}
        disabled={blocked}
        title={why ?? "Record this week as paid"}
        onFire={() => onRecord(row, "paid")}
        className="bg-ocean-blue text-white hover:opacity-90"
        armedClassName="bg-emerald-600 text-white hover:bg-emerald-700"
      />
    </>
  );
}
