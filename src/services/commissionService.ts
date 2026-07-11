import supabase from "../supabase";
import { mustWrite, tryWrite } from "@/supabase/writes";
import type {
  Closer,
  Commission,
  CommissionWithDetails,
  CommissionSummary,
  CommissionFilters,
  PaymentStatus,
  MonthlyCommissionData,
  CommissionLeadSource,
} from "../types/commissions";
import { COMMISSION_DEFAULTS, resolveCommissionLeadSource } from "../types/commissions";

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
 * - Company leads: 30% closer split by default — the "Momentum Standard"; overridable
 *   per closer (closers.company_lead_split). Escalators (30 -> 35 at $250K/mo funded,
 *   -> 40 at $500K/mo) are a WRITTEN comp term but are NOT auto-applied by this engine;
 *   the owner raises the rate on the closer record. See IMPORTANT_TODO #17.
 * - Self-gen leads: 65% closer split
 * - Renewal: 30% split
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
  const rows = await mustWrite<Commission>("create commission", supabase.from("commissions").insert(data));
  return rows[0];
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

  const rows = await mustWrite<Commission>(
    "update commission payment status",
    supabase.from("commissions").update(updateData).eq("id", id),
  );

  // Tell the closer their money is on the way when it actually goes out.
  if (status === 'closer_paid') {
    await notifyCloserOfCommission(id, 'paid');
  }
  return rows[0];
}

// ---------------------------------------------------------------------------
// Approval / hold / notify — super-admin only (enforced by RLS on commissions)
// ---------------------------------------------------------------------------

type CommissionNotifyKind = 'approved' | 'paid' | 'on_hold' | 'released';

/**
 * Best-effort in-app notification to the closer behind a commission.
 * Looks up the closer's linked auth user (closers.user_id) and inserts a row
 * into `messages`. If the closer has no linked user, we skip the in-app message
 * and just log — never blocks the status change. Sender is the acting admin.
 */
async function notifyCloserOfCommission(
  commissionId: string,
  kind: CommissionNotifyKind,
  extra?: { reason?: string },
): Promise<void> {
  try {
    const { data: comm, error } = await supabase
      .from("commissions")
      .select(`
        closer_amount,
        deal:deals(deal_number),
        closer:closers(user_id, first_name)
      `)
      .eq("id", commissionId)
      .single();

    if (error || !comm) {
      console.warn(`[notifyCloser] could not load commission ${commissionId}: ${error?.message}`);
      return;
    }

    // PostgREST embeds can come back as an object or a single-element array.
    const one = <T,>(v: unknown): T | null =>
      (Array.isArray(v) ? (v[0] ?? null) : (v ?? null)) as T | null;

    const closer = one<{ user_id: string | null; first_name: string | null }>(comm.closer);
    if (!closer?.user_id) {
      console.warn(`[notifyCloser] commission ${commissionId} closer has no linked user_id — skipping in-app notify`);
      return;
    }

    const deal = one<{ deal_number: string | null }>(comm.deal);
    const dealLabel = deal?.deal_number || "your deal";
    const amount = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(comm.closer_amount || 0);

    let subject: string;
    let body: string;
    switch (kind) {
      case 'approved':
        subject = `Commission approved — Deal ${dealLabel}`;
        body = `Your commission for deal ${dealLabel} has been approved. Your payout is ${amount}. You'll be notified when payment is sent.`;
        break;
      case 'paid':
        subject = `Commission paid — Deal ${dealLabel}`;
        body = `Your commission payout of ${amount} for deal ${dealLabel} has been sent. Thank you!`;
        break;
      case 'on_hold':
        subject = `Commission on hold — Deal ${dealLabel}`;
        body = `Your commission for deal ${dealLabel} (${amount}) has been placed on hold.${extra?.reason ? ` Reason: ${extra.reason}` : ''} We'll follow up.`;
        break;
      case 'released':
        subject = `Commission hold released — Deal ${dealLabel}`;
        body = `The hold on your commission for deal ${dealLabel} (${amount}) has been released. It's back in the payout queue.`;
        break;
    }

    const { data: auth } = await supabase.auth.getUser();
    const fromUserId = auth?.user?.id;
    if (!fromUserId) {
      console.warn(`[notifyCloser] no authenticated user to send from — skipping notify for ${commissionId}`);
      return;
    }

    await tryWrite(
      "notify closer of commission",
      supabase.from("messages").insert({
        from_user_id: fromUserId,
        to_user_id: closer.user_id,
        subject,
        body,
      }),
    );
  } catch (e) {
    console.warn(`[notifyCloser] unexpected error for commission ${commissionId}:`, e);
  }
}

/** Approve a commission for payout, stamp approver + time, and notify the closer. */
export async function approveCommission(id: string) {
  const { data: auth } = await supabase.auth.getUser();
  const rows = await mustWrite<Commission>(
    "approve commission",
    supabase
      .from("commissions")
      .update({
        payment_status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: auth?.user?.id ?? null,
      })
      .eq("id", id),
  );
  await notifyCloserOfCommission(id, 'approved');
  return rows[0];
}

/** Place a commission on hold (unpaid) with a required reason, and notify the closer. */
export async function holdCommission(id: string, reason: string) {
  const rows = await mustWrite<Commission>(
    "hold commission",
    supabase
      .from("commissions")
      .update({ payment_status: 'on_hold', hold_reason: reason })
      .eq("id", id),
  );
  await notifyCloserOfCommission(id, 'on_hold', { reason });
  return rows[0];
}

/** Release a held commission back to 'pending', clearing the hold reason, and notify the closer. */
export async function releaseHold(id: string) {
  const rows = await mustWrite<Commission>(
    "release commission hold",
    supabase
      .from("commissions")
      .update({ payment_status: 'pending', hold_reason: null })
      .eq("id", id),
  );
  await notifyCloserOfCommission(id, 'released');
  return rows[0];
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
  await mustWrite("delete commission", supabase.from("commissions").delete().eq("id", id));
}

// ---------------------------------------------------------------------------
// "My Earnings" — read-only, self-scoped helpers for the signed-in closer.
// RLS does the real enforcement (a closer can only SELECT commissions whose
// closer_id maps to their own closers row); these helpers just shape the data.
// ---------------------------------------------------------------------------

/** Deal statuses that are no longer "on the table" — funded or dead. */
const CLOSED_DEAL_STATUSES = ['funded', 'declined', 'dead', 'renewal_eligible', 'servicing', 'restructure_executed'];

export interface ProjectedCommission {
  dealId: string;
  dealNumber: string | null;
  businessName: string | null;
  status: string;
  dealType: string | null;
  isRenewal: boolean;
  leadSource: string | null;
  /** The amount the merchant asked for — the basis of the projection. */
  amountRequested: number;
  /** 8 for new deals, 6 for renewals. */
  points: number;
  /** amountRequested × points% — the whole pool before the split. */
  projectedGross: number;
  /** The closer's split % that applies to THIS deal (renewal / self-gen / company). */
  splitPercentage: number;
  /** projectedGross × splitPercentage% — what the closer would take home. */
  projectedPayout: number;
  updatedAt: string | null;
}

/**
 * Which of the closer's three split rates applies to a given deal.
 *
 * MUST use resolveCommissionLeadSource — this is the DISPLAY path (My Earnings), and
 * it previously disagreed with the two PAYOUT paths on `referral`, showing a closer
 * 65% on money that was going to pay 30%. Display and payout now derive from the same
 * classifier by construction, so they cannot drift apart again. (IMPORTANT_TODO #2)
 */
export function splitForDeal(
  closer: Pick<Closer, 'company_lead_split' | 'self_gen_split' | 'renewal_split'>,
  opts: { isRenewal?: boolean | null; leadSource?: string | null },
): { splitPercentage: number; splitLabel: string } {
  switch (resolveCommissionLeadSource(opts)) {
    case 'renewal':
      return { splitPercentage: Number(closer.renewal_split) || 0, splitLabel: 'Renewal split' };
    case 'self_generated':
      return { splitPercentage: Number(closer.self_gen_split) || 0, splitLabel: 'Self-gen split' };
    default:
      return { splitPercentage: Number(closer.company_lead_split) || 0, splitLabel: 'Company-lead split' };
  }
}

/**
 * Resolve the signed-in user to their closers row. Returns null when the user
 * has no closer profile (e.g. an admin who never set one up).
 * `userId` lets callers pass the effective (impersonated) user id.
 */
export async function getMyCloserRecord(userId: string): Promise<Closer | null> {
  const { data, error } = await supabase
    .from("closers")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data as Closer | null) ?? null;
}

/** The closer's OWN commission rows (RLS-scoped), newest first. */
export async function getMyCommissions(closerId: string): Promise<CommissionWithDetails[]> {
  const { data, error } = await supabase
    .from("commissions")
    .select(`
      *,
      deal:deals(deal_number, amount_funded, market, deal_type, customer_id)
    `)
    .eq("closer_id", closerId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []) as CommissionWithDetails[];
}

/**
 * "On the table" — the closer's OPEN deals with a projected payout on each.
 * amount_requested × points (8 new / 6 renewal) = projected gross pool,
 * × the closer's applicable split % = their projected cut. PROJECTION ONLY.
 */
export async function getMyProjectedPipeline(
  closer: Closer,
  userId: string,
): Promise<ProjectedCommission[]> {
  // assigned_closer_id historically holds either the closers.id or the auth user id.
  const { data, error } = await supabase
    .from("deals")
    .select("id, deal_number, status, deal_type, is_renewal, lead_source, amount_requested, updated_at, customer:customers(business_name)")
    .or(`assigned_closer_id.eq.${closer.id},assigned_closer_id.eq.${userId}`)
    .not("status", "in", `(${CLOSED_DEAL_STATUSES.join(',')})`)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  const one = <T,>(v: unknown): T | null =>
    (Array.isArray(v) ? (v[0] ?? null) : (v ?? null)) as T | null;

  return (data || []).map((d) => {
    const isRenewal = Boolean(d.is_renewal);
    const points = isRenewal ? COMMISSION_DEFAULTS.RENEWAL_POINTS : COMMISSION_DEFAULTS.NEW_DEAL_POINTS;
    const amountRequested = Number(d.amount_requested) || 0;
    const projectedGross = (amountRequested * points) / 100;
    const { splitPercentage } = splitForDeal(closer, { isRenewal, leadSource: d.lead_source });
    const customer = one<{ business_name: string | null }>(d.customer);

    return {
      dealId: d.id,
      dealNumber: d.deal_number,
      businessName: customer?.business_name ?? null,
      status: d.status,
      dealType: d.deal_type,
      isRenewal,
      leadSource: d.lead_source,
      amountRequested,
      points,
      projectedGross,
      splitPercentage,
      projectedPayout: (projectedGross * splitPercentage) / 100,
      updatedAt: d.updated_at ?? null,
    } satisfies ProjectedCommission;
  });
}
