import supabase from "../supabase";
import type {
  FunnelData,
  KPIMetrics,
  DateRange,
  TrendDataPoint,
  VendorPerformance,
  TodayStats,
  LeadSourceData,
  RecentActivity,
} from "../types/analytics";

function toISODate(date: Date): string {
  return date.toISOString();
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDateRangeFilter(dateRange?: DateRange) {
  if (!dateRange) return null;
  return {
    start: toISODate(dateRange.start),
    end: toISODate(dateRange.end),
  };
}

export async function fetchFunnelData(dateRange?: DateRange): Promise<FunnelData> {
  const filter = getDateRangeFilter(dateRange);

  const statuses = [
    "lead", "contacted", "application_submitted", "in_review",
    "approved", "funded", "renewed", "declined",
  ];

  const funnel: FunnelData = {
    lead: 0, contacted: 0, mini_app: 0, full_app: 0,
    in_review: 0, approved: 0, funded: 0, renewed: 0, declined: 0,
  };

  // Fetch all counts in parallel
  const promises = statuses.map(async (status) => {
    let query = supabase
      .from("customers")
      .select("*", { count: "exact", head: true })
      .eq("status", status);

    if (filter) {
      query = query.gte("created_at", filter.start).lte("created_at", filter.end);
    }

    const { count } = await query;
    return { status, count: count || 0 };
  });

  // Also fetch mini_app and full_app counts
  const miniAppPromise = (async () => {
    let query = supabase
      .from("customers")
      .select("*", { count: "exact", head: true })
      .eq("application_type", "mini_app")
      .neq("status", "lead");

    if (filter) {
      query = query.gte("created_at", filter.start).lte("created_at", filter.end);
    }

    const { count } = await query;
    return count || 0;
  })();

  const fullAppPromise = (async () => {
    let query = supabase
      .from("customers")
      .select("*", { count: "exact", head: true })
      .eq("application_type", "full_app");

    if (filter) {
      query = query.gte("created_at", filter.start).lte("created_at", filter.end);
    }

    const { count } = await query;
    return count || 0;
  })();

  const [results, miniApp, fullApp] = await Promise.all([
    Promise.all(promises),
    miniAppPromise,
    fullAppPromise,
  ]);

  for (const { status, count } of results) {
    if (status in funnel) {
      (funnel as unknown as Record<string, number>)[status] = count;
    }
  }

  funnel.mini_app = miniApp;
  funnel.full_app = fullApp;

  return funnel;
}

export async function fetchKPIMetrics(dateRange?: DateRange): Promise<KPIMetrics> {
  const filter = getDateRangeFilter(dateRange);

  // Fetch total leads
  let leadsQuery = supabase.from("customers").select("*", { count: "exact", head: true });
  if (filter) leadsQuery = leadsQuery.gte("created_at", filter.start).lte("created_at", filter.end);
  const { count: totalLeads } = await leadsQuery;

  // Fetch funded deals
  let fundedQuery = supabase.from("customers").select("amount_funded, created_at, funded_at").eq("status", "funded");
  if (filter) fundedQuery = fundedQuery.gte("created_at", filter.start).lte("created_at", filter.end);
  const { data: fundedData } = await fundedQuery;

  // Fetch approved count
  let approvedQuery = supabase.from("customers").select("*", { count: "exact", head: true }).eq("status", "approved");
  if (filter) approvedQuery = approvedQuery.gte("created_at", filter.start).lte("created_at", filter.end);
  const { count: approvedCount } = await approvedQuery;

  // Fetch declined count
  let declinedQuery = supabase.from("customers").select("*", { count: "exact", head: true }).eq("status", "declined");
  if (filter) declinedQuery = declinedQuery.gte("created_at", filter.start).lte("created_at", filter.end);
  const { count: declinedCount } = await declinedQuery;

  // Fetch renewed count
  let renewedQuery = supabase.from("customers").select("*", { count: "exact", head: true }).eq("status", "renewed");
  if (filter) renewedQuery = renewedQuery.gte("created_at", filter.start).lte("created_at", filter.end);
  const { count: renewedCount } = await renewedQuery;

  // Fetch pipeline value (in_review + approved)
  let pipelineQuery = supabase.from("customers").select("amount_requested").in("status", ["in_review", "approved"]);
  if (filter) pipelineQuery = pipelineQuery.gte("created_at", filter.start).lte("created_at", filter.end);
  const { data: pipelineData } = await pipelineQuery;

  // Fetch vendor spend
  const { data: vendorData } = await supabase.from("marketing_vendors").select("total_spend, total_revenue");

  const totalFunded = fundedData?.length || 0;
  const totalFundedAmount = fundedData?.reduce((sum, d) => sum + (d.amount_funded || 0), 0) || 0;
  const totalSpend = vendorData?.reduce((sum, v) => sum + (v.total_spend || 0), 0) || 0;
  const totalRevenue = vendorData?.reduce((sum, v) => sum + (v.total_revenue || 0), 0) || 0;
  const pipelineValue = pipelineData?.reduce((sum, d) => sum + (d.amount_requested || 0), 0) || 0;

  const totalDecisions = totalFunded + (approvedCount || 0) + (declinedCount || 0);

  // Calculate avg days to fund
  let avgDaysToFund = 0;
  if (fundedData && fundedData.length > 0) {
    const daysArr = fundedData
      .filter((d) => d.funded_at && d.created_at)
      .map((d) => {
        const created = new Date(d.created_at).getTime();
        const funded = new Date(d.funded_at).getTime();
        return (funded - created) / (1000 * 60 * 60 * 24);
      })
      .filter((d) => d >= 0);

    if (daysArr.length > 0) {
      avgDaysToFund = daysArr.reduce((a, b) => a + b, 0) / daysArr.length;
    }
  }

  return {
    totalLeads: totalLeads || 0,
    totalFunded,
    totalRevenue,
    totalSpend,
    costPerLead: (totalLeads || 0) > 0 ? totalSpend / (totalLeads || 1) : 0,
    costPerAcquisition: totalFunded > 0 ? totalSpend / totalFunded : 0,
    leadToFundRate: (totalLeads || 0) > 0 ? (totalFunded / (totalLeads || 1)) * 100 : 0,
    avgDealSize: totalFunded > 0 ? totalFundedAmount / totalFunded : 0,
    revenuePerLead: (totalLeads || 0) > 0 ? totalRevenue / (totalLeads || 1) : 0,
    avgDaysToFund,
    approvalRate: totalDecisions > 0 ? ((totalFunded + (approvedCount || 0)) / totalDecisions) * 100 : 0,
    declineRate: totalDecisions > 0 ? ((declinedCount || 0) / totalDecisions) * 100 : 0,
    pipelineValue,
    renewalRate: totalFunded > 0 ? ((renewedCount || 0) / totalFunded) * 100 : 0,
  };
}

export async function fetchVendorPerformance(): Promise<VendorPerformance[]> {
  const { data: vendors } = await supabase
    .from("marketing_vendors")
    .select("id, vendor_name, status, cost_per_lead, total_spend, total_revenue");

  if (!vendors || vendors.length === 0) return [];

  const results: VendorPerformance[] = [];

  for (const vendor of vendors) {
    const { data: customers } = await supabase
      .from("customers")
      .select("status, amount_funded, is_live_transfer, created_at, funded_at")
      .eq("vendor_id", vendor.id);

    const leads = customers || [];
    const funded = leads.filter((c) => c.status === "funded");
    const liveTransfers = leads.filter((c) => c.is_live_transfer);
    const liveTransferFunded = liveTransfers.filter((c) => c.status === "funded");

    const totalFundedAmount = funded.reduce((sum, c) => sum + (c.amount_funded || 0), 0);

    let avgDays = 0;
    const daysArr = funded
      .filter((c) => c.funded_at && c.created_at)
      .map((c) => {
        return (new Date(c.funded_at).getTime() - new Date(c.created_at).getTime()) / (1000 * 60 * 60 * 24);
      })
      .filter((d) => d >= 0);
    if (daysArr.length > 0) {
      avgDays = daysArr.reduce((a, b) => a + b, 0) / daysArr.length;
    }

    results.push({
      vendorId: vendor.id,
      vendorName: vendor.vendor_name,
      vendorStatus: vendor.status,
      totalLeads: leads.length,
      fundedDeals: funded.length,
      conversionRate: leads.length > 0 ? (funded.length / leads.length) * 100 : 0,
      totalSpend: vendor.total_spend || 0,
      totalRevenue: vendor.total_revenue || 0,
      roi: (vendor.total_spend || 0) > 0
        ? (((vendor.total_revenue || 0) - (vendor.total_spend || 0)) / (vendor.total_spend || 1)) * 100
        : 0,
      costPerAcquisition: funded.length > 0 ? (vendor.total_spend || 0) / funded.length : 0,
      avgDealSize: funded.length > 0 ? totalFundedAmount / funded.length : 0,
      avgDaysToFund: avgDays,
      liveTransferLeads: liveTransfers.length,
      liveTransferFunded: liveTransferFunded.length,
    });
  }

  return results;
}

export async function fetchTrendData(
  metric: "leads" | "funded" | "revenue",
  granularity: "daily" | "weekly" | "monthly",
  dateRange?: DateRange
): Promise<TrendDataPoint[]> {
  let query = supabase.from("customers").select("created_at, funded_at, amount_funded, status");

  const filter = getDateRangeFilter(dateRange);
  if (filter) {
    query = query.gte("created_at", filter.start).lte("created_at", filter.end);
  }

  const { data } = await query;
  if (!data || data.length === 0) return [];

  // Group by date bucket
  const buckets = new Map<string, number>();

  for (const row of data) {
    let dateStr: string;
    const date = new Date(row.created_at);

    if (granularity === "daily") {
      dateStr = date.toISOString().split("T")[0];
    } else if (granularity === "weekly") {
      const weekStart = new Date(date);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      dateStr = weekStart.toISOString().split("T")[0];
    } else {
      dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    }

    if (metric === "leads") {
      buckets.set(dateStr, (buckets.get(dateStr) || 0) + 1);
    } else if (metric === "funded" && row.status === "funded") {
      buckets.set(dateStr, (buckets.get(dateStr) || 0) + 1);
    } else if (metric === "revenue" && row.status === "funded") {
      buckets.set(dateStr, (buckets.get(dateStr) || 0) + (row.amount_funded || 0));
    }
  }

  return Array.from(buckets.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchTodayStats(): Promise<TodayStats> {
  const todayStart = toISODate(startOfDay(new Date()));

  // Fetch today's leads
  const { count: newLeadsToday } = await supabase
    .from("customers")
    .select("*", { count: "exact", head: true })
    .gte("created_at", todayStart);

  // Live transfers today
  const { count: liveTransfersToday } = await supabase
    .from("customers")
    .select("*", { count: "exact", head: true })
    .gte("created_at", todayStart)
    .eq("is_live_transfer", true);

  // Live transfer conversions (started application or beyond)
  const { count: liveTransferConversions } = await supabase
    .from("customers")
    .select("*", { count: "exact", head: true })
    .gte("created_at", todayStart)
    .eq("is_live_transfer", true)
    .neq("status", "lead");

  // Applications started today
  const { count: applicationsStartedToday } = await supabase
    .from("customers")
    .select("*", { count: "exact", head: true })
    .gte("application_submitted_at", todayStart);

  // Deals in review (all time, current state)
  const { count: dealsInReview } = await supabase
    .from("customers")
    .select("*", { count: "exact", head: true })
    .eq("status", "in_review");

  // Approved today
  const { count: dealsApprovedToday } = await supabase
    .from("customers")
    .select("*", { count: "exact", head: true })
    .gte("approved_at", todayStart);

  // Funded today
  const { count: dealsFundedToday } = await supabase
    .from("customers")
    .select("*", { count: "exact", head: true })
    .gte("funded_at", todayStart);

  // Pipeline value
  const { data: pipelineData } = await supabase
    .from("customers")
    .select("amount_requested")
    .in("status", ["in_review", "approved"]);

  const totalPipelineValue = pipelineData?.reduce((sum, d) => sum + (d.amount_requested || 0), 0) || 0;

  // Hourly breakdown for today
  const { data: todayLeads } = await supabase
    .from("customers")
    .select("created_at")
    .gte("created_at", todayStart);

  const hourlyMap = new Map<number, number>();
  for (let h = 0; h < 24; h++) hourlyMap.set(h, 0);

  if (todayLeads) {
    for (const lead of todayLeads) {
      const hour = new Date(lead.created_at).getHours();
      hourlyMap.set(hour, (hourlyMap.get(hour) || 0) + 1);
    }
  }

  const hourlyLeads = Array.from(hourlyMap.entries())
    .map(([hour, count]) => ({ hour, count }))
    .sort((a, b) => a.hour - b.hour);

  return {
    newLeadsToday: newLeadsToday || 0,
    liveTransfersToday: liveTransfersToday || 0,
    liveTransferConversions: liveTransferConversions || 0,
    applicationsStartedToday: applicationsStartedToday || 0,
    dealsInReview: dealsInReview || 0,
    dealsApprovedToday: dealsApprovedToday || 0,
    dealsFundedToday: dealsFundedToday || 0,
    totalPipelineValue,
    hourlyLeads,
  };
}

export async function fetchLeadSourceBreakdown(dateRange?: DateRange): Promise<LeadSourceData[]> {
  const filter = getDateRangeFilter(dateRange);

  let query = supabase.from("customers").select("source");
  if (filter) {
    query = query.gte("created_at", filter.start).lte("created_at", filter.end);
  }

  const { data } = await query;
  if (!data) return [];

  const counts = new Map<string, number>();
  for (const row of data) {
    const source = row.source || "unknown";
    counts.set(source, (counts.get(source) || 0) + 1);
  }

  const total = data.length || 1;

  const LABELS: Record<string, string> = {
    website: "Website",
    live_transfer: "Live Transfer",
    aged_lead: "Aged Lead",
    ucc_lead: "UCC Lead",
    referral: "Referral",
    cold_call: "Cold Call",
    cold_email: "Cold Email",
    sms_campaign: "SMS Campaign",
    social_media: "Social Media",
    google_ads: "Google Ads",
    facebook_ads: "Facebook Ads",
    partner_referral: "Partner Referral",
    repeat_customer: "Repeat Customer",
    other: "Other",
    unknown: "Unknown",
  };

  return Array.from(counts.entries())
    .map(([source, count]) => ({
      source,
      label: LABELS[source] || source,
      count,
      percentage: (count / total) * 100,
    }))
    .sort((a, b) => b.count - a.count);
}

export async function fetchRecentActivity(limit = 10): Promise<RecentActivity[]> {
  const { data } = await supabase
    .from("activity_log")
    .select(`
      id, entity_type, entity_id, interaction_type, subject, content, created_at,
      profiles:logged_by (first_name, last_name)
    `)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!data) return [];

  // Fetch entity names for context
  const results: RecentActivity[] = [];
  for (const item of data) {
    let entityName = "";

    if (item.entity_type === "customer") {
      const { data: customer } = await supabase
        .from("customers")
        .select("first_name, last_name, business_name")
        .eq("id", item.entity_id)
        .single();
      entityName = customer
        ? customer.business_name || `${customer.first_name} ${customer.last_name}`
        : "Unknown";
    } else if (item.entity_type === "lender") {
      const { data: lender } = await supabase
        .from("lenders")
        .select("company_name")
        .eq("id", item.entity_id)
        .single();
      entityName = lender?.company_name || "Unknown";
    } else if (item.entity_type === "marketing_vendor") {
      const { data: vendor } = await supabase
        .from("marketing_vendors")
        .select("vendor_name")
        .eq("id", item.entity_id)
        .single();
      entityName = vendor?.vendor_name || "Unknown";
    }

    const profile = item.profiles as unknown as { first_name: string | null; last_name: string | null } | null;

    results.push({
      id: item.id,
      entityType: item.entity_type,
      entityName,
      interactionType: item.interaction_type,
      subject: item.subject,
      content: item.content,
      createdAt: item.created_at,
      loggedByName: profile
        ? `${profile.first_name || ""} ${profile.last_name || ""}`.trim()
        : null,
    });
  }

  return results;
}
