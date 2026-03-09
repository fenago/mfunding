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
  MapPinIcon,
} from "@heroicons/react/24/outline";
import { useMarketPerformance } from "../../../hooks/useAnalytics";
import AnalyticsTabNav from "../../../components/analytics/AnalyticsTabNav";

const TOOLTIP_STYLE = {
  backgroundColor: "#21262D",
  border: "1px solid #30363D",
  borderRadius: "8px",
  fontSize: "12px",
  color: "#F0F6FC",
};

// Target markets from CLAUDE.md
const TARGET_MARKETS = [
  { key: "indianapolis", label: "Indianapolis, IN", budget: "20%" },
  { key: "phoenix", label: "Phoenix, AZ", budget: "20%" },
  { key: "columbus", label: "Columbus, OH", budget: "20%" },
  { key: "dc", label: "Washington DC", budget: "15%" },
  { key: "sacramento", label: "Sacramento, CA", budget: "10%" },
  { key: "south_florida", label: "South Florida", budget: "15%" },
];

export default function MarketPerformancePage() {
  const { markets, isLoading } = useMarketPerformance();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  // Map data to target markets, filling in zeros for markets with no data
  const marketData = TARGET_MARKETS.map((tm) => {
    const found = markets.find((m) => m.market === tm.key);
    return {
      market: tm.key,
      label: tm.label,
      budget: tm.budget,
      totalLeads: found?.totalLeads || 0,
      totalFunded: found?.totalFunded || 0,
      totalLost: found?.totalLost || 0,
      closeRate: found?.closeRate || 0,
      totalRevenue: found?.totalRevenue || 0,
      avgDealSize: found?.avgDealSize || 0,
      avgDaysToFund: found?.avgDaysToFund || null,
      leadsThisMonth: found?.leadsThisMonth || 0,
      fundedThisMonth: found?.fundedThisMonth || 0,
    };
  });

  const hasData = marketData.some((m) => m.totalLeads > 0);

  const chartData = marketData.map((m) => ({
    name: m.label.split(",")[0], // Just city name for chart
    leads: m.totalLeads,
    funded: m.totalFunded,
    revenue: m.totalRevenue,
  }));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Market Performance
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Compare the 6 target markets: leads, funded deals, revenue, and ROI
        </p>
      </div>

      {/* Tab Navigation */}
      <AnalyticsTabNav />

      {!hasData ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-12 shadow-sm border border-gray-200 dark:border-gray-700 text-center">
          <MapPinIcon className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No market data yet
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            Market performance will populate as deals are created with market assignments.
            The 6 target markets are listed below with their budget allocations.
          </p>
        </div>
      ) : (
        <>
          {/* Market Comparison Chart */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
              Leads vs Funded by Market
            </h3>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#9CA3AF" }} />
                <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} allowDecimals={false} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value: number | undefined, name?: string) => {
                    const v = value ?? 0;
                    if (name === "leads") return [v, "Leads"];
                    if (name === "funded") return [v, "Funded"];
                    return [`$${v.toLocaleString()}`, "Revenue"];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Bar dataKey="leads" fill="#007EA7" radius={[4, 4, 0, 0]} name="leads" />
                <Bar dataKey="funded" fill="#22C55E" radius={[4, 4, 0, 0]} name="funded" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* Market Table (always shown) */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
          Market Scorecard
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Market</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Budget</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Leads</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Funded</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Close Rate</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Revenue</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Avg Deal</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Avg Days</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">This Month</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {marketData.map((m) => (
                <tr key={m.market} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <MapPinIcon className="w-4 h-4 text-ocean-blue" />
                      <span className="font-medium text-gray-900 dark:text-white">{m.label}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-gray-700 dark:text-gray-300">
                    <span className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded text-xs font-medium">
                      {m.budget}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-gray-700 dark:text-gray-300">{m.totalLeads}</td>
                  <td className="px-3 py-3 text-gray-700 dark:text-gray-300">{m.totalFunded}</td>
                  <td className="px-3 py-3">
                    <span className={`font-medium ${m.closeRate >= 12 ? "text-green-600" : m.closeRate >= 8 ? "text-yellow-600" : m.totalLeads === 0 ? "text-gray-400" : "text-red-600"}`}>
                      {m.totalLeads > 0 ? `${m.closeRate.toFixed(1)}%` : "--"}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-medium text-gray-900 dark:text-white">
                    {m.totalRevenue > 0 ? `$${m.totalRevenue.toLocaleString()}` : "--"}
                  </td>
                  <td className="px-3 py-3 text-gray-700 dark:text-gray-300">
                    {m.avgDealSize > 0 ? `$${(m.avgDealSize / 1000).toFixed(1)}K` : "--"}
                  </td>
                  <td className="px-3 py-3 text-gray-700 dark:text-gray-300">
                    {m.avgDaysToFund != null ? `${m.avgDaysToFund.toFixed(1)}d` : "--"}
                  </td>
                  <td className="px-3 py-3 text-gray-700 dark:text-gray-300">
                    {m.leadsThisMonth > 0 ? `${m.leadsThisMonth} leads / ${m.fundedThisMonth} funded` : "--"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
