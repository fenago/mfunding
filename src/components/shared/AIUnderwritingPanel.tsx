import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  SparklesIcon, ArrowPathIcon, ExclamationTriangleIcon, ChevronDownIcon,
} from "@heroicons/react/24/outline";
import {
  getUnderwritingHistory, runUnderwriting,
  type DealUnderwriting, type UWFlag, type UWMetrics, type UWPerMonth, type UWAffordability,
  type UWScenario, type UWPath, type AffordabilityRating, type RiskRating,
} from "../../services/aiUnderwritingService";
import { useUserProfile } from "../../context/UserProfileContext";

interface Props {
  dealId: string;
}

const TOOLTIP_STYLE = {
  backgroundColor: "#21262D",
  border: "1px solid #30363D",
  borderRadius: "8px",
  fontSize: "12px",
  color: "#F0F6FC",
};

// Human labels for padding categories the edge function reports.
const PADDING_LABELS: Record<string, string> = {
  zelle: "Zelle / P2P",
  venmo: "Venmo",
  cashapp: "Cash App",
  paypal_personal: "PayPal (personal)",
  internal_transfer: "Internal transfers",
  owner_deposit: "Owner deposits / ATM cash",
  reversal: "Refunds / reversals",
  round_number: "Round-number deposits",
  same_day_in_out: "Same-day in/out",
};

const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;
const pct = (n: number | null | undefined) =>
  n == null ? "—" : `${Math.round(n)}%`;
const num = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString();

// Verdict banner tone by affordability + risk.
// ── Narrative renderer ─────────────────────────────────────────────────────
// The underwriter's read arrives as lightweight markdown: an opening headline,
// then "- **Label:** text" bullets, with **bold** on key numbers/verdicts and
// at most one <u>critical warning</u>. Render ONLY those tokens (no HTML
// injection) and fall back gracefully for older plain-prose narratives.
function inlineNarrative(text: string): React.ReactNode[] {
  // Split on **bold** and <u>underline</u> tokens, keep delimiters.
  return text.split(/(\*\*[^*]+\*\*|<u>[^<]*<\/u>)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold text-gray-900 dark:text-white">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("<u>") && part.endsWith("</u>")) {
      return <u key={i} className="decoration-rose-500 decoration-2 underline-offset-2 font-semibold text-rose-700 dark:text-rose-300">{part.slice(3, -4)}</u>;
    }
    return part;
  });
}

function NarrativeText({ text }: { text: string }) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed space-y-1.5">
      {lines.map((line, i) => {
        const m = line.match(/^[-•]\s+(.*)$/);
        if (m) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span className="text-ocean-blue mt-0.5 shrink-0">▸</span>
              <span>{inlineNarrative(m[1])}</span>
            </div>
          );
        }
        return <p key={i}>{inlineNarrative(line)}</p>;
      })}
    </div>
  );
}

function verdictTone(aff: AffordabilityRating | null, risk: RiskRating | null): string {
  if (aff === "unaffordable" || risk === "high")
    return "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200";
  if (aff === "tight")
    return "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200";
  if (aff === "strong" || risk === "low")
    return "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200";
  return "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200";
}

const RATING_BADGE: Record<string, string> = {
  strong: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
  adequate: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
  tight: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  unaffordable: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
  low: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
  medium: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  high: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
};

const FLAG_BADGE: Record<UWFlag["severity"], string> = {
  info: "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300",
  warn: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  critical: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
};

const trendLabel: Record<string, string> = { up: "Trending up", flat: "Flat", down: "Trending down" };

export default function AIUnderwritingPanel({ dealId }: Props) {
  const { isAdmin, isSuperAdmin } = useUserProfile();
  const canRun = isAdmin || isSuperAdmin;

  const [history, setHistory] = useState<DealUnderwriting[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(selectLatest = false) {
    setLoading(true);
    try {
      const rows = await getUnderwritingHistory(dealId);
      setHistory(rows);
      if (selectLatest || !selectedId) setSelectedId(rows[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load underwriting");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      await runUnderwriting(dealId, "manual");
      await load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Underwriting failed. Check that bank statements are uploaded.");
    } finally {
      setRunning(false);
    }
  }

  const current = history.find((h) => h.id === selectedId) ?? null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-mint-green" />
      </div>
    );
  }

  // ── Empty state ──────────────────────────────────────────────────────────
  if (history.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-10 border border-gray-200 dark:border-gray-700 text-center">
        <SparklesIcon className="w-12 h-12 text-ocean-blue/60 mx-auto mb-4" />
        <h3 className="font-semibold text-gray-900 dark:text-white mb-1">No AI underwriting yet</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
          Claude reads the deal's bank statements and returns an affordability + risk read —
          true revenue after padding, safe daily debit capacity, and the max advance this
          merchant can support.
        </p>
        {error && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>}
        {canRun ? (
          <button onClick={run} disabled={running} className="btn-primary inline-flex items-center gap-2 disabled:opacity-60">
            {running ? (
              <>
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
                Claude is reading the statements… ~1 min
              </>
            ) : (
              <>
                <SparklesIcon className="w-4 h-4" />
                Run underwriting
              </>
            )}
          </button>
        ) : (
          <p className="text-xs text-gray-400">Ask an admin to run underwriting on this deal.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header: version selector + run */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <SparklesIcon className="w-5 h-5 text-ocean-blue" /> AI Underwriter
          </h3>
          {history.length > 1 && (
            <select
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(e.target.value)}
              className="text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-2 py-1"
            >
              {history.map((h) => (
                <option key={h.id} value={h.id}>
                  v{h.version} · {new Date(h.created_at).toLocaleDateString()} · {h.run_mode ?? "manual"}
                </option>
              ))}
            </select>
          )}
          {current && (
            <span className="text-xs text-gray-400">
              {new Date(current.created_at).toLocaleString()}
              {current.extraction_model && ` · ${current.extraction_model}`}
            </span>
          )}
        </div>
        {canRun && (
          <button
            onClick={run}
            disabled={running}
            className="px-3 py-2 text-sm font-medium text-ocean-blue border border-ocean-blue rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 inline-flex items-center gap-2 disabled:opacity-60"
          >
            {running ? (
              <>
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
                Claude is reading… ~1 min
              </>
            ) : (
              <>
                <ArrowPathIcon className="w-4 h-4" />
                Re-run
              </>
            )}
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <ExclamationTriangleIcon className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
        </div>
      )}

      {current && <ResultView r={current} />}
    </div>
  );
}

function ResultView({ r }: { r: DealUnderwriting }) {
  const m = (r.metrics ?? {}) as Partial<UWMetrics>;
  const flags = r.flags ?? [];
  const paddingCats = m.padding_by_category ?? {};
  // net_retained_by_month is a PLAIN number[] from the edge function, indexed to
  // per_statement (which is in UPLOAD order, not calendar order) — zip the month
  // labels in, then sort chronologically so the trend reads left-to-right.
  const stmtMonths = (r.per_statement ?? []).map((s) => (s as { month?: string } | null)?.month ?? "");
  // DISTINCT calendar months — recomputed from statement labels so runs stored
  // before the months_covered fix still read right (and drives the thin-evidence note).
  const monthsCovered = new Set(stmtMonths.filter(Boolean)).size || m.months_covered || 0;
  // One bar per CALENDAR month. A merchant with two bank accounts yields two
  // per-statement entries for the same month — a reader thinks in months, not
  // files, so same-month values SUM here (total retained across all accounts).
  const chartByMonth = new Map<string, number>();
  (m.net_retained_by_month ?? []).forEach((d, i) => {
    const isObj = typeof d === "object" && d !== null;
    const month = (isObj ? (d as { month?: string }).month : undefined) ?? stmtMonths[i] ?? `Month ${i + 1}`;
    const val = Number(isObj ? (d as { net_retained?: number }).net_retained ?? 0 : d) || 0;
    chartByMonth.set(month, (chartByMonth.get(month) ?? 0) + val);
  });
  const chartData = [...chartByMonth.entries()]
    .map(([month, net_retained]) => ({ month, net_retained }))
    .sort((a, b) => {
      const ta = Date.parse(`1 ${a.month}`);
      const tb = Date.parse(`1 ${b.month}`);
      return Number.isNaN(ta) || Number.isNaN(tb) ? 0 : ta - tb;
    });

  return (
    <div className="space-y-6">
      {/* Verdict banner */}
      <div className={`rounded-xl border p-5 ${verdictTone(r.affordability_rating, r.risk_rating)}`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold uppercase tracking-wide">Verdict</span>
          {r.affordability_rating && (
            <span className={`px-2.5 py-1 text-xs font-semibold rounded-full capitalize ${RATING_BADGE[r.affordability_rating]}`}>
              {r.affordability_rating}
            </span>
          )}
          {r.risk_rating && (
            <span className={`px-2.5 py-1 text-xs font-semibold rounded-full capitalize ${RATING_BADGE[r.risk_rating]}`}>
              {r.risk_rating} risk
            </span>
          )}
          <span className="text-xs opacity-80 ml-auto">
            {/* Months = DISTINCT calendar months, computed from the statement labels
                so runs stored before the months_covered fix also render right. */}
            {num(m.statements_analyzed)} statements · {num(monthsCovered)} months
            {monthsCovered === 1 && (
              <span className="font-semibold"> · single month — thin evidence</span>
            )}
          </span>
        </div>

        {/* Headline compare */}
        <div className="grid sm:grid-cols-2 gap-4 mt-4">
          <div>
            <div className="text-xs opacity-80">Max affordable advance</div>
            <div className="text-2xl font-bold">
              {money(m.max_affordable_advance)}
              <span className="text-sm font-normal opacity-70"> vs {money(m.amount_requested)} requested</span>
            </div>
          </div>
          <div>
            <div className="text-xs opacity-80">True avg monthly revenue</div>
            <div className="text-2xl font-bold">
              {money(m.true_avg_monthly_revenue)}
              <span className="text-sm font-normal opacity-70">
                {" "}vs {money(m.reported_avg_monthly_revenue)} reported · {pct(m.revenue_quality_pct)} real
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Affordability — the headline read, directly under the verdict */}
      {m.affordability && <AffordabilitySection a={m.affordability} />}

      {/* How we make this deal work — paths to revenue (scenarios collapse under
          as "the math"). Older runs without paths fall back to the scenarios card. */}
      {m.paths && m.paths.length > 0 ? (
        <PathsSection
          paths={m.paths}
          verdict={m.paths_verdict}
          scenarios={m.scenarios}
          scenariosVerdict={m.scenarios_verdict}
        />
      ) : m.scenarios && m.scenarios.length > 0 ? (
        <ScenariosSection scenarios={m.scenarios} verdict={m.scenarios_verdict} />
      ) : null}

      {/* Metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <Metric label="Avg daily balance" value={money(m.avg_daily_balance)} />
        <Metric label="Min balance" value={money(m.min_balance)} tone={(m.min_balance ?? 0) < 0 ? "bad" : undefined} />
        <Metric label="Negative days" value={num(m.negative_days)} tone={(m.negative_days ?? 0) > 0 ? "bad" : undefined} />
        <Metric label="NSF total" value={num(m.nsf_total)} tone={(m.nsf_total ?? 0) > 0 ? "bad" : undefined} />
        <Metric label="Avg net retained" value={money(m.avg_net_retained)} />
        <Metric label="Est. open positions" value={num(m.est_open_positions)} tone={(m.est_open_positions ?? 0) >= 3 ? "bad" : undefined} />
        <Metric label="Existing daily debit" value={money(m.existing_daily_debit)} />
        <Metric label="Debt service" value={pct(m.debt_service_pct)} tone={(m.debt_service_pct ?? 0) >= 25 ? "bad" : undefined} />
        <Metric label="Safe daily capacity" value={money(m.safe_daily_debit_capacity)} />
        <Metric label="Deposit concentration" value={pct(m.deposit_concentration_pct)} tone={(m.deposit_concentration_pct ?? 0) >= 40 ? "bad" : undefined} />
        <Metric label="Revenue trend" value={m.revenue_trend ? (trendLabel[m.revenue_trend] ?? m.revenue_trend) : "—"} />
      </div>

      {/* Explicit per-month metrics table */}
      {m.per_month && m.per_month.length > 0 && <PerMonthTable rows={m.per_month} />}

      {/* Net retained by month chart */}
      {chartData.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
          <h4 className="font-semibold text-gray-900 dark:text-white mb-4">Net retained by month</h4>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363D" opacity={0.3} />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="#8B949E" />
              <YAxis tick={{ fontSize: 12 }} stroke="#8B949E" tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                // Recharts colors item text from the series fill by default, which
                // reads near-black on this dark tooltip — pin label AND items light.
                labelStyle={{ color: "#F0F6FC", fontWeight: 600 }}
                itemStyle={{ color: "#F0F6FC" }}
                formatter={(value) => [`$${Math.round(Number(value) || 0).toLocaleString()}`, "Net retained"]}
              />
              <Bar dataKey="net_retained" radius={[4, 4, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.net_retained < 0 ? "#EF4444" : "#2DD4BF"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Padding breakdown */}
      {Object.keys(paddingCats).length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-semibold text-gray-900 dark:text-white">Revenue padding removed</h4>
            <span className="text-sm font-semibold text-red-600 dark:text-red-400">
              −{money(m.padding_total)} total
            </span>
          </div>
          <div className="space-y-2">
            {Object.entries(paddingCats)
              .filter(([, v]) => (v ?? 0) !== 0)
              .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
              .map(([cat, amt]) => (
                <div key={cat} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">{PADDING_LABELS[cat] ?? cat.replace(/_/g, " ")}</span>
                  <span className="font-medium text-gray-900 dark:text-white">{money(amt)}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Flags */}
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {flags.map((f, i) => (
            <span key={i} className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${FLAG_BADGE[f.severity]}`}>
              {f.message}
            </span>
          ))}
        </div>
      )}

      {/* AI narrative */}
      {r.ai_narrative && (
        <div className="bg-blue-50/50 dark:bg-blue-900/10 rounded-xl p-5 border border-blue-100 dark:border-blue-900/40">
          <h4 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-3">
            <SparklesIcon className="w-4 h-4 text-ocean-blue" /> Underwriter's read
          </h4>
          <NarrativeText text={r.ai_narrative} />
        </div>
      )}

      {/* Per-statement drilldown */}
      {r.per_statement && r.per_statement.length > 0 && (
        <details className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 group">
          <summary className="flex items-center justify-between p-5 cursor-pointer list-none">
            <span className="font-semibold text-gray-900 dark:text-white">
              Per-statement detail ({r.per_statement.length})
            </span>
            <ChevronDownIcon className="w-5 h-5 text-gray-400 group-open:rotate-180 transition-transform" />
          </summary>
          <div className="px-5 pb-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500">
                  <th className="text-left py-2 pr-4 font-medium">Month</th>
                  <th className="text-right py-2 px-4 font-medium">Deposits</th>
                  <th className="text-right py-2 px-4 font-medium">Withdrawals</th>
                  <th className="text-right py-2 px-4 font-medium">Avg balance</th>
                  <th className="text-right py-2 px-4 font-medium">Min balance</th>
                  <th className="text-right py-2 px-4 font-medium">Neg. days</th>
                  <th className="text-right py-2 px-4 font-medium">NSF</th>
                  <th className="text-right py-2 pl-4 font-medium">Padding items</th>
                </tr>
              </thead>
              <tbody>
                {r.per_statement.map((s, i) => (
                  <tr key={i} className="border-b border-gray-100 dark:border-gray-700">
                    <td className="py-2 pr-4 font-medium text-gray-900 dark:text-white">
                      {s.month}
                      {s._filename && (
                        <span className="block text-xs text-gray-400 font-normal truncate max-w-[160px]">{s._filename}</span>
                      )}
                    </td>
                    <td className="py-2 px-4 text-right text-gray-900 dark:text-white">{money(s.total_deposits)}</td>
                    <td className="py-2 px-4 text-right text-gray-900 dark:text-white">{money(s.total_withdrawals)}</td>
                    <td className="py-2 px-4 text-right text-gray-900 dark:text-white">{money(s.avg_daily_balance)}</td>
                    <td className={`py-2 px-4 text-right ${s.min_balance < 0 ? "text-red-600" : "text-gray-900 dark:text-white"}`}>
                      {money(s.min_balance)}
                    </td>
                    <td className={`py-2 px-4 text-right ${s.negative_days > 0 ? "text-red-600" : "text-gray-900 dark:text-white"}`}>
                      {num(s.negative_days)}
                    </td>
                    <td className={`py-2 px-4 text-right ${s.nsf_count > 0 ? "text-red-600" : "text-gray-900 dark:text-white"}`}>
                      {num(s.nsf_count)}
                    </td>
                    <td className="py-2 pl-4 text-right text-gray-500">{s.padding_deposits?.length ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

// ── Affordability: max sustainable DAILY vs WEEKLY payment → advance size ─────
function AffordabilitySection({ a }: { a: UWAffordability }) {
  const verdictWord = (ok: boolean | null) =>
    ok == null ? "—" : ok ? "affordable" : "unaffordable";
  const verdictTint = (ok: boolean | null) =>
    ok == null ? "text-gray-500" : ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
  const hasAsk = a.amount_requested != null && a.amount_requested > 0;
  const cons = a.conservative;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-semibold text-gray-900 dark:text-white">Affordability</h4>
        <span className="text-xs text-gray-400">
          net of {money(a.existing_daily_debit)}/day existing debits
        </span>
      </div>

      {/* Daily vs weekly structures */}
      <div className="grid sm:grid-cols-2 gap-4">
        {[
          { label: "Daily structure", pay: a.max_daily_payment, per: "/day", adv: a.max_advance_daily, bind: a.binding_constraint_daily },
          { label: "Weekly structure", pay: a.max_weekly_payment, per: "/wk", adv: a.max_advance_weekly, bind: a.binding_constraint_weekly },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-xs uppercase tracking-wide text-gray-400 mb-1">{s.label}</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {money(s.pay)}<span className="text-sm font-normal text-gray-500">{s.per} max payment</span>
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              → max advance <span className="font-semibold text-gray-900 dark:text-white">{money(s.adv)}</span>
            </div>
            <div className="text-xs text-gray-400 mt-1">bound by {s.bind === "balance" ? "balance buffer" : "revenue cap"}</div>
          </div>
        ))}
      </div>

      {/* Requested-amount verdict */}
      {hasAsk && (
        <div className="mt-4 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
          Requested <span className="font-semibold">{money(a.amount_requested)}</span> needs{" "}
          <span className="font-semibold">{money(a.required_daily_payment)}/day</span> or{" "}
          <span className="font-semibold">{money(a.required_weekly_payment)}/week</span> →{" "}
          daily <span className={`font-semibold ${verdictTint(a.affordable_daily)}`}>{verdictWord(a.affordable_daily)}</span>,{" "}
          weekly <span className={`font-semibold ${verdictTint(a.affordable_weekly)}`}>{verdictWord(a.affordable_weekly)}</span>.{" "}
          Max advance ≈ <span className="font-semibold">{money(a.max_advance_daily)}</span> (daily) /{" "}
          <span className="font-semibold">{money(a.max_advance_weekly)}</span> (weekly).
        </div>
      )}

      {/* Conservative sensitivity (owner-payroll excluded) */}
      {cons && (
        <div className="mt-3 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700 pt-3">
          <span className="font-medium">Conservative case</span> (owner-payroll excluded, revenue {money(cons.monthly_revenue_basis)}/mo):
          max {money(cons.max_daily_payment)}/day → advance {money(cons.max_advance_daily)}; {money(cons.max_weekly_payment)}/wk → advance {money(cons.max_advance_weekly)}
          {hasAsk && <> — daily <span className={verdictTint(cons.affordable_daily)}>{verdictWord(cons.affordable_daily)}</span>, weekly <span className={verdictTint(cons.affordable_weekly)}>{verdictWord(cons.affordable_weekly)}</span></>}.
        </div>
      )}

      {/* Assumptions */}
      <p className="mt-3 text-xs text-gray-400">
        Assumes payment ≤ {pct(a.max_payment_pct_of_revenue)} of true monthly revenue ({money(a.monthly_revenue_basis)}/mo),
        balance buffer {pct(a.balance_buffer_pct)}{a.balance_basis != null ? ` of worst-month avg balance (${money(a.balance_basis)})` : ""},
        {" "}{a.factor_rate}× factor, {num(a.term_daily_biz_days)} biz-days daily / {num(a.term_weekly_weeks)} weeks weekly.
      </p>
    </div>
  );
}

// ── What would it take? — deterministic what-if scenarios ────────────────────
// Four reads on the two levers a closer asks about: crediting full stated
// revenue, and a clean restructure that zeroes existing debits. Same
// affordability math as above — only the inputs move. Chip = advance vs the ask.
const VS_ASK_CHIP: Record<string, string> = {
  green: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
  amber: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  red: "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300",
  na: "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400",
};
function vsAskLabel(v: UWScenario["affordable_vs_ask"]): string {
  if (v.status === "na" || v.delta == null) return "no ask";
  if (v.delta >= 0) return `+${money(v.delta)} vs ask`;
  return `${money(v.delta)} vs ask`;
}

// The bare scenarios table + verdict + caveat — reused standalone (older runs)
// and embedded under the paths card as "the math".
function ScenariosBody({ scenarios, verdict }: { scenarios: UWScenario[]; verdict?: string }) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500">
              <th className="text-left py-2 pr-4 font-medium">Scenario</th>
              <th className="text-right py-2 px-4 font-medium">Capacity/day</th>
              <th className="text-right py-2 px-4 font-medium">Max advance</th>
              <th className="text-right py-2 pl-4 font-medium">vs ask</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => (
              <tr key={s.key} className="border-b border-gray-100 dark:border-gray-700 last:border-0 align-top">
                <td className="py-2.5 pr-4">
                  <div className="font-medium text-gray-900 dark:text-white">{s.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5 max-w-md">{s.note}</div>
                </td>
                <td className="py-2.5 px-4 text-right text-gray-900 dark:text-white whitespace-nowrap">{money(s.capacity_per_day)}</td>
                <td className="py-2.5 px-4 text-right font-semibold text-gray-900 dark:text-white whitespace-nowrap">{money(s.max_affordable_advance)}</td>
                <td className="py-2.5 pl-4 text-right whitespace-nowrap">
                  <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${VS_ASK_CHIP[s.affordable_vs_ask.status] ?? VS_ASK_CHIP.na}`}>
                    {vsAskLabel(s.affordable_vs_ask)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {verdict && (
        <p className="mt-4 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{verdict}</p>
      )}
      <p className="mt-2 text-xs text-gray-400">
        The restructure row is an <span className="font-medium">upper bound</span> — it assumes existing positions are
        fully cleared. Post-restructure reality lands between as-is and that row.
      </p>
    </>
  );
}

// Standalone card — only for older stored runs that have scenarios but no paths.
function ScenariosSection({ scenarios, verdict }: { scenarios: UWScenario[]; verdict?: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-semibold text-gray-900 dark:text-white">What would it take?</h4>
        <span className="text-xs text-gray-400">daily-remit capacity under each lever</span>
      </div>
      <ScenariosBody scenarios={scenarios} verdict={verdict} />
    </div>
  );
}

// ── Paths to revenue — "How we make this deal work" ──────────────────────────
// The product: every run surfaces at least one actionable path. Ranked rows with
// an action callout; the what-if scenarios collapse underneath as the evidence.
const PATH_ACCENT: Record<string, string> = {
  counter_as_is: "border-l-emerald-400 dark:border-l-emerald-500",
  counter_full_revenue: "border-l-emerald-400 dark:border-l-emerald-500",
  restructure_vcf: "border-l-violet-400 dark:border-l-violet-500",
  micro_mca: "border-l-sky-400 dark:border-l-sky-500",
  product_switch: "border-l-amber-400 dark:border-l-amber-500",
  nurture_trigger: "border-l-gray-300 dark:border-l-gray-600",
};

function PathsSection({
  paths, verdict, scenarios, scenariosVerdict,
}: {
  paths: UWPath[]; verdict?: string; scenarios?: UWScenario[]; scenariosVerdict?: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-1">
        <h4 className="font-semibold text-gray-900 dark:text-white">How we make this deal work</h4>
        <span className="text-xs text-gray-400">{paths.length} path{paths.length === 1 ? "" : "s"}, ranked</span>
      </div>
      {verdict && (
        <p className="text-sm font-medium text-gray-900 dark:text-white mb-4">{verdict}</p>
      )}

      <div className="space-y-3">
        {paths.map((p) => (
          <div
            key={p.key}
            className={`rounded-lg border border-gray-200 dark:border-gray-700 border-l-4 ${PATH_ACCENT[p.key] ?? "border-l-gray-300 dark:border-l-gray-600"} p-3.5`}
          >
            <div className="flex items-start gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-bold flex items-center justify-center mt-0.5">
                {p.rank}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-gray-900 dark:text-white">{p.label}</div>
                <div className="mt-1.5 flex items-start gap-1.5 text-sm text-ocean-blue dark:text-blue-300">
                  <span className="shrink-0 mt-0.5">▸</span>
                  <span className="font-medium">{p.action}</span>
                </div>
                <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{p.expected_note}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {scenarios && scenarios.length > 0 && (
        <details className="mt-4 group">
          <summary className="flex items-center gap-1.5 cursor-pointer list-none text-sm font-medium text-gray-600 dark:text-gray-300">
            <ChevronDownIcon className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform" />
            The math — what-if scenarios
          </summary>
          <div className="mt-3">
            <ScenariosBody scenarios={scenarios} verdict={scenariosVerdict} />
          </div>
        </details>
      )}
    </div>
  );
}

// ── Explicit per-month metrics table (chronological) ─────────────────────────
// One row per CALENDAR month: same-month statements from different bank accounts
// merge — flows and balances SUM (total deposits, total cash across accounts),
// negative days sum (account-days in the red). `accounts` drives the "2 accounts"
// tag so a merged row is visibly a merge, not a single statement.
function mergeMonths(rows: UWPerMonth[]): (UWPerMonth & { accounts: number })[] {
  const nsum = (a: number | null | undefined, b: number | null | undefined): number | null =>
    a == null && b == null ? null : (a ?? 0) + (b ?? 0);
  const by = new Map<string, UWPerMonth & { accounts: number }>();
  rows.forEach((r, i) => {
    const key = r.month ?? `Month ${i + 1}`;
    const cur = by.get(key);
    if (!cur) {
      by.set(key, { ...r, month: key, accounts: 1 });
      return;
    }
    cur.accounts += 1;
    cur.deposit_count = nsum(cur.deposit_count, r.deposit_count);
    cur.true_deposits = (cur.true_deposits ?? 0) + (r.true_deposits ?? 0);
    cur.ending_balance = nsum(cur.ending_balance, r.ending_balance);
    cur.average_daily_balance = nsum(cur.average_daily_balance, r.average_daily_balance);
    cur.negative_days = (cur.negative_days ?? 0) + (r.negative_days ?? 0);
  });
  return [...by.values()].sort((a, b) => {
    const ta = Date.parse(`1 ${a.month}`);
    const tb = Date.parse(`1 ${b.month}`);
    return Number.isNaN(ta) || Number.isNaN(tb) ? 0 : ta - tb;
  });
}

function PerMonthTable({ rows: rawRows }: { rows: UWPerMonth[] }) {
  const rows = mergeMonths(rawRows);
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 overflow-x-auto">
      <h4 className="font-semibold text-gray-900 dark:text-white mb-4">Per-month metrics</h4>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500">
            <th className="text-left py-2 pr-4 font-medium">Month</th>
            <th className="text-right py-2 px-4 font-medium"># Deposits</th>
            <th className="text-right py-2 px-4 font-medium">True deposits</th>
            <th className="text-right py-2 px-4 font-medium">Ending balance</th>
            <th className="text-right py-2 px-4 font-medium">Avg daily balance</th>
            <th className="text-right py-2 pl-4 font-medium">Negative days</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-100 dark:border-gray-700">
              <td className="py-2 pr-4 font-medium text-gray-900 dark:text-white">
                {r.month ?? `Month ${i + 1}`}
                {r.accounts > 1 && (
                  <span className="ml-1.5 text-[10px] font-normal text-gray-400 dark:text-gray-500">· {r.accounts} accounts</span>
                )}
              </td>
              <td className="py-2 px-4 text-right text-gray-900 dark:text-white">{num(r.deposit_count)}</td>
              <td className="py-2 px-4 text-right text-gray-900 dark:text-white">{money(r.true_deposits)}</td>
              <td className={`py-2 px-4 text-right ${(r.ending_balance ?? 0) < 0 ? "text-red-600" : "text-gray-900 dark:text-white"}`}>
                {money(r.ending_balance)}
              </td>
              <td className="py-2 px-4 text-right text-gray-900 dark:text-white">{money(r.average_daily_balance)}</td>
              <td className={`py-2 pl-4 text-right ${r.negative_days > 0 ? "text-red-600" : "text-gray-900 dark:text-white"}`}>
                {num(r.negative_days)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-lg font-semibold mt-0.5 ${tone === "bad" ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}`}>
        {value}
      </div>
    </div>
  );
}
