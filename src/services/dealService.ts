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
import { COMMISSION_DEFAULTS, expectedCommissionInPlay } from "../types/commissions";
import { PIPELINES } from "../data/pipelines";
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

/** A queue deal carries just enough submission data to rank funder-reply urgency. */
export interface QueueDeal extends DealWithCustomer {
  submissions?: { response_at: string | null; status: string }[];
}

// Terminal / done statuses the "My Day" queue never surfaces (both pipelines).
const QUEUE_CLOSED_STATUSES = [
  "nurture",
  "declined",
  "dead",
  "funded",
  "renewal_eligible",
  "restructure_executed",
  "servicing",
];

/**
 * Open deals for the "My Day" work queue, each with its funder submissions
 * (response_at + status) so the caller can rank funder-reply urgency. RLS scopes
 * what a closer can see; further Mine/All scoping happens client-side.
 */
export async function getOpenDealsForQueue(): Promise<QueueDeal[]> {
  const { data, error } = await supabase
    .from("deals")
    .select(`
      *,
      customer:customers!customer_id (
        id, first_name, last_name, business_name, email, phone,
        monthly_revenue, time_in_business, industry
      ),
      submissions:deal_submissions ( response_at, status )
    `)
    .not("status", "in", `(${QUEUE_CLOSED_STATUSES.join(",")})`)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching queue deals:", error);
    throw error;
  }
  return (data || []) as unknown as QueueDeal[];
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

  const d = deal as Deal;
  // Gap #6: a deal can be marked Funded BEFORE amount_funded is known. When the
  // amount is filled in later via an edit, make sure the commission gets created.
  // autoCreateCommissionForFundedDeal is idempotent (no-ops if one already exists),
  // so it's safe to call here as well as from updateDealStatus(funded).
  if (d.status === "funded" && d.amount_funded && d.amount_funded > 0) {
    try {
      await autoCreateCommissionForFundedDeal(d);
    } catch (e) {
      console.error("Auto commission creation (updateDeal) failed:", e);
    }
  }

  return d;
}

export async function updateDealStatus(id: string, newStatus: DealStatus): Promise<Deal> {
  // ── Backward-move lock ────────────────────────────────────────────────
  // Moving a deal BACKWARD (or reviving a closed deal into the pipeline)
  // re-fires that stage's GHL automations at the merchant — a trainee doing
  // it by accident emails a real customer. Forward moves and moves INTO a
  // terminal state (declined / dead / nurture) are always allowed; anything
  // else requires a super_admin.
  {
    const { data: cur } = await supabase.from("deals").select("status, deal_type").eq("id", id).single();
    if (cur && cur.status !== newStatus) {
      const order = PIPELINES[cur.deal_type === "vcf" ? "vcf" : "mca"].stages.map((s) => s.key);
      const fromIdx = order.indexOf(cur.status);
      const toIdx = order.indexOf(newStatus);
      const backward = toIdx !== -1 && (fromIdx === -1 || toIdx < fromIdx);
      if (backward) {
        const { data: auth } = await supabase.auth.getUser();
        const { data: prof } = auth?.user
          ? await supabase.from("profiles").select("role").eq("id", auth.user.id).single()
          : { data: null };
        if (prof?.role !== "super_admin") {
          throw new Error(
            "Backward stage moves are locked — they re-send that stage's automated emails to the merchant. Ask a super admin if this deal really needs to move back.",
          );
        }
      }
    }
  }

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

  // Load the closer record so we can apply THIS closer's individual splits
  // (set per-closer in Admin → Closers), falling back to the platform defaults.
  let closerId: string | null = null;
  let closerSplits: { company: number; self: number; renewal: number } | null = null;
  if (deal.assigned_closer_id) {
    const { data: closer } = await supabase
      .from("closers")
      .select("id, company_lead_split, self_gen_split, renewal_split")
      .eq("user_id", deal.assigned_closer_id)
      .maybeSingle();
    if (closer) {
      closerId = closer.id;
      closerSplits = {
        company: Number(closer.company_lead_split),
        self: Number(closer.self_gen_split),
        renewal: Number(closer.renewal_split),
      };
    }
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

  // Resolve the closer's own rate for this lead source (per-closer override).
  const closerSplitPercentage = closerSplits
    ? leadSource === "renewal"
      ? closerSplits.renewal
      : leadSource === "self_generated"
        ? closerSplits.self
        : closerSplits.company
    : undefined;

  const calc = calculateCommission({
    amountFunded: deal.amount_funded,
    commissionPoints,
    closerId,
    closerSplitPercentage,
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

/** One funder's activity across all its deal submissions, for the Lenders-page
 * scoreboard. Only funders with ≥1 real submission are returned. */
export interface FunderScore {
  lenderId: string;
  lenderName: string;
  submissions: number;   // packages actually sent
  replies: number;       // any response came back
  offers: number;        // offers made (funded terms quoted)
  accepted: number;      // offers the merchant accepted
  funderDeclines: number;// funder passed on the file
  acceptanceRate: number | null; // accepted ÷ offers (their offer win-rate), %
  avgFactor: number | null;      // mean factor rate across logged offers
  avgResponseMs: number | null;  // mean (response_at − submitted_at)
  topDeclineReason: string | null; // most common AI-classified decline reason category
}

/**
 * Aggregate every funder's submission history into a per-lender scoreboard.
 * One query over deal_submissions (+ lender name), reduced client-side. Sorted
 * accepted desc, then offers desc. Only counts submissions that actually went
 * out (or came back) — never-sent / failed rows are ignored.
 */
export async function getFunderScoreboard(): Promise<FunderScore[]> {
  const { data, error } = await supabase
    .from("deal_submissions")
    .select("lender_id, status, submitted_at, response_at, offer_amount, factor_rate, response_data, lender:lenders!lender_id ( company_name )");
  if (error) {
    console.error("Error fetching funder scoreboard:", error);
    throw error;
  }

  const OFFER_STATUSES = ["offer_made", "offer_accepted", "offer_declined", "approved"];
  const LIVE_STATUSES = ["submitted", "under_review", "approved", "offer_made", "offer_accepted", "offer_declined", "declined"];

  interface Acc {
    lenderName: string;
    submissions: number;
    replies: number;
    offers: number;
    accepted: number;
    funderDeclines: number;
    factorSum: number;
    factorN: number;
    respSum: number;
    respN: number;
    declineReasons: Map<string, number>; // decline_reason_category → count
  }
  const byLender = new Map<string, Acc>();

  for (const r of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    const lenderId = r.lender_id as string;
    if (!lenderId) continue;
    const status = r.status as string;
    const submittedAt = r.submitted_at as string | null;
    const responseAt = r.response_at as string | null;
    const offerAmount = r.offer_amount as number | null;
    const factorRate = r.factor_rate as number | null;
    // Only count a submission that actually went out (or produced a response).
    const isLive = !!submittedAt || !!responseAt || offerAmount != null || LIVE_STATUSES.includes(status);
    if (!isLive) continue;

    const acc = byLender.get(lenderId) ?? {
      lenderName: ((r.lender as { company_name?: string } | null)?.company_name) ?? "Funder",
      submissions: 0, replies: 0, offers: 0, accepted: 0, funderDeclines: 0,
      factorSum: 0, factorN: 0, respSum: 0, respN: 0, declineReasons: new Map<string, number>(),
    };
    acc.submissions += 1;
    if (responseAt) acc.replies += 1;
    if (offerAmount != null || OFFER_STATUSES.includes(status)) acc.offers += 1;
    if (status === "offer_accepted") acc.accepted += 1;
    if (status === "declined") acc.funderDeclines += 1;
    // Tally the AI-classified decline reason (from response_data.parsed) so we can
    // surface each funder's most common reason for passing.
    const parsed = (r.response_data as { parsed?: { decline_reason_category?: string | null } } | null)?.parsed;
    const cat = parsed?.decline_reason_category;
    if (cat) acc.declineReasons.set(cat, (acc.declineReasons.get(cat) ?? 0) + 1);
    if (factorRate != null && factorRate > 0) { acc.factorSum += factorRate; acc.factorN += 1; }
    if (submittedAt && responseAt) {
      const ms = new Date(responseAt).getTime() - new Date(submittedAt).getTime();
      if (Number.isFinite(ms) && ms >= 0) { acc.respSum += ms; acc.respN += 1; }
    }
    byLender.set(lenderId, acc);
  }

  const rows: FunderScore[] = [];
  for (const [lenderId, a] of byLender.entries()) {
    // Mode of decline reasons — the category this funder passes on most.
    let topDeclineReason: string | null = null;
    let topN = 0;
    for (const [cat, n] of a.declineReasons.entries()) {
      if (n > topN) { topN = n; topDeclineReason = cat; }
    }
    rows.push({
      lenderId,
      lenderName: a.lenderName,
      submissions: a.submissions,
      replies: a.replies,
      offers: a.offers,
      accepted: a.accepted,
      funderDeclines: a.funderDeclines,
      acceptanceRate: a.offers > 0 ? (a.accepted / a.offers) * 100 : null,
      avgFactor: a.factorN > 0 ? a.factorSum / a.factorN : null,
      avgResponseMs: a.respN > 0 ? a.respSum / a.respN : null,
      topDeclineReason,
    });
  }
  rows.sort((x, y) => (y.accepted - x.accepted) || (y.offers - x.offers) || (y.submissions - x.submissions));
  return rows;
}

export async function getDealStats(): Promise<{
  total: number;
  byStatus: Record<string, number>;
  totalPipeline: number;
  totalFunded: number;
  commissionInPlay: number;
}> {
  const { data, error } = await supabase
    .from("deals")
    .select("status, amount_requested, amount_funded, is_renewal");

  if (error) {
    console.error("Error fetching deal stats:", error);
    throw error;
  }

  const deals = data || [];
  const byStatus: Record<string, number> = {};
  let totalPipeline = 0;
  let totalFunded = 0;
  let commissionInPlay = 0;

  for (const deal of deals) {
    byStatus[deal.status] = (byStatus[deal.status] || 0) + 1;
    if (!["funded", "declined", "dead"].includes(deal.status)) {
      totalPipeline += deal.amount_requested || 0;
      // Potential gross commission on this open application (amount × points).
      commissionInPlay += expectedCommissionInPlay(deal.amount_requested, !!deal.is_renewal);
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
    commissionInPlay,
  };
}
