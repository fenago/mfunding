import supabase from "../supabase";
import { mustWrite } from "@/supabase/writes";
import type {
  Deal,
  DealWithCustomer,
  DealSubmission,
  DealSubmissionWithLender,
  DealStatus,
  SubmissionStatus,
  CreateDealData,
  UpdateDealData,
  DealFilters,
} from "../types/deals";
import { calculateCommission, createCommission } from "./commissionService";
import { syncDealToGHL } from "./ghlService";
import { COMMISSION_DEFAULTS, expectedCommissionInPlay } from "../types/commissions";
import { PIPELINES } from "../data/pipelines";
import type { CommissionLeadSource, Commission } from "../types/commissions";

// Parked (off-pipeline) statuses shared by both product lines. A deal in one of
// these is "on the bench" and can be pulled back with reactivateDeal().
const PARKED_STATUSES: DealStatus[] = ["nurture", "declined", "dead"];

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
  const rows = await mustWrite<Deal>("create deal", supabase.from("deals").insert(data));
  const deal = rows[0];

  // Push the new deal into GoHighLevel (contact + opportunity at its stage) so
  // admin-created leads land in GHL and fire Speed-to-Lead — same as the public
  // intake. Best-effort: never block deal creation if GHL is unavailable.
  void syncDealToGHL(deal.id).catch((e) => console.warn("GHL sync (createDeal) failed:", e));

  return deal;
}

export async function updateDeal(id: string, data: UpdateDealData): Promise<Deal> {
  const rows = await mustWrite<Deal>("update deal", supabase.from("deals").update(data).eq("id", id));
  const d = rows[0];
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
  const { data: cur } = await supabase.from("deals").select("status, deal_type").eq("id", id).single();
  const curStatus = cur?.status as DealStatus | undefined;

  // ── Backward-move lock ────────────────────────────────────────────────
  // Moving a deal BACKWARD re-fires that stage's GHL automations at the
  // merchant — a trainee doing it by accident emails a real customer. Forward
  // moves and moves INTO a terminal state (declined / dead / nurture) are
  // always allowed; anything else requires a super_admin. Pulling a PARKED deal
  // back into the pipeline ("Bring back") is an intentional revive, so it's
  // exempt — the whole point is to restore the stage it left from.
  const revivingFromParked = curStatus != null && PARKED_STATUSES.includes(curStatus) && !PARKED_STATUSES.includes(newStatus);
  if (cur && curStatus !== newStatus && !revivingFromParked) {
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

  const updateData: Record<string, unknown> = { status: newStatus };

  // Set the corresponding timestamp
  const timestampCol = STATUS_TIMESTAMP_MAP[newStatus];
  if (timestampCol) {
    updateData[timestampCol] = new Date().toISOString();
  }

  // Parking an ACTIVE deal → remember where it was so "Bring back" can restore
  // the exact stage. Don't touch previous_status when it's already parked or
  // when moving between active stages.
  if (
    curStatus &&
    PARKED_STATUSES.includes(newStatus) &&
    !PARKED_STATUSES.includes(curStatus)
  ) {
    updateData.previous_status = curStatus;
  }

  // Reactivating a parked deal → clear the nurture timestamp so it doesn't read
  // as still-on-the-bench once it's back in the pipeline.
  if (
    curStatus &&
    PARKED_STATUSES.includes(curStatus) &&
    !PARKED_STATUSES.includes(newStatus)
  ) {
    updateData.nurture_at = null;
  }

  const rows = await mustWrite<Deal>("update deal status", supabase.from("deals").update(updateData).eq("id", id));
  const deal = rows[0];

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

// Active MCA stages, in order, for inferring where a reactivated deal should land.
const ACTIVE_MCA_STAGES: DealStatus[] = [
  "new", "contacted", "qualifying", "application_sent", "docs_collected",
  "bank_statements", "submitted_to_funder", "offer_received", "offer_presented",
  "offer_accepted", "funded",
];

/**
 * "Bring back" — pull a parked deal (nurture / declined / dead) back into the
 * active pipeline, restoring the LAST ACTIVE stage it was in.
 *
 * Target stage:
 *   1. previous_status, if it's an active stage (captured when the deal was parked).
 *   2. Otherwise inferred from the deal's funder submissions / progress:
 *      - any submission that produced an offer → offer_received
 *      - else any still-open submission (submitted / pending) → submitted_to_funder
 *      - else the deal already had an app / docs → application_sent
 *      - else → qualifying
 *
 * Routes through updateDealStatus so stage timestamps, GHL sync, and the
 * nurture_at clear all apply.
 */
export async function reactivateDeal(id: string): Promise<Deal> {
  const { data: deal, error } = await supabase
    .from("deals")
    .select("status, previous_status, application_sent_at, docs_collected_at, doc_checklist")
    .eq("id", id)
    .single();
  if (error || !deal) {
    console.error("reactivateDeal: deal not found", error);
    throw error ?? new Error("Deal not found");
  }

  let target: DealStatus | null = null;

  // 1. Trust the remembered stage if it's a real active stage.
  const prev = deal.previous_status as DealStatus | null;
  if (prev && ACTIVE_MCA_STAGES.includes(prev)) {
    target = prev;
  } else {
    // 2. Infer from submissions.
    const { data: subs } = await supabase
      .from("deal_submissions")
      .select("status")
      .eq("deal_id", id);
    const rows = (subs ?? []) as { status: SubmissionStatus }[];
    const hasOffer = rows.some((s) =>
      ["offer_made", "offer_accepted", "approved"].includes(s.status),
    );
    const hasOpen = rows.some((s) => ["submitted", "pending", "under_review"].includes(s.status));
    const hasAppOrDocs = !!deal.application_sent_at || !!deal.docs_collected_at ||
      Object.values((deal.doc_checklist as Record<string, boolean> | null) ?? {}).some(Boolean);

    if (hasOffer) target = "offer_received";
    else if (hasOpen) target = "submitted_to_funder";
    else if (hasAppOrDocs) target = "application_sent";
    else target = "qualifying";
  }

  return await updateDealStatus(id, target);
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

  const rows = await mustWrite<DealSubmission>(
    "update deal submission",
    supabase.from("deal_submissions").update(updateData).eq("id", id),
  );
  return rows[0];
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
  opens: number;                 // submissions the funder opened (GHL email-open events)
  avgTimeToOpenMs: number | null;// mean (opened_at − submitted_at) — how fast they read it
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
    .select("lender_id, status, submitted_at, response_at, opened_at, offer_amount, factor_rate, response_data, lender:lenders!lender_id ( company_name )");
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
    openSum: number;
    openN: number;
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
      factorSum: 0, factorN: 0, respSum: 0, respN: 0, openSum: 0, openN: 0, declineReasons: new Map<string, number>(),
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
    const openedAt = r.opened_at as string | null;
    if (submittedAt && openedAt) {
      const oms = new Date(openedAt).getTime() - new Date(submittedAt).getTime();
      if (Number.isFinite(oms) && oms >= 0) { acc.openSum += oms; acc.openN += 1; }
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
      opens: a.openN,
      avgTimeToOpenMs: a.openN > 0 ? a.openSum / a.openN : null,
      topDeclineReason,
    });
  }
  rows.sort((x, y) => (y.accepted - x.accepted) || (y.offers - x.offers) || (y.submissions - x.submissions));
  return rows;
}

// ─────────────────────── Funder performance analytics ───────────────────────
// Powers /admin/analytics/lenders. Everything below is derived from real rows
// in deal_submissions + activity_log — no fabricated numbers. Designed to read
// well at n=6 (today) and n=500 (later): a live event feed leads at low volume,
// the leaderboard + decline intelligence become the story as data accumulates.

export type FunderFeedKind =
  | "decline"
  | "stip_request"
  | "offer"
  | "question"
  | "acknowledgment"
  | "reply"
  | "open";

export interface FunderFeedEvent {
  id: string;
  at: string;                 // ISO timestamp
  kind: FunderFeedKind;
  funderName: string | null;
  lenderId: string | null;
  dealId: string | null;
  dealNumber: string | null;
  detail: string | null;      // short human snippet ("low revenue", requested item…)
  opener?: "funder" | "merchant"; // only for kind === "open"
}

export interface FunderDealRef {
  dealId: string;
  dealNumber: string | null;
  businessName: string | null;
  amountRequested: number | null;
  status: SubmissionStatus;
  responseType: string | null;
}

export interface FunderAnalyticsRow {
  lenderId: string;
  lenderName: string;
  paperType: string | null;
  sent: number;
  replied: number;
  replyRate: number | null;         // replied ÷ sent, %
  medianResponseHrs: number | null;
  offers: number;
  offerRate: number | null;         // offers ÷ sent, %
  accepted: number;
  declines: number;
  topDeclineReason: string | null;  // AI-classified category
  declineReasonCounts: Record<string, number>;
  avgFactor: number | null;
  avgOfferToAsk: number | null;     // mean(offer_amount ÷ amount_requested)
  estCommission: number;            // Σ(accepted deal amount) × 8pts — estimate
  commissionIsEstimate: boolean;
  lastInteraction: string | null;
  requestedItems: string[];         // distinct stip items this funder has asked for
  deals: FunderDealRef[];
  declinedRevenues: number[];       // monthly_revenue of declined merchants
  offeredRevenues: number[];        // monthly_revenue of merchants they offered
}

export interface FunderAnalytics {
  totals: {
    submissions: number;
    replies: number;
    offers: number;
    declines: number;
    accepted: number;
    stipRequests: number;
    avgFirstResponseHrs: number | null;
    openRate: number | null;        // opened ÷ tracked emails, %
    trackedEmails: number;
    openedEmails: number;
  };
  funders: FunderAnalyticsRow[];
  feed: FunderFeedEvent[];
  declineReasonTotals: Record<string, number>;
}

const OFFER_SUBMISSION_STATUSES = ["offer_made", "offer_accepted", "offer_declined", "approved"];
const LIVE_SUBMISSION_STATUSES = ["submitted", "under_review", "approved", "offer_made", "offer_accepted", "offer_declined", "declined", "funded"];

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Classify a funder-reply activity_log entry from its content prefix.
function feedKindFromContent(content: string): FunderFeedKind {
  const c = content.trim().toLowerCase();
  if (c.startsWith("decline")) return "decline";
  if (c.startsWith("stip")) return "stip_request";
  if (c.startsWith("offer")) return "offer";
  if (c.startsWith("question")) return "question";
  if (c.startsWith("acknowledg")) return "acknowledgment";
  return "reply";
}

// Pull the human snippet out of a funder-reply log line: drop the "Decline:"/
// "Stip request:" prefix and surrounding quotes, then truncate.
function feedDetailFromContent(content: string): string | null {
  let t = content.replace(/^\s*[A-Za-z ]+:\s*/, "").trim();
  t = t.replace(/^["“]|["”]$/g, "").replace(/["“].*$/s, "").trim();
  if (!t) return null;
  return t.length > 90 ? t.slice(0, 90) + "…" : t;
}

/**
 * One aggregate view of every funder's real submission + reply history.
 * A handful of parallel queries, reduced client-side (same shape as
 * getFunderScoreboard, extended for the analytics page).
 */
export async function getFunderAnalytics(): Promise<FunderAnalytics> {
  const [subsRes, dealsRes, custRes, lendersRes, logRes] = await Promise.all([
    supabase
      .from("deal_submissions")
      .select("id, deal_id, lender_id, status, submitted_at, response_at, response_type, response_summary, response_data, decline_reason, offer_amount, factor_rate, courtesy_sent_at, updated_at, lender:lenders!lender_id ( company_name, paper_types )"),
    supabase.from("deals").select("id, deal_number, amount_requested, customer_id, status"),
    supabase.from("customers").select("id, business_name, monthly_revenue"),
    supabase.from("lenders").select("id, company_name"),
    supabase
      .from("activity_log")
      .select("id, entity_id, subject, content, created_at")
      .eq("entity_type", "deal")
      .or("subject.ilike.ghl:funder-reply%,subject.ilike.funder:email%,subject.ilike.merchant:email%")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (subsRes.error) { console.error("getFunderAnalytics submissions:", subsRes.error); throw subsRes.error; }

  const subs = (subsRes.data ?? []) as unknown as Array<Record<string, unknown>>;
  const deals = (dealsRes.data ?? []) as Array<{ id: string; deal_number: string | null; amount_requested: number | null; customer_id: string | null; status: string }>;
  const customers = (custRes.data ?? []) as Array<{ id: string; business_name: string | null; monthly_revenue: number | null }>;
  const lenders = (lendersRes.data ?? []) as Array<{ id: string; company_name: string | null }>;
  const logs = (logRes.data ?? []) as Array<{ id: string; entity_id: string; subject: string | null; content: string | null; created_at: string }>;

  const dealById = new Map(deals.map((d) => [d.id, d]));
  const custById = new Map(customers.map((c) => [c.id, c]));
  const lenderById = new Map(lenders.map((l) => [l.id, l]));
  // funder company_name → lenderId, for linking activity_log events (which are
  // deal-scoped and only name the funder in the subject) back to the lender.
  const lenderIdByName = new Map<string, string>();
  for (const l of lenders) if (l.company_name) lenderIdByName.set(l.company_name.toLowerCase(), l.id);

  interface Acc {
    lenderName: string;
    paperType: string | null;
    sent: number;
    replied: number;
    offers: number;
    accepted: number;
    declines: number;
    factorSum: number; factorN: number;
    offerToAskSum: number; offerToAskN: number;
    estCommission: number;
    responseHrs: number[];
    lastInteraction: number | null; // epoch ms
    declineReasons: Map<string, number>;
    requestedItems: Set<string>;
    deals: FunderDealRef[];
    declinedRevenues: number[];
    offeredRevenues: number[];
  }
  const byLender = new Map<string, Acc>();

  const totals = { submissions: 0, replies: 0, offers: 0, declines: 0, accepted: 0, stipRequests: 0 };
  const responseHrsAll: number[] = [];
  const declineReasonTotals: Record<string, number> = {};
  const feed: FunderFeedEvent[] = [];
  // Track (lenderId|kind|dealId) already emitted from activity_log so submission-
  // derived events don't double-post the same reply.
  const feedKeys = new Set<string>();

  for (const r of subs) {
    const lenderId = r.lender_id as string;
    if (!lenderId) continue;
    const status = r.status as SubmissionStatus;
    const submittedAt = r.submitted_at as string | null;
    const responseAt = r.response_at as string | null;
    const offerAmount = r.offer_amount as number | null;
    const factorRate = r.factor_rate as number | null;
    const responseType = r.response_type as string | null;
    const isLive = !!submittedAt || !!responseAt || offerAmount != null || LIVE_SUBMISSION_STATUSES.includes(status);
    if (!isLive) continue;

    const lenderObj = r.lender as { company_name?: string; paper_types?: string[] } | null;
    const acc = byLender.get(lenderId) ?? {
      lenderName: lenderObj?.company_name ?? lenderById.get(lenderId)?.company_name ?? "Funder",
      paperType: (lenderObj?.paper_types && lenderObj.paper_types[0]) || null,
      sent: 0, replied: 0, offers: 0, accepted: 0, declines: 0,
      factorSum: 0, factorN: 0, offerToAskSum: 0, offerToAskN: 0, estCommission: 0,
      responseHrs: [], lastInteraction: null,
      declineReasons: new Map<string, number>(), requestedItems: new Set<string>(),
      deals: [], declinedRevenues: [], offeredRevenues: [],
    };

    const deal = r.deal_id ? dealById.get(r.deal_id as string) : undefined;
    const cust = deal?.customer_id ? custById.get(deal.customer_id) : undefined;
    const amountRequested = deal?.amount_requested != null ? Number(deal.amount_requested) : null;
    const monthlyRevenue = cust?.monthly_revenue != null ? Number(cust.monthly_revenue) : null;
    const isOffer = offerAmount != null || OFFER_SUBMISSION_STATUSES.includes(status);

    acc.sent += 1;
    totals.submissions += 1;
    if (responseAt) { acc.replied += 1; totals.replies += 1; }
    if (isOffer) { acc.offers += 1; totals.offers += 1; }
    if (status === "offer_accepted") {
      acc.accepted += 1; totals.accepted += 1;
      if (amountRequested != null) acc.estCommission += amountRequested * (COMMISSION_DEFAULTS.NEW_DEAL_POINTS / 100);
    }
    if (status === "declined") { acc.declines += 1; totals.declines += 1; }

    const parsed = (r.response_data as { parsed?: { decline_reason_category?: string | null; requested_items?: string[] | null; offer_terms?: unknown } } | null)?.parsed;
    const cat = parsed?.decline_reason_category;
    if (cat) {
      acc.declineReasons.set(cat, (acc.declineReasons.get(cat) ?? 0) + 1);
      declineReasonTotals[cat] = (declineReasonTotals[cat] ?? 0) + 1;
    }
    for (const item of (parsed?.requested_items ?? [])) if (item) acc.requestedItems.add(item);
    if (responseType === "stip_request") totals.stipRequests += 1;

    if (status === "declined" && monthlyRevenue != null) acc.declinedRevenues.push(monthlyRevenue);
    if (isOffer && monthlyRevenue != null) acc.offeredRevenues.push(monthlyRevenue);

    if (factorRate != null && factorRate > 0) { acc.factorSum += factorRate; acc.factorN += 1; }
    if (isOffer && offerAmount != null && amountRequested && amountRequested > 0) {
      acc.offerToAskSum += offerAmount / amountRequested; acc.offerToAskN += 1;
    }
    if (submittedAt && responseAt) {
      const hrs = (new Date(responseAt).getTime() - new Date(submittedAt).getTime()) / 3_600_000;
      if (Number.isFinite(hrs) && hrs >= 0) { acc.responseHrs.push(hrs); responseHrsAll.push(hrs); }
    }
    const lastTs = Math.max(
      submittedAt ? Date.parse(submittedAt) : 0,
      responseAt ? Date.parse(responseAt) : 0,
      r.updated_at ? Date.parse(r.updated_at as string) : 0,
    );
    if (lastTs > 0 && (acc.lastInteraction == null || lastTs > acc.lastInteraction)) acc.lastInteraction = lastTs;

    acc.deals.push({
      dealId: (r.deal_id as string) ?? "",
      dealNumber: deal?.deal_number ?? null,
      businessName: cust?.business_name ?? null,
      amountRequested,
      status,
      responseType,
    });
    byLender.set(lenderId, acc);
  }

  // Live event feed from activity_log (preserves stip→decline history that a
  // submission's current status would otherwise flatten).
  let trackedEmails = 0;
  let openedEmails = 0;
  for (const log of logs) {
    const subject = log.subject ?? "";
    const content = log.content ?? "";
    const dealNumber = dealById.get(log.entity_id)?.deal_number ?? null;

    if (subject.startsWith("ghl:funder-reply")) {
      const funderName = subject.split("—")[1]?.trim() || null;
      const lenderId = funderName ? lenderIdByName.get(funderName.toLowerCase()) ?? null : null;
      const kind = feedKindFromContent(content);
      feed.push({
        id: log.id, at: log.created_at, kind, funderName, lenderId,
        dealId: log.entity_id, dealNumber, detail: feedDetailFromContent(content),
      });
      if (lenderId) feedKeys.add(`${lenderId}|${kind}|${log.entity_id}`);
    }

    // Open tracking: outbound funder/merchant emails carry [emsg:…] and, once
    // opened, an [opened:ISO] marker. Count for open-rate + surface as events.
    const isFunderEmail = subject.startsWith("funder:email");
    const isMerchantEmail = subject.startsWith("merchant:email");
    if (isFunderEmail || isMerchantEmail) {
      if (content.includes("[emsg:")) trackedEmails += 1;
      const openMatch = content.match(/\[opened:([^\]]+)\]/);
      if (openMatch) {
        openedEmails += 1;
        const reMatch = content.match(/\[re:\s*([^\]]+)\]/);
        const funderName = isFunderEmail ? (reMatch?.[1]?.trim() ?? null) : null;
        const lenderId = funderName ? lenderIdByName.get(funderName.toLowerCase()) ?? null : null;
        feed.push({
          id: `${log.id}-open`, at: openMatch[1], kind: "open",
          funderName: isFunderEmail ? funderName : null, lenderId,
          dealId: log.entity_id, dealNumber,
          detail: isFunderEmail ? "opened your submission email" : "merchant opened your email",
          opener: isFunderEmail ? "funder" : "merchant",
        });
      }
    }
  }

  // Backfill feed with submission responses not already logged in activity_log.
  for (const r of subs) {
    const lenderId = r.lender_id as string;
    const responseAt = r.response_at as string | null;
    const responseType = r.response_type as string | null;
    if (!lenderId || !responseAt || !responseType) continue;
    const kind: FunderFeedKind = responseType === "stip_request" ? "stip_request"
      : responseType === "offer" ? "offer"
      : responseType === "decline" ? "decline"
      : responseType === "question" ? "question"
      : responseType === "acknowledgment" ? "acknowledgment" : "reply";
    const dealId = r.deal_id as string;
    if (feedKeys.has(`${lenderId}|${kind}|${dealId}`)) continue;
    feed.push({
      id: `sub-${r.id as string}`, at: responseAt, kind,
      funderName: (r.lender as { company_name?: string } | null)?.company_name ?? lenderById.get(lenderId)?.company_name ?? null,
      lenderId, dealId, dealNumber: dealById.get(dealId)?.deal_number ?? null,
      detail: (r.response_summary as string | null) ?? (r.decline_reason as string | null),
    });
  }

  feed.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const funders: FunderAnalyticsRow[] = [];
  for (const [lenderId, a] of byLender.entries()) {
    let topDeclineReason: string | null = null;
    let topN = 0;
    const declineReasonCounts: Record<string, number> = {};
    for (const [cat, n] of a.declineReasons.entries()) {
      declineReasonCounts[cat] = n;
      if (n > topN) { topN = n; topDeclineReason = cat; }
    }
    funders.push({
      lenderId,
      lenderName: a.lenderName,
      paperType: a.paperType,
      sent: a.sent,
      replied: a.replied,
      replyRate: a.sent > 0 ? (a.replied / a.sent) * 100 : null,
      medianResponseHrs: median(a.responseHrs),
      offers: a.offers,
      offerRate: a.sent > 0 ? (a.offers / a.sent) * 100 : null,
      accepted: a.accepted,
      declines: a.declines,
      topDeclineReason,
      declineReasonCounts,
      avgFactor: a.factorN > 0 ? a.factorSum / a.factorN : null,
      avgOfferToAsk: a.offerToAskN > 0 ? a.offerToAskSum / a.offerToAskN : null,
      estCommission: a.estCommission,
      commissionIsEstimate: true,
      lastInteraction: a.lastInteraction != null ? new Date(a.lastInteraction).toISOString() : null,
      requestedItems: [...a.requestedItems],
      deals: a.deals,
      declinedRevenues: a.declinedRevenues,
      offeredRevenues: a.offeredRevenues,
    });
  }
  funders.sort((x, y) =>
    (y.accepted - x.accepted) || (y.offers - x.offers) || (y.replied - x.replied) || (y.sent - x.sent));

  return {
    totals: {
      ...totals,
      avgFirstResponseHrs: responseHrsAll.length > 0 ? responseHrsAll.reduce((s, h) => s + h, 0) / responseHrsAll.length : null,
      openRate: trackedEmails > 0 ? (openedEmails / trackedEmails) * 100 : null,
      trackedEmails,
      openedEmails,
    },
    funders,
    feed,
    declineReasonTotals,
  };
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
