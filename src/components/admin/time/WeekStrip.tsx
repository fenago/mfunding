import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";
import { addDays, fmtClockRange, fmtDayNum, fmtHours, fmtRange, fmtWeekday } from "./timeUtils";

/** What one day cell knows: the hours claimed and, if logged, the shift times. */
export type DayCell = {
  hours: number;
  clockIn?: string | null;
  clockOut?: string | null;
  /** Changed after the first check-in — same trail payroll sees. */
  edited?: boolean;
};

/**
 * Mon–Sun strip for ONE week, with prev/next paging. `byDate` is keyed by
 * YYYY-MM-DD; a day with no entry renders a dash, and days that haven't
 * happened yet are dimmed so a blank Friday on Wednesday doesn't read as a
 * missed day. `today` comes from the caller (Eastern), never from the browser
 * clock — which also means "future" stays correct on a past week (nothing is).
 */
export default function WeekStrip({
  weekStart,
  weekEnd,
  byDate,
  today,
  selectedDate,
  isCurrentWeek,
  canGoBack,
  onPrev,
  onNext,
  onThisWeek,
  onSelectDay,
  weeklyCap,
}: {
  weekStart: string;
  weekEnd: string;
  byDate: Record<string, DayCell>;
  today: string;
  /** The day the check-in form is pointed at — clicking a cell moves it. */
  selectedDate: string;
  isCurrentWeek: boolean;
  /** False once paging back would leave the loaded history window. */
  canGoBack: boolean;
  onPrev: () => void;
  onNext: () => void;
  onThisWeek: () => void;
  onSelectDay: (workDate: string) => void;
  /**
   * Hours after which this week's total needs a manager's approval. Purely
   * informational — the worker can't approve their own overtime, and nothing
   * here blocks them from logging hours they genuinely worked.
   */
  weeklyCap?: number | null;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const total = days.reduce((sum, d) => sum + (byDate[d]?.hours || 0), 0);
  // The cap this week is actually over, or null. Quarter-hour entries sum with
  // float error, so an exactly-40 week must not trip the notice at 40.000000004.
  const capExceeded =
    typeof weeklyCap === "number" && weeklyCap > 0 && total - weeklyCap > 0.005
      ? weeklyCap
      : null;

  const navBtn =
    "rounded-lg border border-gray-200 dark:border-gray-600 p-1.5 text-gray-500 dark:text-gray-400 hover:border-mint-green hover:text-mint-green disabled:opacity-30 disabled:hover:border-gray-200 dark:disabled:hover:border-gray-600 disabled:hover:text-gray-500 transition-colors";

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={navBtn}
            onClick={onPrev}
            disabled={!canGoBack}
            aria-label="Previous week"
            title={canGoBack ? "Previous week" : "That's as far back as your history loads"}
          >
            <ChevronLeftIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            className={navBtn}
            onClick={onNext}
            disabled={isCurrentWeek}
            aria-label="Next week"
            title={isCurrentWeek ? "This is the current week" : "Next week"}
          >
            <ChevronRightIcon className="w-4 h-4" />
          </button>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              {isCurrentWeek ? "This week" : "Week of"}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {fmtRange(weekStart, weekEnd)}
            </p>
          </div>
          {!isCurrentWeek && (
            <button
              type="button"
              onClick={onThisWeek}
              className="ml-1 rounded-full border border-gray-200 dark:border-gray-600 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:border-mint-green hover:text-mint-green transition-colors"
            >
              This week
            </button>
          )}
        </div>
        <div className="text-right">
          <span className="text-2xl font-bold text-gray-900 dark:text-white">{fmtHours(total)}</span>
          <span className="ml-1 text-sm text-gray-500 dark:text-gray-400">hrs logged</span>
        </div>
      </div>

      {capExceeded !== null && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-300">
          <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            You&apos;re at <strong>{fmtHours(total)}h</strong>{" "}
            {isCurrentWeek ? "this week" : "in this week"} — anything over{" "}
            <strong>{fmtHours(capExceeded)}</strong> needs approval from your manager. Keep logging
            what you actually worked.
          </span>
        </div>
      )}

      <div className="grid grid-cols-7 gap-1.5">
        {days.map((d) => {
          const cell = byDate[d];
          const h = cell?.hours;
          const range = fmtClockRange(cell?.clockIn, cell?.clockOut);
          const isToday = d === today;
          const isFuture = d > today;
          const isSelected = d === selectedDate;
          return (
            <button
              key={d}
              type="button"
              disabled={isFuture}
              onClick={() => onSelectDay(d)}
              title={isFuture ? undefined : "Log or fix this day"}
              className={`rounded-lg border px-1 py-2 text-center transition-colors ${
                isToday
                  ? "border-mint-green bg-mint-green/10"
                  : "border-gray-200 dark:border-gray-700"
              } ${isSelected ? "ring-2 ring-mint-green ring-offset-1 dark:ring-offset-gray-900" : ""} ${
                isFuture ? "opacity-40 cursor-default" : "hover:border-mint-green"
              }`}
            >
              <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {fmtWeekday(d)}
              </div>
              <div className="text-[10px] text-gray-400 dark:text-gray-500">{fmtDayNum(d)}</div>
              <div
                className={`mt-1 flex items-center justify-center gap-0.5 text-sm font-semibold leading-tight ${
                  h ? "text-gray-900 dark:text-white" : "text-gray-300 dark:text-gray-600"
                }`}
              >
                <span>{h ? fmtHours(h) : "—"}</span>
                {cell?.edited && (
                  <span title="Changed after the first check-in">
                    <PencilSquareIcon className="w-3 h-3 text-amber-500 dark:text-amber-400" />
                  </span>
                )}
              </div>
              {/* Reserve the line either way so the cells stay the same height. */}
              <div
                className="text-[9px] leading-tight text-gray-400 dark:text-gray-500 truncate"
                title={range || undefined}
              >
                {range || " "}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
