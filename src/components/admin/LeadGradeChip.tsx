/**
 * LeadGradeChip — the v1 lead-quality grade (A–D) + expected value, with the
 * score's own reasons as the tooltip. Standalone by design: mount it anywhere a
 * deal row renders (deals list today; My Day cards and the playbook context bar
 * in a later pass — see research/PLAN_lead_scoring.md §6).
 *
 * HONESTY RAILS (non-negotiable, from the plan):
 *   • the EV always carries "est." — FUND_ODDS are targets, not history;
 *   • the tooltip's last line says the v1 weights are judgment (0 funded deals).
 * Never present this as a measured probability.
 *
 * Colors: A emerald / B blue / C amber / D red.
 */

interface ScoreReason {
  factor: string;
  points: number;
  max: number;
  note: string;
}

interface Props {
  grade?: string | null;
  expectedValue?: number | null;
  reasons?: ScoreReason[] | null;
  /** Hide the EV figure (tight spots like table cells can pass false). */
  showEv?: boolean;
}

const GRADE_STYLES: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800",
  B: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800",
  C: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800",
  D: "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800",
};

function fmtEv(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

export default function LeadGradeChip({ grade, expectedValue, reasons, showEv = true }: Props) {
  if (!grade || !GRADE_STYLES[grade]) return null; // unscored — render nothing, never a fake grade

  // The top reason notes ARE the explanation (never a black box). The
  // expected_value factor line is a footer, not a top reason.
  const top = (reasons ?? []).filter((r) => r.factor !== "expected_value").slice(0, 3);
  const evLine = (reasons ?? []).find((r) => r.factor === "expected_value")?.note;

  return (
    <span className="relative inline-flex group/gradechip">
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border cursor-default ${GRADE_STYLES[grade]}`}
      >
        {grade}
        {showEv && expectedValue != null && expectedValue > 0 && (
          <span className="font-semibold tabular-nums">· {fmtEv(expectedValue)} est.</span>
        )}
      </span>
      {(top.length > 0 || evLine) && (
        <span className="pointer-events-none absolute left-0 top-full z-40 mt-1.5 hidden w-72 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 p-2.5 shadow-xl group-hover/gradechip:block">
          {top.map((r, n) => (
            <span key={n} className="block text-[11px] leading-snug text-gray-700 dark:text-gray-200 mb-1">
              <span className="font-semibold">{r.points}/{r.max}</span> — {r.note}
            </span>
          ))}
          {evLine && (
            <span className="block text-[11px] leading-snug text-gray-500 dark:text-gray-400 mb-1">{evLine}</span>
          )}
          <span className="block text-[10px] italic text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700 pt-1 mt-1">
            v1 rules score — weights are judgment until we have funded-deal history.
          </span>
        </span>
      )}
    </span>
  );
}
