import { useMemo } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

/**
 * StageHistogram — the "where every lead is right now" bar chart: one horizontal
 * bar per pipeline stage, count on the right, click a bar to select (filter) that
 * stage. Extracted from ProcessorBoard so BOTH the Setter Ops processor board and
 * the standalone /admin/processor page render the SAME visual off
 * processor_stage_counts().
 *
 * HONESTY (readers-must-distinguish-unreadable): a failed counts read is a RED
 * error with a retry, never an empty/zeroed chart. "Couldn't load" ≠ "nothing there".
 */

export type CountsState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; counts: Record<string, number>; total: number };

interface StageDef {
  key: string;
  label: string;
}

interface Props {
  state: CountsState;
  /** Stages for the currently-selected pipeline (MCA / VCF). */
  stages: StageDef[];
  /** Currently selected stage key, or null for "all". */
  activeStage: string | null;
  /** Toggle a stage (pass the key; passing the active key clears to null). */
  onSelect: (key: string | null) => void;
  /** Retry the counts read (shown in the error state). */
  onRetry: () => void;
}

export default function StageHistogram({ state, stages, activeStage, onSelect, onRetry }: Props) {
  const countFor = (k: string) => (state.kind === "ready" ? state.counts[k] ?? 0 : 0);
  const maxCount = useMemo(
    () =>
      Math.max(
        1,
        ...stages.map((s) => (state.kind === "ready" ? state.counts[s.key] ?? 0 : 0)),
      ),
    [state, stages],
  );

  if (state.kind === "error") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-3 text-xs text-red-700 dark:text-red-300">
        <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <div className="font-bold">Couldn't load the board counts.</div>
          <div className="mt-0.5">This is not an empty board — it's an unreadable one.</div>
          <div className="mt-0.5 font-mono opacity-80">{state.message}</div>
          <button
            type="button"
            onClick={onRetry}
            className="mt-1.5 font-semibold text-ocean-blue hover:underline"
          >
            Try again →
          </button>
        </div>
      </div>
    );
  }

  if (state.kind === "loading") {
    return <p className="text-xs text-gray-400 py-6">Loading the board…</p>;
  }

  return (
    <div className="space-y-1.5">
      {stages.map((s) => {
        const c = countFor(s.key);
        const pct = Math.round((c / maxCount) * 100);
        const active = activeStage === s.key;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onSelect(active ? null : s.key)}
            aria-pressed={active}
            className={`w-full group flex items-center gap-3 text-left rounded ${
              active ? "ring-1 ring-ocean-blue/40 bg-ocean-blue/5" : ""
            }`}
            title={`${s.label} — ${c} deal${c === 1 ? "" : "s"}`}
          >
            <span
              className={`w-36 shrink-0 text-sm truncate ${
                active ? "font-semibold text-ocean-blue" : "text-gray-700 dark:text-gray-200"
              }`}
            >
              {s.label}
            </span>
            <span className="flex-1 h-7 rounded bg-gray-100 dark:bg-gray-900 overflow-hidden relative">
              <span
                className={`absolute inset-y-0 left-0 rounded ${
                  active ? "bg-ocean-blue" : "bg-ocean-blue/70 group-hover:bg-ocean-blue"
                }`}
                style={{ width: `${Math.max(pct, c > 0 ? 8 : 0)}%` }}
              />
            </span>
            <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
              {c.toLocaleString()}
            </span>
          </button>
        );
      })}
    </div>
  );
}
