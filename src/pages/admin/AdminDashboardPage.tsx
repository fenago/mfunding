import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  BuildingLibraryIcon,
  UsersIcon,
  MegaphoneIcon,
  ClipboardDocumentListIcon,
  ArrowTrendingUpIcon,
  ChartBarSquareIcon,
  SignalIcon,
  MapIcon,
  ArrowRightIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { useUserProfile } from "../../context/UserProfileContext";
import supabase from "../../supabase";
import NeedsAttention from "../../components/admin/NeedsAttention";
import MoneyInPlay from "../../components/admin/MoneyInPlay";
import CompleteProfileNudge from "../../components/admin/CompleteProfileNudge";

interface Stats {
  totalLenders: number;
  activeLenders: number;
  totalCustomers: number;
  leadCustomers: number;
  fundedCustomers: number;
  totalMarketingVendors: number;
  activeVendors: number;
  pendingTasks: number;
}

export default function AdminDashboardPage() {
  const { isSuperAdmin } = useUserProfile();
  const [stats, setStats] = useState<Stats>({
    totalLenders: 0,
    activeLenders: 0,
    totalCustomers: 0,
    leadCustomers: 0,
    fundedCustomers: 0,
    totalMarketingVendors: 0,
    activeVendors: 0,
    pendingTasks: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  /* A FAILED COUNT IS NOT ZERO. Every query below destructured only `count` and
     discarded `error`, so a failure handed back null, `|| 0` turned it into 0, and
     the page rendered "0 Total Lenders / 0 Customers" with full confidence. The
     owner saw exactly that during a DB restart and reasonably concluded his data
     was gone. Same rule as the Lead Machine: a load failure says so, and never
     borrows the shape of real data. */
  const [statsError, setStatsError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    setStatsError(null);
    try {
      // Eight head-counts, issued together rather than in sequence.
      const [
        totalLenders, activeLenders,
        totalCustomers, leadCustomers, fundedCustomers,
        totalMarketingVendors, activeVendors, pendingTasks,
      ] = await Promise.all([
        supabase.from("lenders").select("*", { count: "exact", head: true }),
        supabase.from("lenders").select("*", { count: "exact", head: true }).eq("status", "live_vendor"),
        supabase.from("customers").select("*", { count: "exact", head: true }),
        supabase.from("customers").select("*", { count: "exact", head: true }).eq("status", "lead"),
        supabase.from("customers").select("*", { count: "exact", head: true }).eq("status", "funded"),
        supabase.from("marketing_vendors").select("*", { count: "exact", head: true }),
        supabase.from("marketing_vendors").select("*", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("kanban_tasks").select("*", { count: "exact", head: true }).in("status", ["backlog", "todo", "in_progress"]),
      ]);

      const results = [
        totalLenders, activeLenders, totalCustomers, leadCustomers,
        fundedCustomers, totalMarketingVendors, activeVendors, pendingTasks,
      ];
      const failed = results.find((r) => r.error);
      if (failed?.error) {
        // ANY failure poisons the whole board: a partial dashboard where some
        // tiles are real and some are zero is worse than one that admits it.
        setStatsError(failed.error.message || "the database didn't respond");
        return;
      }

      setStats({
        totalLenders: totalLenders.count ?? 0,
        activeLenders: activeLenders.count ?? 0,
        totalCustomers: totalCustomers.count ?? 0,
        leadCustomers: leadCustomers.count ?? 0,
        fundedCustomers: fundedCustomers.count ?? 0,
        totalMarketingVendors: totalMarketingVendors.count ?? 0,
        activeVendors: activeVendors.count ?? 0,
        pendingTasks: pendingTasks.count ?? 0,
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
      setStatsError(error instanceof Error ? error.message : "the database didn't respond");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  const colorRgb: Record<string, string> = {
    "bg-blue-500": "59,130,246",
    "bg-green-500": "34,197,94",
    "bg-purple-500": "168,85,247",
    "bg-orange-500": "249,115,22",
  };

  const statCards = [
    {
      title: "Total Lenders",
      value: stats.totalLenders,
      subtitle: `${stats.activeLenders} active`,
      icon: BuildingLibraryIcon,
      color: "bg-blue-500",
      link: "/admin/lenders",
      superAdminOnly: true,
    },
    {
      title: "Total Customers",
      value: stats.totalCustomers,
      subtitle: `${stats.leadCustomers} leads, ${stats.fundedCustomers} funded`,
      icon: UsersIcon,
      color: "bg-green-500",
      link: "/admin/customers",
      superAdminOnly: false,
    },
    {
      title: "Marketing Vendors",
      value: stats.totalMarketingVendors,
      subtitle: `${stats.activeVendors} active`,
      icon: MegaphoneIcon,
      color: "bg-purple-500",
      link: "/admin/marketing",
      superAdminOnly: true,
    },
    {
      title: "Pending Tasks",
      value: stats.pendingTasks,
      subtitle: "Backlog, To Do, In Progress",
      icon: ClipboardDocumentListIcon,
      color: "bg-orange-500",
      link: "/admin/todos",
      superAdminOnly: false,
    },
  ];

  const filteredCards = statCards.filter(
    (card) => !card.superAdminOnly || isSuperAdmin
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Dashboard
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Welcome to the mFunding admin portal
        </p>
      </div>

      {/* A failed load says so, in place of the numbers, rather than under them —
          the whole point is that no zero appears anywhere it could be mistaken
          for a real count. */}
      {statsError && (
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 px-4 py-3">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0 text-rose-600 dark:text-rose-400" />
          <span className="text-sm text-rose-800 dark:text-rose-200">
            <strong>Couldn't load your dashboard numbers</strong> — this is a load failure, not an empty database.
            Nothing has been lost. ({statsError})
          </span>
          <button onClick={() => void fetchStats()} className="btn-ghost btn-sm">
            Try again
          </button>
        </div>
      )}

      {/* Nudge staff to complete their profile so payroll has their details */}
      <CompleteProfileNudge />

      {/* Start here — the money workflows */}
      <Link
        to="/admin/playbooks"
        className="group mb-8 flex items-center justify-between gap-4 rounded-2xl p-5 text-white shadow-sm transition-shadow hover:shadow-md"
        style={{ background: "linear-gradient(135deg, #0A2342 0%, #0C516E 55%, #007EA7 100%)" }}
      >
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15">
            <MapIcon className="h-6 w-6" />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-mint-green">Start here</p>
            <h2 className="text-lg font-bold">Revenue Playbooks</h2>
            <p className="text-sm text-white/70">
              Exactly what to do, what to say, and where to click for the 3 flows that make money — Website Lead, Live Transfer, and VCF.
            </p>
          </div>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1 rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold group-hover:bg-white/25">
          Open <ArrowRightIcon className="h-4 w-4" />
        </span>
      </Link>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {filteredCards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.title}
              to={card.link}
              className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between mb-4">
                <div
                  className="p-3 rounded-lg"
                  style={{ backgroundColor: `rgba(${colorRgb[card.color] || "59,130,246"}, 0.15)` }}
                >
                  <Icon
                    className={`w-6 h-6 ${card.color.replace("bg-", "text-")}`}
                  />
                </div>
                <ArrowTrendingUpIcon className="w-5 h-5 text-gray-400" />
              </div>
              {/* An em-dash, not 0. A zero here is indistinguishable from a real
                  count of zero, which is the whole bug. */}
              <h3 className="text-3xl font-bold text-gray-900 dark:text-white">
                {statsError ? <span className="text-gray-300 dark:text-gray-600">—</span> : card.value}
              </h3>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300 mt-1">
                {card.title}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {statsError ? "unavailable" : card.subtitle}
              </p>
            </Link>
          );
        })}
      </div>

      {/* Needs attention — operational queues */}
      <NeedsAttention />

      {/* Money in play — owner's view. What the open pipeline is really worth, what it
          pays out at the closer split, and what it's actually expected to fund.
          Super-admin only: it exposes company margin, not just a closer's own book. */}
      {isSuperAdmin && (
        <div className="mt-6">
          <MoneyInPlay />
        </div>
      )}

      {/* Quick Actions */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Quick Actions
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Link
            to="/admin/customers"
            className="flex items-center gap-3 p-4 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
          >
            <UsersIcon className="w-5 h-5 text-green-500" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              Add Customer
            </span>
          </Link>
          <Link
            to="/admin/todos"
            className="flex items-center gap-3 p-4 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
          >
            <ClipboardDocumentListIcon className="w-5 h-5 text-orange-500" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              View Tasks
            </span>
          </Link>
          {isSuperAdmin && (
            <>
              <Link
                to="/admin/users"
                className="flex items-center gap-3 p-4 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                <UsersIcon className="w-5 h-5 text-emerald-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  Manage Users
                </span>
              </Link>
              <Link
                to="/admin/lenders"
                className="flex items-center gap-3 p-4 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                <BuildingLibraryIcon className="w-5 h-5 text-blue-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  Add Lender
                </span>
              </Link>
              <Link
                to="/admin/marketing"
                className="flex items-center gap-3 p-4 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                <MegaphoneIcon className="w-5 h-5 text-purple-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  Marketing
                </span>
              </Link>
              <Link
                to="/admin/analytics"
                className="flex items-center gap-3 p-4 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                <ChartBarSquareIcon className="w-5 h-5 text-cyan-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  Analytics
                </span>
              </Link>
              <Link
                to="/admin/analytics/realtime"
                className="flex items-center gap-3 p-4 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                <SignalIcon className="w-5 h-5 text-green-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  Real-Time
                </span>
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
