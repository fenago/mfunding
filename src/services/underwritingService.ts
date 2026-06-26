import supabase from "../supabase";

// Internal underwriting — score a deal's risk from the bank analysis + customer
// profile, BEFORE submitting to funders. One source in, a recommendation out.

export interface UWInputs {
  avg_monthly_revenue?: number | null;
  average_daily_balance?: number | null;
  nsf_count?: number | null;
  negative_days?: number | null;
  existing_mca_positions?: number | null;
  time_in_business?: number | null; // months
  credit_score_range?: string | null;
}

export interface UWFactor { factor: string; impact: number; detail: string }
export interface UWResult {
  score: number; // 0-100, higher = lower risk
  recommendation: "approve" | "review" | "decline";
  flags: string[];
  breakdown: UWFactor[];
}

function parseCredit(range?: string | null): number | null {
  if (!range) return null;
  const m = range.match(/\d{3}/);
  return m ? parseInt(m[0], 10) : null;
}

/** Weighted scorecard. Start at 100, deduct for risk factors. Tune freely. */
export function scoreDeal(i: UWInputs): UWResult {
  let score = 100;
  const flags: string[] = [];
  const breakdown: UWFactor[] = [];
  const deduct = (factor: string, impact: number, detail: string) => {
    score -= impact;
    breakdown.push({ factor, impact: -impact, detail });
  };

  const nsf = i.nsf_count ?? 0;
  if (nsf > 0) { deduct("NSFs", Math.min(nsf * 5, 25), `${nsf} NSF(s)`); if (nsf >= 3) flags.push(`${nsf} NSFs`); }

  const neg = i.negative_days ?? 0;
  if (neg > 0) { deduct("Negative days", Math.min(neg * 3, 20), `${neg} negative day(s)`); if (neg >= 5) flags.push(`${neg} negative days`); }

  const pos = i.existing_mca_positions ?? 0;
  if (pos > 0) { deduct("Existing MCA positions", Math.min(pos * 10, 30), `${pos} active position(s)`); if (pos >= 3) flags.push(`Stacked: ${pos} positions`); }

  const adb = i.average_daily_balance ?? null;
  if (adb !== null) {
    if (adb < 2500) { deduct("Low ADB", 25, `ADB $${adb.toLocaleString()}`); flags.push("ADB under $2.5k"); }
    else if (adb < 5000) { deduct("Low ADB", 15, `ADB $${adb.toLocaleString()}`); flags.push("ADB under $5k"); }
  }

  const rev = i.avg_monthly_revenue ?? null;
  if (rev !== null && rev < 15000) { deduct("Low revenue", 20, `$${rev.toLocaleString()}/mo`); flags.push("Revenue under $15k/mo"); }

  const tib = i.time_in_business ?? null;
  if (tib !== null && tib < 12) { deduct("Time in business", 10, `${tib} months`); if (tib < 6) flags.push("Under 6 months in business"); }

  const credit = parseCredit(i.credit_score_range);
  if (credit !== null && credit < 550) { deduct("Low credit", 10, i.credit_score_range ?? ""); flags.push("Credit under 550"); }

  score = Math.max(0, Math.round(score));
  const recommendation = score >= 70 ? "approve" : score >= 45 ? "review" : "decline";
  return { score, recommendation, flags, breakdown };
}

export interface UnderwritingAssessment {
  id: string;
  deal_id: string;
  bank_analysis_id: string | null;
  score: number | null;
  recommendation: "approve" | "review" | "decline" | null;
  decision: "pending" | "approved" | "declined" | "review";
  risk_flags: string[];
  breakdown: UWFactor[] | null;
  notes: string | null;
  created_at: string;
}

export async function getAssessmentForDeal(dealId: string): Promise<UnderwritingAssessment | null> {
  const { data, error } = await supabase
    .from("underwriting_assessments")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as UnderwritingAssessment) ?? null;
}

export async function saveAssessment(params: {
  dealId: string;
  bankAnalysisId?: string | null;
  result: UWResult;
  decision: "pending" | "approved" | "declined" | "review";
  notes?: string;
}): Promise<UnderwritingAssessment> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("underwriting_assessments")
    .insert({
      deal_id: params.dealId,
      bank_analysis_id: params.bankAnalysisId ?? null,
      score: params.result.score,
      recommendation: params.result.recommendation,
      decision: params.decision,
      risk_flags: params.result.flags,
      breakdown: params.result.breakdown,
      notes: params.notes ?? null,
      assessed_by: auth.user?.id ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as UnderwritingAssessment;
}
