import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeftIcon,
  EnvelopeIcon,
  PhoneIcon,
  CalendarIcon,
} from "@heroicons/react/24/outline";
import type { Closer, CommissionWithDetails } from "../../../types/commissions";
import {
  CLOSER_STATUS_CONFIG,
  MARKET_LABELS,
  PAYMENT_STATUS_CONFIG,
} from "../../../types/commissions";
import { getCloserById } from "../../../services/closerService";
import { getCommissionsByCloser } from "../../../services/commissionService";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "N/A";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function CloserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [closer, setCloser] = useState<Closer | null>(null);
  const [commissions, setCommissions] = useState<CommissionWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (id) loadData(id);
  }, [id]);

  const loadData = async (closerId: string) => {
    setIsLoading(true);
    try {
      const [closerData, commissionData] = await Promise.all([
        getCloserById(closerId),
        getCommissionsByCloser(closerId),
      ]);
      setCloser(closerData);
      setCommissions(commissionData);
    } catch (err) {
      console.error("Error loading closer:", err);
    }
    setIsLoading(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  if (!closer) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500">Closer not found.</p>
        <Link to="/admin/closers" className="text-ocean-blue hover:underline mt-2 inline-block">
          Back to Closers
        </Link>
      </div>
    );
  }

  const totalGross = commissions.reduce((sum, c) => sum + c.gross_commission, 0);
  const totalCloserPayout = commissions.reduce((sum, c) => sum + (c.closer_amount || 0), 0);
  const pendingCount = commissions.filter((c) => c.payment_status === "pending").length;
  const avgDealCommission = commissions.length > 0 ? totalGross / commissions.length : 0;

  return (
    <div className="p-6">
      {/* Back link */}
      <Link
        to="/admin/closers"
        className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 mb-4"
      >
        <ArrowLeftIcon className="w-4 h-4" />
        Back to Closers
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {closer.first_name} {closer.last_name}
            </h1>
            <span className={`px-2 py-1 text-xs font-medium rounded-full ${CLOSER_STATUS_CONFIG[closer.status]?.color}`}>
              {CLOSER_STATUS_CONFIG[closer.status]?.label}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-2 text-sm text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1">
              <EnvelopeIcon className="w-4 h-4" />
              {closer.email}
            </span>
            {closer.phone && (
              <span className="flex items-center gap-1">
                <PhoneIcon className="w-4 h-4" />
                {closer.phone}
              </span>
            )}
            {closer.start_date && (
              <span className="flex items-center gap-1">
                <CalendarIcon className="w-4 h-4" />
                Started {formatDate(closer.start_date)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Deals Funded</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{closer.total_deals_funded}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Close Rate</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{formatPercent(closer.close_rate)}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Earned</p>
          <p className="text-2xl font-bold text-emerald-600">{formatCurrency(totalCloserPayout)}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Avg Commission</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{formatCurrency(avgDealCommission)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Info */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Profile & Splits</h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">Company Lead Split</span>
              <span className="text-sm font-medium text-gray-900 dark:text-white">{closer.company_lead_split}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">Self-Gen Split</span>
              <span className="text-sm font-medium text-gray-900 dark:text-white">{closer.self_gen_split}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">Renewal Split</span>
              <span className="text-sm font-medium text-gray-900 dark:text-white">{closer.renewal_split}%</span>
            </div>
            {closer.draw_amount && (
              <>
                <div className="border-t border-gray-200 dark:border-gray-700 pt-3 flex justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Monthly Draw</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(closer.draw_amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Draw Period</span>
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {formatDate(closer.draw_start_date)} - {formatDate(closer.draw_end_date)}
                  </span>
                </div>
              </>
            )}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-3 flex justify-between">
              <span className="text-sm text-gray-500 dark:text-gray-400">Max Leads/Mo</span>
              <span className="text-sm font-medium text-gray-900 dark:text-white">{closer.max_leads_per_month}</span>
            </div>
          </div>

          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mt-6 mb-2">Markets</h3>
          <div className="flex flex-wrap gap-2">
            {closer.markets.length > 0 ? (
              closer.markets.map((m) => (
                <span
                  key={m}
                  className="px-2 py-1 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full"
                >
                  {MARKET_LABELS[m] || m}
                </span>
              ))
            ) : (
              <span className="text-sm text-gray-400">No markets assigned</span>
            )}
          </div>

          {closer.notes && (
            <>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mt-6 mb-2">Notes</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">{closer.notes}</p>
            </>
          )}
        </div>

        {/* Commission History */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Commission History
            </h2>
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <span>{commissions.length} commissions</span>
              {pendingCount > 0 && (
                <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded-full">
                  {pendingCount} pending
                </span>
              )}
            </div>
          </div>
          {commissions.length === 0 ? (
            <div className="p-6 text-center text-gray-500 dark:text-gray-400">
              No commissions recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Deal</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Gross</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Your Split</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Payout</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {commissions.map((comm) => (
                    <tr key={comm.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                        {comm.deal?.deal_number || "N/A"}
                        {comm.deal?.market && (
                          <span className="ml-2 text-xs text-gray-400">
                            {MARKET_LABELS[comm.deal.market as keyof typeof MARKET_LABELS]?.split(",")[0] || comm.deal.market}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-medium text-gray-900 dark:text-white">
                        {formatCurrency(comm.gross_commission)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-gray-600 dark:text-gray-400">
                        {comm.closer_split_percentage}%
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-medium text-emerald-600">
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
