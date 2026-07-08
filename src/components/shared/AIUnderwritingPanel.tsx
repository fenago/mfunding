import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  SparklesIcon, ArrowPathIcon, ExclamationTriangleIcon, ChevronDownIcon,
} from "@heroicons/react/24/outline";
import {
  getUnderwritingHistory, runUnderwriting,
  type DealUnderwriting, type UWFlag, type UWMetrics, type AffordabilityRating, type RiskRating,
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
  const chartData = (m.net_retained_by_month ?? []).map((d) => ({
    month: d.month,
    net_retained: d.net_retained,
  }));

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
            {num(m.statements_analyzed)} statements · {num(m.months_covered)} months
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
