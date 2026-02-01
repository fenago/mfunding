import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  BuildingLibraryIcon,
  UsersIcon,
  MegaphoneIcon,
  ClipboardDocumentListIcon,
  ArrowTrendingUpIcon,
} from "@heroicons/react/24/outline";
import { useUserProfile } from "../../context/UserProfileContext";
import supabase from "../../supabase";

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

  useEffect(() => {
    const fetchStats = async () => {
      setIsLoading(true);
      try {
        // Fetch lenders stats
        const { count: totalLenders } = await supabase
          .from("lenders")
          .select("*", { count: "exact", head: true });

        const { count: activeLenders } = await supabase
          .from("lenders")
          .select("*", { count: "exact", head: true })
          .eq("status", "live_vendor");

        // Fetch customers stats
        const { count: totalCustomers } = await supabase
          .from("customers")
          .select("*", { count: "exact", head: true });

        const { count: leadCustomers } = await supabase
          .from("customers")
          .select("*", { count: "exact", head: true })
          .eq("status", "lead");

        const { count: fundedCustomers } = await supabase
          .from("customers")
          .select("*", { count: "exact", head: true })
          .eq("status", "funded");

        // Fetch marketing vendors stats
        const { count: totalMarketingVendors } = await supabase
          .from("marketing_vendors")
          .select("*", { count: "exact", head: true });

        const { count: activeVendors } = await supabase
          .from("marketing_vendors")
          .select("*", { count: "exact", head: true })
          .eq("status", "active");

        // Fetch pending tasks
        const { count: pendingTasks } = await supabase
          .from("kanban_tasks")
          .select("*", { count: "exact", head: true })
          .in("status", ["backlog", "todo", "in_progress"]);

        setStats({
          totalLenders: totalLenders || 0,
          activeLenders: activeLenders || 0,
          totalCustomers: totalCustomers || 0,
          leadCustomers: leadCustomers || 0,
          fundedCustomers: fundedCustomers || 0,
          totalMarketingVendors: totalMarketingVendors || 0,
          activeVendors: activeVendors || 0,
          pendingTasks: pendingTasks || 0,
        });
      } catch (error) {
        console.error("Error fetching stats:", error);
      }
      setIsLoading(false);
    };

    fetchStats();
  }, []);

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
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Dashboard
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Welcome to the mFunding admin portal
        </p>
      </div>

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
                  className={`p-3 rounded-lg ${card.color} bg-opacity-10`}
                >
                  <Icon
                    className={`w-6 h-6 ${card.color.replace("bg-", "text-")}`}
                  />
                </div>
                <ArrowTrendingUpIcon className="w-5 h-5 text-gray-400" />
              </div>
              <h3 className="text-3xl font-bold text-gray-900 dark:text-white">
                {card.value}
              </h3>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300 mt-1">
                {card.title}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {card.subtitle}
              </p>
            </Link>
          );
        })}
      </div>

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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
