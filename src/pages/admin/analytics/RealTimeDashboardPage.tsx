import {
  PhoneArrowUpRightIcon,
  UsersIcon,
  DocumentCheckIcon,
  CheckBadgeIcon,
  BanknotesIcon,
  ClockIcon,
  SignalIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useRealTimeDashboard } from "../../../hooks/useAnalytics";
import type { RecentActivity } from "../../../types/analytics";

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffSecs = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSecs < 5) return "just now";
  if (diffSecs < 60) return `${diffSecs}s ago`;
  const diffMins = Math.floor(diffSecs / 60);
  return `${diffMins}m ago`;
}

function formatHour(hour: number): string {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour > 12 ? `${hour - 12}pm` : `${hour}am`;
}

const INTERACTION_LABELS: Record<string, string> = {
  call: "Phone Call",
  email: "Email",
  sms: "SMS",
  note: "Note",
  meeting: "Meeting",
  voicemail: "Voicemail",
  document_uploaded: "Document",
  status_change: "Status Change",
  application_submitted: "Application",
  follow_up_scheduled: "Follow-up",
};

const ENTITY_LABELS: Record<string, string> = {
  customer: "Customer",
  lender: "Lender",
  marketing_vendor: "Vendor",
};

export default function RealTimeDashboardPage() {
  const { todayStats, recentActivity, isLoading, lastUpdated, refetch } =
    useRealTimeDashboard(30000);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const liveTransferConvRate =
    todayStats && todayStats.liveTransfersToday > 0
      ? ((todayStats.liveTransferConversions / todayStats.liveTransfersToday) * 100).toFixed(1)
      : "0";

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Real-Time Dashboard
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">{today}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 dark:bg-green-900/20 rounded-full">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
            </span>
            <span className="text-xs font-medium text-green-700 dark:text-green-400">
              Live {lastUpdated ? `- updated ${formatTimeAgo(lastUpdated)}` : ""}
            </span>
          </div>
          <button
            onClick={refetch}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Refresh now"
          >
            <ArrowPathIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Live Transfer Tracker */}
      <div className="bg-gradient-to-r from-ocean-blue to-teal rounded-xl p-6 text-white">
        <div className="flex items-center gap-2 mb-4">
          <PhoneArrowUpRightIcon className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Live Transfer Tracker</h2>
        </div>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <p className="text-3xl font-bold">{todayStats?.liveTransfersToday || 0}</p>
            <p className="text-sm text-white/70 mt-1">Live Transfers Today</p>
          </div>
          <div>
            <p className="text-3xl font-bold">{todayStats?.liveTransferConversions || 0}</p>
            <p className="text-sm text-white/70 mt-1">Conversions (App Started)</p>
          </div>
          <div>
            <p className="text-3xl font-bold">{liveTransferConvRate}%</p>
            <p className="text-sm text-white/70 mt-1">Conversion Rate</p>
          </div>
        </div>
      </div>

      {/* Daily Pipeline Board */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-3">
            <UsersIcon className="w-5 h-5 text-blue-500" />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">New Leads</span>
          </div>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">
            {todayStats?.newLeadsToday || 0}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-400 mt-1">today</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-3">
            <DocumentCheckIcon className="w-5 h-5 text-purple-500" />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Apps Started</span>
          </div>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">
            {todayStats?.applicationsStartedToday || 0}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-400 mt-1">today</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-3">
            <ClockIcon className="w-5 h-5 text-yellow-500" />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">In Review</span>
          </div>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">
            {todayStats?.dealsInReview || 0}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-400 mt-1">total active</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-3">
            <CheckBadgeIcon className="w-5 h-5 text-green-500" />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Approved</span>
          </div>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">
            {todayStats?.dealsApprovedToday || 0}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-400 mt-1">today</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-3">
            <BanknotesIcon className="w-5 h-5 text-emerald-500" />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Funded</span>
          </div>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">
            {todayStats?.dealsFundedToday || 0}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-400 mt-1">today</p>
        </div>
      </div>

      {/* Pipeline Value Banner */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SignalIcon className="w-5 h-5 text-cyan-500" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Active Pipeline Value
          </span>
        </div>
        <span className="text-xl font-bold text-gray-900 dark:text-white">
          ${(todayStats?.totalPipelineValue || 0).toLocaleString()}
        </span>
      </div>

      {/* Bottom Row: Hourly Chart + Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Hourly Activity Chart */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
            Leads by Hour
          </h3>
          {todayStats?.hourlyLeads ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={todayStats.hourlyLeads} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                <XAxis
                  dataKey="hour"
                  tickFormatter={formatHour}
                  tick={{ fontSize: 10, fill: "#9CA3AF" }}
                  interval={2}
                />
                <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#21262D",
                    border: "1px solid #30363D",
                    borderRadius: "8px",
                    fontSize: "12px",
                    color: "#F0F6FC",
                  }}
                  labelFormatter={(h) => formatHour(Number(h))}
                  formatter={(value: number | undefined) => [value ?? 0, "Leads"]}
                />
                <Bar dataKey="count" fill="#007EA7" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[250px] text-gray-400 text-sm">
              No data yet today
            </div>
          )}
        </div>

        {/* Recent Activity Feed */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
            Recent Activity
          </h3>
          {recentActivity.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">
              No recent activity
            </div>
          ) : (
            <div className="space-y-3 max-h-[300px] overflow-y-auto">
              {recentActivity.map((activity: RecentActivity) => (
                <div
                  key={activity.id}
                  className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50"
                >
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-ocean-blue/10 flex items-center justify-center">
                    <span className="text-xs font-medium text-ocean-blue">
                      {ENTITY_LABELS[activity.entityType]?.[0] || "?"}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {activity.entityName}
                      </span>
                      <span className="text-xs px-2 py-0.5 bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-full">
                        {INTERACTION_LABELS[activity.interactionType] || activity.interactionType}
                      </span>
                    </div>
                    {activity.subject && (
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 truncate">
                        {activity.subject}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 dark:text-gray-400 mt-1">
                      {new Date(activity.createdAt).toLocaleTimeString()}
                      {activity.loggedByName && ` by ${activity.loggedByName}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
