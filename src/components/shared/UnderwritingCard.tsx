import { useEffect, useState } from "react";
import {
  ShieldCheckIcon, ExclamationTriangleIcon, SparklesIcon, ArrowPathIcon, ArrowRightIcon,
} from "@heroicons/react/24/outline";
import { getBankAnalysisForDeal } from "../../services/bankAnalysisService";
import {
  scoreDeal, saveAssessment, getAssessmentForDeal, getActiveScorecard,
  type UWResult, type UWInputs, type UnderwritingAssessment,
} from "../../services/underwritingService";
import {
  getLatestUnderwriting, runUnderwriting,
  type DealUnderwriting, type AffordabilityRating, type RiskRating,
} from "../../services/aiUnderwritingService";
import { updateDealStatus } from "../../services/dealService";
import { useUserProfile } from "../../context/UserProfileContext";
import supabase from "../../supabase";
import { mustWrite } from "@/supabase/writes";
import type { DealWithCustomer } from "../../types/deals";

interface Props {
  deal: DealWithCustomer;
  onDecision?: () => void;
  /** Jump to the deal's Underwriting tab (full AI analysis). */
  onSeeFullAnalysis?: () => void;
}

const REC_STYLE: Record<string, string> = {
  approve: "text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/40",
  review: "text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40",
  decline: "text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40",
};

const RATING_BADGE: Record<string, string> = {
  strong: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
  adequate: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
  tight: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  unaffordable: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
  low: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
  medium: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  high: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
};

const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;

// Map the AI verdict onto the same approve/review/decline recommendation the
// decision buttons speak, so the card never says "Submit" over a HIGH-risk read.
function aiRecommendation(ai: DealUnderwriting): "approve" | "review" | "decline" {
  if (ai.affordability_rating === "unaffordable" || ai.risk_rating === "high") return "decline";
  if (ai.affordability_rating === "tight" || ai.risk_rating === "medium") return "review";
  return "approve";
}

function verdictTone(aff: AffordabilityRating | null, risk: RiskRating | null): string {
  if (aff === "unaffordable" || risk === "high")
    return "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20";
  if (aff === "tight")
    return "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20";
  return "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20";
}

export default function UnderwritingCard({ deal, onDecision, onSeeFullAnalysis }: Props) {
  const { isAdmin, isSuperAdmin } = useUserProfile();
  const canRun = isAdmin || isSuperAdmin;

  const [result, setResult] = useState<UWResult | null>(null);
  const [ai, setAi] = useState<DealUnderwriting | null>(null);
  const [bankId, setBankId] = useState<string | null>(null);
  const [hasBank, setHasBank] = useState(false);
  const [saved, setSaved] = useState<UnderwritingAssessment | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    const [bank, prior, scorecard, latestAi] = await Promise.all([
      getBankAnalysisForDeal(deal.id).catch(() => null),
      getAssessmentForDeal(deal.id).catch(() => null),
      getActiveScorecard().catch(() => undefined),
      getLatestUnderwriting(deal.id).catch(() => null),
    ]);
    setHasBank(!!bank);
    setBankId(bank?.id ?? null);
    const c = deal.customer;
    const inputs: UWInputs = {
      avg_monthly_revenue: bank?.avg_monthly_revenue ?? c?.monthly_revenue ?? null,
      average_daily_balance: bank?.average_daily_balance ?? null,
      nsf_count: bank?.nsf_count ?? null,
      negative_days: bank?.negative_days ?? null,
      existing_mca_positions: bank?.existing_mca_positions ?? null,
      time_in_business: c?.time_in_business ?? null,
      credit_score_range: (c as { credit_score_range?: string } | undefined)?.credit_score_range ?? null,
    };
    setResult(scoreDeal(inputs, scorecard));
    setSaved(prior);
    setAi(latestAi);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadAll();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.id]);

  async function runAiUnderwriting() {
    setRunning(true);
    setRunError(null);
    try {
      await runUnderwriting(deal.id, "manual");
      await loadAll();
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Underwriting failed. Check that bank statements are uploaded.");
    } finally {
      setRunning(false);
    }
  }

  async function decide(decision: "approved" | "declined" | "review") {
    if (!result) return;
    setBusy(true);
    try {
      const a = await saveAssessment({ dealId: deal.id, bankAnalysisId: bankId, result, decision });
      setSaved(a);
      if (decision === "declined") {
        await updateDealStatus(deal.id, "declined"); // also syncs GHL -> Lost
        await mustWrite("set deal lost reason", supabase.from("deals").update({ lost_reason: "bank_data_fail" }).eq("id", deal.id));
      }
      onDecision?.();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;

  // The AI underwriter is the source of truth when it has a read; the naive
  // stated-figures score is a fallback estimate only.
  const rec = ai ? aiRecommendation(ai) : (result?.recommendation ?? "review");
  const m = ai?.metrics ?? {};
  const topFlags = (ai?.flags ?? []).slice(0, 2);

  const runBtn = canRun && (
    <button
      onClick={runAiUnderwriting}
      disabled={running}
      className="px-3 py-1.5 text-xs font-medium text-ocean-blue border border-ocean-blue rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 inline-flex items-center gap-1.5 disabled:opacity-60"
    >
      {running ? (
        <>
          <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
          Claude is reading the statements… ~1 min
        </>
      ) : (
        <>
          {ai ? <ArrowPathIcon className="w-3.5 h-3.5" /> : <SparklesIcon className="w-3.5 h-3.5" />}
          {ai ? "Re-run underwriting" : "Run underwriting"}
        </>
      )}
    </button>
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <ShieldCheckIcon className="w-5 h-5 text-ocean-blue" /> Underwriting
        </h3>
        {saved && (
          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">
            decision: {saved.decision}
          </span>
        )}
      </div>

      {ai ? (
        /* ── AI underwriter present: it is the headline ─────────────────────── */
        <>
          <div className={`rounded-lg border p-4 mb-4 ${verdictTone(ai.affordability_rating, ai.risk_rating)}`}>
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                AI verdict
              </span>
              {ai.risk_rating && (
                <span className={`px-2.5 py-1 text-xs font-semibold rounded-full capitalize ${RATING_BADGE[ai.risk_rating]}`}>
                  {ai.risk_rating} risk
                </span>
              )}
              {ai.affordability_rating && (
                <span className={`px-2.5 py-1 text-xs font-semibold rounded-full capitalize ${RATING_BADGE[ai.affordability_rating]}`}>
                  {ai.affordability_rating}
                </span>
              )}
            </div>
            <div className="text-sm text-gray-700 dark:text-gray-200">
              <span className="font-semibold">Max affordable advance {money(m.max_affordable_advance)}</span>
              <span className="text-gray-500 dark:text-gray-400"> vs {money(m.amount_requested)} requested</span>
            </div>
          </div>

          <div className={`px-3 py-1.5 rounded-lg text-sm font-semibold inline-block mb-3 ${REC_STYLE[rec]}`}>
            {rec === "approve" ? "Recommend: Submit" : rec === "review" ? "Manual Review" : "Recommend: Decline"}
          </div>

          {topFlags.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {topFlags.map((f, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <ExclamationTriangleIcon
                    className={`w-4 h-4 shrink-0 mt-0.5 ${f.severity === "critical" ? "text-red-600" : "text-amber-600"}`}
                  />
                  <span className="text-gray-600 dark:text-gray-300">{f.message}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 mb-4">
            {onSeeFullAnalysis ? (
              <button
                onClick={onSeeFullAnalysis}
                className="text-xs text-ocean-blue hover:underline inline-flex items-center gap-1"
              >
                See full analysis in the Underwriting tab <ArrowRightIcon className="w-3 h-3" />
              </button>
            ) : (
              <span className="text-xs text-gray-400">See full analysis in the Underwriting tab.</span>
            )}
            {runBtn}
          </div>
        </>
      ) : (
        /* ── No AI read yet: stated-figures estimate, clearly labeled ────────── */
        <>
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/40 mb-3">
            <SparklesIcon className="w-4 h-4 text-ocean-blue shrink-0 mt-0.5" />
            <div className="text-xs text-gray-600 dark:text-gray-300">
              <span className="font-semibold text-gray-900 dark:text-white">Estimate only — based on stated figures.</span>{" "}
              Run AI underwriting for the real read on the bank statements.
            </div>
          </div>

          {!hasBank && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
              No bank analysis entered yet — this estimate uses only stated figures.
            </p>
          )}

          <div className="flex items-center gap-4 mb-4">
            <div className="text-center">
              <div
                className={`text-4xl font-bold ${
                  (result?.score ?? 0) >= 70 ? "text-emerald-600" : (result?.score ?? 0) >= 45 ? "text-amber-600" : "text-red-600"
                }`}
              >
                {result?.score ?? "—"}
              </div>
              <div className="text-xs text-gray-400">fit score — higher is safer</div>
            </div>
            <div className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${REC_STYLE[rec]}`}>
              {rec === "approve" ? "Estimate: Submit" : rec === "review" ? "Manual Review" : "Estimate: Decline"}
            </div>
          </div>

          {result && result.flags.length > 0 && (
            <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 mb-3">
              <ExclamationTriangleIcon className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span className="text-amber-700 dark:text-amber-300 text-xs">{result.flags.join(" · ")}</span>
            </div>
          )}

          {result && result.breakdown.length > 0 && (
            <details className="text-xs mb-3">
              <summary className="cursor-pointer text-ocean-blue">Estimate breakdown</summary>
              <div className="mt-2 space-y-1">
                {result.breakdown.map((b, i) => (
                  <div key={i} className="flex justify-between text-gray-500 dark:text-gray-400">
                    <span>{b.factor} <span className="text-gray-400">({b.detail})</span></span>
                    <span className="text-red-500">{b.impact}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="mb-4">{runBtn}</div>
        </>
      )}

      {runError && (
        <div className="flex items-start gap-2 p-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 mb-4">
          <ExclamationTriangleIcon className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <span className="text-red-700 dark:text-red-300 text-xs">{runError}</span>
        </div>
      )}

      <div className="flex gap-2 pt-3 border-t border-gray-100 dark:border-gray-700">
        <button onClick={() => decide("approved")} disabled={busy}
          className="px-3 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-60">
          Approve → submit
        </button>
        <button onClick={() => decide("review")} disabled={busy}
          className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60">
          Hold for review
        </button>
        <button onClick={() => decide("declined")} disabled={busy}
          className="px-3 py-2 text-sm font-medium text-red-600 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-60">
          Decline
        </button>
      </div>
    </div>
  );
}
