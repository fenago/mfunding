import { useEffect, useState } from "react";
import supabase from "@/supabase";

/**
 * WHERE THE DIALS CAME FROM.
 *
 * Owner's question (2026-09-21): "where the lead dispositions come from... if
 * they originate from an outbound telemarketing campaign like wavv or a real
 * time lead or live transfer or other."
 *
 * The hard part is that 95% of dials go to contacts with NO DEAL — over 30 days
 * that is 33k calls across 19k contacts against 370 deals — so deals.lead_source
 * alone answers almost nothing. `setter_dial_origins()` walks a two-rung ladder
 * (a deal on the contact, else the Lead Machine batch type) and leaves anything
 * it cannot trace as UNATTRIBUTED rather than folding it into a named bucket.
 *
 * What this panel is FOR: separating effort from result. The dial counts and the
 * positive counts live in different rows, and until you put them side by side it
 * is not visible that almost all of the former produces none of the latter.
 */

interface OriginRow {
  origin: string;
  origin_label: string;
  is_cold_outbound: boolean;
  dials: number;
  unique_contacts: number;
  dispositioned: number;
  conversations: number;
  positive_merchants: number;
}

interface Props {
  from: Date;
  to: Date;
  /** Narrow to one setter; omit for the whole floor. */
  setterId?: string | null;
  /** Shown above the table so a reader knows which window they're looking at. */
  rangeLabel?: string;
}

const int = (n: number) => n.toLocaleString();

export default function DialOriginsPanel({ from, to, setterId, rangeLabel }: Props) {
  const [rows, setRows] = useState<OriginRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    supabase
      .rpc("setter_dial_origins", {
        p_from: from.toISOString(),
        p_to: to.toISOString(),
        p_setter: setterId ?? null,
      })
      .then(({ data, error: err }) => {
        if (!alive) return;
        // UNREADABLE IS NOT EMPTY. A failed read must never render as "no dials
        // came from anywhere" — that is the defect this codebase keeps producing.
        if (err) { setError(err.message); setRows(null); }
        else setRows((data ?? []) as OriginRow[]);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [from, to, setterId]);

  const totalDials = (rows ?? []).reduce((a, r) => a + r.dials, 0);
  const totalPositives = (rows ?? []).reduce((a, r) => a + r.positive_merchants, 0);
  const coldDials = (rows ?? []).filter((r) => r.is_cold_outbound).reduce((a, r) => a + r.dials, 0);
  const coldPositives = (rows ?? []).filter((r) => r.is_cold_outbound).reduce((a, r) => a + r.positive_merchants, 0);
  const coldPct = totalDials > 0 ? Math.round((coldDials / totalDials) * 100) : 0;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          📍 Where the dials came from
        </h2>
        {rangeLabel && <span className="text-xs text-gray-400">{rangeLabel}</span>}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Every dial traced to its origin: a <b>deal</b> on the contact gives the lead source, otherwise the
        Lead Machine batch it was pushed from. Anything we cannot trace is listed as{" "}
        <b>unattributed</b> and never folded into a named row.{" "}
        <b>Positives are counted per merchant</b>, not per call — the same rule the Positives panel uses.
      </p>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : error ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Couldn’t read dial origins — {error}. This is <b>not</b> a statement that no dials were made.
        </p>
      ) : !rows || rows.length === 0 ? (
        <p className="text-sm text-gray-400">No dials in this range.</p>
      ) : (
        <>
          {/* THE HEADLINE. Effort and result in one sentence, because the table
              below makes you do the arithmetic yourself. */}
          {totalDials > 0 && coldDials > 0 && (
            <div className={`mb-3 rounded-lg border px-3 py-2 text-xs ${
              coldPositives === 0
                ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200"
                : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 text-gray-700 dark:text-gray-300"
            }`}>
              <b>{coldPct}% of dials ({int(coldDials)}) were cold outbound</b> from purchased or harvested
              lists, and they produced{" "}
              <b>{coldPositives === 0 ? "no positive dispositions at all" : `${int(coldPositives)} positive merchant${coldPositives === 1 ? "" : "s"}`}</b>.{" "}
              The other {int(totalDials - coldDials)} dials produced {int(totalPositives - coldPositives)}.
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-2 pr-3 font-semibold">Origin</th>
                  <th className="py-2 px-2 text-right font-semibold">Dials</th>
                  <th className="py-2 px-2 text-right font-semibold">Merchants</th>
                  <th className="py-2 px-2 text-right font-semibold">Conversations</th>
                  <th className="py-2 pl-2 text-right font-semibold">Positives</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.origin} className="border-b border-gray-100 dark:border-gray-700/60 last:border-0">
                    <td className="py-2 pr-3">
                      <span className="text-gray-800 dark:text-gray-100">{r.origin_label}</span>
                      {r.is_cold_outbound && (
                        <span className="ml-2 rounded-full border border-gray-300 dark:border-gray-600 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                          cold
                        </span>
                      )}
                      {r.origin === "unattributed" && (
                        <span className="ml-2 rounded-full border border-amber-400/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400">
                          unknown
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums text-gray-700 dark:text-gray-200">{int(r.dials)}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{int(r.unique_contacts)}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-gray-700 dark:text-gray-200">{int(r.conversations)}</td>
                    <td className={`py-2 pl-2 text-right tabular-nums font-semibold ${
                      r.positive_merchants > 0 ? "text-mint-green" : "text-gray-400"
                    }`}>
                      {int(r.positive_merchants)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-gray-400">
            A <b>conversation</b> is 120s or longer. <b>Merchants</b> is distinct contacts dialled, so a list
            you call five times counts once. Cold rows are lists nobody asked us to call; the rest arrived
            from a vendor, a form, or work already in the pipeline.
          </p>
        </>
      )}
    </div>
  );
}
