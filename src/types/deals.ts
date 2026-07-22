export type DealStatus =
  | "new"
  | "contacted"
  | "qualifying"
  | "application_sent"
  | "docs_collected"
  | "bank_statements"
  | "submitted_to_funder"
  | "offer_received"
  | "offer_presented"
  | "offer_accepted"
  | "funded"
  | "renewal_eligible"
  // VCF (debt relief) stages
  | "new_distressed"
  | "hardship_consult"
  | "positions_analysis"
  | "strategy_proposal"
  | "agreement_sent"
  | "submitted_to_vcf"
  | "restructure_executed"
  | "servicing"
  // shared outcomes
  | "nurture"
  | "declined"
  | "dead";

export type DealType =
  | "mca"
  | "term_loan"
  | "line_of_credit"
  | "sba"
  | "equipment_financing"
  | "vcf";

/** Products a merchant can be shopping for. Multi-select on the deal
 *  (deals.products_interested) — a merchant may want several. Values match the
 *  DB CHECK constraint exactly; do not rename without a migration. */
export type ProductInterest =
  | "mca"
  | "term_loan"
  | "sba_loan"
  | "line_of_credit"
  | "equipment_financing"
  | "cre"
  | "debt_relief";

/** Display order + short chip labels for the products a merchant wants. The GHL
 *  contact tag is derived mechanically: `product-` + value with underscores → dashes
 *  (mca → product-mca, sba_loan → product-sba-loan). One source of truth for the
 *  chip cluster in the Revenue Playbook. */
export const PRODUCT_INTEREST_OPTIONS: { value: ProductInterest; label: string; full: string }[] = [
  { value: "mca", label: "MCA", full: "Merchant Cash Advance" },
  { value: "term_loan", label: "Term", full: "Term / business loan" },
  { value: "sba_loan", label: "SBA", full: "SBA loan" },
  { value: "line_of_credit", label: "LOC", full: "Line of credit" },
  { value: "equipment_financing", label: "Equip", full: "Equipment financing" },
  { value: "cre", label: "CRE", full: "Commercial real estate" },
  { value: "debt_relief", label: "Relief", full: "Debt relief" },
];

/** The GHL contact tag for a product interest (mca → product-mca). Kept in sync
 *  with the edge function `sync-deal-product-tags`, which owns the write. */
export function productTag(value: ProductInterest): string {
  return `product-${value.replace(/_/g, "-")}`;
}

export type SubmissionStatus =
  | "pending"
  | "submitted"
  | "under_review"
  | "approved"
  | "declined"
  | "offer_made"
  | "offer_accepted"
  | "offer_declined"
  | "funded"
  | "withdrawn";

export type Market =
  | "indianapolis"
  | "phoenix"
  | "columbus"
  | "dc"
  | "sacramento"
  | "south_florida";

export interface Deal {
  id: string;
  customer_id: string;
  deal_number: string | null;
  deal_type: DealType;
  /** Products the merchant is shopping for (multi-select, ≥1). Deal-scoped truth;
   *  synced to product-* tags on the GHL contact. Defaults to '{mca}'. */
  products_interested: ProductInterest[];
  status: DealStatus;
  /** The last ACTIVE stage this deal was in before it got parked (nurture/declined/dead),
   *  captured on the way out so "Bring back" can restore it. */
  previous_status: DealStatus | null;
  amount_requested: number | null;
  amount_funded: number | null;
  use_of_funds: string | null;
  urgency: string | null;
  application_type: string | null;
  // Stage timestamps
  contacted_at: string | null;
  qualified_at: string | null;
  application_sent_at: string | null;
  docs_collected_at: string | null;
  bank_statements_at: string | null;
  /** The date (YYYY-MM-DD) the merchant COMMITTED to sending their bank
   * statements. Captured in the playbook's docs step; drives My Day's chase. */
  stips_promised_by?: string | null;
  offer_accepted_at: string | null;
  nurture_at: string | null;
  merchant_reply_at?: string | null;
  merchant_reply_summary?: string | null;
  submitted_at: string | null;
  offer_received_at: string | null;
  offer_presented_at: string | null;
  funded_at: string | null;
  declined_at: string | null;
  // Assignment
  assigned_closer_id: string | null;
  lead_source: string | null;
  lead_source_detail: string | null;
  campaign_id: string | null;
  market: Market | null;
  // Renewal
  is_renewal: boolean;
  original_deal_id: string | null;
  renewal_count: number;
  paydown_percentage: number;
  renewal_eligible_date: string | null;
  // Renewal projection — drive the merchant portal's paydown countdown.
  /** Total to be repaid (advance × factor). */
  payback_amount?: number | null;
  /** Amount debited each remittance. */
  remittance_amount?: number | null;
  /** How often the debit happens. */
  remittance_frequency?: "daily" | "weekly" | null;
  first_remittance_date?: string | null;
  /** Staff-entered current balance; authoritative when set. */
  balance_override?: number | null;
  /** Freshness stamp auto-set to now() whenever balance_override is edited. */
  balance_as_of?: string | null;
  // GHL
  ghl_contact_id: string | null;
  ghl_opportunity_id: string | null;
  //
  notes: string | null;
  /** Playbook "collected" chips, keyed "<playbookId>:<stepN>" → checked labels. */
  playbook_checklist: Record<string, string[]> | null;
  /** Closer-controlled manual doc checklist, keyed by customer_document_type slug
   *  → true when collected. SOURCE OF TRUTH for funder doc availability. */
  doc_checklist?: Record<string, boolean> | null;
  /** Lead temperature (cold|cool|warm|warmer|hot|hottest) — drives My Day rank. */
  temperature?: string | null;
  /** Qualification snapshot that arrived WITH the lead (revenue, TIB, FICO, etc.). */
  lead_qual?: Record<string, unknown> | null;
  /** Speed-to-lead countdown target for hot/hottest leads. NULL on a live transfer —
   *  the merchant is already on the phone, so there is nothing to be late for. */
  first_call_due_at?: string | null;
  /** When a closer FIRST reached out, answered or not. The speed-to-lead SLA is judged
   *  against THIS — a merchant who doesn't pick up does not make us slow.
   *  (`contacted_at`, above, is the different question: when we actually got through.) */
  first_attempt_at?: string | null;
  last_attempt_at?: string | null;
  contact_attempts?: number | null;
  first_touch_channel?: "call" | "email" | "sms" | "other" | null;
  /** The merchant asked to be called at this time. While it's in the future the deal is
   *  SNOOZED out of the urgent queue; it jumps back to the top the moment it comes due. */
  callback_at?: string | null;
  /** Who scheduled the callback. 'merchant_stated' = auto-booked from the vendor's
   *  best-time field — a WINDOW, not a promise (amber copy, downgrades after 3h,
   *  auto-expires at the end of its Eastern day). 'closer_promised' = a human
   *  commitment (red copy, never auto-expires). */
  callback_source?: "merchant_stated" | "closer_promised" | null;
  /** GHL appointment id projecting callback_at onto the "Callbacks — Internal"
   *  calendar (one-way DB→GHL, healed by the 5-min callback-calendar-sync sweep). */
  callback_ghl_event_id?: string | null;
  /** The callback_at INSTANT the GHL event currently reflects — NOT a sync
   *  timestamp. On calendar ⇔ callback_synced_at === callback_at. */
  callback_synced_at?: string | null;
  /** Last calendar-sync failure (null = healthy). Never blocks the callback. */
  callback_sync_error?: string | null;
  // ── Lead scoring v1 (research/PLAN_lead_scoring.md) ──
  /** Close-likelihood grade A–D. v1 weights are JUDGMENT (0 funded deals) — always label as estimate. */
  lead_grade?: "A" | "B" | "C" | "D" | null;
  /** 0–100 rules score behind the grade. */
  lead_score?: number | null;
  /** Estimated $ = P(close) × expected gross commission on the fundable amount — the "best first" sort. */
  expected_value?: number | null;
  /** Factor breakdown [{factor, points, max, note}] — the notes ARE the explanation. */
  score_reasons?: { factor: string; points: number; max: number; note: string }[] | null;
  score_version?: number | null;
  scored_at?: string | null;
  /** Persisted AI lender analysis (tokens cost money — survives reloads). */
  ai_lender_recommendations: { summary: string; recommendations: unknown[] } | null;
  ai_recommended_at: string | null;
  tags: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DealWithCustomer extends Deal {
  customer?: {
    id: string;
    first_name: string;
    last_name: string;
    business_name: string | null;
    email: string | null;
    /** Extra addresses CC'd on outbound merchant email (primary stays `email`). */
    additional_emails: string[] | null;
    phone: string | null;
    monthly_revenue: number | null;
    time_in_business: number | null;
    industry: string | null;
  };
  closer?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
  };
}

export interface DealSubmission {
  id: string;
  deal_id: string;
  lender_id: string;
  status: SubmissionStatus;
  submitted_at: string | null;
  response_at: string | null;
  submitted_by: string | null;
  // Offer details
  offer_amount: number | null;
  factor_rate: number | null;
  term_months: number | null;
  daily_payment: number | null;
  weekly_payment: number | null;
  total_payback: number | null;
  commission_points: number | null;
  commission_amount: number | null;
  // Decline
  decline_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DealSubmissionWithLender extends DealSubmission {
  lender?: {
    id: string;
    company_name: string;
    status: string;
    paper_types: string[];
    lender_types: string[];
  };
}

export interface CreateDealData {
  customer_id: string;
  deal_type: DealType;
  status?: DealStatus;
  amount_requested?: number;
  use_of_funds?: string;
  urgency?: string;
  lead_source?: string;
  lead_source_detail?: string;
  campaign_id?: string | null;
  market?: Market;
  assigned_closer_id?: string;
  is_renewal?: boolean;
  original_deal_id?: string;
  notes?: string;
  tags?: string[];
  // VCF (debt relief) intake fields — captured at lead time from the playbook
  vcf_active_positions?: number;
  vcf_total_balance?: number;
  vcf_daily_debit?: number;
  vcf_current_funders?: string;
  vcf_hardship_reason?: string;
}

export interface UpdateDealData {
  deal_type?: DealType;
  amount_requested?: number;
  amount_funded?: number;
  use_of_funds?: string;
  urgency?: string;
  application_type?: string;
  assigned_closer_id?: string | null;
  lead_source?: string;
  lead_source_detail?: string;
  campaign_id?: string | null;
  market?: Market;
  is_renewal?: boolean;
  paydown_percentage?: number;
  renewal_eligible_date?: string;
  // Renewal projection fields (drive the merchant paydown countdown).
  payback_amount?: number | null;
  remittance_amount?: number | null;
  remittance_frequency?: "daily" | "weekly" | null;
  first_remittance_date?: string | null;
  balance_override?: number | null;
  balance_as_of?: string | null;
  notes?: string;
  tags?: string[];
}

export interface DealFilters {
  status?: DealStatus;
  market?: Market;
  deal_type?: DealType;
  /** Profile id of the owning closer (deals.assigned_closer_id → profiles.id).
   *  NOT closers.id — see CloserOption in dealService. */
  assigned_closer_id?: string;
  /** Show ONLY deals with no owning closer. Mutually exclusive with
   *  assigned_closer_id (an unassigned deal has no closer to match). */
  unassigned?: boolean;
  campaign_id?: string;
  search?: string;
  date_from?: string;
  date_to?: string;
}

// Stage ordering for the pipeline stepper
export const DEAL_STAGES: { key: DealStatus; label: string }[] = [
  { key: "new", label: "New Lead" },
  { key: "contacted", label: "Contacted" },
  { key: "qualifying", label: "Qualifying" },
  { key: "application_sent", label: "App Sent" },
  { key: "docs_collected", label: "Docs Collected" },
  { key: "bank_statements", label: "Bank Statements" },
  { key: "submitted_to_funder", label: "Submitted to Funders" },
  { key: "offer_received", label: "Offer Received" },
  { key: "offer_presented", label: "Offer Presented" },
  { key: "offer_accepted", label: "Offer Accepted" },
  { key: "funded", label: "Funded" },
];

export const DEAL_STATUS_CONFIG: Record<DealStatus, { label: string; color: string; bgColor: string }> = {
  new: { label: "New Lead", color: "text-gray-700 dark:text-gray-300", bgColor: "bg-gray-100 dark:bg-gray-700" },
  contacted: { label: "Contacted", color: "text-blue-700 dark:text-blue-300", bgColor: "bg-blue-100 dark:bg-blue-900" },
  qualifying: { label: "Qualifying", color: "text-indigo-700 dark:text-indigo-300", bgColor: "bg-indigo-100 dark:bg-indigo-900" },
  application_sent: { label: "App Sent", color: "text-purple-700 dark:text-purple-300", bgColor: "bg-purple-100 dark:bg-purple-900" },
  docs_collected: { label: "Docs Collected", color: "text-cyan-700 dark:text-cyan-300", bgColor: "bg-cyan-100 dark:bg-cyan-900" },
  bank_statements: { label: "Bank Statements", color: "text-sky-700 dark:text-sky-300", bgColor: "bg-sky-100 dark:bg-sky-900" },
  submitted_to_funder: { label: "Submitted to Funders", color: "text-yellow-700 dark:text-yellow-300", bgColor: "bg-yellow-100 dark:bg-yellow-900" },
  offer_received: { label: "Offer Received", color: "text-orange-700 dark:text-orange-300", bgColor: "bg-orange-100 dark:bg-orange-900" },
  offer_presented: { label: "Offer Presented", color: "text-amber-700 dark:text-amber-300", bgColor: "bg-amber-100 dark:bg-amber-900" },
  offer_accepted: { label: "Offer Accepted", color: "text-lime-700 dark:text-lime-300", bgColor: "bg-lime-100 dark:bg-lime-900" },
  funded: { label: "Funded", color: "text-green-700 dark:text-green-300", bgColor: "bg-green-100 dark:bg-green-900" },
  renewal_eligible: { label: "Renewal Eligible", color: "text-teal-700 dark:text-teal-300", bgColor: "bg-teal-100 dark:bg-teal-900" },
  // VCF (debt relief) stages
  new_distressed: { label: "New Lead (Distressed)", color: "text-gray-700 dark:text-gray-300", bgColor: "bg-gray-100 dark:bg-gray-700" },
  hardship_consult: { label: "Hardship Consultation", color: "text-blue-700 dark:text-blue-300", bgColor: "bg-blue-100 dark:bg-blue-900" },
  positions_analysis: { label: "Positions & Balances", color: "text-indigo-700 dark:text-indigo-300", bgColor: "bg-indigo-100 dark:bg-indigo-900" },
  strategy_proposal: { label: "Strategy / Proposal", color: "text-purple-700 dark:text-purple-300", bgColor: "bg-purple-100 dark:bg-purple-900" },
  agreement_sent: { label: "Agreement Sent", color: "text-amber-700 dark:text-amber-300", bgColor: "bg-amber-100 dark:bg-amber-900" },
  submitted_to_vcf: { label: "Submitted to VCF", color: "text-yellow-700 dark:text-yellow-300", bgColor: "bg-yellow-100 dark:bg-yellow-900" },
  restructure_executed: { label: "Restructure Executed", color: "text-green-700 dark:text-green-300", bgColor: "bg-green-100 dark:bg-green-900" },
  servicing: { label: "Servicing / Monitoring", color: "text-teal-700 dark:text-teal-300", bgColor: "bg-teal-100 dark:bg-teal-900" },
  nurture: { label: "Nurture / Re-engage", color: "text-violet-700 dark:text-violet-300", bgColor: "bg-violet-100 dark:bg-violet-900" },
  declined: { label: "Declined", color: "text-red-700 dark:text-red-300", bgColor: "bg-red-100 dark:bg-red-900" },
  dead: { label: "Dead", color: "text-gray-500 dark:text-gray-500", bgColor: "bg-gray-100 dark:bg-gray-800" },
};

export const DEAL_TYPE_CONFIG: Record<DealType, { label: string; shortLabel: string }> = {
  mca: { label: "Merchant Cash Advance", shortLabel: "MCA" },
  term_loan: { label: "Term Loan", shortLabel: "Term Loan" },
  line_of_credit: { label: "Line of Credit", shortLabel: "LOC" },
  sba: { label: "SBA Loan", shortLabel: "SBA" },
  equipment_financing: { label: "Equipment Financing", shortLabel: "Equipment" },
  vcf: { label: "VCF Debt Relief", shortLabel: "VCF" },
};

export const MARKET_CONFIG: Record<Market, { label: string }> = {
  indianapolis: { label: "Indianapolis, IN" },
  phoenix: { label: "Phoenix/Scottsdale, AZ" },
  columbus: { label: "Columbus/Cincinnati, OH" },
  dc: { label: "Washington DC/NoVA" },
  sacramento: { label: "Sacramento, CA" },
  south_florida: { label: "South Florida" },
};

export const SUBMISSION_STATUS_CONFIG: Record<SubmissionStatus, { label: string; color: string; bgColor: string }> = {
  pending: { label: "Pending", color: "text-gray-700", bgColor: "bg-gray-100" },
  submitted: { label: "Submitted", color: "text-blue-700", bgColor: "bg-blue-100" },
  under_review: { label: "Under Review", color: "text-yellow-700", bgColor: "bg-yellow-100" },
  approved: { label: "Approved", color: "text-green-700", bgColor: "bg-green-100" },
  declined: { label: "Declined", color: "text-red-700", bgColor: "bg-red-100" },
  offer_made: { label: "Offer Made", color: "text-orange-700", bgColor: "bg-orange-100" },
  offer_accepted: { label: "Accepted", color: "text-emerald-700", bgColor: "bg-emerald-100" },
  offer_declined: { label: "Offer Declined", color: "text-rose-700", bgColor: "bg-rose-100" },
  funded: { label: "Funded", color: "text-teal-700", bgColor: "bg-teal-100" },
  withdrawn: { label: "Withdrawn", color: "text-gray-500", bgColor: "bg-gray-100" },
};
