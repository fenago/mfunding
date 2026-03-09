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
  BuildingLibraryIcon,
} from "@heroicons/react/24/outline";
import { useLenderPerformance } from "../../../hooks/useAnalytics";
import AnalyticsTabNav from "../../../components/analytics/AnalyticsTabNav";

const TOOLTIP_STYLE = {
  backgroundColor: "#21262D",
  border: "1px solid #30363D",
  borderRadius: "8px",
  fontSize: "12px",
  color: "#F0F6FC",
};

export default function LenderPerformancePage() {
  const { lenders, isLoading } = useLenderPerformance();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  // Filter to lenders with at least 1 submission for charts
  const activeLenders = lenders.filter((l) => l.totalSubmissions > 0);

  const chartData = activeLenders.map((l) => ({
    name: l.lenderName.length > 15 ? l.lenderName.slice(0, 15) + "..." : l.lenderName,
    submissions: l.totalSubmissions,
    approved: l.totalApproved,
    declined: l.totalDeclined,
    rate: Number(l.approvalRate.toFixed(1)),
  }));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Lender Performance
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Submission outcomes, approval rates, and average offers by lender
        </p>
      </div>

      {/* Tab Navigation */}
      <AnalyticsTabNav />

      {activeLenders.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-12 shadow-sm border border-gray-200 dark:border-gray-700 text-center">
          <BuildingLibraryIcon className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No lender submission data yet
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
            Lender performance metrics will appear here once deals are submitted to funders and responses are received.
          </p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {activeLenders.length}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Active Lenders</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {activeLenders.reduce((s, l) => s + l.totalSubmissions, 0)}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Total Submissions</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
              <p className="text-2xl font-bold text-green-600">
                {(() => {
                  const totalSub = activeLenders.reduce((s, l) => s + l.totalSubmissions, 0);
                  const totalApp = activeLenders.reduce((s, l) => s + l.totalApproved, 0);
                  return totalSub > 0 ? ((totalApp / totalSub) * 100).toFixed(1) : "0";
                })()}%
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Avg Approval Rate</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {activeLenders.reduce((s, l) => s + l.totalFunded, 0)}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Deals Funded</p>
            </div>
          </div>

          {/* Lender Comparison Chart */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
              Submissions vs Approvals by Lender
            </h3>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10, fill: "#9CA3AF" }}
                  angle={-30}
                  textAnchor="end"
                  height={60}
                />
                <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} allowDecimals={false} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value: number | undefined, name?: string) => {
                    const v = value ?? 0;
                    if (name === "submissions") return [v, "Submissions"];
                    if (name === "approved") return [v, "Approved"];
                    return [v, "Declined"];
                  }}
                />
                <Bar dataKey="submissions" fill="#007EA7" radius={[4, 4, 0, 0]} name="submissions" />
                <Bar dataKey="approved" fill="#22C55E" radius={[4, 4, 0, 0]} name="approved" />
                <Bar dataKey="declined" fill="#EF4444" radius={[4, 4, 0, 0]} name="declined" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Lender Table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
              Lender Scorecard
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Lender</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Submitted</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Approved</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Declined</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Approval Rate</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Avg Offer</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Avg Factor</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Avg Points</th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Response Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {lenders
                    .sort((a, b) => b.totalSubmissions - a.totalSubmissions)
                    .map((lender) => (
                    <tr key={lender.lenderId} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="px-3 py-3 font-medium text-gray-900 dark:text-white whitespace-nowrap">
                        {lender.lenderName}
                      </td>
                      <td className="px-3 py-3 text-gray-700 dark:text-gray-300">{lender.totalSubmissions}</td>
                      <td className="px-3 py-3 text-green-600">{lender.totalApproved}</td>
                      <td className="px-3 py-3 text-red-600">{lender.totalDeclined}</td>
                      <td className="px-3 py-3">
                        <span className={`font-medium ${lender.approvalRate >= 60 ? "text-green-600" : lender.approvalRate >= 40 ? "text-yellow-600" : "text-red-600"}`}>
                          {lender.approvalRate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-3 py-3 text-gray-700 dark:text-gray-300">
                        {lender.avgOfferAmount > 0 ? `$${(lender.avgOfferAmount / 1000).toFixed(1)}K` : "--"}
                      </td>
                      <td className="px-3 py-3 text-gray-700 dark:text-gray-300">
                        {lender.avgFactorRate > 0 ? lender.avgFactorRate.toFixed(2) : "--"}
                      </td>
                      <td className="px-3 py-3 text-gray-700 dark:text-gray-300">
                        {lender.avgCommissionPoints > 0 ? `${lender.avgCommissionPoints.toFixed(1)}pts` : "--"}
                      </td>
                      <td className="px-3 py-3 text-gray-700 dark:text-gray-300">
                        {lender.avgResponseDays != null ? `${lender.avgResponseDays.toFixed(1)}d` : "--"}
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
