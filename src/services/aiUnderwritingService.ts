import supabase from "../supabase";

// AI "Internal Underwriter" (Phase 1). Reads a deal's bank-statement PDFs with
// Claude and returns an affordability + risk read. The heavy lifting lives in
// the `underwrite-deal` edge function; this module is a thin typed client over
// the `deal_underwriting` (versioned results) and `underwriting_settings`
// (singleton knobs) tables.

// ── Result shapes (match the exact jsonb keys the edge function writes) ───────

export type RiskRating = "low" | "medium" | "high";
export type AffordabilityRating = "strong" | "adequate" | "tight" | "unaffordable";
export type FlagSeverity = "info" | "warn" | "critical";

export interface UWFlag {
  code: string;
  severity: FlagSeverity;
  message: string;
}

export interface UWMetrics {
  reported_avg_monthly_revenue: number;
  true_avg_monthly_revenue: number;
  revenue_quality_pct: number;
  padding_total: number;
  padding_by_category: Record<string, number>;
  net_retained_by_month: { month: string; net_retained: number }[];
  avg_net_retained: number;
  avg_daily_balance: number;
  min_balance: number;
  negative_days: number;
  nsf_total: number;
  est_open_positions: number;
  existing_daily_debit: number;
  debt_service_pct: number;
  safe_daily_debit_capacity: number;
  max_affordable_advance: number;
  amount_requested: number;
  revenue_trend: "up" | "flat" | "down";
  deposit_concentration_pct: number;
  statements_analyzed: number;
  months_covered: number;
}

export interface UWPerStatement {
  month: string;
  opening_balance: number;
  closing_balance: number;
  total_deposits: number;
  total_withdrawals: number;
  avg_daily_balance: number;
  min_balance: number;
  negative_days: number;
  nsf_count: number;
  deposits: unknown[];
  padding_deposits: unknown[];
  mca_debits: unknown[];
  _filename: string;
}

export interface DealUnderwriting {
  id: string;
  deal_id: string;
  version: number;
  run_mode: string | null;
  docs_hash: string | null;
  per_statement: UWPerStatement[] | null;
  metrics: Partial<UWMetrics> | null;
  flags: UWFlag[] | null;
  risk_rating: RiskRating | null;
  affordability_rating: AffordabilityRating | null;
  ai_narrative: string | null;
  settings_snapshot: Record<string, unknown> | null;
  extraction_model: string | null;
  judge_model: string | null;
  created_at: string;
  created_by: string | null;
}

// ── Settings shape ───────────────────────────────────────────────────────────

export interface UnderwritingSettings {
  id: string;
  padding_categories: Record<string, boolean>;
  revenue_quality_flag_pct: number | null;
  holdback_ceiling_pct: number | null;
  nsf_monthly_cap: number | null;
  negative_days_flag: number | null;
  debt_service_flag_pct: number | null;
  min_avg_daily_balance: number | null;
  extraction_model: string | null;
  judge_model: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

// ── Reads ────────────────────────────────────────────────────────────────────

// All underwriting runs for a deal, newest version first.
export async function getUnderwritingHistory(dealId: string): Promise<DealUnderwriting[]> {
  const { data, error } = await supabase
    .from("deal_underwriting")
    .select("*")
    .eq("deal_id", dealId)
    .order("version", { ascending: false });
  if (error) throw error;
  return (data ?? []) as DealUnderwriting[];
}

// The latest run for a deal (null if never underwritten).
export async function getLatestUnderwriting(dealId: string): Promise<DealUnderwriting | null> {
  const rows = await getUnderwritingHistory(dealId);
  return rows[0] ?? null;
}

// ── Run (edge function) ──────────────────────────────────────────────────────

// Kick off Claude on the deal's statements. mode:"manual" always re-runs.
// Takes ~40-60s. Returns the created result row.
export async function runUnderwriting(
  dealId: string,
  mode: "manual" | "auto" = "manual",
): Promise<DealUnderwriting> {
  const { data, error } = await supabase.functions.invoke("underwrite-deal", {
    body: { dealId, mode },
  });
  if (error) throw error;
  return data as DealUnderwriting;
}

// Fire-and-forget auto-run after an app-side bank_statement upload. Never throws
// and never blocks the UI — the GHL-side auto-run already exists server-side.
export function autoUnderwriteDeal(dealId: string): void {
  supabase.functions
    .invoke("underwrite-deal", { body: { dealId, mode: "auto" } })
    .catch(() => {});
}

// A bank statement is uploaded against a *customer*, but underwriting keys off a
// *deal*. Resolve the customer's most recent deal and auto-run against it. Fully
// fire-and-forget: swallows every error so an upload UI never blocks or throws.
export function autoUnderwriteForCustomer(customerId: string): void {
  supabase
    .from("deals")
    .select("id")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
    .then(({ data }) => {
      if (data?.id) autoUnderwriteDeal(data.id);
    })
    .then(undefined, () => {});
}

// ── Settings ─────────────────────────────────────────────────────────────────

export async function getUnderwritingSettings(): Promise<UnderwritingSettings | null> {
  const { data, error } = await supabase
    .from("underwriting_settings")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as UnderwritingSettings) ?? null;
}

export async function saveUnderwritingSettings(
  id: string,
  patch: Partial<Omit<UnderwritingSettings, "id">>,
): Promise<UnderwritingSettings> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("underwriting_settings")
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: auth.user?.id ?? null })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as UnderwritingSettings;
}
