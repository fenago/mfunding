import { useState, useEffect, useCallback, useRef } from "react";
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
import {
  fetchFunnelData,
  fetchKPIMetrics,
  fetchVendorPerformance,
  fetchTrendData,
  fetchTodayStats,
  fetchLeadSourceBreakdown,
  fetchRecentActivity,
} from "../services/analyticsService";

export function useAnalyticsDashboard(dateRange: DateRange) {
  const [funnelData, setFunnelData] = useState<FunnelData | null>(null);
  const [kpiMetrics, setKpiMetrics] = useState<KPIMetrics | null>(null);
  const [vendorPerformance, setVendorPerformance] = useState<VendorPerformance[]>([]);
  const [leadTrend, setLeadTrend] = useState<TrendDataPoint[]>([]);
  const [fundedTrend, setFundedTrend] = useState<TrendDataPoint[]>([]);
  const [leadSources, setLeadSources] = useState<LeadSourceData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [funnel, kpis, vendors, leads, funded, sources] = await Promise.all([
        fetchFunnelData(dateRange),
        fetchKPIMetrics(dateRange),
        fetchVendorPerformance(),
        fetchTrendData("leads", "daily", dateRange),
        fetchTrendData("funded", "daily", dateRange),
        fetchLeadSourceBreakdown(dateRange),
      ]);

      setFunnelData(funnel);
      setKpiMetrics(kpis);
      setVendorPerformance(vendors);
      setLeadTrend(leads);
      setFundedTrend(funded);
      setLeadSources(sources);
    } catch (error) {
      console.error("Error fetching analytics:", error);
    }
    setIsLoading(false);
  }, [dateRange]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return {
    funnelData,
    kpiMetrics,
    vendorPerformance,
    leadTrend,
    fundedTrend,
    leadSources,
    isLoading,
    refetch: fetchAll,
  };
}

export function useRealTimeDashboard(autoRefreshMs = 30000) {
  const [todayStats, setTodayStats] = useState<TodayStats | null>(null);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [stats, activity] = await Promise.all([
        fetchTodayStats(),
        fetchRecentActivity(15),
      ]);

      setTodayStats(stats);
      setRecentActivity(activity);
      setLastUpdated(new Date());
    } catch (error) {
      console.error("Error fetching real-time stats:", error);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();

    if (autoRefreshMs > 0) {
      intervalRef.current = setInterval(fetchAll, autoRefreshMs);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchAll, autoRefreshMs]);

  return {
    todayStats,
    recentActivity,
    isLoading,
    lastUpdated,
    refetch: fetchAll,
  };
}
