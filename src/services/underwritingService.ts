import supabase from "../supabase";
import { mustWrite } from "@/supabase/writes";

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

/** Tunable scorecard weights/thresholds. Editable at /admin/platform-config. */
export interface ScorecardConfig {
  nsf_per: number; nsf_max: number; nsf_flag_at: number;
  neg_per: number; neg_max: number; neg_flag_at: number;
  pos_per: number; pos_max: number; pos_flag_at: number;
  adb_low1: number; adb_low1_deduct: number; adb_low2: number; adb_low2_deduct: number;
  rev_min: number; rev_deduct: number;
  tib_min: number; tib_deduct: number; tib_flag_at: number;
  credit_min: number; credit_deduct: number;
  approve_at: number; review_at: number;
}

// Defaults reproduce the original hardcoded scorecard exactly.
export const DEFAULT_SCORECARD: ScorecardConfig = {
  nsf_per: 5, nsf_max: 25, nsf_flag_at: 3,
  neg_per: 3, neg_max: 20, neg_flag_at: 5,
  pos_per: 10, pos_max: 30, pos_flag_at: 3,
  adb_low1: 2500, adb_low1_deduct: 25, adb_low2: 5000, adb_low2_deduct: 15,
  rev_min: 15000, rev_deduct: 20,
  tib_min: 12, tib_deduct: 10, tib_flag_at: 6,
  credit_min: 550, credit_deduct: 10,
  approve_at: 70, review_at: 45,
};

/** Weighted scorecard. Start at 100, deduct for risk factors. */
export function scoreDeal(i: UWInputs, c: ScorecardConfig = DEFAULT_SCORECARD): UWResult {
  let score = 100;
  const flags: string[] = [];
  const breakdown: UWFactor[] = [];
  const deduct = (factor: string, impact: number, detail: string) => {
    score -= impact;
    breakdown.push({ factor, impact: -impact, detail });
  };

  const nsf = i.nsf_count ?? 0;
  if (nsf > 0) { deduct("NSFs", Math.min(nsf * c.nsf_per, c.nsf_max), `${nsf} NSF(s)`); if (nsf >= c.nsf_flag_at) flags.push(`${nsf} NSFs`); }

  const neg = i.negative_days ?? 0;
  if (neg > 0) { deduct("Negative days", Math.min(neg * c.neg_per, c.neg_max), `${neg} negative day(s)`); if (neg >= c.neg_flag_at) flags.push(`${neg} negative days`); }

  const pos = i.existing_mca_positions ?? 0;
  if (pos > 0) { deduct("Existing MCA positions", Math.min(pos * c.pos_per, c.pos_max), `${pos} active position(s)`); if (pos >= c.pos_flag_at) flags.push(`Stacked: ${pos} positions`); }

  const adb = i.average_daily_balance ?? null;
  if (adb !== null) {
    if (adb < c.adb_low1) { deduct("Low ADB", c.adb_low1_deduct, `ADB $${adb.toLocaleString()}`); flags.push(`ADB under $${(c.adb_low1 / 1000).toLocaleString()}k`); }
    else if (adb < c.adb_low2) { deduct("Low ADB", c.adb_low2_deduct, `ADB $${adb.toLocaleString()}`); flags.push(`ADB under $${(c.adb_low2 / 1000).toLocaleString()}k`); }
  }

  const rev = i.avg_monthly_revenue ?? null;
  if (rev !== null && rev < c.rev_min) { deduct("Low revenue", c.rev_deduct, `$${rev.toLocaleString()}/mo`); flags.push(`Revenue under $${(c.rev_min / 1000).toLocaleString()}k/mo`); }

  const tib = i.time_in_business ?? null;
  if (tib !== null && tib < c.tib_min) { deduct("Time in business", c.tib_deduct, `${tib} months`); if (tib < c.tib_flag_at) flags.push(`Under ${c.tib_flag_at} months in business`); }

  const credit = parseCredit(i.credit_score_range);
  if (credit !== null && credit < c.credit_min) { deduct("Low credit", c.credit_deduct, i.credit_score_range ?? ""); flags.push(`Credit under ${c.credit_min}`); }

  score = Math.max(0, Math.round(score));
  const recommendation = score >= c.approve_at ? "approve" : score >= c.review_at ? "review" : "decline";
  return { score, recommendation, flags, breakdown };
}

/** The active scorecard config (falls back to DEFAULT_SCORECARD). */
export async function getActiveScorecard(): Promise<ScorecardConfig> {
  const { data } = await supabase
    .from("underwriting_scorecards")
    .select("config")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { ...DEFAULT_SCORECARD, ...((data?.config as Partial<ScorecardConfig>) ?? {}) };
}

/** Upsert the active scorecard config (single active row). */
export async function saveScorecard(config: ScorecardConfig): Promise<void> {
  const { data: existing } = await supabase
    .from("underwriting_scorecards").select("id").eq("is_active", true).limit(1).maybeSingle();
  if (existing) {
    await mustWrite("update underwriting scorecard", supabase.from("underwriting_scorecards").update({ config }).eq("id", existing.id));
  } else {
    await mustWrite("create underwriting scorecard", supabase.from("underwriting_scorecards").insert({ name: "Default", config, is_active: true }));
  }
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
  const rows = await mustWrite<UnderwritingAssessment>(
    "create underwriting assessment",
    supabase.from("underwriting_assessments").insert({
      deal_id: params.dealId,
      bank_analysis_id: params.bankAnalysisId ?? null,
      score: params.result.score,
      recommendation: params.result.recommendation,
      decision: params.decision,
      risk_flags: params.result.flags,
      breakdown: params.result.breakdown,
      notes: params.notes ?? null,
      assessed_by: auth.user?.id ?? null,
    }),
  );
  return rows[0];
}
