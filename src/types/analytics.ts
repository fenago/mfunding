export interface FunnelData {
  lead: number;
  contacted: number;
  mini_app: number;
  full_app: number;
  in_review: number;
  approved: number;
  funded: number;
  renewed: number;
  declined: number;
}

export interface KPIMetrics {
  totalLeads: number;
  totalFunded: number;
  totalRevenue: number;
  totalSpend: number;
  costPerLead: number;
  costPerAcquisition: number;
  leadToFundRate: number;
  avgDealSize: number;
  revenuePerLead: number;
  avgDaysToFund: number;
  approvalRate: number;
  declineRate: number;
  pipelineValue: number;
  renewalRate: number;
}

export interface DateRange {
  start: Date;
  end: Date;
  preset?: "today" | "this_week" | "this_month" | "this_quarter" | "this_year" | "all_time" | "custom";
}

export interface TrendDataPoint {
  date: string;
  value: number;
  label?: string;
}

export interface VendorPerformance {
  vendorId: string;
  vendorName: string;
  vendorStatus: string;
  totalLeads: number;
  fundedDeals: number;
  conversionRate: number;
  totalSpend: number;
  totalRevenue: number;
  roi: number;
  costPerAcquisition: number;
  avgDealSize: number;
  avgDaysToFund: number;
  liveTransferLeads: number;
  liveTransferFunded: number;
}

export interface TodayStats {
  newLeadsToday: number;
  liveTransfersToday: number;
  liveTransferConversions: number;
  applicationsStartedToday: number;
  dealsInReview: number;
  dealsApprovedToday: number;
  dealsFundedToday: number;
  totalPipelineValue: number;
  hourlyLeads: { hour: number; count: number }[];
}

export interface LeadSourceData {
  source: string;
  label: string;
  count: number;
  percentage: number;
}

export interface RecentActivity {
  id: string;
  entityType: string;
  entityName: string;
  interactionType: string;
  subject: string | null;
  content: string | null;
  createdAt: string;
  loggedByName: string | null;
}

// ===== Deal-Level Analytics Types =====

export interface LeadSource {
  id: string;
  name: string;
  type: LeadSourceType;
  vendorId: string | null;
  costPerLead: number | null;
  monthlyBudget: number | null;
  totalLeads: number;
  totalFunded: number;
  totalSpend: number;
  totalRevenue: number;
  costPerFundedDeal: number | null;
  roiPercentage: number | null;
  status: string;
}

export type LeadSourceType =
  | "live_transfer"
  | "google_ads"
  | "aged_lead"
  | "ucc_filing"
  | "referral"
  | "sub_iso"
  | "organic"
  | "social_media"
  | "other";

export interface PipelineVelocity {
  stageTransition: string;
  stageLabel: string;
  avgDays: number | null;
  sampleSize: number;
}

export interface DealFunnelStage {
  stage: string;
  label: string;
  count: number;
  color: string;
}

export interface CloserPerformance {
  closerId: string;
  closerName: string;
  totalLeadsAssigned: number;
  totalDealsFunded: number;
  totalDealsLost: number;
  closeRate: number;
  totalRevenue: number;
  avgDealSize: number;
  avgDaysToFund: number | null;
  dealsThisMonth: number;
  revenueThisMonth: number;
}

export interface LenderPerformance {
  lenderId: string;
  lenderName: string;
  totalSubmissions: number;
  totalApproved: number;
  totalDeclined: number;
  totalFunded: number;
  approvalRate: number;
  avgOfferAmount: number;
  avgFactorRate: number;
  avgCommissionPoints: number;
  avgResponseDays: number | null;
}

export interface MarketPerformance {
  market: string;
  marketLabel: string;
  totalLeads: number;
  totalFunded: number;
  totalLost: number;
  closeRate: number;
  totalRevenue: number;
  avgDealSize: number;
  avgDaysToFund: number | null;
  leadsThisMonth: number;
  fundedThisMonth: number;
}

export interface MonthlyRevenue {
  month: string;
  dealsFunded: number;
  totalFundedAmount: number;
  avgDealSize: number;
  mcaDeals: number;
  termLoanDeals: number;
  locDeals: number;
  sbaDeals: number;
  equipmentDeals: number;
  renewalDeals: number;
  newDeals: number;
}

export interface LeadSourceROI {
  sourceId: string;
  sourceName: string;
  sourceType: LeadSourceType;
  totalLeads: number;
  totalFunded: number;
  totalSpend: number;
  totalRevenue: number;
  costPerFundedDeal: number | null;
  roiPercentage: number | null;
}

export interface CostPerFundedDealCard {
  label: string;
  costPerDeal: number | null;
  totalFunded: number;
  totalSpend: number;
}
