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
  DealFunnelStage,
  PipelineVelocity,
  CloserPerformance,
  LenderPerformance,
  MarketPerformance,
  MonthlyRevenue,
  LeadSourceROI,
  CostPerFundedDealCard,
} from "../types/analytics";
import {
  fetchFunnelData,
  fetchKPIMetrics,
  fetchVendorPerformance,
  fetchTrendData,
  fetchTodayStats,
  fetchLeadSourceBreakdown,
  fetchRecentActivity,
  fetchDealFunnelMetrics,
  fetchPipelineVelocity,
  fetchCloserPerformance,
  fetchLenderPerformance,
  fetchMarketPerformance,
  fetchMonthlyRevenue,
  fetchLeadSourceROI,
  fetchCostPerFundedDeal,
  fetchCloseRateTrend,
} from "../services/analyticsService";

export function useAnalyticsDashboard(dateRange: DateRange) {
  const [funnelData, setFunnelData] = useState<FunnelData | null>(null);
  const [kpiMetrics, setKpiMetrics] = useState<KPIMetrics | null>(null);
  const [vendorPerformance, setVendorPerformance] = useState<VendorPerformance[]>([]);
  const [leadTrend, setLeadTrend] = useState<TrendDataPoint[]>([]);
  const [fundedTrend, setFundedTrend] = useState<TrendDataPoint[]>([]);
  const [leadSources, setLeadSources] = useState<LeadSourceData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // ⚠ The catch below used to be console.error alone, so a failed load left
  // every panel empty with nothing on screen saying the numbers were never
  // fetched. A dashboard that cannot read its sources must say so — "no data"
  // and "we couldn't load it" are different claims, and only one of them is
  // about the business.
  const [loadError, setLoadError] = useState<string | null>(null);

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
      setLoadError(null);
    } catch (error) {
      console.error("Error fetching analytics:", error);
      setLoadError(error instanceof Error ? error.message : "The analytics reads failed.");
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
    loadError,
    refetch: fetchAll,
  };
}

export function useRealTimeDashboard(autoRefreshMs = 30000) {
  const [todayStats, setTodayStats] = useState<TodayStats | null>(null);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Same for the realtime strip, and it matters more here: this one
  // auto-refreshes every 30s, so a silent failure keeps a zeroed board looking
  // live and current.
  const [loadError, setLoadError] = useState<string | null>(null);
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
      setLoadError(null);
    } catch (error) {
      console.error("Error fetching real-time stats:", error);
      setLoadError(error instanceof Error ? error.message : "The realtime reads failed.");
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
    loadError,
    refetch: fetchAll,
  };
}

export function useDealAnalytics(dateRange: DateRange) {
  const [dealFunnel, setDealFunnel] = useState<DealFunnelStage[]>([]);
  const [pipelineVelocity, setPipelineVelocity] = useState<PipelineVelocity[]>([]);
  const [monthlyRevenue, setMonthlyRevenue] = useState<MonthlyRevenue[]>([]);
  const [closeRateTrend, setCloseRateTrend] = useState<TrendDataPoint[]>([]);
  const [costPerDealBySource, setCostPerDealBySource] = useState<CostPerFundedDealCard[]>([]);
  const [costPerDealByMarket, setCostPerDealByMarket] = useState<CostPerFundedDealCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Deal analytics feeds the ⭐ cost-per-funded-deal cards; an empty card from
  // a failed read reads as "nothing costs anything".
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [funnel, velocity, revenue, closeRate, bySource, byMarket] = await Promise.all([
        fetchDealFunnelMetrics(dateRange),
        fetchPipelineVelocity(),
        fetchMonthlyRevenue(dateRange),
        fetchCloseRateTrend(dateRange),
        fetchCostPerFundedDeal("source"),
        fetchCostPerFundedDeal("market"),
      ]);

      setDealFunnel(funnel);
      setPipelineVelocity(velocity);
      setMonthlyRevenue(revenue);
      setCloseRateTrend(closeRate);
      setCostPerDealBySource(bySource);
      setCostPerDealByMarket(byMarket);
      setLoadError(null);
    } catch (error) {
      console.error("Error fetching deal analytics:", error);
      setLoadError(error instanceof Error ? error.message : "The deal-analytics reads failed.");
    }
    setIsLoading(false);
  }, [dateRange]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return {
    dealFunnel,
    pipelineVelocity,
    monthlyRevenue,
    closeRateTrend,
    costPerDealBySource,
    costPerDealByMarket,
    isLoading,
    loadError,
    refetch: fetchAll,
  };
}

export function useCloserPerformance() {
  const [closers, setClosers] = useState<CloserPerformance[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchCloserPerformance();
        setClosers(data);
      } catch (error) {
        console.error("Error fetching closer performance:", error);
      }
      setIsLoading(false);
    })();
  }, []);

  return { closers, isLoading };
}

export function useLenderPerformance() {
  const [lenders, setLenders] = useState<LenderPerformance[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchLenderPerformance();
        setLenders(data);
      } catch (error) {
        console.error("Error fetching lender performance:", error);
      }
      setIsLoading(false);
    })();
  }, []);

  return { lenders, isLoading };
}

export function useMarketPerformance() {
  const [markets, setMarkets] = useState<MarketPerformance[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchMarketPerformance();
        setMarkets(data);
      } catch (error) {
        console.error("Error fetching market performance:", error);
      }
      setIsLoading(false);
    })();
  }, []);

  return { markets, isLoading };
}

export function useLeadSourceROI() {
  const [sources, setSources] = useState<LeadSourceROI[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchLeadSourceROI();
        setSources(data);
      } catch (error) {
        console.error("Error fetching lead source ROI:", error);
      }
      setIsLoading(false);
    })();
  }, []);

  return { sources, isLoading };
}
