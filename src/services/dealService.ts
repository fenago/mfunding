import supabase from "../supabase";
import type {
  Deal,
  DealWithCustomer,
  DealSubmission,
  DealSubmissionWithLender,
  DealStatus,
  CreateDealData,
  UpdateDealData,
  DealFilters,
} from "../types/deals";
import { calculateCommission, createCommission } from "./commissionService";
import { syncDealToGHL } from "./ghlService";
import { COMMISSION_DEFAULTS } from "../types/commissions";
import type { CommissionLeadSource, Commission } from "../types/commissions";

// Stage → timestamp column mapping
const STATUS_TIMESTAMP_MAP: Partial<Record<DealStatus, string>> = {
  contacted: "contacted_at",
  qualifying: "qualified_at",
  application_sent: "application_sent_at",
  docs_collected: "docs_collected_at",
  bank_statements: "bank_statements_at",
  submitted_to_funder: "submitted_at",
  offer_received: "offer_received_at",
  offer_presented: "offer_presented_at",
  offer_accepted: "offer_accepted_at",
  funded: "funded_at",
  nurture: "nurture_at",
  declined: "declined_at",
};

export async function getAllDeals(filters?: DealFilters): Promise<DealWithCustomer[]> {
  let query = supabase
    .from("deals")
    .select(`
      *,
      customer:customers!customer_id (
        id, first_name, last_name, business_name, email, phone,
        monthly_revenue, time_in_business, industry
      ),
      closer:profiles!assigned_closer_id (
        id, first_name, last_name
      )
    `)
    .order("created_at", { ascending: false });

  if (filters?.status) {
    query = query.eq("status", filters.status);
  }
  if (filters?.market) {
    query = query.eq("market", filters.market);
  }
  if (filters?.deal_type) {
    query = query.eq("deal_type", filters.deal_type);
  }
  if (filters?.assigned_closer_id) {
    query = query.eq("assigned_closer_id", filters.assigned_closer_id);
  }
  if (filters?.campaign_id) {
    query = query.eq("campaign_id", filters.campaign_id);
  }
  if (filters?.date_from) {
    query = query.gte("created_at", filters.date_from);
  }
  if (filters?.date_to) {
    query = query.lte("created_at", filters.date_to);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching deals:", error);
    throw error;
  }

  let results = (data || []) as unknown as DealWithCustomer[];

  // Client-side search filter (across customer name and business name)
  if (filters?.search) {
    const search = filters.search.toLowerCase();
    results = results.filter((deal) => {
      const customerName = `${deal.customer?.first_name || ""} ${deal.customer?.last_name || ""}`.toLowerCase();
      const businessName = (deal.customer?.business_name || "").toLowerCase();
      const dealNumber = (deal.deal_number || "").toLowerCase();
      return customerName.includes(search) || businessName.includes(search) || dealNumber.includes(search);
    });
  }

  return results;
}

export async function getDealById(id: string): Promise<{
  deal: DealWithCustomer;
  submissions: DealSubmissionWithLender[];
} | null> {
  const { data: deal, error } = await supabase
    .from("deals")
    .select(`
      *,
      customer:customers!customer_id (
        id, first_name, last_name, business_name, email, phone,
        monthly_revenue, time_in_business, industry
      ),
      closer:profiles!assigned_closer_id (
        id, first_name, last_name
      )
    `)
    .eq("id", id)
    .single();

  if (error || !deal) {
    console.error("Error fetching deal:", error);
    return null;
  }

  const { data: submissions, error: subError } = await supabase
    .from("deal_submissions")
    .select(`
      *,
      lender:lenders!lender_id (
        id, company_name, status, paper_types, lender_types
      )
    `)
    .eq("deal_id", id)
    .order("created_at", { ascending: false });

  if (subError) {
    console.error("Error fetching submissions:", subError);
  }

  return {
    deal: deal as unknown as DealWithCustomer,
    submissions: (submissions || []) as unknown as DealSubmissionWithLender[],
  };
}

export async function createDeal(data: CreateDealData): Promise<Deal> {
  const { data: deal, error } = await supabase
    .from("deals")
    .insert(data)
    .select()
    .single();

  if (error) {
    console.error("Error creating deal:", error);
    throw error;
  }

  // Push the new deal into GoHighLevel (contact + opportunity at its stage) so
  // admin-created leads land in GHL and fire Speed-to-Lead — same as the public
  // intake. Best-effort: never block deal creation if GHL is unavailable.
  void syncDealToGHL((deal as Deal).id).catch((e) => console.warn("GHL sync (createDeal) failed:", e));

  return deal as Deal;
}

export async function updateDeal(id: string, data: UpdateDealData): Promise<Deal> {
  const { data: deal, error } = await supabase
    .from("deals")
    .update(data)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating deal:", error);
    throw error;
  }

  return deal as Deal;
}

export async function updateDealStatus(id: string, newStatus: DealStatus): Promise<Deal> {
  const updateData: Record<string, unknown> = { status: newStatus };

  // Set the corresponding timestamp
  const timestampCol = STATUS_TIMESTAMP_MAP[newStatus];
  if (timestampCol) {
    updateData[timestampCol] = new Date().toISOString();
  }

  const { data: deal, error } = await supabase
    .from("deals")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating deal status:", error);
    throw error;
  }

  // Auto-generate the commission when a deal becomes funded (best-effort —
  // never block the status change if commission creation fails).
  if (newStatus === "funded") {
    try {
      await autoCreateCommissionForFundedDeal(deal as Deal);
    } catch (e) {
      console.error("Auto commission creation failed:", e);
    }
  }

  // Auto-push the stage change to GHL when the deal is already linked, so the
  // opportunity stage stays in sync without a manual "Sync to GHL" click.
  // (Only for already-linked deals — we don't create GHL records here.)
  const d = deal as Deal;
  if (d.ghl_opportunity_id || d.ghl_contact_id) {
    try {
      await syncDealToGHL(id);
    } catch (e) {
      console.error("GHL stage sync failed:", e);
    }
  }

  return deal as Deal;
}

/**
 * Create the commission for a funded deal, computing splits via the commission
 * engine. No-op if the deal has no funded amount or already has a commission.
 * Note: deals.assigned_closer_id references profiles(id); commissions.closer_id
 * references closers(id) — so we map the assigned profile to its closer record.
 */
export async function autoCreateCommissionForFundedDeal(deal: Deal): Promise<Commission | null> {
  if (!deal.amount_funded || deal.amount_funded <= 0) return null;

  const { data: existing } = await supabase
    .from("commissions")
    .select("id")
    .eq("deal_id", deal.id)
    .limit(1);
  if (existing && existing.length > 0) return null;

  let closerId: string | null = null;
  if (deal.assigned_closer_id) {
    const { data: closer } = await supabase
      .from("closers")
      .select("id")
      .eq("user_id", deal.assigned_closer_id)
      .maybeSingle();
    if (closer) closerId = closer.id;
  }

  const isRenewal = !!deal.is_renewal;
  const commissionPoints = isRenewal
    ? COMMISSION_DEFAULTS.RENEWAL_POINTS
    : COMMISSION_DEFAULTS.NEW_DEAL_POINTS;
  const leadSource: CommissionLeadSource = isRenewal
    ? "renewal"
    : deal.lead_source && /self/i.test(deal.lead_source)
      ? "self_generated"
      : "company";

  const calc = calculateCommission({
    amountFunded: deal.amount_funded,
    commissionPoints,
    closerId,
    leadSource,
    isRenewal,
  });

  return await createCommission({
    deal_id: deal.id,
    deal_submission_id: null,
    gross_commission: calc.grossCommission,
    commission_points: calc.commissionPoints,
    closer_id: closerId,
    closer_split_percentage: calc.closerSplitPercentage,
    closer_amount: calc.closerAmount,
    company_amount: calc.companyAmount,
    sub_iso_id: null,
    override_points: calc.overridePoints,
    override_amount: calc.overrideAmount,
    manager_override_percentage: null,
    manager_override_amount: calc.managerOverrideAmount,
    payment_status: "pending",
    funder_paid_at: null,
    closer_paid_at: null,
    clawback_amount: 0,
    clawback_reason: null,
    notes: "Auto-generated on deal funded",
  } as Omit<Commission, "id" | "created_at" | "updated_at">);
}

export async function submitToFunder(
  dealId: string,
  lenderId: string,
  notes?: string
): Promise<DealSubmission> {
  const rows = await submitToMultipleFunders(dealId, [lenderId], notes);
  const row = rows.find((r) => r.lender_id === lenderId) ?? rows[0];
  if (!row) throw new Error("Submission was not recorded");
  return row as DealSubmission;
}

/** Submit one deal to several funders at once (3–5 in parallel) and advance the
 * deal to "Submitted to Funders". Skips lenders already submitted. */
export async function submitToMultipleFunders(
  dealId: string,
  lenderIds: string[],
  notes?: string,
): Promise<DealSubmission[]> {
  if (lenderIds.length === 0) return [];
  // Gap B: the edge function records each submission, EMAILS each funder's
  // submission_email with the deal package summary, advances the deal to
  // "submitted_to_funder", and logs the send. (Replaces the old insert-only flow.)
  const { data, error } = await supabase.functions.invoke("submit-to-funders", {
    body: { dealId, lenderIds, notes: notes || null },
  });
  if (error) {
    console.error("Error submitting to funders:", error);
    throw error;
  }
  if (data?.warning) console.warn("submit-to-funders:", data.warning);
  // Advance the deal stage (also auto-syncs the GHL opportunity). Best-effort.
  try {
    await updateDealStatus(dealId, "submitted_to_funder");
  } catch (e) {
    console.error("Failed to advance deal to submitted_to_funder:", e);
  }
  // Return the resulting submission rows for the UI.
  const { data: submissionRows } = await supabase
    .from("deal_submissions")
    .select("*")
    .eq("deal_id", dealId)
    .in("lender_id", lenderIds);
  return (submissionRows || []) as DealSubmission[];
}

export async function updateSubmission(
  id: string,
  data: Partial<Pick<
    DealSubmission,
    | "status"
    | "offer_amount"
    | "factor_rate"
    | "term_months"
    | "daily_payment"
    | "weekly_payment"
    | "total_payback"
    | "commission_points"
    | "commission_amount"
    | "decline_reason"
    | "notes"
  >>
): Promise<DealSubmission> {
  const updateData: Record<string, unknown> = { ...data };

  // Auto-set response_at when status changes to an outcome
  if (data.status && ["approved", "declined", "offer_made"].includes(data.status)) {
    updateData.response_at = new Date().toISOString();
  }

  const { data: submission, error } = await supabase
    .from("deal_submissions")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error updating submission:", error);
    throw error;
  }

  return submission as DealSubmission;
}

export async function getDealStats(): Promise<{
  total: number;
  byStatus: Record<string, number>;
  totalPipeline: number;
  totalFunded: number;
}> {
  const { data, error } = await supabase
    .from("deals")
    .select("status, amount_requested, amount_funded");

  if (error) {
    console.error("Error fetching deal stats:", error);
    throw error;
  }

  const deals = data || [];
  const byStatus: Record<string, number> = {};
  let totalPipeline = 0;
  let totalFunded = 0;

  for (const deal of deals) {
    byStatus[deal.status] = (byStatus[deal.status] || 0) + 1;
    if (!["funded", "declined", "dead"].includes(deal.status)) {
      totalPipeline += deal.amount_requested || 0;
    }
    if (deal.status === "funded") {
      totalFunded += deal.amount_funded || 0;
    }
  }

  return {
    total: deals.length,
    byStatus,
    totalPipeline,
    totalFunded,
  };
}
