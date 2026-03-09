import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  FunnelIcon,
} from "@heroicons/react/24/outline";
import { useLeadSourceROI } from "../../../hooks/useAnalytics";
import AnalyticsTabNav from "../../../components/analytics/AnalyticsTabNav";

const TOOLTIP_STYLE = {
  backgroundColor: "#21262D",
  border: "1px solid #30363D",
  borderRadius: "8px",
  fontSize: "12px",
  color: "#F0F6FC",
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  live_transfer: "Live Transfer",
  google_ads: "Google Ads",
  aged_lead: "Aged Lead",
  ucc_filing: "UCC Filing",
  referral: "Referral",
  sub_iso: "Sub-ISO",
  organic: "Organic",
  social_media: "Social Media",
  other: "Other",
};

const SOURCE_TYPE_COLORS: Record<string, string> = {
  live_transfer: "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  google_ads: "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
  aged_lead: "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  ucc_filing: "bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400",
  referral: "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400",
  sub_iso: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/20 dark:text-cyan-400",
  organic: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  social_media: "bg-pink-100 text-pink-700 dark:bg-pink-900/20 dark:text-pink-400",
  other: "bg-gray-100 text-gray-700 dark:bg-gray-900/20 dark:text-gray-400",
};

export default function LeadSourceROIPage() {
  const { sources, isLoading } = useLeadSourceROI();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  // Aggregate by source type for the chart
  const byType = new Map<string, { leads: number; funded: number; spend: number; revenue: number }>();
  for (const s of sources) {
    const existing = byType.get(s.sourceType) || { leads: 0, funded: 0, spend: 0, revenue: 0 };
    existing.leads += s.totalLeads;
    existing.funded += s.totalFunded;
    existing.spend += s.totalSpend;
    existing.revenue += s.totalRevenue;
    byType.set(s.sourceType, existing);
  }

  const chartData = Array.from(byType.entries()).map(([type, stats]) => ({
    name: SOURCE_TYPE_LABELS[type] || type,
    leads: stats.leads,
    funded: stats.funded,
    spend: stats.spend,
    revenue: stats.revenue,
    roi: stats.spend > 0 ? ((stats.revenue - stats.spend) / stats.spend) * 100 : 0,
  }));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Lead Source ROI
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Compare lead sources by cost, revenue, and return on investment
        </p>
      </div>

      {/* Tab Navigation */}
      <AnalyticsTabNav />

      {sources.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-12 shadow-sm border border-gray-200 dark:border-gray-700 text-center">
          <FunnelIcon className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No lead source data yet
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            Lead source ROI will appear here once lead sources are configured and tracking spend/revenue.
            Add lead sources in the lead_sources table to start tracking.
          </p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {sources.reduce((s, src) => s + src.totalLeads, 0).toLocaleString()}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Total Leads</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
              <p className="text-2xl font-bold text-green-600">
                {sources.reduce((s, src) => s + src.totalFunded, 0)}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Total Funded</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                ${sources.reduce((s, src) => s + src.totalSpend, 0).toLocaleString()}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Total Spend</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
              <p className="text-2xl font-bold text-emerald-600">
                ${sources.reduce((s, src) => s + src.totalRevenue, 0).toLocaleString()}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Total Revenue</p>
            </div>
          </div>

          {/* ROI by Source Type Chart */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
              Spend vs Revenue by Source Type
            </h3>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#9CA3AF" }} />
                <YAxis
                  tick={{ fontSize: 11, fill: "#9CA3AF" }}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value: number | undefined, name?: string) => {
                    const v = value ?? 0;
                    if (name === "spend") return [`$${v.toLocaleString()}`, "Spend"];
                    if (name === "revenue") return [`$${v.toLocaleString()}`, "Revenue"];
                    return [v, name || ""];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Bar dataKey="spend" fill="#EF4444" radius={[4, 4, 0, 0]} name="spend" />
                <Bar dataKey="revenue" fill="#22C55E" radius={[4, 4, 0, 0]} name="revenue" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Source Detail Table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
              Lead Source Detail
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Source</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Leads</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Funded</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Spend</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Revenue</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Cost/Deal</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">ROI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {sources.map((source) => (
                    <tr key={source.sourceId} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="px-3 py-3 font-medium text-gray-900 dark:text-white whitespace-nowrap">
                        {source.sourceName}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${SOURCE_TYPE_COLORS[source.sourceType] || SOURCE_TYPE_COLORS.other}`}>
                          {SOURCE_TYPE_LABELS[source.sourceType] || source.sourceType}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-gray-700 dark:text-gray-300">{source.totalLeads}</td>
                      <td className="px-3 py-3 text-gray-700 dark:text-gray-300">{source.totalFunded}</td>
                      <td className="px-3 py-3 text-gray-700 dark:text-gray-300">
                        ${source.totalSpend.toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-gray-700 dark:text-gray-300">
                        ${source.totalRevenue.toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-gray-700 dark:text-gray-300">
                        {source.costPerFundedDeal != null ? `$${source.costPerFundedDeal.toLocaleString()}` : "--"}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`font-medium ${(source.roiPercentage ?? 0) > 0 ? "text-green-600" : (source.roiPercentage ?? 0) < 0 ? "text-red-600" : "text-gray-400"}`}>
                          {source.roiPercentage != null ? `${source.roiPercentage.toFixed(0)}%` : "--"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
