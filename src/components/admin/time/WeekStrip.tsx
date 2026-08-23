import { addDays, fmtDayNum, fmtHours, fmtRange, fmtWeekday } from "./timeUtils";

/**
 * Mon–Sun strip for one week. `hoursByDate` is keyed by YYYY-MM-DD; a day with
 * no entry renders a dash, and days that haven't happened yet are dimmed so a
 * blank Friday on Wednesday doesn't read as a missed day. `today` comes from the
 * caller (Eastern), never from the browser clock.
 */
export default function WeekStrip({
  weekStart,
  weekEnd,
  hoursByDate,
  today,
}: {
  weekStart: string;
  weekEnd: string;
  hoursByDate: Record<string, number>;
  today: string;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const total = days.reduce((sum, d) => sum + (hoursByDate[d] || 0), 0);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">This week</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">{fmtRange(weekStart, weekEnd)}</p>
        </div>
        <div className="text-right">
          <span className="text-2xl font-bold text-gray-900 dark:text-white">{fmtHours(total)}</span>
          <span className="ml-1 text-sm text-gray-500 dark:text-gray-400">hrs logged</span>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {days.map((d) => {
          const h = hoursByDate[d];
          const isToday = d === today;
          const isFuture = d > today;
          return (
            <div
              key={d}
              className={`rounded-lg border px-1 py-2 text-center ${
                isToday
                  ? "border-mint-green bg-mint-green/10"
                  : "border-gray-200 dark:border-gray-700"
              } ${isFuture ? "opacity-40" : ""}`}
            >
              <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {fmtWeekday(d)}
              </div>
              <div className="text-[10px] text-gray-400 dark:text-gray-500">{fmtDayNum(d)}</div>
              <div
                className={`mt-1 text-sm font-semibold ${
                  h ? "text-gray-900 dark:text-white" : "text-gray-300 dark:text-gray-600"
                }`}
              >
                {h ? fmtHours(h) : "—"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
