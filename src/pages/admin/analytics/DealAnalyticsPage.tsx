import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
} from "recharts";
import {
  CurrencyDollarIcon,
  ChartBarIcon,
  ClockIcon,
  ArrowTrendingUpIcon,
} from "@heroicons/react/24/outline";
import { useDealAnalytics } from "../../../hooks/useAnalytics";
import DateRangePicker, { getDefaultDateRange } from "../../../components/analytics/DateRangePicker";
import KPICard from "../../../components/analytics/KPICard";
import FunnelChart from "../../../components/analytics/FunnelChart";
import type { DateRange } from "../../../types/analytics";
import AnalyticsTabNav from "../../../components/analytics/AnalyticsTabNav";

const TOOLTIP_STYLE = {
  backgroundColor: "#21262D",
  border: "1px solid #30363D",
  borderRadius: "8px",
  fontSize: "12px",
  color: "#F0F6FC",
};

export default function DealAnalyticsPage() {
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange());
  const {
    dealFunnel,
    pipelineVelocity,
    monthlyRevenue,
    closeRateTrend,
    costPerDealBySource,
    costPerDealByMarket,
    isLoading,
  } = useDealAnalytics(dateRange);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  const totalFunded = dealFunnel.find((s) => s.stage === "funded")?.count || 0;
  const totalLeads = dealFunnel.find((s) => s.stage === "new")?.count || 0;
  const totalRevenue = monthlyRevenue.reduce((sum, m) => sum + m.totalFundedAmount, 0);
  const avgVelocity = pipelineVelocity.find((v) => v.stageTransition === "total_lead_to_funded");

  // Filter out the "total" row from velocity for the bar chart
  const velocityChartData = pipelineVelocity
    .filter((v) => v.stageTransition !== "total_lead_to_funded" && v.avgDays !== null)
    .map((v) => ({
      name: v.stageLabel,
      days: Number(v.avgDays?.toFixed(1)) || 0,
      count: v.sampleSize,
    }));

  const revenueChartData = monthlyRevenue.map((m) => ({
    month: m.month,
    revenue: m.totalFundedAmount,
    deals: m.dealsFunded,
  }));

  const closeRateData = closeRateTrend.map((d) => ({
    date: d.date,
    rate: Number(d.value.toFixed(1)),
  }));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Deal Analytics
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Pipeline performance, velocity, and revenue tracking
          </p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {/* Tab Navigation */}
      <AnalyticsTabNav />

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          label="Total Deals"
          value={totalLeads}
          icon={ChartBarIcon}
          color="bg-blue-500"
          format="number"
        />
        <KPICard
          label="Deals Funded"
          value={totalFunded}
          icon={CurrencyDollarIcon}
          color="bg-green-500"
          format="number"
        />
        <KPICard
          label="Total Revenue"
          value={totalRevenue}
          icon={CurrencyDollarIcon}
          color="bg-emerald-500"
          format="currency"
        />
        <KPICard
          label="Avg Days to Fund"
          value={avgVelocity?.avgDays ?? 0}
          icon={ClockIcon}
          color="bg-indigo-500"
          format="days"
        />
      </div>

      {/* Deal Funnel */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
          Deal Pipeline Funnel
        </h2>
        {dealFunnel.length > 0 ? (
          <FunnelChart data={dealFunnel.map((s) => ({ name: s.label, value: s.count, color: s.color }))} />
        ) : (
          <EmptyState message="No deal data yet. Deals will appear here as they flow through the pipeline." />
        )}
      </div>

      {/* Cost Per Funded Deal */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Source */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
            Cost Per Funded Deal by Source
          </h3>
          {costPerDealBySource.length > 0 ? (
            <div className="space-y-3">
              {costPerDealBySource.map((item) => (
                <div key={item.label} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{item.label}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{item.totalFunded} deals funded</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-gray-900 dark:text-white">
                      {item.costPerDeal != null ? `$${item.costPerDeal.toLocaleString()}` : "--"}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      ${item.totalSpend.toLocaleString()} spent
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No lead source data yet." />
          )}
        </div>

        {/* By Market */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
            Deals Funded by Market
          </h3>
          {costPerDealByMarket.length > 0 ? (
            <div className="space-y-3">
              {costPerDealByMarket.map((item) => (
                <div key={item.label} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{item.label}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{item.totalFunded} funded</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-gray-900 dark:text-white">
                      {item.costPerDeal != null ? `$${item.costPerDeal.toLocaleString()}` : "--"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No market data yet. Deals will appear here as they are assigned to markets." />
          )}
        </div>
      </div>

      {/* Pipeline Velocity */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
          Pipeline Velocity (Avg Days Per Stage)
        </h3>
        {velocityChartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={velocityChartData} margin={{ top: 5, right: 20, left: 10, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: "#9CA3AF" }}
                angle={-30}
                textAnchor="end"
                height={60}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#9CA3AF" }}
                label={{ value: "Days", angle: -90, position: "insideLeft", fill: "#9CA3AF", fontSize: 11 }}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value: number | undefined) => [`${value ?? 0} days`, "Avg Days"]}
              />
              <Bar dataKey="days" fill="#007EA7" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState message="No pipeline velocity data yet. Metrics will appear as deals progress through stages." />
        )}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Close Rate Trend */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-4">
            <ArrowTrendingUpIcon className="w-5 h-5 text-green-500" />
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              Close Rate Trend
            </h3>
          </div>
          {closeRateData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={closeRateData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9CA3AF" }} />
                <YAxis
                  tick={{ fontSize: 11, fill: "#9CA3AF" }}
                  tickFormatter={(v) => `${v}%`}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value: number | undefined) => [`${value ?? 0}%`, "Close Rate"]}
                />
                <Line
                  type="monotone"
                  dataKey="rate"
                  stroke="#22C55E"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "#22C55E" }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No close rate data yet." />
          )}
        </div>

        {/* Revenue by Month */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-4">
            <CurrencyDollarIcon className="w-5 h-5 text-emerald-500" />
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              Revenue by Month
            </h3>
          </div>
          {revenueChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={revenueChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00D49D" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#00D49D" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9CA3AF" }} />
                <YAxis
                  tick={{ fontSize: 11, fill: "#9CA3AF" }}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value: number | undefined, name?: string) => [
                    name === "revenue" ? `$${(value ?? 0).toLocaleString()}` : (value ?? 0),
                    name === "revenue" ? "Revenue" : "Deals",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#00D49D"
                  strokeWidth={2}
                  fill="url(#revenueGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No revenue data yet. Revenue will appear as deals are funded." />
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <ChartBarIcon className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-3" />
      <p className="text-sm text-gray-400 dark:text-gray-500 max-w-sm">
        {message}
      </p>
    </div>
  );
}
