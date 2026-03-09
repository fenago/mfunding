import supabase from "../supabase";
import type {
  Commission,
  CommissionWithDetails,
  CommissionSummary,
  CommissionFilters,
  PaymentStatus,
  MonthlyCommissionData,
  CommissionLeadSource,
} from "../types/commissions";
import { COMMISSION_DEFAULTS } from "../types/commissions";

interface CalculateCommissionParams {
  amountFunded: number;
  commissionPoints: number;
  closerId?: string | null;
  closerSplitPercentage?: number;
  subISOId?: string | null;
  overridePoints?: number;
  leadSource: CommissionLeadSource;
  isRenewal?: boolean;
  managerOverridePercentage?: number;
}

export interface CommissionCalculation {
  grossCommission: number;
  commissionPoints: number;
  closerSplitPercentage: number;
  closerAmount: number;
  companyAmount: number;
  overridePoints: number;
  overrideAmount: number;
  managerOverrideAmount: number;
}

/**
 * Core commission calculator that handles all split scenarios.
 *
 * Economics from CLAUDE.md:
 * - New deals: 8 points (8% of funded amount) = $4,000 on $50K
 * - Renewals: 6 points = $3,000 on $50K
 * - Company leads: 50% closer split
 * - Self-gen leads: 70% closer split
 * - Renewal specialist: 35% split
 * - Sub-ISO: MFunding keeps 2 points override, Sub-ISO keeps 6
 */
export function calculateCommission(params: CalculateCommissionParams): CommissionCalculation {
  const {
    amountFunded,
    commissionPoints,
    closerId,
    closerSplitPercentage,
    subISOId,
    overridePoints = COMMISSION_DEFAULTS.SUB_ISO_OVERRIDE_POINTS,
    leadSource,
    isRenewal = false,
    managerOverridePercentage = 0,
  } = params;

  const grossCommission = (amountFunded * commissionPoints) / 100;

  // Determine closer split based on lead source
  let effectiveSplit = 0;
  if (closerId) {
    if (closerSplitPercentage !== undefined) {
      effectiveSplit = closerSplitPercentage;
    } else if (isRenewal || leadSource === 'renewal') {
      effectiveSplit = COMMISSION_DEFAULTS.RENEWAL_SPLIT;
    } else if (leadSource === 'self_generated') {
      effectiveSplit = COMMISSION_DEFAULTS.SELF_GEN_SPLIT;
    } else {
      effectiveSplit = COMMISSION_DEFAULTS.COMPANY_LEAD_SPLIT;
    }
  }

  // Sub-ISO deal: MFunding keeps override points, Sub-ISO gets the rest
  let effectiveOverridePoints = 0;
  let overrideAmount = 0;
  if (subISOId) {
    effectiveOverridePoints = overridePoints;
    overrideAmount = (amountFunded * effectiveOverridePoints) / 100;
  }

  // For Sub-ISO deals, the closer (if any) splits from MFunding's override portion only,
  // NOT from the full gross commission. Sub-ISO keeps their 6 points; MFunding's 2-point
  // override is what gets split with any closer or manager.
  const mfundingPortion = subISOId ? overrideAmount : grossCommission;

  const closerAmount = closerId ? (mfundingPortion * effectiveSplit) / 100 : 0;
  const managerOverrideAmount = managerOverridePercentage > 0
    ? (mfundingPortion * managerOverridePercentage) / 100
    : 0;

  // Company keeps: MFunding's portion minus closer payout and manager override
  const companyAmount = mfundingPortion - closerAmount - managerOverrideAmount;

  return {
    grossCommission,
    commissionPoints,
    closerSplitPercentage: effectiveSplit,
    closerAmount,
    companyAmount,
    overridePoints: effectiveOverridePoints,
    overrideAmount,
    managerOverrideAmount,
  };
}

export async function createCommission(data: Omit<Commission, 'id' | 'created_at' | 'updated_at'>) {
  const { data: commission, error } = await supabase
    .from("commissions")
    .insert(data)
    .select()
    .single();

  if (error) throw error;
  return commission as Commission;
}

export async function getAllCommissions(
  filters?: CommissionFilters
): Promise<CommissionWithDetails[]> {
  let query = supabase
    .from("commissions")
    .select(`
      *,
      closer:closers(first_name, last_name),
      sub_iso:sub_isos(company_name),
      deal:deals(deal_number, amount_funded, market, deal_type, customer_id)
    `)
    .order("created_at", { ascending: false });

  if (filters?.paymentStatus) {
    query = query.eq("payment_status", filters.paymentStatus);
  }
  if (filters?.closerId) {
    query = query.eq("closer_id", filters.closerId);
  }
  if (filters?.subISOId) {
    query = query.eq("sub_iso_id", filters.subISOId);
  }
  if (filters?.dateFrom) {
    query = query.gte("created_at", filters.dateFrom);
  }
  if (filters?.dateTo) {
    query = query.lte("created_at", filters.dateTo);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as CommissionWithDetails[];
}

export async function getCommissionsByCloser(closerId: string): Promise<CommissionWithDetails[]> {
  return getAllCommissions({ closerId });
}

export async function getCommissionsBySubISO(subISOId: string): Promise<CommissionWithDetails[]> {
  return getAllCommissions({ subISOId });
}

export async function updatePaymentStatus(
  id: string,
  status: PaymentStatus,
  extra?: { funder_paid_at?: string; closer_paid_at?: string; clawback_amount?: number; clawback_reason?: string }
) {
  const updateData: Record<string, unknown> = { payment_status: status };

  if (status === 'funder_paid') {
    updateData.funder_paid_at = extra?.funder_paid_at || new Date().toISOString();
  }
  if (status === 'closer_paid' || status === 'completed') {
    updateData.closer_paid_at = extra?.closer_paid_at || new Date().toISOString();
  }
  if (status === 'clawback') {
    updateData.clawback_amount = extra?.clawback_amount || 0;
    updateData.clawback_reason = extra?.clawback_reason || '';
  }

  const { data, error } = await supabase
    .from("commissions")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as Commission;
}

export async function getCommissionSummary(dateFrom?: string, dateTo?: string): Promise<CommissionSummary> {
  let query = supabase.from("commissions").select("*");

  if (dateFrom) query = query.gte("created_at", dateFrom);
  if (dateTo) query = query.lte("created_at", dateTo);

  const { data, error } = await query;
  if (error) throw error;

  const commissions = (data || []) as Commission[];

  // This month boundaries
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

  const thisMonthCommissions = commissions.filter(
    (c) => c.created_at >= monthStart && c.created_at <= monthEnd
  );

  return {
    totalPending: commissions
      .filter((c) => c.payment_status === 'pending')
      .reduce((sum, c) => sum + c.gross_commission, 0),
    totalFunderPaid: commissions
      .filter((c) => c.payment_status === 'funder_paid')
      .reduce((sum, c) => sum + c.gross_commission, 0),
    totalCloserPaid: commissions
      .filter((c) => c.payment_status === 'closer_paid')
      .reduce((sum, c) => sum + c.gross_commission, 0),
    totalCompleted: commissions
      .filter((c) => c.payment_status === 'completed')
      .reduce((sum, c) => sum + c.gross_commission, 0),
    totalClawback: commissions
      .filter((c) => c.payment_status === 'clawback')
      .reduce((sum, c) => sum + (c.clawback_amount || 0), 0),
    totalGrossCommission: commissions.reduce((sum, c) => sum + c.gross_commission, 0),
    totalCompanyRevenue: commissions.reduce((sum, c) => sum + (c.company_amount || 0), 0),
    totalCloserPayouts: commissions.reduce((sum, c) => sum + (c.closer_amount || 0), 0),
    totalSubISOPayouts: commissions.reduce((sum, c) => sum + (c.override_amount || 0), 0),
    commissionCount: commissions.length,
    thisMonthGross: thisMonthCommissions.reduce((sum, c) => sum + c.gross_commission, 0),
    thisMonthCompany: thisMonthCommissions.reduce((sum, c) => sum + (c.company_amount || 0), 0),
  };
}

export async function getMonthlyCommissionData(months = 12): Promise<MonthlyCommissionData[]> {
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);

  const { data, error } = await supabase
    .from("commissions")
    .select("gross_commission, company_amount, closer_amount, override_amount, created_at")
    .gte("created_at", startDate.toISOString())
    .order("created_at", { ascending: true });

  if (error) throw error;

  const buckets = new Map<string, MonthlyCommissionData>();

  for (const row of data || []) {
    const date = new Date(row.created_at);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    if (!buckets.has(key)) {
      buckets.set(key, { month: key, gross: 0, company: 0, closerPayouts: 0, subISOPayouts: 0 });
    }

    const bucket = buckets.get(key)!;
    bucket.gross += row.gross_commission || 0;
    bucket.company += row.company_amount || 0;
    bucket.closerPayouts += row.closer_amount || 0;
    bucket.subISOPayouts += row.override_amount || 0;
  }

  return Array.from(buckets.values()).sort((a, b) => a.month.localeCompare(b.month));
}

export async function deleteCommission(id: string) {
  const { error } = await supabase.from("commissions").delete().eq("id", id);
  if (error) throw error;
}
