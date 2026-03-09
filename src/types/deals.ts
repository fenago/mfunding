export type DealStatus =
  | "new"
  | "contacted"
  | "qualifying"
  | "application_sent"
  | "docs_collected"
  | "submitted_to_funder"
  | "offer_received"
  | "offer_presented"
  | "funded"
  | "renewal_eligible"
  | "declined"
  | "dead";

export type DealType =
  | "mca"
  | "term_loan"
  | "line_of_credit"
  | "sba"
  | "equipment_financing";

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
  status: DealStatus;
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
  submitted_at: string | null;
  offer_received_at: string | null;
  offer_presented_at: string | null;
  funded_at: string | null;
  declined_at: string | null;
  // Assignment
  assigned_closer_id: string | null;
  lead_source: string | null;
  lead_source_detail: string | null;
  market: Market | null;
  // Renewal
  is_renewal: boolean;
  original_deal_id: string | null;
  renewal_count: number;
  paydown_percentage: number;
  renewal_eligible_date: string | null;
  // GHL
  ghl_contact_id: string | null;
  ghl_opportunity_id: string | null;
  //
  notes: string | null;
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
  amount_requested?: number;
  use_of_funds?: string;
  urgency?: string;
  lead_source?: string;
  lead_source_detail?: string;
  market?: Market;
  assigned_closer_id?: string;
  is_renewal?: boolean;
  original_deal_id?: string;
  notes?: string;
  tags?: string[];
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
  market?: Market;
  is_renewal?: boolean;
  paydown_percentage?: number;
  renewal_eligible_date?: string;
  notes?: string;
  tags?: string[];
}

export interface DealFilters {
  status?: DealStatus;
  market?: Market;
  deal_type?: DealType;
  assigned_closer_id?: string;
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
  { key: "submitted_to_funder", label: "Submitted" },
  { key: "offer_received", label: "Offer Received" },
  { key: "offer_presented", label: "Offer Presented" },
  { key: "funded", label: "Funded" },
];

export const DEAL_STATUS_CONFIG: Record<DealStatus, { label: string; color: string; bgColor: string }> = {
  new: { label: "New Lead", color: "text-gray-700 dark:text-gray-300", bgColor: "bg-gray-100 dark:bg-gray-700" },
  contacted: { label: "Contacted", color: "text-blue-700 dark:text-blue-300", bgColor: "bg-blue-100 dark:bg-blue-900" },
  qualifying: { label: "Qualifying", color: "text-indigo-700 dark:text-indigo-300", bgColor: "bg-indigo-100 dark:bg-indigo-900" },
  application_sent: { label: "App Sent", color: "text-purple-700 dark:text-purple-300", bgColor: "bg-purple-100 dark:bg-purple-900" },
  docs_collected: { label: "Docs Collected", color: "text-cyan-700 dark:text-cyan-300", bgColor: "bg-cyan-100 dark:bg-cyan-900" },
  submitted_to_funder: { label: "Submitted", color: "text-yellow-700 dark:text-yellow-300", bgColor: "bg-yellow-100 dark:bg-yellow-900" },
  offer_received: { label: "Offer Received", color: "text-orange-700 dark:text-orange-300", bgColor: "bg-orange-100 dark:bg-orange-900" },
  offer_presented: { label: "Offer Presented", color: "text-amber-700 dark:text-amber-300", bgColor: "bg-amber-100 dark:bg-amber-900" },
  funded: { label: "Funded", color: "text-green-700 dark:text-green-300", bgColor: "bg-green-100 dark:bg-green-900" },
  renewal_eligible: { label: "Renewal Eligible", color: "text-teal-700 dark:text-teal-300", bgColor: "bg-teal-100 dark:bg-teal-900" },
  declined: { label: "Declined", color: "text-red-700 dark:text-red-300", bgColor: "bg-red-100 dark:bg-red-900" },
  dead: { label: "Dead", color: "text-gray-500 dark:text-gray-500", bgColor: "bg-gray-100 dark:bg-gray-800" },
};

export const DEAL_TYPE_CONFIG: Record<DealType, { label: string; shortLabel: string }> = {
  mca: { label: "Merchant Cash Advance", shortLabel: "MCA" },
  term_loan: { label: "Term Loan", shortLabel: "Term Loan" },
  line_of_credit: { label: "Line of Credit", shortLabel: "LOC" },
  sba: { label: "SBA Loan", shortLabel: "SBA" },
  equipment_financing: { label: "Equipment Financing", shortLabel: "Equipment" },
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
