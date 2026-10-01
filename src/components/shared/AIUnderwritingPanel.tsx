import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";
import {
  SparklesIcon, ArrowPathIcon, ExclamationTriangleIcon, ChevronDownIcon, CheckCircleIcon,
} from "@heroicons/react/24/outline";
import {
  getUnderwritingHistory, runUnderwriting,
  getUnderwritingContext, saveUnderwritingContext,
  type DealUnderwriting, type UWFlag, type UWMetrics, type UWPerMonth, type UWAffordability,
  type UWScenario, type UWPath, type UWDocumentLedgerRow, type AffordabilityRating, type RiskRating,
  type UWPosition, type UWEndedPosition, type UWOtherObligation,
  type UWTimelineRow, type UWRemainingPosition, type UWRefi, type UWRefiTerm,
  type UWVelocityRow, type UWPositionAnomaly, type UWProvenance,
  type UWProfile, type UWRecommendedFunder, type UWExcludedFunder,
  type UWCollectionActivity, type UWCollectionType,
} from "../../services/aiUnderwritingService";
import { modelLabel } from "../../services/platformService";
import { PRODUCT_LABEL_SHORT, type ProductId } from "@/lib/lenderProducts";
import { useUserProfile } from "../../context/UserProfileContext";
import useIsProcessor from "@/hooks/useIsProcessor";
import DealAssistant from "../admin/DealAssistant";

interface Props {
  dealId: string;
  /**
   * Narrow container (a drawer, a side panel) rather than a full page. Tightens
   * padding and drops the metric grid to two columns. It does NOT remove or fold
   * anything extra — the same information is present at both densities, because a
   * reader in a drawer is doing the same job as a reader on a page.
   */
  embedded?: boolean;
  /**
   * Which tab opens. Defaults to "decision" — "can we fund it" is always the
   * first question. A caller that already knows why the reader is here should say
   * so: the control beside the funder picker opens on "funders", because she
   * clicked it to choose a funder, not to re-read the capacity.
   */
  initialTab?: TabKey;
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

// ── Owner context for the underwriter ────────────────────────────────────────
// A deal-level free-text note for things the statements can't tell (seasonality,
// a baseline the analyzed months undershoot, expected volume). Injected into the
// judge prompt as broker context. Inline save only — no browser popups.
function ContextEditor({ dealId, canEdit }: { dealId: string; canEdit: boolean }) {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getUnderwritingContext(dealId)
      .then((t) => { if (alive) { setValue(t); setSaved(t); } })
      .catch(() => { /* non-fatal — leave empty */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [dealId]);

  const dirty = value.trim() !== saved.trim();

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await saveUnderwritingContext(dealId, value);
      setSaved(value);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save context");
    } finally {
      setSaving(false);
    }
  }

  // Read-only view for non-admins: show the note only if one exists.
  if (!canEdit) {
    if (loading || !saved.trim()) return null;
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Context for the underwriter</div>
        <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{saved}</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-semibold text-gray-900 dark:text-white">Context for the underwriter</label>
        <span className="text-xs text-gray-400">Factored into the AI read — never overrides the statements</span>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={loading || saving}
        rows={3}
        placeholder="Things the statements can't tell — e.g. 'Baseline revenue is $100K/mo; Mar–Jun is the seasonal low; owner expects normal volume from August.'"
        className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-ocean-blue/40 disabled:opacity-60"
      />
      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={save}
          disabled={!dirty || saving || loading}
          className="px-3 py-1.5 text-sm font-medium text-white bg-ocean-blue rounded-lg hover:bg-ocean-blue/90 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {saving ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : null}
          {saving ? "Saving…" : "Save context"}
        </button>
        {justSaved && !dirty && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
            <CheckCircleIcon className="w-4 h-4" /> Saved — will apply on the next run
          </span>
        )}
        {dirty && !saving && (
          <span className="text-xs text-gray-400">Unsaved — re-run underwriting after saving to apply</span>
        )}
        {err && <span className="text-xs text-red-600 dark:text-red-400">{err}</span>}
      </div>
    </div>
  );
}

export default function AIUnderwritingPanel({ dealId, embedded = false, initialTab = "decision" }: Props) {
  const { isAdmin, isSuperAdmin } = useUserProfile();
  // PROCESSORS RUN UNDERWRITING TOO. Packaging a file — statements in, funder
  // fit out — is the processor's job, and the edge function has permitted them
  // since 2026-09-16 (it checks is_processor BEFORE the ownership test). This
  // client gate was the only thing still telling them to "ask an admin", on a
  // deal they are the assigned worker for.
  //
  // Reading an existing run is the more expensive half of the bug: a processor
  // who cannot SEE a completed result has no option but to spend another one.
  // Owner, 9/21: "I don't want to pay for tokens every time."
  const { isProcessor } = useIsProcessor();
  const canRun = isAdmin || isSuperAdmin || isProcessor;

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
      <div className="space-y-4">
        <ContextEditor dealId={dealId} canEdit={canRun} />
        <div className="bg-white dark:bg-gray-800 rounded-xl p-10 border border-gray-200 dark:border-gray-700 text-center">
        <SparklesIcon className="w-12 h-12 text-ocean-blue/60 mx-auto mb-4" />
        <h3 className="font-semibold text-gray-900 dark:text-white mb-1">No AI underwriting yet</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
          Claude reads the deal's bank statements and returns an affordability + risk read —
          true revenue after padding, safe daily debit capacity, and the max advance this
          merchant can support.
        </p>
        {error && <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>}
        <div className="flex items-center justify-center gap-2 flex-wrap">
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
          <DealAssistant dealId={dealId} placement="button" buttonLabel="Ask about this file" />
        </div>
        </div>
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
              {current.judge_model && ` · Judged by ${modelLabel(current.judge_model)}`}
              {current.extraction_model && ` · Extracted by ${modelLabel(current.extraction_model)}`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <DealAssistant dealId={dealId} placement="button" buttonLabel="Ask about this file" />
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
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <ExclamationTriangleIcon className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
        </div>
      )}

      <ContextEditor dealId={dealId} canEdit={canRun} />

      {current && <ResultView r={current} embedded={embedded} initialTab={initialTab} />}
    </div>
  );
}

// ─────────────────────── The reorganisation, 2026-10-01 ───────────────────────
// Owner: "it's too much information and it's overwhelming... i want to keep
// everything but it needs to be more geared towards humans that need to use
// this information."
//
// Nothing below is deleted. It is RANKED and FOLDED, against the sequence the
// reader actually works in — she is a processor about to pick funders:
//
//   ① Can we fund it, and for how much?   → the header. NEVER behind a tab.
//   ② What will kill it?                  → Risks
//   ③ Where does it go?                   → Funders
//   ④ What do I say?                      → Submission
//   ⑤ Show me the working                 → Working (accordions, collapsed)
//
// THE RULE THAT CONSTRAINS THE TABS: a tab may not hide something that is
// currently screaming. "Unaffordable", "High risk", active collections, a
// doctored statement and a failed document parse all render ABOVE the tab bar,
// unconditionally, because a red flag behind a tab nobody opens is a red flag
// that does not exist. The tabs only ever fold things that are safe to not see.

type TabKey = "decision" | "risks" | "funders" | "submission" | "working";

/** Semantic tone, kept separate from the brand accent on purpose: ocean-blue is
 *  "this is interactive", these three are "this is good / watch it / this kills
 *  the deal". Mixing them is how a warning ends up looking like a link. */
type Tone = "good" | "warn" | "critical" | "neutral";

const TONE_TEXT: Record<Tone, string> = {
  good: "text-emerald-700 dark:text-emerald-300",
  warn: "text-amber-700 dark:text-amber-300",
  critical: "text-red-700 dark:text-red-300",
  neutral: "text-gray-700 dark:text-gray-300",
};
const TONE_BAR: Record<Tone, string> = {
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  critical: "bg-red-500",
  neutral: "bg-gray-400 dark:bg-gray-500",
};

/**
 * Confidence as a SHAPE, not the word "medium" in grey.
 *
 * Owner's note was about exactly this: a read's confidence was a lowercase word
 * in small grey text beside a red headline, so it carried none of the weight it
 * should. Three segments, filled to level, coloured semantically — readable
 * without being read.
 */
function ConfidenceMeter({ level, label = "confidence" }: { level: string | null | undefined; label?: string }) {
  const n = level === "high" ? 3 : level === "medium" ? 2 : level === "low" ? 1 : 0;
  // 0 = we were never told. That is NOT low confidence, and it must not draw as
  // one segment of red — it draws as empty with its own wording.
  const tone: Tone = n === 3 ? "good" : n === 2 ? "warn" : n === 1 ? "critical" : "neutral";
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={n === 0 ? `This run did not record a ${label}.` : `${level} ${label}`}
    >
      <span className="inline-flex gap-0.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`block w-1.5 h-3.5 rounded-sm ${i < n ? TONE_BAR[tone] : "bg-gray-300 dark:bg-gray-600"}`}
          />
        ))}
      </span>
      <span className={`text-[11px] font-semibold capitalize ${n === 0 ? "text-gray-400" : TONE_TEXT[tone]}`}>
        {n === 0 ? `${label} not recorded` : `${level} ${label}`}
      </span>
    </span>
  );
}

/**
 * True vs reported revenue, as the ratio it actually is.
 *
 * "86% real" is a proportion and the eye reads a proportion instantly and a
 * percentage slowly. The filled part is what survived the padding sweep; the
 * remainder is what came out, and it is labelled with the dollar figure rather
 * than left as a gap the reader has to infer.
 */
function RevenueRealityBar({
  truth, reported, qualityPct, padding,
}: {
  truth: number | null | undefined;
  reported: number | null | undefined;
  qualityPct: number | null | undefined;
  padding: number | null | undefined;
}) {
  if (truth == null || reported == null || reported <= 0) return null;
  const raw = qualityPct ?? (truth / reported) * 100;
  const filled = Math.max(0, Math.min(100, raw));
  // Under 70% real is a file whose deposits are mostly not revenue — that is a
  // submission problem, not a rounding note, so the bar says so in colour.
  const tone: Tone = filled >= 85 ? "good" : filled >= 70 ? "warn" : "critical";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-xs opacity-80">True monthly revenue</span>
        <span className={`text-[11px] font-bold ${TONE_TEXT[tone]}`}>{Math.round(filled)}% real</span>
      </div>
      <div className="text-2xl font-bold leading-tight">
        {money(truth)}
        <span className="text-sm font-normal opacity-70"> vs {money(reported)} reported</span>
      </div>
      <div className="mt-1.5 h-2.5 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden flex">
        <div className={`h-full ${TONE_BAR[tone]}`} style={{ width: `${filled}%` }} />
        <div className="h-full flex-1 bg-red-400/70 dark:bg-red-500/60" />
      </div>
      {padding != null && padding > 0 && (
        <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
          <span className="font-semibold text-red-600 dark:text-red-400">−{money(padding)}</span> stripped as padding
          <span className="opacity-70"> — itemised under Working</span>
        </div>
      )}
    </div>
  );
}

/**
 * Monthly revenue trend. Direction matters as much as the average: $40k/mo
 * falling is a different deal from $40k/mo climbing, and the single averaged
 * figure above hides which one you are looking at.
 *
 * True deposits per month (padding already removed), so it is the same basis as
 * the headline — not total deposits, which would disagree with it.
 */
function RevenueTrendChart({ rows }: { rows: UWPerMonth[] }) {
  const data = rows
    .filter((m) => m.month)
    .map((m) => ({ month: m.month as string, revenue: Number(m.true_deposits) || 0 }));
  if (data.length < 2) return null; // a trend needs two points; one month is not a direction
  const avg = data.reduce((s, d) => s + d.revenue, 0) / data.length;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          True revenue by month
        </h4>
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          dashed = {money(avg)} avg
        </span>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#30363D" opacity={0.3} />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#8B949E" />
          <YAxis
            tick={{ fontSize: 11 }}
            stroke="#8B949E"
            tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "#F0F6FC", fontWeight: 600 }}
            itemStyle={{ color: "#F0F6FC" }}
            formatter={(value) => [`$${Math.round(Number(value) || 0).toLocaleString()}`, "True revenue"]}
          />
          <ReferenceLine y={avg} stroke="#8B949E" strokeDasharray="4 4" />
          <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.revenue >= avg ? "#2DD4BF" : "#F59E0B"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * The position stack — who is already taking money out, every day, in one bar.
 *
 * The numbers for this are in PositionsSection's table and stay there. What the
 * table cannot do is show the SHAPE of the burden: five funders each taking a
 * little is a different conversation from one taking most of it, and that is the
 * thing a processor needs off a glance before she picks who to send to.
 */
const STACK_FILLS = ["#38BDF8", "#818CF8", "#F472B6", "#FB923C", "#A3E635", "#2DD4BF"];
function PositionStack({
  positions, capacity,
}: {
  positions: UWPosition[];
  capacity: number | null | undefined;
}) {
  const live = positions.filter((p) => (Number(p.daily_amount) || 0) > 0);
  if (live.length === 0) return null;
  const total = live.reduce((s, p) => s + (Number(p.daily_amount) || 0), 0);
  const sorted = [...live].sort((a, b) => (b.daily_amount || 0) - (a.daily_amount || 0));
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Who is already debiting — {live.length} active position{live.length === 1 ? "" : "s"}
        </h4>
        <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">
          {money(total)}/day
        </span>
      </div>
      <div className="h-6 w-full rounded-lg overflow-hidden flex bg-gray-200 dark:bg-gray-700">
        {sorted.map((p, i) => {
          const w = total > 0 ? ((p.daily_amount || 0) / total) * 100 : 0;
          return (
            <div
              key={`${p.funder}-${i}`}
              className="h-full flex items-center justify-center"
              style={{ width: `${w}%`, backgroundColor: STACK_FILLS[i % STACK_FILLS.length] }}
              title={`${p.funder} — ${money(p.daily_amount)}/day (${Math.round(w)}% of the stack), ${p.cadence}`}
            >
              {w >= 12 && (
                <span className="text-[10px] font-bold text-gray-900 truncate px-1">{Math.round(w)}%</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {sorted.map((p, i) => (
          <span key={`${p.funder}-lg-${i}`} className="inline-flex items-center gap-1 text-[11px] text-gray-600 dark:text-gray-300">
            <span
              className="inline-block w-2 h-2 rounded-sm shrink-0"
              style={{ backgroundColor: STACK_FILLS[i % STACK_FILLS.length] }}
            />
            <span className="font-semibold">{p.funder}</span>
            <span className="opacity-75 tabular-nums">{money(p.daily_amount)}/d</span>
          </span>
        ))}
      </div>
      {/* Room left, next to room taken — the actual question behind the stack. */}
      {capacity != null && (
        <div className="mt-2 text-[11px] text-gray-600 dark:text-gray-300">
          Safe daily capacity <span className="font-bold">{money(capacity)}</span> ·{" "}
          {capacity - total >= 0 ? (
            <span className="font-semibold text-emerald-700 dark:text-emerald-300">
              {money(capacity - total)}/day of room left
            </span>
          ) : (
            <span className="font-semibold text-red-700 dark:text-red-300">
              {money(total - capacity)}/day OVER safe capacity
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * EVIDENCE INTEGRITY — the strip that stops this panel lying by omission.
 *
 * Every section below reports on a read that can fail. A statement that failed
 * to parse means its month is NOT in any of these numbers, and "no red flags"
 * computed over a partial read is the worst instance of the absence-vs-
 * unreadable bug in the whole app: it tells a processor a file is clean when
 * nobody has seen half of it.
 *
 * So the coverage of the read is stated ABOVE the tabs, always, in the same
 * breath as the verdict it qualifies. Errors are red and name the count; a
 * single month says "thin evidence" in its own right; bank-feed months are
 * called out because the merchant cannot alter those.
 */
function EvidenceStrip({
  statements, months, ledger, provenance,
}: {
  statements: number | null | undefined;
  months: number;
  ledger: UWDocumentLedgerRow[] | undefined;
  provenance: UWProvenance | undefined;
}) {
  const errored = (ledger ?? []).filter((d) => d.status === "error");
  const feedMonths = provenance?.bank_feed_months?.length ?? 0;
  // Evidence strength is a DESCRIBED composite, not an invented score: months of
  // coverage, minus any month we failed to read, plus a lift for feed-verified
  // months. The inputs are all printed next to it so nobody has to trust it.
  const strength: Tone =
    errored.length > 0 ? "critical" : months >= 3 ? (feedMonths > 0 ? "good" : "good") : months === 2 ? "warn" : "critical";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex gap-0.5" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`block w-4 h-1.5 rounded-sm ${
                i < (strength === "good" ? 3 : strength === "warn" ? 2 : 1)
                  ? TONE_BAR[strength]
                  : "bg-gray-300 dark:bg-gray-600"
              }`}
            />
          ))}
        </span>
        <span className={`font-bold ${TONE_TEXT[strength]}`}>
          {errored.length > 0
            ? "Incomplete read"
            : months >= 3
              ? "Evidence: solid"
              : months === 2
                ? "Evidence: thin"
                : "Evidence: single month"}
        </span>
      </span>
      <span className="text-gray-500 dark:text-gray-400">
        {num(statements)} statement{statements === 1 ? "" : "s"} · {num(months)} month{months === 1 ? "" : "s"}
      </span>
      {feedMonths > 0 && (
        <span className="font-semibold text-emerald-700 dark:text-emerald-300">
          🏦 {feedMonths} feed-verified{provenance?.institution ? ` · ${provenance.institution}` : ""}
        </span>
      )}
      {/* THE LINE THAT MATTERS. A failed parse is a hole, and every "none found"
          in the tabs below is scoped to what was actually read. */}
      {errored.length > 0 && (
        <span className="font-bold text-red-700 dark:text-red-300">
          ⚠ {errored.length} document{errored.length === 1 ? "" : "s"} failed to parse — those months are NOT in
          these numbers. Nothing below is a statement that they are clean. (Working → Documents)
        </span>
      )}
      {months === 1 && errored.length === 0 && (
        <span className="font-semibold text-amber-700 dark:text-amber-300">
          one month cannot show a trend or a seasonal dip
        </span>
      )}
    </div>
  );
}

/** Critical flags, lifted out of the flat chip pile at the bottom of the old
 *  layout. A `critical` severity flag was rendering as one grey-ish pill in a row
 *  of twenty, below five charts. Loudest first, above the tabs, always. */
function CriticalFlags({ flags }: { flags: UWFlag[] }) {
  const critical = flags.filter((f) => f.severity === "critical");
  if (critical.length === 0) return null;
  return (
    <div className="rounded-xl border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/25 p-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <ExclamationTriangleIcon className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
        <h4 className="text-xs font-bold uppercase tracking-wide text-red-800 dark:text-red-200">
          {critical.length} deal-breaker{critical.length === 1 ? "" : "s"}
        </h4>
      </div>
      <ul className="space-y-1">
        {critical.map((f, i) => (
          <li key={i} className="flex gap-2 text-sm font-semibold text-red-800 dark:text-red-200">
            <span className="text-red-500 shrink-0">▸</span>
            <span>{f.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The tab bar. Counts and alert dots on the tabs themselves, so she can tell
 *  there are six risks without opening Risks. */
function TabBar({
  tab, setTab, counts,
}: {
  tab: TabKey;
  setTab: (t: TabKey) => void;
  counts: Record<TabKey, { n: number | null; alert: boolean }>;
}) {
  const TABS: { key: TabKey; label: string; hint: string }[] = [
    { key: "decision", label: "Decision", hint: "Capacity, affordability and the plays that make it work" },
    { key: "risks", label: "Risks", hint: "What will kill this deal — worst first" },
    { key: "funders", label: "Funders", hint: "Who buys this file, and who is knocked out" },
    { key: "submission", label: "Submission", hint: "What to say when you send it" },
    { key: "working", label: "Working", hint: "Every number's source — tables, debits, descriptors" },
  ];
  return (
    <div
      role="tablist"
      className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-700 -mb-px"
    >
      {TABS.map((t) => {
        const c = counts[t.key];
        const active = tab === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            title={t.hint}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${
              active
                ? "border-ocean-blue text-ocean-blue bg-ocean-blue/5 dark:bg-ocean-blue/10"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            }`}
          >
            {t.label}
            {c.n != null && c.n > 0 && (
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  c.alert
                    ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
                    : "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                }`}
              >
                {c.n}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** An accordion for the Working tab. Collapsed by default — house rule — and it
 *  says what is inside it before you open it, so folding costs no information. */
function Fold({
  title, note, children, defaultOpen = false,
}: {
  title: string;
  note?: string | null;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 group">
      <summary className="flex items-center justify-between gap-2 p-4 cursor-pointer list-none">
        <span className="min-w-0">
          <span className="font-semibold text-gray-900 dark:text-white">{title}</span>
          {note && <span className="block text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{note}</span>}
        </span>
        <ChevronDownIcon className="w-5 h-5 text-gray-400 shrink-0 group-open:rotate-180 transition-transform" />
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

// ── The fact set behind the submission paragraph ─────────────────────────────
// `submission_facts` is the code-computed ground truth the writer was allowed to
// use — the migration's words: "so a human can verify the paragraph invented
// nothing. Code computes ground truth; the model only phrases it." It was being
// stored and never shown, which leaves the check un-runnable: a closer is about
// to paste model-written prose to a funder with no way to confirm a figure in it.
//
// TWO RULES THIS RENDERER KEEPS.
//
// ① UNKNOWN KEYS STILL RENDER. The labels below are a presentation nicety, not a
//    whitelist: anything not in the map prints humanised with its raw value. A
//    renderer that showed only the keys it recognised would silently drop a new
//    fact the model HAD been given, and the one thing this panel exists to do is
//    make the paragraph checkable. New facts appear unstyled rather than not at all.
//
// ② `documents_unreadable` IS NOT A ROW IN A TABLE. It is the field that stops a
//    silence being sold as a clean bill of health, so when it is non-zero it is
//    lifted out and rendered red ABOVE the fold — the paragraph was written from
//    an incomplete read, and whoever is about to send it needs to know before they
//    send it, not after they expand an accordion.
const FACT_LABEL: Record<string, string> = {
  business_name: "Business",
  industry: "Industry",
  state: "State",
  time_in_business: "Time in business",
  amount_requested: "Amount requested",
  verified_avg_monthly_revenue: "Verified avg monthly revenue",
  normal_season_avg_monthly_revenue: "Normal-season avg revenue",
  worst_month_revenue: "Worst month",
  revenue_trend: "Revenue trend",
  months_of_statements: "Months of statements",
  open_position_count: "Open positions",
  existing_daily_remittance: "Existing daily remittance",
  debt_service_pct_of_verified_revenue: "Debt service (% of verified revenue)",
  avg_daily_balance: "Avg daily balance",
  negative_days: "Negative days",
  nsf_total: "NSF total",
  settlement_servicers: "Settlement servicers",
  collection_activity_detected: "Collection activity",
  collection_activity_confidence: "Collection-activity confidence",
  collection_activity_types: "Collection-activity types",
  consolidation_viable: "Consolidation viable",
  consolidation_amount: "Consolidation amount",
  consolidation_term_months: "Consolidation term (months)",
  consolidation_monthly_payment: "Consolidation monthly payment",
  months_read: "Months read",
  documents_unreadable: "Documents unreadable",
};
// Keys whose values are dollars. Everything else prints as given, because
// inventing a unit is its own small lie.
const MONEY_FACTS = new Set([
  "amount_requested", "verified_avg_monthly_revenue", "normal_season_avg_monthly_revenue",
  "worst_month_revenue", "existing_daily_remittance", "avg_daily_balance",
  "consolidation_amount", "consolidation_monthly_payment",
]);

function factValue(key: string, v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return MONEY_FACTS.has(key) ? money(v) : num(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "none";
    return v
      .map((it) =>
        it != null && typeof it === "object"
          ? // A settlement servicer is an object; show the name and the amount,
            // which is what a human checks it against on the statement.
            [
              (it as { servicer?: string }).servicer,
              (it as { monthly_amount?: number }).monthly_amount != null
                ? money((it as { monthly_amount?: number }).monthly_amount)
                : null,
            ].filter(Boolean).join(" · ")
          : String(it),
      )
      .join("; ");
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function SubmissionFacts({ facts }: { facts: Record<string, unknown> }) {
  const unreadable = Number(facts.documents_unreadable) || 0;
  const entries = Object.entries(facts).filter(([k]) => k !== "documents_unreadable");
  return (
    <>
      {/* Lifted out, not a row. See rule ② above. */}
      {unreadable > 0 && (
        <div className="rounded-xl border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/25 p-3">
          <p className="text-sm font-bold text-red-800 dark:text-red-200">
            ⚠ This paragraph was written from an incomplete read — {num(unreadable)} document
            {unreadable === 1 ? "" : "s"} could not be parsed.
          </p>
          <p className="text-xs text-red-700 dark:text-red-300 mt-1">
            Anything it does not mention may simply be in a month nobody read.{" "}
            <span className="font-semibold">
              Fix the documents and re-run before sending this to a funder.
            </span>
          </p>
        </div>
      )}
      <Fold
        title={`The facts it was written from (${entries.length})`}
        note="Code-computed ground truth — the model only phrased it. Check any figure in the paragraph against this."
      >
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 border-b border-gray-100 dark:border-gray-700/60 py-1">
              <dt className="text-xs text-gray-500 dark:text-gray-400">{FACT_LABEL[k] ?? humanize(k)}</dt>
              <dd className="text-xs font-semibold text-gray-900 dark:text-white text-right tabular-nums">
                {factValue(k, v)}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
          Revenue here is <span className="font-semibold">verified</span> (bank-derived). The stated figure is
          deliberately absent from this set — quoting a number a funder cannot reproduce from the statements is
          how a package loses credibility.
        </p>
      </Fold>
    </>
  );
}

// ── Consolidation: a trade with two halves, and neither may be shown alone ────
//
// `metrics.consolidation_analysis` is NOT the same question as `metrics.refi`.
// refi answers "does a consolidated payment fit"; this answers "is it a good
// idea", which refi never did. The whole reason the dimension exists is that
// consolidation is BETTER MONTHLY AND WORSE OVERALL — on Spirit Drilling
// (MF-2026-0442) $4,577/mo freed, bought with $9,082 of additional total cost at
// a 45% premium.
//
// So the relief and the premium are rendered in the same block, at the same
// weight, side by side. A panel that showed "$4,577/mo freed" in large green text
// with the premium in grey underneath would mislead in exactly the way this
// analysis was built to prevent, and would do it while appearing to disclose.
//
// `applicable: false` is an EARNED answer (no positions, no estimable balance),
// not missing data, so it renders as a stated finding with its reason rather than
// as nothing at all.
const CONSOLIDATION_VERDICT: Record<string, { label: string; tone: Tone }> = {
  better_monthly_costlier_overall: { label: "Better monthly, costlier overall", tone: "warn" },
  better_both: { label: "Better monthly AND cheaper overall", tone: "good" },
  worse_both: { label: "Worse monthly and costlier overall", tone: "critical" },
  not_viable: { label: "Not viable", tone: "critical" },
};

function ConsolidationSection({
  c, read,
}: {
  c: NonNullable<Partial<UWMetrics>["consolidation_analysis"]>;
  read?: string | null;
}) {
  // An earned "no", with the reason. Never silence.
  if (c.applicable === false) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
        <h4 className="font-semibold text-gray-900 dark:text-white mb-1">Consolidation</h4>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          <span className="font-semibold">Not applicable to this file.</span>{" "}
          {c.reason ?? "No open positions with an estimable balance, so there is nothing to consolidate."}
        </p>
        <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
          This is a computed answer, not a gap in the data.
        </p>
      </div>
    );
  }

  const v = c.verdict ? CONSOLIDATION_VERDICT[c.verdict] : undefined;
  const relief = c.monthly_relief ?? null;
  const premium = c.premium_vs_paying_as_is ?? null;
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h4 className="font-semibold text-gray-900 dark:text-white">Consolidation</h4>
        {v && (
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
            v.tone === "good"
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
              : v.tone === "critical"
                ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
          }`}>
            {v.label}
          </span>
        )}
      </div>

      {/* THE TWO HALVES, equal weight, same row. */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/60 dark:bg-emerald-900/15 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
            What it frees up
          </div>
          <div className="text-2xl font-bold text-emerald-800 dark:text-emerald-200 leading-tight mt-0.5">
            {relief != null ? `${money(relief)}/mo` : "—"}
          </div>
          <div className="text-[11px] text-emerald-800/80 dark:text-emerald-200/80 mt-1">
            {money(c.current_monthly_remittance)} → {money(c.consolidated_monthly_payment)}
            {c.monthly_relief_pct_of_revenue != null && (
              <> · {pct(c.monthly_relief_pct_of_revenue)} of revenue</>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50/60 dark:bg-red-900/15 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
            What it costs
          </div>
          <div className="text-2xl font-bold text-red-800 dark:text-red-200 leading-tight mt-0.5">
            {premium != null ? `+${money(premium)}` : "—"}
            {c.premium_pct != null && (
              <span className="text-sm font-bold"> ({Math.round(c.premium_pct)}%)</span>
            )}
          </div>
          <div className="text-[11px] text-red-800/80 dark:text-red-200/80 mt-1">
            {money(c.est_outstanding_mid)} owed now → {money(c.total_payback)} total payback
            {c.consolidated_term_months != null && <> over {num(c.consolidated_term_months)} mo</>}
          </div>
        </div>
      </div>

      {c.tradeoff && (
        <p className="mt-3 text-sm text-gray-700 dark:text-gray-200">
          <span className="font-semibold">The trade:</span> {c.tradeoff}
        </p>
      )}
      {/* The distinction that gets merchants into trouble — true consolidation
          retires the positions, reverse consolidation does not. */}
      {c.mechanism_note && (
        <p className="mt-2 text-[11px] text-gray-600 dark:text-gray-300 border-t border-gray-200 dark:border-gray-700 pt-2">
          {c.mechanism_note}
        </p>
      )}
      {c.caveat && (
        <p className="mt-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">⚠ {c.caveat}</p>
      )}
      {read && (
        <div className="mt-3 border-t border-gray-200 dark:border-gray-700 pt-3">
          <NarrativeText text={read} />
        </div>
      )}
    </div>
  );
}

// ── Do we even have desks for this? ──────────────────────────────────────────
// Counts of LIVE funders by product, never names. It makes the consolidation and
// term-loan reads actionable: "2 true-consolidation desks" is a different
// conversation from "0", and until now nothing rendered this at all even though
// every run carries it.
//
// `status !== "read_ok"` means the lenders table could not be read. The counts
// then MUST NOT print — "we have no SBA desks" and "we could not check" send a
// closer to opposite conclusions, and this is the panel where that mistake is
// least affordable.
function NetworkCapability({ n }: { n: NonNullable<Partial<UWMetrics>["network_capability"]> }) {
  if (n.status !== "read_ok") {
    return (
      <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3">
        <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
          ⚠ Couldn&apos;t read the funder network for this run{n.status ? ` (${n.status})` : ""}.
        </p>
        <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
          This is <span className="font-bold">not</span> &ldquo;no desks available&rdquo;. Check the funder
          catalogue before telling anyone a product is unplaceable.
        </p>
      </div>
    );
  }
  const rows: { label: string; v: number | undefined }[] = [
    { label: "All live funders", v: n.live_funders_total },
    { label: "Term loan", v: n.live_term_loan_desks },
    { label: "Line of credit", v: n.live_loc_desks },
    { label: "SBA", v: n.live_sba_desks },
    { label: "Factoring", v: n.live_factoring_desks },
    { label: "True consolidation", v: n.live_true_consolidation_desks },
    { label: "Reverse consolidation", v: n.live_reverse_consolidation_desks },
  ].filter((r) => r.v != null);
  if (rows.length === 0) return null;
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
        Live desks by product
      </h4>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {rows.map((r) => (
          <span key={r.label} className="inline-flex items-baseline gap-1.5 text-[11px]">
            <span className={`font-bold tabular-nums ${
              (r.v ?? 0) === 0 ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"
            }`}>
              {num(r.v)}
            </span>
            <span className="text-gray-500 dark:text-gray-400">{r.label}</span>
          </span>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
        Counts only — which desk is the shortlist&apos;s job. A zero is a real zero: that product has nowhere
        to go today.
      </p>
    </div>
  );
}

/** Shown when a tab has nothing in it. Says WHY it is empty — a run stored before
 *  a detector shipped is not the same as a clean file, and this panel must never
 *  let those two read alike. */
function TabEmpty({ what, why }: { what: string; why: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 p-6 text-center">
      <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">{what}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{why}</p>
    </div>
  );
}

function ResultView({
  r, embedded = false, initialTab = "decision",
}: {
  r: DealUnderwriting;
  embedded?: boolean;
  initialTab?: TabKey;
}) {
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

  // ── Tab routing ────────────────────────────────────────────────────────────
  // "decision" always opens first: the reader's first question is always "can we
  // fund this and for how much", and she should never have to click to start.
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [submissionCopied, setSubmissionCopied] = useState(false);
  const copySubmission = async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setSubmissionCopied(true);
      setTimeout(() => setSubmissionCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (permissions, insecure context). Say nothing
      // misleading: the button simply does not flip to "Copied", and the text is
      // on screen to select manually.
      console.error("Failed to copy submission paragraph");
    }
  };
  // Additive + nullable on BOTH levels: older runs have no `lenses` key, and any
  // individual lens can be null when the judge did not answer.
  const lenses = m.lenses;
  const consolidation = m.consolidation_analysis;

  const perMonth = m.per_month ?? [];
  const activePositions = m.active_positions ?? [];
  const criticalCount = flags.filter((f) => f.severity === "critical").length;
  const warnCount = flags.filter((f) => f.severity === "warn").length;
  const collectionsLive =
    !!m.collection_activity?.detected ||
    (m.collection_activity?.settlement_servicers ?? []).length > 0;
  const ledgerErrors = (m.document_ledger ?? []).filter((d) => d.status === "error").length;
  const fraudChecks = (m.provenance?.cross_checks ?? []).filter((c) => c.fraud).length;

  // Risk count on the tab = everything that tab holds which is genuinely bad.
  // Deliberately NOT a total of rows in the tab: a badge that counts neutral
  // context inflates to "14" on a clean file and then means nothing on a dirty one.
  const riskCount =
    criticalCount + warnCount + (collectionsLive ? 1 : 0) + fraudChecks +
    ((m.negative_days ?? 0) > 0 ? 1 : 0) + ((m.nsf_total ?? 0) > 0 ? 1 : 0);
  const funderCount = m.profile?.recommended_funders?.length ?? null;
  const tabCounts: Record<TabKey, { n: number | null; alert: boolean }> = {
    decision: { n: null, alert: false },
    risks: { n: riskCount, alert: criticalCount > 0 || collectionsLive || fraudChecks > 0 },
    funders: { n: funderCount, alert: false },
    submission: { n: null, alert: false },
    working: { n: ledgerErrors > 0 ? ledgerErrors : null, alert: ledgerErrors > 0 },
  };

  return (
    <div className="space-y-4">
      {/* ═══ ALWAYS VISIBLE — ① can we fund it, and for how much ═══════════════
          Nothing in this zone is ever behind a tab. Owner's constraint and the
          lead's: a red flag behind a tab nobody opens is a red flag that doesn't
          exist. */}
      <div className={`rounded-xl border ${embedded ? "p-4" : "p-5"} ${verdictTone(r.affordability_rating, r.risk_rating)}`}>
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
          {m.owner_context_used && (
            <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 inline-flex items-center gap-1">
              <SparklesIcon className="w-3.5 h-3.5" /> Owner context factored in
            </span>
          )}
          {m.latest_month_is_partial && (
            <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
              Latest month partial{m.normal_season_avg_monthly_revenue != null && (
                <> — normal-season avg {money(m.normal_season_avg_monthly_revenue)}/mo</>
              )}
            </span>
          )}
        </div>

        {/* The two numbers the whole panel exists to produce. */}
        <div className={`grid gap-5 mt-4 ${embedded ? "" : "sm:grid-cols-2"}`}>
          <div>
            <div className="text-xs opacity-80">Max affordable advance</div>
            <div className="text-2xl font-bold leading-tight">
              {money(m.max_affordable_advance)}
              <span className="text-sm font-normal opacity-70"> vs {money(m.amount_requested)} requested</span>
            </div>
            {/* Ask vs capacity as a relationship, not two numbers side by side —
                "over by $30k" is the sentence she has to act on. */}
            {m.max_affordable_advance != null && m.amount_requested != null && m.amount_requested > 0 && (
              <div className="mt-1.5 text-[11px] font-semibold">
                {m.max_affordable_advance >= m.amount_requested ? (
                  <span className="text-emerald-700 dark:text-emerald-300">
                    ✓ the ask fits — {money(m.max_affordable_advance - m.amount_requested)} of headroom
                  </span>
                ) : (
                  <span className="text-red-700 dark:text-red-300">
                    ⚠ the ask is {money(m.amount_requested - m.max_affordable_advance)} over capacity — counter at{" "}
                    {money(m.max_affordable_advance)}
                  </span>
                )}
              </div>
            )}
          </div>
          <RevenueRealityBar
            truth={m.true_avg_monthly_revenue}
            reported={m.reported_avg_monthly_revenue}
            qualityPct={m.revenue_quality_pct}
            padding={m.padding_total}
          />
        </div>

        {/* Coverage of the read, in the same breath as the verdict it qualifies. */}
        <div className="mt-4 pt-3 border-t border-current/15">
          <EvidenceStrip
            statements={m.statements_analyzed}
            months={monthsCovered}
            ledger={m.document_ledger}
            provenance={m.provenance}
          />
        </div>
      </div>

      {/* ═══ ALWAYS VISIBLE — the things that must never be folded ═════════════ */}
      <CriticalFlags flags={flags} />

      {/* Collection activity — knocks funders off the shortlist, so it is read
          first, above the tabs, exactly where it was. */}
      {collectionsLive && (
        <CollectionActivitySection
          ca={m.collection_activity!}
          excluded={m.profile?.excluded_note ?? []}
        />
      )}

      {/* Doctored-statement callout. A merchant cannot alter the bank feed, so a
          statement claiming more than the feed is the single most expensive thing
          on this screen. Never behind a tab. */}
      {m.provenance && <CrossCheckBanner provenance={m.provenance} />}

      {/* ═══ THE TABS — everything that is safe not to see at a glance ════════ */}
      <TabBar tab={tab} setTab={setTab} counts={tabCounts} />

      {/* ① DECISION — capacity, affordability, the plays, and the shape of the money */}
      {tab === "decision" && (
        <div className="space-y-4 pt-1">
          {m.affordability ? (
            <AffordabilitySection a={m.affordability} />
          ) : (
            <TabEmpty
              what="No affordability block on this run."
              why="This run predates the affordability model — re-run underwriting to get max daily/weekly payment and the advance each supports."
            />
          )}

          {/* Direction, not just the average. */}
          {perMonth.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
              <RevenueTrendChart rows={perMonth} />
            </div>
          )}

          {/* The burden already on the account, as a shape. */}
          {activePositions.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
              <PositionStack positions={activePositions} capacity={m.safe_daily_debit_capacity} />
            </div>
          )}

          {/* How we make this deal work. */}
          {m.paths && m.paths.length > 0 && (
            <PathsSection
              paths={m.paths}
              verdict={m.paths_verdict}
              scenarios={m.scenarios}
              scenariosVerdict={m.scenarios_verdict}
            />
          )}
          {(!m.paths || m.paths.length === 0) && m.scenarios && m.scenarios.length > 0 && (
            <ScenariosSection scenarios={m.scenarios} verdict={m.scenarios_verdict} />
          )}

          {/* Estimated remaining balance + refi/consolidation feasibility. */}
          {((m.remaining_by_position && m.remaining_by_position.length > 0) || m.refi) && (
            <RemainingRefiSection
              positions={m.remaining_by_position}
              refi={m.refi}
              outstandingLow={m.est_outstanding_low}
              outstandingMid={m.est_outstanding_mid}
              outstandingHigh={m.est_outstanding_high}
            />
          )}

          {/* ── Consolidation — its own region, per underwriter-dimensions 10/1 ──
              Deliberately NOT folded into RemainingRefiSection above. `refi`
              answers "does a consolidated payment fit"; this answers "is it a
              good idea", and only this one carries the factor premium. Reading
              the relief without the premium is the specific error the dimension
              exists to prevent, so the component renders both halves at equal
              weight and neither can be shown alone.

              Sourced from `metrics.consolidation_analysis`, NOT from
              `submission_facts.consolidation_*` — that fact set is a deliberately
              narrowed funder-safe subset handed to the paragraph writer, and
              `metrics` is authoritative if the two ever disagree. */}
          {consolidation && (
            <ConsolidationSection c={consolidation} read={lenses?.consolidation_read} />
          )}

          {/* Term loan — a product-capacity read, so it belongs beside capacity.
              NOT gated on `product_signals` containing term_loan: it answers the
              question even when the answer is "not placeable", and gating it would
              hide exactly that answer. A term loan IS a loan, so lending language
              here is correct — the MCA receivables rule governs the MCA copy, not
              this. */}
          {lenses?.term_loan_read && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
              <h4 className="font-semibold text-gray-900 dark:text-white mb-3">As a term loan</h4>
              <NarrativeText text={lenses.term_loan_read} />
            </div>
          )}

          {/* The metric grid. Kept whole — every card the old layout had — but it
              sits under the decision it supports rather than above the positions. */}
          <div className={`grid gap-3 ${embedded ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"}`}>
            <Metric label="Avg daily balance" value={money(m.avg_daily_balance)} />
            <Metric label="Min balance" value={money(m.min_balance)} tone={(m.min_balance ?? 0) < 0 ? "bad" : undefined} />
            <Metric label="Negative days" value={num(m.negative_days)} tone={(m.negative_days ?? 0) > 0 ? "bad" : undefined} />
            <Metric label="NSF total" value={num(m.nsf_total)} tone={(m.nsf_total ?? 0) > 0 ? "bad" : undefined} />
            <Metric label="Avg net retained" value={money(m.avg_net_retained)} />
            <Metric label="Active MCA positions" value={num(m.est_open_positions)} tone={(m.est_open_positions ?? 0) >= 3 ? "bad" : undefined} />
            <Metric label="MCA daily debit" value={money(m.existing_daily_debit)} />
            <Metric label="Debt service" value={pct(m.debt_service_pct)} tone={(m.debt_service_pct ?? 0) >= 25 ? "bad" : undefined} />
            <Metric label="Safe daily capacity" value={money(m.safe_daily_debit_capacity)} />
            <Metric label="Deposit concentration" value={pct(m.deposit_concentration_pct)} tone={(m.deposit_concentration_pct ?? 0) >= 40 ? "bad" : undefined} />
            <Metric label="Revenue trend" value={m.revenue_trend ? (trendLabel[m.revenue_trend] ?? m.revenue_trend) : "—"} />
          </div>
        </div>
      )}

      {/* ② RISKS — what will kill it, worst first */}
      {tab === "risks" && (
        <div className="space-y-4 pt-1">
          {/* Warnings. Criticals are above the tab bar and are NOT repeated here —
              one render per fact; the header is the louder place. */}
          {warnCount > 0 && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
              <h4 className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200 mb-2">
                {warnCount} warning{warnCount === 1 ? "" : "s"}
              </h4>
              <ul className="space-y-1">
                {flags.filter((f) => f.severity === "warn").map((f, i) => (
                  <li key={i} className="flex gap-2 text-sm text-amber-800 dark:text-amber-200">
                    <span className="text-amber-500 shrink-0">▸</span>
                    <span>{f.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* `info` flags — context, not risk. Quiet, last, still present: the old
              layout put every severity in one undifferentiated pill row, which is
              why a `critical` read like an `info`. */}
          {flags.some((f) => f.severity === "info") && (
            <div className="flex flex-wrap gap-2">
              {flags.filter((f) => f.severity === "info").map((f, i) => (
                <span key={i} className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${FLAG_BADGE[f.severity]}`}>
                  {f.message}
                </span>
              ))}
            </div>
          )}
          {criticalCount > 0 && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              The {criticalCount} deal-breaker{criticalCount === 1 ? "" : "s"}
              {collectionsLive ? " and the collection activity" : ""} are shown above the tabs, where they
              cannot be missed.
            </p>
          )}

          {/* Cash stress, as the count it is. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Metric label="Negative days" value={num(m.negative_days)} tone={(m.negative_days ?? 0) > 0 ? "bad" : undefined} />
            <Metric label="NSF total" value={num(m.nsf_total)} tone={(m.nsf_total ?? 0) > 0 ? "bad" : undefined} />
            <Metric label="Min balance" value={money(m.min_balance)} tone={(m.min_balance ?? 0) < 0 ? "bad" : undefined} />
            <Metric label="Overdraft fees" value={money(m.overdraft_fees_total)} tone={(m.overdraft_fees_total ?? 0) > 0 ? "bad" : undefined} />
          </div>

          {/* Positions — the count and the stack are the two biggest decline
              reasons after collections. */}
          {(activePositions.length > 0 || (m.ended_positions ?? []).length > 0 || (m.other_obligations ?? []).length > 0) && (
            <PositionsSection
              active={activePositions}
              ended={m.ended_positions ?? []}
              other={m.other_obligations ?? []}
              otherMonthly={m.other_obligations_monthly}
              dailyMca={m.existing_daily_debit}
              latestMonth={m.latest_statement_month}
            />
          )}

          {/* Stacking velocity — the direction of the position count. */}
          {m.stacking_velocity && m.stacking_velocity.length > 0 && (
            <StackingVelocitySection rows={m.stacking_velocity} narrative={m.stacking_velocity_narrative} />
          )}

          {/* Holdback stress — remittances against deposits. Guarded on the FIELD,
              not on the row count: holdback_pct is additive, and a chart drawn
              over rows that never carried it is an empty axis that reads as "no
              holdback stress" on a run that simply never measured it. */}
          {perMonth.some((row) => row.holdback_pct != null) && (
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
              <HoldbackRatioChart rows={perMonth} />
            </div>
          )}

          {riskCount === 0 && (
            <TabEmpty
              what="No flags, no collections, no negative days and no NSFs in the months read."
              why={
                ledgerErrors > 0
                  ? `⚠ But ${ledgerErrors} document(s) failed to parse, so this is a clean read of an INCOMPLETE set — not a clean file.`
                  : `Scoped to the ${monthsCovered} month(s) analysed. It is not a representation about anything outside them.`
              }
            />
          )}
        </div>
      )}

      {/* ③ FUNDERS — where does it go */}
      {tab === "funders" && (
        <div className="space-y-4 pt-1">
          {/* ── How the funder's desk will read this file ──────────────────────
              Moved here from Submission at underwriter-dimensions' request, and
              they were right: "how a funder reads this file" and "which funder"
              are the same decision.

              ⚠ IT IS INTERNAL AND IT READS LIKE SOMETHING A FUNDER WAS NEVER
              MEANT TO SEE. Sitting next to the shortlist — a surface a closer is
              actively copying out of — the risk of it being pasted goes UP, not
              down. So the warning is a red banner inside the block rather than a
              grey line under the heading, and it is the first thing in the
              region. */}
          {lenses?.funder_view && (
            <div className="bg-amber-50/60 dark:bg-amber-900/10 rounded-xl p-5 border border-amber-200 dark:border-amber-900/40">
              <div className="flex items-start gap-2 mb-2 rounded-lg bg-red-100 dark:bg-red-900/40 px-2.5 py-1.5">
                <ExclamationTriangleIcon className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <p className="text-[11px] font-bold text-red-800 dark:text-red-200">
                  INTERNAL — DO NOT SEND THIS TO A FUNDER. It is written bluntly about how they will
                  receive the file. The pasteable copy is the submission paragraph, under Submission.
                </p>
              </div>
              <h4 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-1">
                <SparklesIcon className="w-4 h-4 text-amber-600" /> How the funder will read it
              </h4>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
                What they see first, stop on, and ask for.
              </p>
              <NarrativeText text={lenses.funder_view} />
            </div>
          )}

          {/* Do we even have desks for the products in play? */}
          {m.network_capability && <NetworkCapability n={m.network_capability} />}

          {m.profile ? (
            <>
              <MerchantProfileSection p={m.profile} />
              <RecommendedFundersSection
                funders={m.profile.recommended_funders ?? []}
                note={m.profile.recommended_funders_note ?? null}
              />
            </>
          ) : (
            <TabEmpty
              what="No funder shortlist on this run."
              why="This run predates the merchant profiler — re-run underwriting to get the paper tier and the gated funder shortlist."
            />
          )}
        </div>
      )}

      {/* ④ SUBMISSION — what do I say.
          Order is deliberate, most-sendable first: the pasteable paragraph, then the
          funder's-eye read of what is coming, then the two product lenses, then the
          full internal read. Every block below is ADDITIVE and null-checked — runs
          stored before 2026-10-01 have none of these keys and must still render. */}
      {tab === "submission" && (
        <div className="space-y-4 pt-1">
          {/* THE paragraph. Funder-facing and pasteable with no editing. A NULL here
              is never rendered as an empty box: a closer could mistake that for
              finished copy and send nothing, so absence is stated outright. */}
          {r.submission_paragraph ? (
            <div className="bg-emerald-50/60 dark:bg-emerald-900/10 rounded-xl p-5 border border-emerald-200 dark:border-emerald-900/40">
              <div className="flex items-start justify-between gap-3 mb-2">
                <h4 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <SparklesIcon className="w-4 h-4 text-emerald-600" /> Submission paragraph
                </h4>
                <button
                  type="button"
                  onClick={() => void copySubmission(r.submission_paragraph ?? "")}
                  className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/30"
                >
                  {submissionCopied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
                Paste as-is alongside the package. It discloses the adverse facts on purpose —
                verified (not stated) revenue, and no other funder is named.
              </p>
              <p className="text-sm leading-relaxed text-gray-800 dark:text-gray-100 whitespace-pre-wrap">
                {r.submission_paragraph}
              </p>
            </div>
          ) : (
            <TabEmpty
              what="No submission paragraph on this run."
              why="Either the run predates the feature, or the writer failed, or its output was rejected by the funder-facing compliance check. Re-run to generate one — do not read the absence as 'nothing worth saying'."
            />
          )}

          {/* The checkable half. The paragraph above is model-written prose about to
              go to a funder; this is the ground truth it was given. */}
          {r.submission_facts && <SubmissionFacts facts={r.submission_facts} />}

          {r.ai_narrative ? (
            <div className="bg-blue-50/50 dark:bg-blue-900/10 rounded-xl p-5 border border-blue-100 dark:border-blue-900/40">
              <h4 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-3">
                <SparklesIcon className="w-4 h-4 text-ocean-blue" /> Underwriter&apos;s read
              </h4>
              <NarrativeText text={r.ai_narrative} />
            </div>
          ) : (
            <TabEmpty
              what="No underwriter narrative on this run."
              why="The judge pass produces this. If the run is recent and this is empty, the judge call failed — re-run rather than reading the absence as 'nothing to say'."
            />
          )}
        </div>
      )}

      {/* ⑤ WORKING — show me the numbers. Accordions, every one collapsed. */}
      {tab === "working" && (
        <div className="space-y-3 pt-1">
          {/* Documents FIRST and open when something failed: an unreadable
              document is the thing that invalidates everything else in here. */}
          {m.document_ledger && m.document_ledger.length > 0 && (
            <Fold
              title={`Documents read (${m.document_ledger.length})`}
              note={
                ledgerErrors > 0
                  ? `⚠ ${ledgerErrors} failed to parse — their months are missing from every number in this panel`
                  : "Every uploaded file and what became of it"
              }
              defaultOpen={ledgerErrors > 0}
            >
              <DocumentLedger rows={m.document_ledger} />
            </Fold>
          )}

          {perMonth.length > 0 && (
            <Fold title="Per-month metrics" note="Deposits, balances, NSFs and holdback, month by month">
              <PerMonthTable rows={perMonth} overdraftFeesTotal={m.overdraft_fees_total} />
            </Fold>
          )}

          {m.position_timeline && m.position_timeline.length > 0 && (
            <Fold
              title="Position timeline"
              note="Every recurring debitor across all months, with the one-offs excluded from the count"
            >
              <TimelineSection rows={m.position_timeline} anomalies={m.position_anomalies} />
            </Fold>
          )}

          {Object.keys(paddingCats).length > 0 && (
            <Fold title="Revenue padding removed" note={`−${money(m.padding_total)} total — by category`}>
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
            </Fold>
          )}

          {chartData.length > 0 && (
            <Fold title="Net retained by month" note="What was left after every debit">
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
            </Fold>
          )}

          {r.per_statement && r.per_statement.length > 0 && (
            <Fold
              title={`Per-statement detail (${r.per_statement.length})`}
              note="One row per file, as extracted"
            >
              <div className="overflow-x-auto">
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
            </Fold>
          )}
        </div>
      )}
    </div>
  );
}

// ── Collection activity ──────────────────────────────────────────────────────
// Collections, garnishments, tax levies and judgment/writ debits found in the
// statements. Rendered in the SAME critical-flag treatment as the doctored-
// statement banner (red-300/red-800 ring, red-50/red-900-25 fill) because it
// carries the same weight: several funders hard-decline on it.
// The UCC line underneath is deliberately NOT red — filings are context about
// existing financed positions, not collection activity.
const COLLECTION_TYPE_LABEL: Record<UWCollectionType, string> = {
  collections: "Collections",
  garnishment: "Garnishment",
  tax_levy: "Tax levy",
  judgment: "Judgment / writ",
  debt_settlement: "Debt-settlement program",
};
const collectionTypeLabel = (t: string) =>
  COLLECTION_TYPE_LABEL[t as UWCollectionType] ?? t.replace(/_/g, " ");

function CollectionItemRows({ items }: { items: UWCollectionActivity["items"] }) {
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div
          key={i}
          className="flex items-start justify-between gap-3 text-sm bg-white/60 dark:bg-black/20 rounded-lg px-3 py-1.5"
        >
          <span className="min-w-0 text-red-800 dark:text-red-200">
            <span className="font-semibold">{it.date ?? it.month ?? "—"}</span>
            <span className="text-red-700 dark:text-red-300"> · {it.desc}</span>
          </span>
          <span className="shrink-0 text-right">
            <span className="font-semibold text-red-800 dark:text-red-200">{money(it.amount)}</span>
            <span className="ml-2 inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-md bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
              {collectionTypeLabel(it.type)}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * THE PARAGRAPH THAT RENDERED TWICE (owner's screenshot, 2026-10-01).
 *
 * The same text appeared, verbatim, above and below the stats line. It was not a
 * duplicated JSX node — it was TWO FIELDS HOLDING ONE STRING. underwrite-deal
 * writes `profile.collection_activity_summary` as a straight copy of
 * `collection_activity.note`:
 *
 *   collection_activity_summary: collectionActivity.detected ? collectionActivity.note : null
 *
 * Confirmed against the stored runs, not inferred: of the runs that have both,
 * all six are byte-identical, and the summary is null on exactly the runs where
 * nothing was detected. So the field carries no information that `note` does not.
 *
 * This section used to take both and render both. It now takes only `ca` and
 * renders `ca.note` once — the redundant INPUT is gone, which is the cause, and
 * not a second copy suppressed at the point of display. `collection_activity_summary`
 * had exactly one reader in the codebase (this prop), so dropping it here leaves
 * it unread; the server-side write is underwriter-dimensions' file to retire and
 * they have been told. Keeping the write costs nothing in the meantime.
 */
function CollectionActivitySection({
  ca, excluded,
}: {
  ca: UWCollectionActivity;
  excluded: UWExcludedFunder[];
}) {
  const items = ca.items ?? [];
  const types = ca.types ?? [];
  const ucc = ca.ucc_corroboration;
  const knockedOut = (excluded ?? []).filter((e) => e.collections_exclusion === true);
  // A settlement servicer matched on NAME alone (medium) does not fire the gate — it
  // must not knock funders off a shortlist on an unverified descriptor — but the
  // setter still has to see it, so the section renders with honest wording instead.
  const possibleOnly = !ca.detected;

  return (
    <div className="rounded-xl border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/25 p-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h4 className="font-bold text-red-800 dark:text-red-200">
          {possibleOnly ? "⚠ Possible debt-settlement servicer" : "⚠ Collection activity detected"}
        </h4>
        {types.map((t) => (
          <span
            key={t}
            className="inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
          >
            {collectionTypeLabel(t)}
          </span>
        ))}
        {!possibleOnly && (
          <span className="ml-auto">
            <ConfidenceMeter level={ca.confidence} />
          </span>
        )}
      </div>

      {!possibleOnly && (
      <div className="text-sm text-red-700 dark:text-red-300 mb-2">
        <span className="font-semibold">{num(items.length)}</span> flagged item{items.length === 1 ? "" : "s"} across{" "}
        <span className="font-semibold">{num(ca.months_with_activity)}</span> month
        {ca.months_with_activity === 1 ? "" : "s"} ·{" "}
        <span className="font-semibold">{money(ca.total_amount)}</span> total
        {ca.monthly_count > 0 && (
          <span className="text-red-600 dark:text-red-400"> · {ca.monthly_count.toFixed(1)} per month</span>
        )}
      </div>
      )}

      {/* The ONE paragraph. Carries the weight the duplicated copy used to. */}
      {ca.note && <p className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">{ca.note}</p>}

      {/* Named debt-settlement servicers — the thing a setter must see before
          submitting. Additive: runs stored before the settlement detector shipped
          have no settlement_servicers key and this renders nothing. */}
      {(ca.settlement_servicers ?? []).length > 0 && (
        <div className="mb-2 rounded-lg border border-red-300 dark:border-red-800 bg-white/70 dark:bg-black/25 p-2.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-300 mb-1.5">
            Debt-settlement servicer — not a position
          </div>
          <div className="space-y-1.5">
            {(ca.settlement_servicers ?? []).map((sv, i) => (
              <div key={i} className="text-sm text-red-800 dark:text-red-200">
                <span className="font-semibold">{sv.servicer}</span>
                {sv.confidence !== "high" && (
                  <span className="ml-1.5 px-1.5 py-0.5 text-[11px] font-semibold rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200">
                    possible — verify the statement line
                  </span>
                )}
                <span className="opacity-80">
                  {" "}· {money(sv.amount)}
                  {sv.occurrences > 1 ? ` × ${sv.occurrences}` : ""}
                  {sv.month ? ` (${sv.month})` : ""} · “{sv.desc}”
                </span>
                <div className="text-xs opacity-75">{sv.reason}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-red-700 dark:text-red-300 mt-1.5">
            Excluded from the position count and the consolidation math — a settlement
            servicer is a program the merchant is enrolled in, not an advance to be bought out.
          </p>
        </div>
      )}

      {/* ≤4 items read at a glance; anything longer folds, like the rest of the panel. */}
      {!possibleOnly && items.length > 0 && (
        items.length <= 4 ? (
          <CollectionItemRows items={items} />
        ) : (
          <details className="group">
            <summary className="flex items-center gap-1.5 cursor-pointer list-none text-sm font-medium text-red-700 dark:text-red-300">
              <ChevronDownIcon className="w-4 h-4 text-red-500 group-open:rotate-180 transition-transform" />
              Show {items.length} items
            </summary>
            <div className="mt-2">
              <CollectionItemRows items={items} />
            </div>
          </details>
        )
      )}

      {/* Funders this knocked out of the shortlist */}
      {knockedOut.length > 0 && (
        <div className="mt-3 border-t border-red-200 dark:border-red-800/60 pt-2.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-300 mb-1.5">
            Funders excluded because of this:
          </div>
          <div className="space-y-1">
            {knockedOut.map((e, i) => (
              <div key={e.lender_id ?? i} className="flex gap-2 text-xs text-red-700 dark:text-red-300">
                <span className="text-red-400 shrink-0">▸</span>
                <span>
                  <span className="font-semibold text-red-800 dark:text-red-200">{e.company_name}</span>
                  {e.reason ? ` — ${e.reason}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* UCC filings — separate, lower-key signal. Liens/financed positions on
          record, NOT collection activity; never styled red. */}
      {ucc?.matched && (
        <div className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40 px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
          <span className="font-semibold text-gray-700 dark:text-gray-200">UCC corroboration:</span>{" "}
          {num(ucc.filings)} filing{ucc.filings === 1 ? "" : "s"} on record
          {ucc.business_name ? ` for ${ucc.business_name}` : ""}
          {ucc.secured_parties && ucc.secured_parties.length > 0
            ? ` (${ucc.secured_parties.join(", ")})`
            : ""}
          .{ucc.note ? ` ${ucc.note}` : ""}
        </div>
      )}
    </div>
  );
}

// ── Merchant profile — what this file IS, in the cheat sheet's language ──────
// Deliberately shares the /admin/cheat-sheet semantics: A=green, B=blue, C=amber,
// D=red for paper; mint/accent for the consolidation lane; gold for debt relief.
// A closer reading the panel and the cheat sheet must see ONE colour system.
const PAPER_TILE: Record<string, string> = {
  A: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 ring-emerald-300/70 dark:ring-emerald-700/70",
  B: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 ring-blue-300/70 dark:ring-blue-700/70",
  C: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 ring-amber-300/70 dark:ring-amber-700/70",
  D: "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 ring-rose-300/70 dark:ring-rose-700/70",
};
const PAPER_TEXT: Record<string, string> = {
  A: "text-emerald-700 dark:text-emerald-300",
  B: "text-blue-700 dark:text-blue-300",
  C: "text-amber-700 dark:text-amber-300",
  D: "text-rose-700 dark:text-rose-300",
};
const PAPER_MEANING: Record<string, string> = {
  A: "clean file — best pricing, longest terms",
  B: "solid file with a blemish or a position",
  C: "stacked or stressed — priced accordingly",
  D: "high risk — only the D-paper desks will look",
};
const SIZE_BUCKET_LABEL: Record<string, string> = {
  micro: "Micro", small_mid: "Small–mid", mid_large: "Mid–large", jumbo: "Jumbo",
};
// ── Product labels: the shared map, not a fifth copy ────────────────────────
// This file held its own `PRODUCT_LABEL`, typed `Record<string, string>` rather
// than `Record<ProductId, string>` — so unlike the two consolidated maps it was
// invisible to the type system. A new product breaks the build until
// lenderProducts.ts is updated; this copy would just fall through to
// `humanize()` and render the raw key with its underscores swapped for spaces.
//
// An earlier version of this note said the old map was "already missing
// `consumer` and `startup_robs_401k`" and that one of them had rendered on
// screen. Neither has, and neither can: `underwrite-deal` whitelists seven
// product signals (KNOWN_PRODUCTS, the same seven as the
// `lender_programs.product_type` CHECK) and drops anything else before it is
// stored, so those two cannot reach this component. The map being invisible to
// the type system is reason enough on its own; it did not need a symptom, and
// the one it was given was never real.
//
// SHORT, not long, and that is a design decision rather than an accident of which
// import was nearer. These are chips in a dense row ("Products in play"), and the
// long map would push `sba_loan` to "SBA loan", `equipment_financing` to
// "Equipment financing" and `invoice_factoring` to "Invoice factoring" — longer
// text in the narrowest place it appears.
//
// It changes NO visible text today, which is the part worth knowing. Measured
// 2026-10-01 against `deal_underwriting`: 153 stored runs, 79 of which carry any
// product_signals, and only three distinct values have ever appeared — `mca`,
// `invoice_factoring` and `equipment_financing`. The short map renders those as
// "MCA", "Factoring" and "Equipment", exactly what the local copy produced; the
// other six values gain correct labels for the first time.
//
// READ THOSE COUNTS CAREFULLY. `mca` appears on 79 of 79, and that is not an
// observation — `underwrite-deal:3481` seeds the set with "mca" unconditionally
// before the model's values are merged in, so its count is just "runs that
// produced a profile" wearing a product label. The two real signals are
// `invoice_factoring` on 37 of 79 and `equipment_financing` on 10 of 79. Anyone
// comparing 79 against 37 and concluding MCA is twice as common has been misled
// by a constant.
//
// The table is also hot: 8 runs landed between two measurements an hour apart
// this session. Re-measure rather than citing these numbers in a year.
//
// `product_signals` is `string[]` off the model, so the lookup must still tolerate
// a value outside the union. The guard keeps the fallback explicit instead of
// casting the map to `Record<string, string>` and losing the exhaustiveness that
// is the whole point of the shared definition.
const humanize = (s: string) => s.replace(/_/g, " ");
const isProductId = (s: string): s is ProductId => s in PRODUCT_LABEL_SHORT;
const productLabel = (s: string) => (isProductId(s) ? PRODUCT_LABEL_SHORT[s] : humanize(s));

function MerchantProfileSection({ p }: { p: UWProfile }) {
  const tier = p.paper_tier;
  const tile = PAPER_TILE[tier] ?? PAPER_TILE.C;
  const because = p.paper_tier_ceiling_because ?? [];
  const basisNote =
    p.paper_tier_basis === "fico_and_cashflow"
      ? `FICO-based${p.fico_low != null ? ` — ${p.fico_low} low` : ""}`
      : p.paper_tier_basis === "cashflow_inferred"
        ? "cash-flow inferred — no credit pulled"
        : null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-semibold text-gray-900 dark:text-white">Merchant profile</h4>
        <span className="text-xs text-gray-400">what this file is — same grades as the cheat sheet</span>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        {/* Paper tier — the headline grade */}
        <div className="flex items-center gap-3">
          <div className={`w-14 h-14 rounded-xl ring-2 flex items-center justify-center text-3xl font-extrabold shrink-0 ${tile}`}>
            {tier}
          </div>
          <div className="min-w-0">
            <div className={`text-base font-bold ${PAPER_TEXT[tier] ?? ""}`}>{tier} paper</div>
            {basisNote && <div className="text-xs text-gray-500 dark:text-gray-400">({basisNote})</div>}
            <div className="text-xs text-gray-400">{PAPER_MEANING[tier] ?? ""}</div>
          </div>
        </div>

        {/* Size bucket */}
        {p.size_bucket && (
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-gray-400">Size tier</div>
            <div className="text-base font-bold text-gray-900 dark:text-white">
              {SIZE_BUCKET_LABEL[p.size_bucket] ?? humanize(p.size_bucket)}
              {p.size_basis_amount != null && p.size_basis_amount > 0 && (
                <span className="ml-1.5 text-sm font-normal text-gray-500 dark:text-gray-400">
                  {money(p.size_basis_amount)}
                </span>
              )}
            </div>
            {p.size_basis && (
              <div className="text-xs text-gray-500 dark:text-gray-400 max-w-xs">{p.size_basis}</div>
            )}
          </div>
        )}
      </div>

      {/* Status badges — the ground truth a closer scans for */}
      <div className="flex flex-wrap gap-2 mt-4">
        {p.positions != null && (
          <span className={`inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full ${
            p.positions >= 3
              ? "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300"
              : p.positions > 0
                ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                : "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
          }`}>
            {p.positions} open position{p.positions === 1 ? "" : "s"}
          </span>
        )}
        {p.consolidation_candidate && (
          <span className="inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300">
            🔗 Consolidation candidate
          </span>
        )}
        {p.debt_relief_candidate && (
          <span className="inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300">
            🛟 Debt relief candidate
          </span>
        )}
        {p.fast_track && (
          <span className="inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300">
            ⚡ Fast-track
          </span>
        )}
      </div>

      {/* Product signals */}
      {p.product_signals && p.product_signals.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          <span className="text-xs uppercase tracking-wide text-gray-400 mr-1">Products in play</span>
          {p.product_signals.map((s) => (
            <span key={s} className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              {productLabel(s)}
            </span>
          ))}
        </div>
      )}

      {/* Plain-English why */}
      {p.profile_reason && (
        <p className="mt-3 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{p.profile_reason}</p>
      )}

      {/* What pinned the ceiling — folded, because it's evidence, not the answer */}
      {because.length > 0 && (
        <details className="mt-3 group">
          <summary className="flex items-center gap-1.5 cursor-pointer list-none text-xs font-medium text-gray-500 dark:text-gray-400">
            <ChevronDownIcon className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform" />
            Why the grade can't go higher ({because.length})
            {p.paper_tier_ai && p.paper_tier_ai !== tier && (
              <span className="text-gray-400"> · AI read {p.paper_tier_ai}, capped to {tier}</span>
            )}
          </summary>
          <div className="mt-2 space-y-1">
            {because.map((b, i) => (
              <div key={i} className="flex gap-2 text-xs text-gray-600 dark:text-gray-400">
                <span className="text-gray-400 shrink-0">▸</span>
                <span>{b}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ── Send this deal to — the deterministic funder shortlist ───────────────────
// Matched in CODE against lenders.category (the same payload /admin/cheat-sheet
// reads), never named by the model. Ranked; each row carries WHY it matched so a
// closer can sanity-check the play before submitting.
function consoBadgeLabel(t: string): string {
  return humanize(t).replace(/\//g, " / ").replace(/\s+/g, " ").trim();
}
// A reason that says "confirm" / "outside the band" / "not recorded" is a caveat,
// not a match — tint it amber so it never reads as a green light.
const isCaveat = (r: string) => /confirm|outside|not recorded/i.test(r);

function FunderRow({ f, rank, canLink }: { f: UWRecommendedFunder; rank: number; canLink: boolean }) {
  const reasons = (f.why_matched ?? "").split(";").map((r) => r.trim()).filter(Boolean);
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 border-l-4 border-l-mint-green p-3.5">
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-bold flex items-center justify-center mt-0.5">
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* /admin/lenders/:id is admin-only — a closer clicking it would be
                bounced to "/", so they get the name as plain text. */}
            {canLink ? (
              <Link
                to={`/admin/lenders/${f.lender_id}`}
                className="font-semibold text-gray-900 dark:text-white hover:text-ocean-blue dark:hover:text-blue-300 hover:underline"
              >
                {f.company_name}
              </Link>
            ) : (
              <span className="font-semibold text-gray-900 dark:text-white">{f.company_name}</span>
            )}
            {f.consolidation_type && (
              <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 uppercase tracking-wide">
                {consoBadgeLabel(f.consolidation_type)}
              </span>
            )}
            {f.relationship && (
              <span className="text-[11px] uppercase tracking-wide text-gray-400">{humanize(f.relationship)}</span>
            )}
          </div>
          {reasons.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {reasons.map((r, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-md ${
                    isCaveat(r)
                      ? "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                  }`}
                >
                  {r}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RecommendedFundersSection({
  funders, note,
}: {
  funders: UWRecommendedFunder[];
  note: string | null;
}) {
  const { isAdmin, isSuperAdmin } = useUserProfile();
  // Same reasoning as canRun above: a processor packaging the file is exactly
  // who acts on "send this deal to".
  const { isProcessor } = useIsProcessor();
  const canLink = isAdmin || isSuperAdmin || isProcessor;
  // Nothing to show and nothing to explain — stay silent rather than render an
  // empty shell (older/partial runs).
  if (funders.length === 0 && !note) return null;
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-semibold text-gray-900 dark:text-white">Send this deal to</h4>
        <span className="text-xs text-gray-400">
          {funders.length > 0
            ? `${funders.length} live funder${funders.length === 1 ? "" : "s"}, ranked`
            : "no match"}
        </span>
      </div>
      {funders.length > 0 && (
        <div className="space-y-3">
          {funders.map((f, i) => (
            <FunderRow key={f.lender_id} f={f} rank={i + 1} canLink={canLink} />
          ))}
        </div>
      )}
      {note && (
        <p className={`text-sm text-gray-500 dark:text-gray-400 ${funders.length > 0 ? "mt-3" : ""}`}>{note}</p>
      )}
      {funders.length > 0 && (
        <p className="mt-3 text-xs text-gray-400">
          Matched in code against each funder's recorded box — the same data behind the{" "}
          <Link to="/admin/cheat-sheet" className="text-ocean-blue hover:underline">funder cheat sheet</Link>.
          Confirm the box with the rep before submitting.
        </p>
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

// ── Positions — active MCA (latest month), paid-off history, other obligations ─
// The corrected stacking picture: only advances still debiting in the NEWEST
// statement month are "open positions"; advances gone from the latest month are
// paid off (a positive signal); non-MCA fixed debts are cash-flow context, not
// stacking. Replaces the old cross-month union that inflated the position count.
const OBLIGATION_LABEL: Record<string, string> = {
  sba_loan: "SBA / term loan",
  equipment_lease: "Equipment lease",
  consumer_finance: "Consumer finance",
  vendor_other: "Vendor / other",
};
function PositionsSection({
  active, ended, other, otherMonthly, dailyMca, latestMonth,
}: {
  active: UWPosition[];
  ended: UWEndedPosition[];
  other: UWOtherObligation[];
  otherMonthly?: number;
  dailyMca?: number;
  latestMonth?: string | null;
}) {
  const cadence = (c: string) => (c === "unknown" ? "" : ` ${c}`);
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 overflow-x-auto">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-semibold text-gray-900 dark:text-white">Positions</h4>
        <span className="text-xs text-gray-400">
          open MCAs in the latest month{latestMonth ? ` (${latestMonth})` : ""}
        </span>
      </div>

      {/* Active MCA positions */}
      {active.length > 0 ? (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Active MCA positions ({active.length})
            </span>
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {money(dailyMca)}/day
            </span>
          </div>
          <div className="space-y-1.5">
            {active.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-gray-700 dark:text-gray-300">{p.funder}</span>
                <span className="text-gray-500 dark:text-gray-400">
                  <span className="font-medium text-gray-900 dark:text-white">{money(p.amount)}</span>
                  {cadence(p.cadence)}
                  <span className="text-xs text-gray-400"> · {money(p.daily_amount)}/day</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">No open MCA positions in the latest month.</p>
      )}

      {/* Paid-off / ended history */}
      {ended.length > 0 && (
        <div className="mb-4 border-t border-gray-100 dark:border-gray-700 pt-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400 mb-2">
            Paid off / ended ({ended.length}) · positive paydown signal
          </div>
          <div className="flex flex-wrap gap-2">
            {ended.map((p, i) => (
              <span key={i} className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                {p.funder}{p.last_seen_month ? ` — last seen ${p.last_seen_month}` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Non-MCA fixed obligations */}
      {other.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Other fixed obligations (not MCA stacking)
            </span>
            {otherMonthly != null && otherMonthly > 0 && (
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{money(otherMonthly)}/mo</span>
            )}
          </div>
          <div className="space-y-1.5">
            {other.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-gray-700 dark:text-gray-300">
                  {p.funder}
                  <span className="ml-1.5 text-[10px] uppercase tracking-wide text-gray-400">
                    {OBLIGATION_LABEL[p.class] ?? p.class}
                  </span>
                </span>
                <span className="text-gray-500 dark:text-gray-400">
                  <span className="font-medium text-gray-900 dark:text-white">{money(p.amount)}</span>
                  {cadence(p.cadence)}
                  <span className="text-xs text-gray-400"> · {money(p.monthly)}/mo</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Position timeline — every recurring debitor across all months ────────────
// Renewals/step-ups surface as an amber note under the funder name (change_event);
// one-off anomalies deliberately excluded from the position count are called out
// below the table so a closer never wonders "why isn't that debit a position?"
const TIMELINE_CLASS_LABEL: Record<string, string> = {
  mca: "MCA",
  sba_loan: "SBA / term loan",
  equipment_lease: "Equipment lease",
  consumer_finance: "Consumer finance",
  vendor_other: "Vendor / other",
};
function TimelineSection({ rows, anomalies }: { rows: UWTimelineRow[]; anomalies?: UWPositionAnomaly[] }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 overflow-x-auto">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-semibold text-gray-900 dark:text-white">Position timeline</h4>
        <span className="text-xs text-gray-400">every recurring debitor across all months</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500">
            <th className="text-left py-2 pr-4 font-medium">Funder</th>
            <th className="text-left py-2 px-4 font-medium">Class</th>
            <th className="text-left py-2 px-4 font-medium">Cadence</th>
            <th className="text-right py-2 px-4 font-medium">Amount</th>
            <th className="text-left py-2 px-4 font-medium">First seen</th>
            <th className="text-left py-2 px-4 font-medium">Last seen</th>
            <th className="text-left py-2 pl-4 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-gray-100 dark:border-gray-700 last:border-0 align-top">
              <td className="py-2 pr-4">
                <div className="font-medium text-gray-900 dark:text-white whitespace-nowrap">{row.funder}</div>
                {row.change_event && (
                  <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 max-w-[220px] leading-snug">
                    {row.change_event}
                  </div>
                )}
              </td>
              <td className="py-2 px-4 text-[10px] font-semibold uppercase tracking-wide text-gray-400 whitespace-nowrap">
                {TIMELINE_CLASS_LABEL[row.class] ?? row.class.replace(/_/g, " ")}
              </td>
              <td className="py-2 px-4 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                {row.cadence === "unknown" ? "—" : row.cadence}
              </td>
              <td className="py-2 px-4 text-right font-medium text-gray-900 dark:text-white whitespace-nowrap">
                {money(row.amount)}
              </td>
              <td className="py-2 px-4 text-gray-600 dark:text-gray-400 whitespace-nowrap">{row.first_seen_month}</td>
              <td className="py-2 px-4 text-gray-600 dark:text-gray-400 whitespace-nowrap">{row.last_seen_month}</td>
              <td className="py-2 pl-4 whitespace-nowrap">
                <span
                  className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full ${
                    row.status === "active"
                      ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {row.status === "active" ? "ACTIVE" : "PAID OFF"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {anomalies && anomalies.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700 space-y-1.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-1.5">
            Excluded one-off / step-up debits ({anomalies.length}) — not counted as positions
          </div>
          {anomalies.map((a, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-400">
              <ExclamationTriangleIcon className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
              <span>
                <span className="font-medium text-gray-900 dark:text-white">{a.funder}</span>
                {" "}· {money(a.amount)} — {a.note}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Estimated remaining balance + refi/consolidation feasibility ─────────────
// Ranged remaining-balance estimates per active position (60/80/100 biz-day
// assumed terms), rolled into a total, plus whether consolidating that total
// into one payment pencils out against normal-season and worst-month revenue.
const REFI_VERDICT_BADGE: Record<UWRefiTerm["verdict"], string> = {
  viable: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
  tight: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  not_viable: "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300",
};
function RemainingRefiSection({
  positions, refi, outstandingLow, outstandingMid, outstandingHigh,
}: {
  positions?: UWRemainingPosition[];
  refi?: UWRefi;
  outstandingLow?: number;
  outstandingMid?: number;
  outstandingHigh?: number;
}) {
  const hasPositions = !!positions && positions.length > 0;
  const hasTotal = outstandingLow != null && outstandingHigh != null;
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-semibold text-gray-900 dark:text-white">Estimated remaining balance & refi feasibility</h4>
        <span className="text-xs text-gray-400">estimates — payoff letters required</span>
      </div>

      {hasPositions && (
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500">
                <th className="text-left py-2 pr-4 font-medium">Funder</th>
                <th className="text-right py-2 px-4 font-medium">Daily</th>
                <th className="text-right py-2 px-4 font-medium">Paid to date</th>
                <th className="text-right py-2 pl-4 font-medium">Est. remaining</th>
              </tr>
            </thead>
            <tbody>
              {positions!.map((p, i) => (
                <tr key={i} className="border-b border-gray-100 dark:border-gray-700 last:border-0">
                  <td className="py-2 pr-4 font-medium text-gray-900 dark:text-white whitespace-nowrap">{p.funder}</td>
                  <td className="py-2 px-4 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">{money(p.daily_amount)}/day</td>
                  <td className="py-2 px-4 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">{money(p.payments_to_date)}</td>
                  <td className="py-2 pl-4 text-right whitespace-nowrap">
                    {money(p.remaining_low)}–{money(p.remaining_high)}{" "}
                    <span className="font-semibold text-gray-900 dark:text-white">({money(p.remaining_mid)} mid)</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasTotal && (
        <div className="text-sm text-gray-700 dark:text-gray-300 mb-4">
          Est. total outstanding{" "}
          <span className="font-semibold text-gray-900 dark:text-white">{money(outstandingLow)}–{money(outstandingHigh)}</span>
          {" "}(mid <span className="font-semibold text-gray-900 dark:text-white">{money(outstandingMid)}</span>)
        </div>
      )}

      {refi && (
        <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
          <p className="text-sm font-medium text-gray-900 dark:text-white mb-3">{refi.verdict}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500">
                  <th className="text-left py-2 pr-4 font-medium">Term</th>
                  <th className="text-right py-2 px-4 font-medium">Monthly payment</th>
                  <th className="text-right py-2 px-4 font-medium">% normal revenue</th>
                  <th className="text-right py-2 px-4 font-medium">% worst month</th>
                  <th className="text-left py-2 pl-4 font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {refi.terms.map((t, i) => (
                  <tr key={i} className="border-b border-gray-100 dark:border-gray-700 last:border-0">
                    <td className="py-2 pr-4 font-medium text-gray-900 dark:text-white whitespace-nowrap">{t.months} mo</td>
                    <td className="py-2 px-4 text-right text-gray-900 dark:text-white whitespace-nowrap">{money(t.monthly_payment)}</td>
                    <td className="py-2 px-4 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">{pct(t.pct_of_normal_revenue)}</td>
                    <td className="py-2 px-4 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">{pct(t.pct_of_worst_month)}</td>
                    <td className="py-2 pl-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full uppercase ${REFI_VERDICT_BADGE[t.verdict]}`}>
                        {t.verdict.replace(/_/g, " ")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {refi.caveat && <p className="mt-3 text-xs text-gray-400 italic">{refi.caveat}</p>}
        </div>
      )}
    </div>
  );
}

// ── Stacking velocity — positions added vs retired, month over month ─────────
function StackingVelocitySection({ rows, narrative }: { rows: UWVelocityRow[]; narrative?: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
      <h4 className="font-semibold text-gray-900 dark:text-white mb-4">Stacking velocity</h4>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" stroke="#30363D" opacity={0.3} />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#8B949E" />
          <YAxis tick={{ fontSize: 11 }} stroke="#8B949E" allowDecimals={false} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "#F0F6FC", fontWeight: 600 }}
            itemStyle={{ color: "#F0F6FC" }}
            formatter={(value, name) => [Number(value) || 0, name === "added" ? "Added" : "Ended"]}
          />
          <Bar dataKey="added" name="added" fill="#F59E0B" radius={[4, 4, 0, 0]} />
          <Bar dataKey="ended" name="ended" fill="#2DD4BF" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      {narrative && (
        <p className="mt-3 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{narrative}</p>
      )}
    </div>
  );
}

// ── Holdback ratio — MCA remittances vs deposits, month over month ───────────
// >=100% means the merchant is remitting more to advances than it's depositing
// that month — a hard distress signal, flagged with a 100% reference line.
function HoldbackRatioChart({ rows }: { rows: UWPerMonth[] }) {
  const data = rows
    .filter((r) => r.holdback_pct != null)
    .map((r) => ({ month: r.month ?? "—", holdback_pct: r.holdback_pct as number }));
  if (data.length === 0) return null;
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
      <h4 className="font-semibold text-gray-900 dark:text-white mb-1">Holdback ratio — MCA remittances vs deposits</h4>
      <p className="text-xs text-gray-400 mb-4">
        Share of each month's deposits going out to MCA remittances —{" "}
        <span className="font-medium text-gray-500 dark:text-gray-400">100%+ means remitting more than it takes in</span>
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#30363D" opacity={0.3} />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#8B949E" />
          <YAxis tick={{ fontSize: 11 }} stroke="#8B949E" tickFormatter={(v: number) => `${v}%`} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "#F0F6FC", fontWeight: 600 }}
            itemStyle={{ color: "#F0F6FC" }}
            formatter={(value) => [`${Math.round(Number(value) || 0)}%`, "Holdback"]}
          />
          <ReferenceLine y={100} stroke="#EF4444" strokeDasharray="4 4" />
          <Bar dataKey="holdback_pct" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.holdback_pct >= 100 ? "#EF4444" : d.holdback_pct >= 70 ? "#F59E0B" : "#2DD4BF"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
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
  // Optional (additive) fields are typed `number | undefined`, not `| null` —
  // a separate summer keeps `undefined` for older runs that lack them entirely.
  const osum = (a: number | undefined, b: number | undefined): number | undefined =>
    a == null && b == null ? undefined : (a ?? 0) + (b ?? 0);
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
    cur.nsf_count = osum(cur.nsf_count, r.nsf_count);
    cur.overdraft_fees = osum(cur.overdraft_fees, r.overdraft_fees);
    cur.revenue_card = osum(cur.revenue_card, r.revenue_card);
    cur.revenue_cash_check = osum(cur.revenue_cash_check, r.revenue_cash_check);
    cur.revenue_transfer_other = osum(cur.revenue_transfer_other, r.revenue_transfer_other);
  });
  return [...by.values()].sort((a, b) => {
    const ta = Date.parse(`1 ${a.month}`);
    const tb = Date.parse(`1 ${b.month}`);
    return Number.isNaN(ta) || Number.isNaN(tb) ? 0 : ta - tb;
  });
}

function PerMonthTable({ rows: rawRows, overdraftFeesTotal }: { rows: UWPerMonth[]; overdraftFeesTotal?: number }) {
  const rows = mergeMonths(rawRows);
  // Revenue-quality columns are additive — only show them if at least one month
  // actually carries the breakdown (older runs won't).
  const hasRevenueQuality = rows.some(
    (r) => r.revenue_card != null || r.revenue_cash_check != null || r.revenue_transfer_other != null,
  );
  const hasCashStress = rows.some((r) => r.nsf_count != null || r.overdraft_fees != null);
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 overflow-x-auto">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-semibold text-gray-900 dark:text-white">Per-month metrics</h4>
        {overdraftFeesTotal != null && overdraftFeesTotal > 0 && (
          <span className="text-sm font-semibold text-red-600 dark:text-red-400">
            {money(overdraftFeesTotal)} total overdraft fees
          </span>
        )}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500">
            <th className="text-left py-2 pr-4 font-medium">Month</th>
            <th className="text-right py-2 px-4 font-medium"># Deposits</th>
            <th className="text-right py-2 px-4 font-medium">True deposits</th>
            <th className="text-right py-2 px-4 font-medium">Ending balance</th>
            <th className="text-right py-2 px-4 font-medium">Avg daily balance</th>
            <th className={`text-right py-2 px-4 font-medium ${hasCashStress || hasRevenueQuality ? "" : "pl-4"}`}>Negative days</th>
            {hasCashStress && (
              <>
                <th className="text-right py-2 px-4 font-medium">NSF</th>
                <th className="text-right py-2 px-4 font-medium">OD fees</th>
              </>
            )}
            {hasRevenueQuality && (
              <>
                <th className="text-right py-2 px-4 font-medium">Card revenue</th>
                <th className="text-right py-2 px-4 font-medium">Cash/check</th>
                <th className="text-right py-2 pl-4 font-medium">Transfer/other</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-100 dark:border-gray-700">
              <td className="py-2 pr-4 font-medium text-gray-900 dark:text-white whitespace-nowrap">
                <span className="mr-1" title={r.source === "plaid" ? "Bank feed (Plaid, verified)" : "Uploaded statement"}>
                  {r.source === "plaid" ? "🏦" : "📄"}
                </span>
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
              <td className={`py-2 px-4 text-right ${r.negative_days > 0 ? "text-red-600" : "text-gray-900 dark:text-white"}`}>
                {num(r.negative_days)}
              </td>
              {hasCashStress && (
                <>
                  <td className={`py-2 px-4 text-right ${(r.nsf_count ?? 0) > 0 ? "text-red-600" : "text-gray-900 dark:text-white"}`}>
                    {num(r.nsf_count)}
                  </td>
                  <td className={`py-2 px-4 text-right ${(r.overdraft_fees ?? 0) > 0 ? "text-red-600" : "text-gray-900 dark:text-white"}`}>
                    {money(r.overdraft_fees)}
                  </td>
                </>
              )}
              {hasRevenueQuality && (
                <>
                  <td className="py-2 px-4 text-right font-semibold text-gray-900 dark:text-white">{money(r.revenue_card)}</td>
                  <td className="py-2 px-4 text-right text-gray-500 dark:text-gray-400">{money(r.revenue_cash_check)}</td>
                  <td className="py-2 pl-4 text-right text-gray-500 dark:text-gray-400">{money(r.revenue_transfer_other)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Bank-feed cross-check — doctored-statement defense ───────────────────────
// When an uploaded PDF and the connected bank feed both cover a month, we compare
// deposits. A fraud mismatch (statement claims materially MORE than the unfalsifiable
// feed) is rendered as a loud red banner; benign variances get a quiet line.
function CrossCheckBanner({ provenance }: { provenance: UWProvenance }) {
  const checks = provenance.cross_checks ?? [];
  if (checks.length === 0) return null;
  const frauds = checks.filter((c) => c.fraud);
  const variances = checks.filter((c) => !c.fraud);
  return (
    <div className="space-y-2">
      {frauds.length > 0 && (
        <div className="rounded-xl border-2 border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/25 p-4">
          <div className="flex items-center gap-2 mb-2">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
            <h4 className="font-bold text-red-800 dark:text-red-200">
              Possible doctored statement — bank feed doesn't match
            </h4>
          </div>
          <p className="text-sm text-red-700 dark:text-red-300 mb-2">
            The connected bank feed (Plaid) can't be altered by the merchant. Where an uploaded
            statement claims more deposits than the feed shows, verify before submitting to any funder.
          </p>
          <div className="space-y-1.5">
            {frauds.map((c, i) => (
              <div key={i} className="flex items-center justify-between text-sm bg-white/60 dark:bg-black/20 rounded-lg px-3 py-1.5">
                <span className="font-semibold text-red-800 dark:text-red-200">{c.month}</span>
                <span className="text-red-700 dark:text-red-300">
                  statement <span className="font-semibold">{money(c.pdf_deposits)}</span> vs feed{" "}
                  <span className="font-semibold">{money(c.plaid_deposits)}</span>{" "}
                  <span className="font-bold">(+{Math.round(c.pct_diff)}%)</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {variances.length > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Bank-feed reconciliation variance (likely pending/timing):{" "}
          {variances.map((c) => `${c.month} ${money(c.pdf_deposits)} vs ${money(c.plaid_deposits)} (${c.pct_diff > 0 ? "+" : ""}${Math.round(c.pct_diff)}%)`).join("; ")}.
        </div>
      )}
    </div>
  );
}

// ── Per-document coverage ledger ─────────────────────────────────────────────
// One row per SOURCE file → analyzed (with the month extracted), a deduplicated
// duplicate, or an error. Errors are shown loudly (their month is NOT in coverage);
// this is the anti-SILENT-ZERO guarantee made visible to the closer.
const LEDGER_BADGE: Record<UWDocumentLedgerRow["status"], string> = {
  analyzed: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
  duplicate: "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300",
  error: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
  cross_check: "bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300",
};
const LEDGER_STATUS_LABEL: Record<UWDocumentLedgerRow["status"], string> = {
  analyzed: "analyzed", duplicate: "duplicate", error: "error", cross_check: "cross-check",
};
// 🏦 bank feed (Plaid, unfalsifiable) vs 📄 uploaded statement PDF.
const sourceBadge = (s?: "statement_pdf" | "plaid") => (s === "plaid" ? "🏦" : "📄");
function DocumentLedger({ rows }: { rows: UWDocumentLedgerRow[] }) {
  const analyzed = rows.filter((r) => r.status === "analyzed").length;
  const dup = rows.filter((r) => r.status === "duplicate").length;
  const errored = rows.filter((r) => r.status === "error").length;
  const feed = rows.filter((r) => r.status === "cross_check").length;
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 overflow-x-auto">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-semibold text-gray-900 dark:text-white">Statement coverage</h4>
        <span className="text-xs text-gray-400">
          {analyzed} analyzed{dup ? ` · ${dup} duplicate` : ""}{errored ? ` · ${errored} error` : ""}{feed ? ` · ${feed} bank-feed cross-check` : ""}
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-500">
            <th className="text-left py-2 pr-4 font-medium">File / source</th>
            <th className="text-left py-2 px-4 font-medium">Status</th>
            <th className="text-left py-2 px-4 font-medium">Month</th>
            <th className="text-left py-2 pl-4 font-medium">Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-100 dark:border-gray-700 last:border-0 align-top">
              <td className="py-2 pr-4 text-gray-900 dark:text-white">
                <span className="flex items-center gap-1.5">
                  <span title={r.source === "plaid" ? "Bank feed (Plaid)" : "Uploaded statement"}>{sourceBadge(r.source)}</span>
                  <span className="block truncate max-w-[200px]" title={r.filename}>{r.filename}</span>
                </span>
              </td>
              <td className="py-2 px-4">
                <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${LEDGER_BADGE[r.status]}`}>
                  {LEDGER_STATUS_LABEL[r.status]}
                </span>
              </td>
              <td className="py-2 px-4 text-gray-700 dark:text-gray-300 whitespace-nowrap">{r.month ?? "—"}</td>
              <td className="py-2 pl-4 text-xs text-gray-500 dark:text-gray-400 max-w-md">{r.detail}</td>
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
