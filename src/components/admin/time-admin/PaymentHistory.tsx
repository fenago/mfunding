import { useMemo, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { type PayRun, type StaffWithRate } from "@/services/timeTracking";
import { displayName, formatHours, formatMoney, formatRange, ROLE_BADGE, shortInstant } from "./format";

/**
 * Every pay run ever recorded, newest-first, with a per-person filter.
 * Reference content, so it starts COLLAPSED — the week the owner is actually
 * running payroll for is the live work above it.
 */
export default function PaymentHistory({
  runs,
  staff,
  loading,
}: {
  runs: PayRun[];
  staff: StaffWithRate[];
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState<string>("all");

  const nameOf = useMemo(() => {
    const m = new Map<string, StaffWithRate>();
    for (const s of staff) m.set(s.id, s);
    return m;
  }, [staff]);

  // Sorted defensively rather than trusting the service's ORDER BY.
  const sorted = useMemo(
    () =>
      [...runs].sort((a, b) => {
        if (a.period_start !== b.period_start) return a.period_start < b.period_start ? 1 : -1;
        return (b.created_at || "").localeCompare(a.created_at || "");
      }),
    [runs]
  );

  const filtered = useMemo(
    () => (person === "all" ? sorted : sorted.filter((r) => r.user_id === person)),
    [sorted, person]
  );

  // Only offer people who actually appear in the history.
  const peopleInHistory = useMemo(() => {
    const ids = new Set(runs.map((r) => r.user_id));
    return staff.filter((s) => ids.has(s.id));
  }, [runs, staff]);

  const totalPaid = filtered
    .filter((r) => r.status === "paid")
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          {open ? (
            <ChevronDownIcon className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronRightIcon className="w-4 h-4 text-gray-400" />
          )}
          <span className="font-semibold text-gray-900 dark:text-white">Payment history</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {runs.length} run{runs.length === 1 ? "" : "s"}
          </span>
        </span>
        {!open && totalPaid > 0 && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            <strong className="text-gray-900 dark:text-white">{formatMoney(totalPaid)}</strong> paid
            to date
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              Person
              <select
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                className="text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 px-2 py-1"
              >
                <option value="all">Everyone</option>
                {peopleInHistory.map((s) => (
                  <option key={s.id} value={s.id}>
                    {displayName(s)}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Paid in view:{" "}
              <strong className="text-gray-900 dark:text-white tabular-nums">
                {formatMoney(totalPaid)}
              </strong>
            </span>
          </div>

          {loading ? (
            <p className="px-4 pb-6 text-sm text-gray-400">Loading pay runs…</p>
          ) : filtered.length === 0 ? (
            <p className="px-4 pb-6 text-sm text-gray-500 dark:text-gray-400">
              No pay runs recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase text-xs">
                  <tr>
                    <th className="px-4 py-3 font-medium">Person</th>
                    <th className="px-4 py-3 font-medium">Period</th>
                    <th className="px-4 py-3 font-medium text-right">Hours</th>
                    <th className="px-4 py-3 font-medium text-right">Rate</th>
                    <th className="px-4 py-3 font-medium text-right">Amount</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {filtered.map((r) => {
                    const s = nameOf.get(r.user_id);
                    return (
                      <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900 dark:text-white">
                            {s ? displayName(s) : "Unknown user"}
                          </div>
                          {s && (
                            <span
                              className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                ROLE_BADGE[s.role] ??
                                "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                              }`}
                            >
                              {s.role}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                          {formatRange(r.period_start, r.period_end)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-200">
                          {formatHours(Number(r.hours) || 0)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-200">
                          {formatMoney(Number(r.hourly_rate) || 0, r.currency)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-bold text-gray-900 dark:text-white">
                          {formatMoney(Number(r.amount) || 0, r.currency)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {r.status === "paid" ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                              Paid{r.paid_at ? ` ${shortInstant(r.paid_at)}` : ""}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                              Pending
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 max-w-xs truncate" title={r.note ?? undefined}>
                          {r.note || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
