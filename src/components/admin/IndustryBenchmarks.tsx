// INDUSTRY BENCHMARKS — the rendering half.
//
// The figures themselves live in `@/data/industryBenchmarks` and are defined
// exactly once. Everything here only DRAWS them, in three shapes:
//
//   • BenchmarkChip     — a suffix beside a live number ("industry 3–5%")
//   • BenchmarkTile     — a KPI-sized card: shop value over the industry band
//   • IndustryComparisonCard — the collapsible all-nine reference
//
// ── THE COLOUR RULE IS NOT THE PAGE'S RAG RULE ───────────────────────────────
// Setter Performance colours a KPI against the OWNER'S thresholds in
// ph_dialer_kpi_targets, and red there means "well off your own target". These
// chips are a second opinion from an industry rule of thumb, so they use a
// narrower palette on purpose: GREEN meets or beats the band, AMBER is below
// it, GREY means this page has no comparable number. Nothing here ever paints
// red, and nothing here changes what the page's own RAG says.
//
// ── A GREY CHIP IS A STATEMENT, NOT A GAP ────────────────────────────────────
// Five of the nine benchmarks have no live counterpart on this page — three are
// context-only (commission points, factor rates, ISO survival) and two would
// need a query this page deliberately does not run (renewal rate, cost per
// funded deal). They render with the band alone and say "no live number here
// yet" out loud, rather than being quietly dropped or silently compared to
// something that is not them.

import { type ReactNode } from "react";
import { ScaleIcon } from "@heroicons/react/24/outline";
import {
  INDUSTRY_BENCHMARKS,
  INDUSTRY_BENCHMARK_GROUPS,
  benchmarkRag,
  benchmarkVerdict,
  formatBenchmarkValue,
  type BenchmarkId,
  type BenchmarkRag,
} from "@/data/industryBenchmarks";

const CHIP: Record<BenchmarkRag, string> = {
  green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  none: "bg-gray-500/10 text-gray-500 dark:text-gray-400 border-gray-500/30",
};
const DOT: Record<BenchmarkRag, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  none: "bg-gray-400",
};

/** The shop's value for a benchmark. `null` is UNKNOWN — the chip goes grey and
 *  says so, and is never drawn as if the shop had scored zero. */
export type BenchmarkValues = Partial<Record<BenchmarkId, number | null>>;

function titleFor(id: BenchmarkId, value: number | null | undefined, rag: BenchmarkRag): string {
  const bm = INDUSTRY_BENCHMARKS[id];
  const shop =
    rag === "none"
      ? "No comparable number on this page — the band is shown for reference only."
      : `This shop: ${formatBenchmarkValue(value, bm)} — ${benchmarkVerdict(rag, bm)}.`;
  return `${bm.label} — industry ${bm.band}. ${bm.note} ${shop} Industry rule of thumb, not an owner-set target.`;
}

/** The inline form: sits beside a number the page already renders and says what
 *  the industry does. Coloured by how the SHOP's value compares — pass it, or
 *  pass nothing and get an uncoloured reference chip. */
export function BenchmarkChip({
  id,
  value,
  className = "",
  compact = false,
}: {
  id: BenchmarkId;
  value?: number | null;
  className?: string;
  compact?: boolean;
}) {
  const bm = INDUSTRY_BENCHMARKS[id];
  const rag = benchmarkRag(value, bm);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 ${
        compact ? "text-[10px]" : "text-[11px]"
      } whitespace-nowrap ${CHIP[rag]} ${className}`}
      title={titleFor(id, value, rag)}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT[rag]}`} />
      <span className="opacity-70">industry</span>
      <b className="tabular-nums font-semibold">{bm.band.split(" · ")[0]}</b>
    </span>
  );
}

/** The tile form: the shop's number big, the industry band under it. Used where
 *  the comparison IS the point rather than an aside. */
export function BenchmarkTile({
  id,
  value,
  label,
  basis,
  caveat,
}: {
  id: BenchmarkId;
  /** The shop's comparable value. null = not computable → grey, stated. */
  value: number | null;
  /** Overrides the benchmark's own label when the page calls it something else. */
  label?: string;
  /** WHICH numbers this was built from — never left to the reader to guess. */
  basis: string;
  caveat?: ReactNode;
}) {
  const bm = INDUSTRY_BENCHMARKS[id];
  const rag = benchmarkRag(value, bm);
  return (
    <div className="card bg-base-100 border border-base-300 shadow-sm" title={titleFor(id, value, rag)}>
      <div className="card-body p-4 gap-1">
        <div className="text-xs uppercase tracking-wide text-gray-400">{label ?? bm.label}</div>
        <div className="flex items-baseline gap-2">
          <span
            className={`text-xl font-semibold tabular-nums ${
              rag === "green"
                ? "text-emerald-600 dark:text-emerald-400"
                : rag === "amber"
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-gray-400 dark:text-gray-500"
            }`}
          >
            {value === null ? "—" : formatBenchmarkValue(value, bm)}
          </span>
          <BenchmarkChip id={id} value={value} compact />
        </div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">{basis}</div>
        {caveat && <div className="text-[11px] text-amber-600 dark:text-amber-400 leading-snug">{caveat}</div>}
      </div>
    </div>
  );
}

/** The legend for the chips above — deliberately worded so nobody reads a green
 *  benchmark chip as a green KPI. */
export function BenchmarkLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
      <span className="font-semibold text-gray-600 dark:text-gray-300">Industry chips:</span>
      <span className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-emerald-500" />
        <b className="text-emerald-600 dark:text-emerald-400">Green</b> = meets or beats the industry band
      </span>
      <span className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-amber-500" />
        <b className="text-amber-600 dark:text-amber-400">Amber</b> = below it
      </span>
      <span className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-gray-400" />
        <b>Grey</b> = no comparable number on this page
      </span>
      <span className="opacity-80">
        These are <b>rules of thumb</b>, never red, and they do <b>not</b> override the owner's thresholds.
      </span>
    </div>
  );
}

/** The reference: all nine, with this shop's value wherever the page can
 *  compute one. Collapsed by default — reference content folds, active work
 *  stays open. */
export function IndustryComparisonCard({
  values,
  basis = {},
  rangeLabel,
}: {
  values: BenchmarkValues;
  /** Per-benchmark "built from what" line. A benchmark with a value MUST have
   *  one, so a number is never presented without its denominator. */
  basis?: Partial<Record<BenchmarkId, ReactNode>>;
  rangeLabel?: string;
}) {
  return (
    <details className="group card bg-base-100 border border-base-300 shadow-sm">
      <summary className="card-body p-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <ScaleIcon className="w-5 h-5 text-mint-green" />
            How we compare to industry
            <span className="text-xs font-normal text-gray-400">
              9 MCA/ISO benchmarks{rangeLabel ? ` · shop values over ${rangeLabel}` : ""}
            </span>
          </h2>
          <span className="text-xs text-gray-400">
            <span className="group-open:hidden">click to open</span>
            <span className="hidden group-open:inline">click to close</span>
          </span>
        </div>
      </summary>

      <div className="card-body p-4 pt-0 space-y-3">
        <BenchmarkLegend />

        <div className="overflow-x-auto rounded-lg border border-base-300">
          <table className="table w-full">
            <thead className="bg-base-200/60 dark:bg-gray-800/50">
              <tr>
                <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-base-300">
                  Benchmark
                </th>
                <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-base-300">
                  Industry
                </th>
                <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-base-300 text-right whitespace-nowrap">
                  This shop
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-base-300/70">
              {INDUSTRY_BENCHMARK_GROUPS.map((g) =>
                g.members.map((id, i) => {
                  const bm = INDUSTRY_BENCHMARKS[id];
                  const value = values[id] ?? null;
                  const rag = benchmarkRag(value, bm);
                  return (
                    <tr key={id} className="hover:bg-base-200/40 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="px-3 py-2.5 text-sm text-gray-700 dark:text-gray-200 align-top">
                        <div className="flex items-start gap-2">
                          {i === 0 ? (
                            <span className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-base-200 dark:bg-gray-700/60 text-[10px] font-semibold text-gray-500 dark:text-gray-300 flex items-center justify-center">
                              {g.n}
                            </span>
                          ) : (
                            <span className="shrink-0 w-5" />
                          )}
                          <div className="min-w-0">
                            <div className="font-semibold text-gray-900 dark:text-white">{bm.label}</div>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">{bm.note}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-sm text-gray-700 dark:text-gray-200 align-top whitespace-normal">
                        {bm.band}
                      </td>
                      <td className="px-3 py-2.5 text-sm text-right align-top tabular-nums">
                        {!bm.compare || value === null ? (
                          <span className="text-gray-400 dark:text-gray-500 text-xs">
                            {bm.compare ? "no live number here yet" : "reference only"}
                          </span>
                        ) : (
                          <div className="inline-flex flex-col items-end gap-1">
                            <span
                              className={`font-semibold ${
                                rag === "green"
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-amber-600 dark:text-amber-400"
                              }`}
                              title={benchmarkVerdict(rag, bm)}
                            >
                              {formatBenchmarkValue(value, bm)}
                            </span>
                            <span className="text-[10px] text-gray-400 max-w-[16rem] text-right whitespace-normal">
                              {basis[id] ?? "computed on this page"}
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          <b>These are industry rules of thumb, not this shop's targets.</b> The owner's own thresholds live in{" "}
          <code>platform_settings.ph_dialer_kpi_targets</code> and are the only thing that colours a KPI red
          anywhere on this page. A row reading <b>"no live number here yet"</b> has a benchmark but nothing on
          this page to compare it to — it is stated rather than dropped, and no query was added to invent one.
        </p>
      </div>
    </details>
  );
}
