import supabase from "../supabase";
import { mustWrite } from "@/supabase/writes";

// Bank analysis = the single bank-data source the underwriting workbench reads,
// whether the numbers came from Plaid (auto) or were keyed in manually.

export interface BankAnalysis {
  id: string;
  deal_id: string | null;
  customer_id: string | null;
  source: "manual" | "plaid";
  months_analyzed: number | null;
  average_daily_balance: number | null;
  avg_monthly_deposits: number | null;
  avg_monthly_revenue: number | null;
  deposit_count: number | null;
  nsf_count: number | null;
  negative_days: number | null;
  existing_mca_positions: number | null;
  existing_mca_payments: number | null;
  largest_deposit: number | null;
  notes: string | null;
  entered_by: string | null;
  created_at: string;
  updated_at: string;
}

export type BankAnalysisInput = Partial<
  Omit<BankAnalysis, "id" | "created_at" | "updated_at" | "entered_by">
>;

/** Most recent bank analysis for a deal (or null). */
export async function getBankAnalysisForDeal(dealId: string): Promise<BankAnalysis | null> {
  const { data, error } = await supabase
    .from("bank_analyses")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as BankAnalysis) ?? null;
}

/** Insert a manual bank analysis (the manual equivalent of Plaid extraction). */
export async function createBankAnalysis(input: BankAnalysisInput): Promise<BankAnalysis> {
  const { data: auth } = await supabase.auth.getUser();
  const rows = await mustWrite<BankAnalysis>(
    "create bank analysis",
    supabase
      .from("bank_analyses")
      .insert({ ...input, source: input.source ?? "manual", entered_by: auth.user?.id ?? null }),
  );
  return rows[0];
}

export async function updateBankAnalysis(id: string, patch: BankAnalysisInput): Promise<BankAnalysis> {
  const rows = await mustWrite<BankAnalysis>(
    "update bank analysis",
    supabase.from("bank_analyses").update(patch).eq("id", id),
  );
  return rows[0];
}

/**
 * Simple pre-qual signal from the metrics (tune thresholds later). Mirrors the
 * checks Plaid data would drive so underwriting reads one source.
 */
export function prequalFlags(a: BankAnalysis | BankAnalysisInput): string[] {
  const flags: string[] = [];
  if ((a.nsf_count ?? 0) > 5) flags.push("5+ NSFs");
  if ((a.negative_days ?? 0) > 5) flags.push("5+ negative days");
  if ((a.existing_mca_positions ?? 0) >= 3) flags.push("3+ existing MCA positions (stacked)");
  if ((a.average_daily_balance ?? 0) > 0 && (a.average_daily_balance ?? 0) < 5000) flags.push("ADB under $5k");
  return flags;
}
