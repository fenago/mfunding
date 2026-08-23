import type { PayRun } from "@/services/timeTracking";
import { fmtHours, fmtMoney, fmtRange, fmtStampDate } from "./timeUtils";

/** Every pay run cut for this worker, newest first. */
export default function PayRunList({ runs }: { runs: PayRun[] }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Payments</h3>

      {runs.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No payments have been issued yet. Keep checking in — payroll creates a run for each pay
          period.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-2 pr-4 font-medium">Period</th>
                <th className="py-2 pr-4 font-medium">Hours</th>
                <th className="py-2 pr-4 font-medium">Rate</th>
                <th className="py-2 pr-4 font-medium">Amount</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="py-2.5 pr-4 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                    {fmtRange(r.period_start, r.period_end)}
                  </td>
                  <td className="py-2.5 pr-4 text-gray-700 dark:text-gray-300">
                    {fmtHours(r.hours)}
                  </td>
                  <td className="py-2.5 pr-4 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                    {r.hourly_rate != null ? `${fmtMoney(r.hourly_rate, r.currency)}/hr` : "—"}
                  </td>
                  <td className="py-2.5 pr-4 font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                    {fmtMoney(r.amount, r.currency)}
                  </td>
                  <td className="py-2.5 pr-4">
                    {r.status === "paid" ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                        Paid
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-900/20 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                        Pending
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {r.paid_at ? fmtStampDate(r.paid_at) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
