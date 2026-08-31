import { CheckIcon } from "@heroicons/react/24/solid";
import { gateState, type GateState, type PipelineRow, type Pipe } from "./types";

/**
 * GateTracker — the per-lead readiness spine. Four explicit gates, in order:
 *   ① Interested  ② Application  ③ Statements  ④ QA  → READY TO SUBMIT
 *
 * A gate is green (done) or grey (not yet). Once all four are green AND the lead
 * has been marked ready, the READY badge lights up. Rendered the SAME in the list
 * row (compact) and the cockpit drawer (full) so the processor never sees two
 * different pictures of the same lead.
 */

interface Pip {
  n: number;
  label: string;
  done: boolean;
  /** small suffix, e.g. "100%" or "×3" */
  meta?: string;
}

function pipsFor(g: GateState): Pip[] {
  return [
    { n: 1, label: "Interested", done: g.interested },
    { n: 2, label: "Application", done: g.appComplete, meta: `${g.appPct}%` },
    {
      n: 3,
      label: "Statements",
      done: g.statements,
      meta: g.statementCount > 0 ? `×${g.statementCount}` : undefined,
    },
    { n: 4, label: "QA", done: g.qa },
  ];
}

export default function GateTracker({
  row,
  pipe,
  compact = false,
}: {
  row: PipelineRow;
  pipe: Pipe;
  compact?: boolean;
}) {
  const g = gateState(row, pipe);
  const pips = pipsFor(g);

  return (
    <div className={`flex items-center ${compact ? "gap-1" : "gap-1.5"}`}>
      {pips.map((p, i) => (
        <div key={p.n} className="flex items-center">
          <div className="flex items-center gap-1">
            <span
              className={`inline-flex items-center justify-center rounded-full font-bold shrink-0 ${
                compact ? "w-4 h-4 text-[9px]" : "w-5 h-5 text-[10px]"
              } ${
                p.done
                  ? "bg-emerald-500 text-white"
                  : "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
              }`}
              title={`${p.label}${p.meta ? ` (${p.meta})` : ""} — ${p.done ? "done" : "not yet"}`}
            >
              {p.done ? <CheckIcon className={compact ? "w-2.5 h-2.5" : "w-3 h-3"} /> : p.n}
            </span>
            {!compact && (
              <span
                className={`text-[10px] font-semibold ${
                  p.done ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400"
                }`}
              >
                {p.label}
                {p.meta ? <span className="ml-0.5 opacity-70">{p.meta}</span> : null}
              </span>
            )}
            {compact && p.meta && (
              <span
                className={`text-[9px] font-semibold ${
                  p.done ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400"
                }`}
              >
                {p.meta}
              </span>
            )}
          </div>
          {i < pips.length - 1 && (
            <span
              className={`mx-0.5 ${compact ? "w-2" : "w-3"} h-px ${
                p.done ? "bg-emerald-400" : "bg-gray-300 dark:bg-gray-600"
              }`}
            />
          )}
        </div>
      ))}
      {g.ready ? (
        <span
          className={`ml-1 inline-flex items-center gap-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-bold ${
            compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]"
          }`}
        >
          <CheckIcon className={compact ? "w-2.5 h-2.5" : "w-3 h-3"} /> READY
        </span>
      ) : null}
    </div>
  );
}
