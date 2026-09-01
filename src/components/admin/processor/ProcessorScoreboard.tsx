import { useCallback, useEffect, useState } from "react";
import { ArrowPathIcon, ChartBarIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import supabase from "@/supabase";

/**
 * ProcessorScoreboard — "what did the processors DO" for a range, per person +
 * role total. Reads processor_scoreboard() (work counted by AUTHOR, not book
 * ownership — consistent with 'Last touched by'). Honest reads: a failed load is
 * a red error, never a table of zeros.
 */

interface Row {
  user_id: string;
  name: string;
  calls: number;
  deals_worked: number;
  apps_sent: number;
  ask_total: number;
  go_verdicts: number;
  no_go_verdicts: number;
  callbacks_set: number;
  appointments_set: number;
  cleaned: number;
  statements_in: number;
}
interface Board { processors: Row[]; totals: Omit<Row, "user_id" | "name"> | null }

type RangeKey = "today" | "7d" | "30d";
const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
];

/** Start of "today" on the US-East wall clock, as a UTC Date. */
function etTodayStart(): Date {
  const nowEt = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offsetMs = Date.now() - nowEt.getTime();
  const startEt = new Date(nowEt);
  startEt.setHours(0, 0, 0, 0);
  return new Date(startEt.getTime() + offsetMs);
}

function boundsFor(key: RangeKey): { from: Date; to: Date } {
  const to = new Date();
  if (key === "today") return { from: etTodayStart(), to };
  const days = key === "7d" ? 7 : 30;
  return { from: new Date(Date.now() - days * 86_400_000), to };
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function ProcessorScoreboard() {
  const [range, setRange] = useState<RangeKey>("today");
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { from, to } = boundsFor(range);
      const { data, error } = await supabase.rpc("processor_scoreboard", {
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      });
      if (error) throw new Error(error.message);
      setBoard((data ?? { processors: [], totals: null }) as Board);
    } catch (e) {
      setBoard(null);
      setErr(e instanceof Error ? e.message : "Failed to load the scoreboard.");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { void load(); }, [load]);

  const rows = board?.processors ?? [];
  const t = board?.totals ?? null;

  const num = "px-3 py-2 text-right tabular-nums";

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ChartBarIcon className="w-5 h-5 text-ocean-blue" />
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Processor scoreboard</h2>
          <span className="text-[11px] text-gray-400">what got DONE — counted by who did it</span>
        </div>
        <div className="flex items-center gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              aria-pressed={range === r.key}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                range === r.key
                  ? "border-ocean-blue bg-ocean-blue/10 text-ocean-blue"
                  : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300"
              }`}
            >
              {r.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="ml-1 inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-ocean-blue disabled:opacity-50"
            title="Reload"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {err ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2.5 text-xs text-red-700 dark:text-red-300">
          <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Couldn't load the scoreboard — {err}</span>
        </div>
      ) : loading && !board ? (
        <p className="mt-3 text-xs text-gray-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-xs text-gray-400">No processors are set up yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-gray-400">
                <th className="px-3 py-2 text-left">Processor</th>
                <th className={num} title="Contact attempts logged (processor touches)">Calls</th>
                <th className={num} title="Distinct deals with any activity by them">Deals worked</th>
                <th className={num} title="Applications sent to e-sign (blocked sends excluded)">Apps sent</th>
                <th className={num} title="Σ amount requested across the deals whose apps they sent">$ added</th>
                <th className={num} title="Bank-statement documents that arrived in this range on deals they worked">Stmts in</th>
                <th className={num} title="QA verdicts rendered">GO / NO-GO</th>
                <th className={num}>Callbacks</th>
                <th className={num}>Appts</th>
                <th className={num} title="DND flags + long-term-nurture moves — list hygiene is real work">Cleaned</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map((r) => (
                <tr key={r.user_id}>
                  <td className="px-3 py-2 font-semibold text-gray-900 dark:text-white">{r.name}</td>
                  <td className={num}>{r.calls.toLocaleString()}</td>
                  <td className={num}>{r.deals_worked.toLocaleString()}</td>
                  <td className={num}>{r.apps_sent.toLocaleString()}</td>
                  <td className={`${num} font-semibold text-emerald-600 dark:text-emerald-400`}>
                    {r.ask_total > 0 ? money(r.ask_total) : "—"}
                  </td>
                  <td className={num}>{r.statements_in.toLocaleString()}</td>
                  <td className={num}>
                    <span className="text-emerald-600 dark:text-emerald-400">{r.go_verdicts}</span>
                    {" / "}
                    <span className="text-red-500 dark:text-red-400">{r.no_go_verdicts}</span>
                  </td>
                  <td className={num}>{r.callbacks_set.toLocaleString()}</td>
                  <td className={num}>{r.appointments_set.toLocaleString()}</td>
                  <td className={num}>{r.cleaned.toLocaleString()}</td>
                </tr>
              ))}
              {t && rows.length > 1 && (
                <tr className="bg-gray-50 dark:bg-gray-900/40 font-bold">
                  <td className="px-3 py-2 text-gray-900 dark:text-white">ROLE TOTAL</td>
                  <td className={num}>{t.calls.toLocaleString()}</td>
                  <td className={num}>{t.deals_worked.toLocaleString()}</td>
                  <td className={num}>{t.apps_sent.toLocaleString()}</td>
                  <td className={`${num} text-emerald-600 dark:text-emerald-400`}>{t.ask_total > 0 ? money(t.ask_total) : "—"}</td>
                  <td className={num}>{t.statements_in.toLocaleString()}</td>
                  <td className={num}>{t.go_verdicts} / {t.no_go_verdicts}</td>
                  <td className={num}>{t.callbacks_set.toLocaleString()}</td>
                  <td className={num}>{t.appointments_set.toLocaleString()}</td>
                  <td className={num}>{t.cleaned.toLocaleString()}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
