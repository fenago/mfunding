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

// Stage → timestamp column mapping
const STATUS_TIMESTAMP_MAP: Partial<Record<DealStatus, string>> = {
  contacted: "contacted_at",
  qualifying: "qualified_at",
  application_sent: "application_sent_at",
  docs_collected: "docs_collected_at",
  submitted_to_funder: "submitted_at",
  offer_received: "offer_received_at",
  offer_presented: "offer_presented_at",
  funded: "funded_at",
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

  return deal as Deal;
}

export async function submitToFunder(
  dealId: string,
  lenderId: string,
  notes?: string
): Promise<DealSubmission> {
  const { data: submission, error } = await supabase
    .from("deal_submissions")
    .insert({
      deal_id: dealId,
      lender_id: lenderId,
      status: "submitted",
      submitted_at: new Date().toISOString(),
      notes: notes || null,
    })
    .select()
    .single();

  if (error) {
    console.error("Error submitting to funder:", error);
    throw error;
  }

  return submission as DealSubmission;
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
