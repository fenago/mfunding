import { useEffect, useState } from "react";
import { ShieldCheckIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { getBankAnalysisForDeal } from "../../services/bankAnalysisService";
import {
  scoreDeal, saveAssessment, getAssessmentForDeal, getActiveScorecard,
  type UWResult, type UWInputs, type UnderwritingAssessment,
} from "../../services/underwritingService";
import { updateDealStatus } from "../../services/dealService";
import supabase from "../../supabase";
import type { DealWithCustomer } from "../../types/deals";

interface Props {
  deal: DealWithCustomer;
  onDecision?: () => void;
}

const REC_STYLE: Record<string, string> = {
  approve: "text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/40",
  review: "text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40",
  decline: "text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40",
};

export default function UnderwritingCard({ deal, onDecision }: Props) {
  const [result, setResult] = useState<UWResult | null>(null);
  const [bankId, setBankId] = useState<string | null>(null);
  const [hasBank, setHasBank] = useState(false);
  const [saved, setSaved] = useState<UnderwritingAssessment | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [bank, prior, scorecard] = await Promise.all([
        getBankAnalysisForDeal(deal.id).catch(() => null),
        getAssessmentForDeal(deal.id).catch(() => null),
        getActiveScorecard().catch(() => undefined),
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
      setLoading(false);
    })();
  }, [deal.id]);

  async function decide(decision: "approved" | "declined" | "review") {
    if (!result) return;
    setBusy(true);
    try {
      const a = await saveAssessment({ dealId: deal.id, bankAnalysisId: bankId, result, decision });
      setSaved(a);
      if (decision === "declined") {
        await updateDealStatus(deal.id, "declined"); // also syncs GHL -> Lost
        await supabase.from("deals").update({ lost_reason: "bank_data_fail" }).eq("id", deal.id);
      }
      onDecision?.();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;
  const rec = result?.recommendation ?? "review";
  const scoreColor = (result?.score ?? 0) >= 70 ? "text-emerald-600" : (result?.score ?? 0) >= 45 ? "text-amber-600" : "text-red-600";

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

      {!hasBank && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
          No bank analysis yet — score is based only on stated figures. Enter bank metrics (Bank Analysis card) for an accurate read.
        </p>
      )}

      <div className="flex items-center gap-4 mb-4">
        <div className="text-center">
          <div className={`text-4xl font-bold ${scoreColor}`}>{result?.score ?? "—"}</div>
          <div className="text-xs text-gray-400">risk score</div>
        </div>
        <div className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${REC_STYLE[rec]}`}>
          {rec === "approve" ? "Recommend: Submit" : rec === "review" ? "Manual Review" : "Recommend: Decline"}
        </div>
      </div>

      {result && result.flags.length > 0 && (
        <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 mb-3">
          <ExclamationTriangleIcon className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <span className="text-amber-700 dark:text-amber-300 text-xs">{result.flags.join(" · ")}</span>
        </div>
      )}

      {result && result.breakdown.length > 0 && (
        <details className="text-xs mb-4">
          <summary className="cursor-pointer text-ocean-blue">Score breakdown</summary>
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

      <div className="flex gap-2">
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
