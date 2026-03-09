// Commission & Financial Engine Types

export type PaymentStatus = 'pending' | 'funder_paid' | 'closer_paid' | 'completed' | 'clawback';
export type CloserStatus = 'active' | 'inactive' | 'terminated';
export type SubISOStatus = 'pending' | 'active' | 'suspended' | 'terminated';
export type CommissionLeadSource = 'company' | 'self_generated' | 'sub_iso' | 'renewal';

// Market type is defined in deals.ts — re-export for commission domain consumers
export type { Market } from './deals';
import type { Market } from './deals';

export const MARKET_LABELS: Record<Market, string> = {
  indianapolis: 'Indianapolis, IN',
  phoenix: 'Phoenix/Scottsdale, AZ',
  columbus: 'Columbus/Cincinnati, OH',
  dc: 'Washington DC/NoVA',
  sacramento: 'Sacramento, CA',
  south_florida: 'South Florida',
};

export const PAYMENT_STATUS_CONFIG: Record<PaymentStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800' },
  funder_paid: { label: 'Funder Paid', color: 'bg-blue-100 text-blue-800' },
  closer_paid: { label: 'Closer Paid', color: 'bg-emerald-100 text-emerald-800' },
  completed: { label: 'Completed', color: 'bg-green-100 text-green-800' },
  clawback: { label: 'Clawback', color: 'bg-red-100 text-red-800' },
};

export const CLOSER_STATUS_CONFIG: Record<CloserStatus, { label: string; color: string }> = {
  active: { label: 'Active', color: 'bg-green-100 text-green-800' },
  inactive: { label: 'Inactive', color: 'bg-gray-100 text-gray-600' },
  terminated: { label: 'Terminated', color: 'bg-red-100 text-red-800' },
};

export const SUB_ISO_STATUS_CONFIG: Record<SubISOStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800' },
  active: { label: 'Active', color: 'bg-green-100 text-green-800' },
  suspended: { label: 'Suspended', color: 'bg-orange-100 text-orange-800' },
  terminated: { label: 'Terminated', color: 'bg-red-100 text-red-800' },
};

// Default commission economics from CLAUDE.md
export const COMMISSION_DEFAULTS = {
  AVERAGE_DEAL_SIZE: 50_000,
  NEW_DEAL_POINTS: 8,
  RENEWAL_POINTS: 6,
  COMPANY_LEAD_SPLIT: 50,
  SELF_GEN_SPLIT: 70,
  RENEWAL_SPLIT: 35,
  SUB_ISO_OVERRIDE_POINTS: 2,
  SUB_ISO_KEEPS_POINTS: 6,
} as const;

export interface Closer {
  id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  company_lead_split: number;
  self_gen_split: number;
  renewal_split: number;
  draw_amount: number | null;
  draw_start_date: string | null;
  draw_end_date: string | null;
  status: CloserStatus;
  start_date: string | null;
  end_date: string | null;
  markets: Market[];
  max_leads_per_month: number;
  total_deals_funded: number;
  total_commission_earned: number;
  close_rate: number;
  agreement_signed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CloserFormData {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  company_lead_split: number;
  self_gen_split: number;
  renewal_split: number;
  draw_amount?: number | null;
  draw_start_date?: string | null;
  draw_end_date?: string | null;
  status: CloserStatus;
  start_date?: string | null;
  markets: Market[];
  max_leads_per_month: number;
  notes?: string;
}

export interface SubISO {
  id: string;
  user_id: string | null;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string | null;
  override_points: number;
  platform_fee_monthly: number | null;
  agreement_start_date: string | null;
  agreement_end_date: string | null;
  status: SubISOStatus;
  ghl_sub_account_id: string | null;
  ghl_location_id: string | null;
  total_deals_submitted: number;
  total_deals_funded: number;
  total_commission_earned: number;
  total_override_earned: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface SubISOFormData {
  company_name: string;
  contact_name: string;
  email: string;
  phone?: string;
  override_points: number;
  platform_fee_monthly?: number | null;
  agreement_start_date?: string | null;
  agreement_end_date?: string | null;
  status: SubISOStatus;
  notes?: string;
}

export interface Commission {
  id: string;
  deal_id: string;
  deal_submission_id: string | null;
  gross_commission: number;
  commission_points: number;
  closer_id: string | null;
  closer_split_percentage: number | null;
  closer_amount: number | null;
  company_amount: number | null;
  sub_iso_id: string | null;
  override_points: number | null;
  override_amount: number | null;
  manager_override_percentage: number | null;
  manager_override_amount: number | null;
  payment_status: PaymentStatus;
  funder_paid_at: string | null;
  closer_paid_at: string | null;
  clawback_amount: number;
  clawback_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Joined version with related data for display
export interface CommissionWithDetails extends Commission {
  closer?: Pick<Closer, 'first_name' | 'last_name'> | null;
  sub_iso?: Pick<SubISO, 'company_name'> | null;
  deal?: {
    deal_number: string | null;
    amount_funded: number | null;
    market: string | null;
    deal_type: string | null;
    customer_id: string | null;
  } | null;
}

export interface CommissionSummary {
  totalPending: number;
  totalFunderPaid: number;
  totalCloserPaid: number;
  totalCompleted: number;
  totalClawback: number;
  totalGrossCommission: number;
  totalCompanyRevenue: number;
  totalCloserPayouts: number;
  totalSubISOPayouts: number;
  commissionCount: number;
  thisMonthGross: number;
  thisMonthCompany: number;
}

export interface CommissionFilters {
  paymentStatus?: PaymentStatus;
  closerId?: string;
  subISOId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface CloserCommissionSummary {
  closer: Closer;
  totalDeals: number;
  totalFunded: number;
  closeRate: number;
  totalGrossCommission: number;
  totalCloserPayout: number;
  avgDealSize: number;
  thisMonthDeals: number;
  thisMonthCommission: number;
}

export interface MonthlyCommissionData {
  month: string;
  gross: number;
  company: number;
  closerPayouts: number;
  subISOPayouts: number;
}
