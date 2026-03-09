import { useState, useEffect } from "react";
import {
  BanknotesIcon,
  ClockIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import type {
  CommissionWithDetails,
  CommissionSummary,
  MonthlyCommissionData,
  PaymentStatus,
} from "../../../types/commissions";
import { PAYMENT_STATUS_CONFIG } from "../../../types/commissions";
import {
  getAllCommissions,
  getCommissionSummary,
  getMonthlyCommissionData,
  updatePaymentStatus,
} from "../../../services/commissionService";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "N/A";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const PIE_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6"];

export default function CommissionDashboardPage() {
  const [commissions, setCommissions] = useState<CommissionWithDetails[]>([]);
  const [summary, setSummary] = useState<CommissionSummary | null>(null);
  const [monthlyData, setMonthlyData] = useState<MonthlyCommissionData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"pending" | "paid" | "all">("all");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [commData, summaryData, monthly] = await Promise.all([
        getAllCommissions(),
        getCommissionSummary(),
        getMonthlyCommissionData(12),
      ]);
      setCommissions(commData);
      setSummary(summaryData);
      setMonthlyData(monthly);
    } catch (err) {
      console.error("Error loading commissions:", err);
    }
    setIsLoading(false);
  };

  const handleStatusChange = async (id: string, newStatus: PaymentStatus) => {
    try {
      await updatePaymentStatus(id, newStatus);
      loadData();
    } catch (err) {
      console.error("Error updating status:", err);
    }
  };

  const filteredCommissions = commissions.filter((c) => {
    if (activeTab === "pending" && !["pending", "funder_paid"].includes(c.payment_status)) return false;
    if (activeTab === "paid" && !["closer_paid", "completed"].includes(c.payment_status)) return false;
    if (statusFilter && c.payment_status !== statusFilter) return false;
    return true;
  });

  // Data for closer breakdown pie chart
  const closerBreakdown = commissions.reduce((acc, c) => {
    const name = c.closer
      ? `${c.closer.first_name} ${c.closer.last_name}`
      : c.sub_iso
        ? c.sub_iso.company_name
        : "Direct";
    acc.set(name, (acc.get(name) || 0) + c.gross_commission);
    return acc;
  }, new Map<string, number>());

  const pieData = Array.from(closerBreakdown.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Commissions</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Track commission payouts, revenue, and payment status
          </p>
        </div>
        <button onClick={loadData} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
          <ArrowPathIcon className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                <ClockIcon className="w-5 h-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Pending</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(summary.totalPending)}</p>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <CheckCircleIcon className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Completed</p>
                <p className="text-xl font-bold text-emerald-600">{formatCurrency(summary.totalCompleted)}</p>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
                <ExclamationTriangleIcon className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Clawbacks</p>
                <p className="text-xl font-bold text-red-600">{formatCurrency(summary.totalClawback)}</p>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <BanknotesIcon className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">This Month (Company)</p>
                <p className="text-xl font-bold text-blue-600">{formatCurrency(summary.thisMonthCompany)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Revenue Breakdown */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">Total Gross Commission</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{formatCurrency(summary.totalGrossCommission)}</p>
            <p className="text-xs text-gray-400 mt-1">{summary.commissionCount} commissions</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">Company Revenue (Net)</p>
            <p className="text-2xl font-bold text-emerald-600">{formatCurrency(summary.totalCompanyRevenue)}</p>
            <p className="text-xs text-gray-400 mt-1">After closer and Sub-ISO splits</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">Total Closer Payouts</p>
            <p className="text-2xl font-bold text-blue-600">{formatCurrency(summary.totalCloserPayouts)}</p>
            <p className="text-xs text-gray-400 mt-1">Sub-ISO overrides: {formatCurrency(summary.totalSubISOPayouts)}</p>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Monthly Revenue Chart */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Monthly Revenue</h2>
          {monthlyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 12, fill: "#9CA3AF" }}
                  tickFormatter={(val) => {
                    const [y, m] = val.split("-");
                    return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m) - 1]} '${y.slice(2)}`;
                  }}
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "#9CA3AF" }}
                  tickFormatter={(val) => `$${(val / 1000).toFixed(0)}K`}
                />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  contentStyle={{
                    backgroundColor: "#1F2937",
                    border: "1px solid #374151",
                    borderRadius: "8px",
                    color: "#fff",
                  }}
                />
                <Legend />
                <Bar dataKey="company" name="Company" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="closerPayouts" name="Closer Payouts" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="subISOPayouts" name="Sub-ISO Overrides" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-400">
              No commission data yet
            </div>
          )}
        </div>

        {/* Breakdown by Closer/Source */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Revenue by Closer / Source</h2>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  dataKey="value"
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  label={({ name, percent }: any) => `${name} (${(percent * 100).toFixed(0)}%)`}
                  labelLine={false}
                >
                  {pieData.map((_entry, index) => (
                    <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-400">
              No commission data yet
            </div>
          )}
        </div>
      </div>

      {/* Commission Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        {/* Tabs */}
        <div className="flex items-center gap-1 p-4 border-b border-gray-200 dark:border-gray-700">
          {(["all", "pending", "paid"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === tab
                  ? "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white"
                  : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
            >
              {tab === "all" ? "All" : tab === "pending" ? "Pending" : "Paid"}
              <span className="ml-2 px-1.5 py-0.5 text-xs bg-gray-200 dark:bg-gray-600 rounded">
                {tab === "all"
                  ? commissions.length
                  : tab === "pending"
                    ? commissions.filter((c) => ["pending", "funder_paid"].includes(c.payment_status)).length
                    : commissions.filter((c) => ["closer_paid", "completed"].includes(c.payment_status)).length}
              </span>
            </button>
          ))}
          <div className="ml-auto">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input-field text-sm w-40"
            >
              <option value="">All Status</option>
              {Object.entries(PAYMENT_STATUS_CONFIG).map(([val, cfg]) => (
                <option key={val} value={val}>{cfg.label}</option>
              ))}
            </select>
          </div>
        </div>

        {filteredCommissions.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            No commissions found for this filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Deal</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Closer / Sub-ISO</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Gross</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Company</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Closer Payout</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filteredCommissions.map((comm) => (
                  <tr key={comm.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {comm.deal?.deal_number || "N/A"}
                      </p>
                      {comm.deal?.deal_type && (
                        <p className="text-xs text-gray-400">{comm.deal.deal_type.toUpperCase()}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {comm.closer ? (
                        <p className="text-sm text-gray-700 dark:text-gray-300">
                          {comm.closer.first_name} {comm.closer.last_name}
                          <span className="text-xs text-gray-400 ml-1">({comm.closer_split_percentage}%)</span>
                        </p>
                      ) : comm.sub_iso ? (
                        <p className="text-sm text-gray-700 dark:text-gray-300">
                          {comm.sub_iso.company_name}
                          <span className="text-xs text-gray-400 ml-1">(Sub-ISO)</span>
                        </p>
                      ) : (
                        <span className="text-sm text-gray-400">Direct</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-gray-900 dark:text-white">
                      {formatCurrency(comm.gross_commission)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-emerald-600">
                      {formatCurrency(comm.company_amount || 0)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-blue-600">
                      {formatCurrency(comm.closer_amount || 0)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${PAYMENT_STATUS_CONFIG[comm.payment_status]?.color}`}>
                        {PAYMENT_STATUS_CONFIG[comm.payment_status]?.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(comm.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {comm.payment_status === "pending" && (
                        <button
                          onClick={() => handleStatusChange(comm.id, "funder_paid")}
                          className="text-xs text-ocean-blue hover:underline"
                        >
                          Mark Funder Paid
                        </button>
                      )}
                      {comm.payment_status === "funder_paid" && (
                        <button
                          onClick={() => handleStatusChange(comm.id, "closer_paid")}
                          className="text-xs text-ocean-blue hover:underline"
                        >
                          Mark Closer Paid
                        </button>
                      )}
                      {comm.payment_status === "closer_paid" && (
                        <button
                          onClick={() => handleStatusChange(comm.id, "completed")}
                          className="text-xs text-emerald-600 hover:underline"
                        >
                          Complete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
