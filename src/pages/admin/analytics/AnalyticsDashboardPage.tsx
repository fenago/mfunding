import { useState } from "react";
import {
  UsersIcon,
  CurrencyDollarIcon,
  ChartBarIcon,
  BanknotesIcon,
  ArrowTrendingUpIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { useAnalyticsDashboard } from "../../../hooks/useAnalytics";
import KPICard from "../../../components/analytics/KPICard";
import FunnelChart from "../../../components/analytics/FunnelChart";
import TrendLineChart from "../../../components/analytics/TrendLineChart";
import LeadSourcePieChart from "../../../components/analytics/LeadSourcePieChart";
import VendorROITable from "../../../components/analytics/VendorROITable";
import DateRangePicker, { getDefaultDateRange } from "../../../components/analytics/DateRangePicker";
import type { DateRange } from "../../../types/analytics";
import { useTheme } from "../../../lib/theme-context";

const FUNNEL_COLORS_LIGHT = [
  "#0A2342", // lead - midnight blue
  "#0C516E", // contacted - deep sea
  "#007EA7", // mini app - ocean blue
  "#0097A7", // full app
  "#00A896", // in review - teal
  "#00C49F", // approved
  "#00D49D", // funded - mint green
  "#4CAF50", // renewed - green
];

const FUNNEL_COLORS_DARK = [
  "#3B82F6", // lead - blue-500 (visible on dark bg)
  "#0EA5E9", // contacted - sky-500
  "#06B6D4", // mini app - cyan-500
  "#14B8A6", // full app - teal-500
  "#10B981", // in review - emerald-500
  "#22C55E", // approved - green-500
  "#00D49D", // funded - mint green
  "#4ADE80", // renewed - green-400
];

export default function AnalyticsDashboardPage() {
  const { resolved: theme } = useTheme();
  const FUNNEL_COLORS = theme === "dark" ? FUNNEL_COLORS_DARK : FUNNEL_COLORS_LIGHT;
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange());

  const {
    funnelData,
    kpiMetrics,
    vendorPerformance,
    leadTrend,
    fundedTrend,
    leadSources,
    isLoading,
  } = useAnalyticsDashboard(dateRange);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  const funnelStages = funnelData
    ? [
        { name: "Leads", value: funnelData.lead, color: FUNNEL_COLORS[0] },
        { name: "Contacted", value: funnelData.contacted, color: FUNNEL_COLORS[1] },
        { name: "Mini App", value: funnelData.mini_app, color: FUNNEL_COLORS[2] },
        { name: "Full App", value: funnelData.full_app, color: FUNNEL_COLORS[3] },
        { name: "In Review", value: funnelData.in_review, color: FUNNEL_COLORS[4] },
        { name: "Approved", value: funnelData.approved, color: FUNNEL_COLORS[5] },
        { name: "Funded", value: funnelData.funded, color: FUNNEL_COLORS[6] },
        { name: "Renewed", value: funnelData.renewed, color: FUNNEL_COLORS[7] },
      ]
    : [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Analytics Dashboard
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Funnel performance and key business metrics
          </p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      {/* KPI Cards */}
      {kpiMetrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard
            label="Total Leads"
            value={kpiMetrics.totalLeads}
            icon={UsersIcon}
            color="bg-blue-500"
            format="number"
          />
          <KPICard
            label="Cost Per Lead"
            value={kpiMetrics.costPerLead}
            icon={CurrencyDollarIcon}
            color="bg-purple-500"
            format="currency"
          />
          <KPICard
            label="Cost Per Acquisition"
            value={kpiMetrics.costPerAcquisition}
            icon={CurrencyDollarIcon}
            color="bg-orange-500"
            format="currency"
          />
          <KPICard
            label="Lead-to-Fund Rate"
            value={kpiMetrics.leadToFundRate}
            icon={ChartBarIcon}
            color="bg-green-500"
            format="percent"
          />
          <KPICard
            label="Avg Deal Size"
            value={kpiMetrics.avgDealSize}
            icon={BanknotesIcon}
            color="bg-emerald-500"
            format="currency"
          />
          <KPICard
            label="Revenue Per Lead"
            value={kpiMetrics.revenuePerLead}
            icon={ArrowTrendingUpIcon}
            color="bg-teal-500"
            format="currency"
          />
          <KPICard
            label="Avg Days to Fund"
            value={kpiMetrics.avgDaysToFund}
            icon={ClockIcon}
            color="bg-indigo-500"
            format="days"
          />
          <KPICard
            label="Pipeline Value"
            value={kpiMetrics.pipelineValue}
            icon={CurrencyDollarIcon}
            color="bg-cyan-500"
            format="currency"
          />
        </div>
      )}

      {/* Secondary KPIs */}
      {kpiMetrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard
            label="Approval Rate"
            value={kpiMetrics.approvalRate}
            icon={CheckCircleIcon}
            color="bg-green-500"
            format="percent"
          />
          <KPICard
            label="Decline Rate"
            value={kpiMetrics.declineRate}
            icon={XCircleIcon}
            color="bg-red-500"
            format="percent"
          />
          <KPICard
            label="Renewal Rate"
            value={kpiMetrics.renewalRate}
            icon={ArrowTrendingUpIcon}
            color="bg-teal-500"
            format="percent"
          />
          <KPICard
            label="Total Funded"
            value={kpiMetrics.totalFunded}
            subValue={`$${kpiMetrics.totalRevenue.toLocaleString()} revenue`}
            icon={BanknotesIcon}
            color="bg-emerald-500"
            format="number"
          />
        </div>
      )}

      {/* Funnel */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
          Conversion Funnel
        </h2>
        <FunnelChart data={funnelStages} />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lead Trend */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
            Leads Over Time
          </h3>
          <TrendLineChart
            data={leadTrend}
            color="#007EA7"
            label="Leads"
          />
        </div>

        {/* Funded Trend */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
            Funded Deals Over Time
          </h3>
          <TrendLineChart
            data={fundedTrend}
            color="#00D49D"
            label="Funded"
          />
        </div>
      </div>

      {/* Lead Source + Vendor ROI Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lead Source Breakdown */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
            Lead Sources
          </h3>
          <LeadSourcePieChart data={leadSources} />
        </div>

        {/* Vendor ROI Table */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
            Vendor Performance
          </h3>
          <VendorROITable data={vendorPerformance} />
        </div>
      </div>
    </div>
  );
}
