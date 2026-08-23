import type { PayRun, StaffRate } from "@/services/timeTracking";
import { fmtHours, fmtMoney, fmtRange, fmtStampDate } from "./timeUtils";

export type WeekSummary = {
  /** Monday, YYYY-MM-DD */
  start: string;
  /** Sunday, YYYY-MM-DD */
  end: string;
  hours: number;
  /** The pay run covering this week, if one has been created yet. */
  run: PayRun | null;
};

/**
 * Past weeks, newest first — hours logged and what happened to the money.
 * An estimate is shown ONLY when the worker can read their own staff_rates row;
 * with no rate we print "—" rather than implying a number we don't have.
 */
export default function WeekHistory({
  weeks,
  rate,
}: {
  weeks: WeekSummary[];
  rate: StaffRate | null;
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Past weeks</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Weeks run <strong>Monday to Sunday</strong>. Pay status comes from payroll — an
        &ldquo;estimated&rdquo; figure is your hours &times; your rate, not a promise.
      </p>

      {weeks.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No earlier weeks yet — your history builds up as you check in.
        </p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
          {weeks.map((w) => (
            <div key={w.start} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
              <span className="text-sm text-gray-700 dark:text-gray-300 min-w-[10.5rem]">
                {fmtRange(w.start, w.end)}
              </span>
              <span className="text-sm font-semibold text-gray-900 dark:text-white min-w-[4.5rem]">
                {fmtHours(w.hours)} hrs
              </span>
              <span className="ml-auto">
                <PayCell week={w} rate={rate} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PayCell({ week, rate }: { week: WeekSummary; rate: StaffRate | null }) {
  const run = week.run;

  if (run && run.status === "paid") {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
        Paid {fmtMoney(run.amount, run.currency)}
        {run.paid_at ? ` on ${fmtStampDate(run.paid_at)}` : ""}
      </span>
    );
  }

  if (run) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-900/20 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
        Pending
        {run.amount != null ? ` — ${fmtMoney(run.amount, run.currency)}` : ""}
      </span>
    );
  }

  if (rate?.hourly_rate) {
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-700/50 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600">
        {fmtMoney(week.hours * Number(rate.hourly_rate), rate.currency)} estimated
      </span>
    );
  }

  return <span className="text-sm text-gray-400 dark:text-gray-500">—</span>;
}
