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
