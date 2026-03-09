import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  UserGroupIcon,
  TrophyIcon,
} from "@heroicons/react/24/outline";
import { useCloserPerformance } from "../../../hooks/useAnalytics";
import AnalyticsTabNav from "../../../components/analytics/AnalyticsTabNav";

const TOOLTIP_STYLE = {
  backgroundColor: "#21262D",
  border: "1px solid #30363D",
  borderRadius: "8px",
  fontSize: "12px",
  color: "#F0F6FC",
};

export default function CloserPerformancePage() {
  const { closers, isLoading } = useCloserPerformance();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  const chartData = closers.map((c) => ({
    name: c.closerName.split(" ")[0],
    deals: c.totalDealsFunded,
    revenue: c.totalRevenue,
    rate: Number(c.closeRate.toFixed(1)),
  }));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Closer Performance
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Individual closer metrics, close rates, and revenue
        </p>
      </div>

      {/* Tab Navigation */}
      <AnalyticsTabNav />

      {closers.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-12 shadow-sm border border-gray-200 dark:border-gray-700 text-center">
          <UserGroupIcon className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No closer data yet
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            Closer performance metrics will appear here once deals are assigned to closers and funded.
          </p>
        </div>
      ) : (
        <>
          {/* Top Performer Highlight */}
          {closers.length > 0 && (() => {
            const top = [...closers].sort((a, b) => b.totalDealsFunded - a.totalDealsFunded)[0];
            return (
              <div className="bg-gradient-to-r from-ocean-blue to-teal rounded-xl p-6 text-white">
                <div className="flex items-center gap-2 mb-3">
                  <TrophyIcon className="w-5 h-5" />
                  <h2 className="text-lg font-semibold">Top Closer</h2>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div>
                    <p className="text-2xl font-bold">{top.closerName}</p>
                    <p className="text-sm text-white/70 mt-1">Name</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{top.totalDealsFunded}</p>
                    <p className="text-sm text-white/70 mt-1">Deals Funded</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{top.closeRate.toFixed(1)}%</p>
                    <p className="text-sm text-white/70 mt-1">Close Rate</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">${top.totalRevenue.toLocaleString()}</p>
                    <p className="text-sm text-white/70 mt-1">Total Revenue</p>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Closer Comparison Chart */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
              Deals Funded by Closer
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#9CA3AF" }} />
                <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} allowDecimals={false} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value: number | undefined, name?: string) => {
                    const v = value ?? 0;
                    if (name === "deals") return [v, "Deals Funded"];
                    if (name === "rate") return [`${v}%`, "Close Rate"];
                    return [`$${v.toLocaleString()}`, "Revenue"];
                  }}
                />
                <Bar dataKey="deals" fill="#007EA7" radius={[4, 4, 0, 0]} name="deals" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Closer Table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
              Closer Scorecard
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Closer</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Leads</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Funded</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Close Rate</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Avg Deal</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Revenue</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Avg Days</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">This Month</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {closers.map((closer) => (
                    <tr key={closer.closerId} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="px-3 py-3 font-medium text-gray-900 dark:text-white whitespace-nowrap">
                        {closer.closerName}
                      </td>
                      <td className="px-3 py-3 text-gray-700 dark:text-gray-300">{closer.totalLeadsAssigned}</td>
                      <td className="px-3 py-3 text-gray-700 dark:text-gray-300">{closer.totalDealsFunded}</td>
                      <td className="px-3 py-3">
                        <span className={`font-medium ${closer.closeRate >= 12 ? "text-green-600" : closer.closeRate >= 8 ? "text-yellow-600" : "text-red-600"}`}>
                          {closer.closeRate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-3 py-3 text-gray-700 dark:text-gray-300">
                        ${closer.avgDealSize >= 1000 ? `${(closer.avgDealSize / 1000).toFixed(1)}K` : closer.avgDealSize.toLocaleString()}
                      </td>
                      <td className="px-3 py-3 font-medium text-gray-900 dark:text-white">
                        ${closer.totalRevenue.toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-gray-700 dark:text-gray-300">
                        {closer.avgDaysToFund != null ? `${closer.avgDaysToFund.toFixed(1)}d` : "--"}
                      </td>
                      <td className="px-3 py-3 text-gray-700 dark:text-gray-300">
                        {closer.dealsThisMonth} deals / ${closer.revenueThisMonth.toLocaleString()}
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
