import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  HomeIcon,
  ClipboardDocumentListIcon,
  BuildingLibraryIcon,
  UsersIcon,
  MegaphoneIcon,
  Cog6ToothIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowLeftOnRectangleIcon,
  CalculatorIcon,
  RectangleGroupIcon,
  ChartBarSquareIcon,
  SignalIcon,
  SunIcon,
  MoonIcon,
  ComputerDesktopIcon,
  DocumentTextIcon,
  UserGroupIcon,
  BuildingOffice2Icon,
  BanknotesIcon,
  ArrowsRightLeftIcon,
  ShieldExclamationIcon,
  ArrowPathIcon,
  DocumentMagnifyingGlassIcon,
  UserPlusIcon,
  ReceiptPercentIcon,
  MapIcon,
  ArrowPathRoundedSquareIcon,
  BookOpenIcon,
  WrenchScrewdriverIcon,
  PhoneArrowUpRightIcon,
  ChatBubbleLeftRightIcon,
} from "@heroicons/react/24/outline";
import { useUserProfile } from "../../context/UserProfileContext";
import { useRenewalsAccess, useCloserLens } from "../../hooks/useCloserSplits";
import { useTheme } from "../../lib/theme-context";
import supabase from "../../supabase";
import Logo from "../ui/Logo";

type NavRole = "closer" | "admin" | "super_admin";

interface NavItem {
  name: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: NavRole[];
}
interface NavGroup {
  title: string;
  items: NavItem[];
}

const OPS: NavRole[] = ["closer", "admin", "super_admin"]; // operational — all staff
const ADMIN: NavRole[] = ["admin", "super_admin"]; // managers — not closers
const SUPER: NavRole[] = ["super_admin"]; // owner-only: financials, config, network

// The focused "closer lens" (closers, employees, admins-with-a-closer-row) sees
// only these operating links — the daily work surface. Everything else is hidden
// for them. Role/renewals gating still applies on top (so a pure closer, who
// can't reach the admin-only Task Board route, won't see it here either).
const CLOSER_LENS_PATHS = new Set<string>([
  "/admin/playbooks", // 🎯 Revenue Playbook — their command center
  "/admin/comms",
  "/admin/documents", // Doc Review
  "/admin/todos", // Task Board
  "/admin/resources",
  "/admin/renewals", // shown per closers.renewals_enabled (handled in canSee)
]);

const navGroups: NavGroup[] = [
  {
    title: "Home",
    items: [
      // Home link for managers only; the closer lens lands on the Revenue Playbook.
      { name: "Dashboard", path: "/admin", icon: HomeIcon, roles: ADMIN },
    ],
  },
  {
    title: "Daily",
    items: [
      { name: "Revenue Playbook", path: "/admin/playbooks", icon: MapIcon, roles: OPS },
      { name: "Deals", path: "/admin/deals", icon: DocumentTextIcon, roles: OPS },
      { name: "Lenders", path: "/admin/lenders", icon: BuildingLibraryIcon, roles: ADMIN },
      { name: "Funder Directory", path: "/admin/funder-directory", icon: BuildingLibraryIcon, roles: SUPER },
      { name: "Task Board", path: "/admin/todos", icon: ClipboardDocumentListIcon, roles: ADMIN },
      { name: "Comms", path: "/admin/comms", icon: ChatBubbleLeftRightIcon, roles: OPS },
      { name: "Doc Review", path: "/admin/documents", icon: DocumentMagnifyingGlassIcon, roles: OPS },
      { name: "Customers", path: "/admin/customers", icon: UsersIcon, roles: OPS },
      { name: "Resources", path: "/admin/resources", icon: BookOpenIcon, roles: OPS },
    ],
  },
  {
    title: "Leads & Marketing",
    items: [
      { name: "Lead Partner (Synergy)", path: "/admin/lead-partner", icon: BuildingOffice2Icon, roles: SUPER },
      { name: "Marketing Vendors", path: "/admin/marketing", icon: MegaphoneIcon, roles: SUPER },
      { name: "Vendor Scorecard", path: "/admin/marketing/scorecard", icon: ChartBarSquareIcon, roles: SUPER },
      { name: "Live Transfer Leads", path: "/admin/marketing/live-transfers", icon: PhoneArrowUpRightIcon, roles: SUPER },
      { name: "Lead Lists & Data", path: "/admin/marketing/lead-lists", icon: WrenchScrewdriverIcon, roles: SUPER },
      { name: "Lead Sources", path: "/admin/lead-sources", icon: SignalIcon, roles: SUPER },
      { name: "Campaigns", path: "/admin/campaigns", icon: MegaphoneIcon, roles: SUPER },
      { name: "Budget Planner", path: "/admin/lead-budget", icon: CalculatorIcon, roles: SUPER },
      { name: "Sequences", path: "/admin/sequences", icon: ArrowPathRoundedSquareIcon, roles: OPS },
      { name: "Lead Tools", path: "/admin/lead-tools", icon: WrenchScrewdriverIcon, roles: OPS },
      { name: "Referrals", path: "/admin/referrals", icon: UserPlusIcon, roles: ADMIN },
    ],
  },
  {
    title: "Pipeline Ops",
    items: [
      { name: "Renewals", path: "/admin/renewals", icon: ArrowPathIcon, roles: OPS },
    ],
  },
  {
    title: "Team & Money",
    items: [
      { name: "Closers", path: "/admin/closers", icon: UserGroupIcon, roles: SUPER },
      { name: "Sub-ISOs", path: "/admin/sub-isos", icon: BuildingOffice2Icon, roles: SUPER },
      { name: "Commissions", path: "/admin/commissions", icon: BanknotesIcon, roles: SUPER },
    ],
  },
  {
    title: "Modeling & Insights",
    items: [
      { name: "Analytics", path: "/admin/analytics", icon: ChartBarSquareIcon, roles: SUPER },
      { name: "Funder Performance", path: "/admin/analytics/lenders", icon: BuildingLibraryIcon, roles: ADMIN },
      { name: "Real-Time", path: "/admin/analytics/realtime", icon: SignalIcon, roles: SUPER },
      { name: "Unit Economics (MCA)", path: "/admin/unit-economics", icon: CalculatorIcon, roles: SUPER },
      { name: "Unit Economics (VCF)", path: "/admin/unit-economics-vcf", icon: CalculatorIcon, roles: SUPER },
      { name: "Live Transfer ROI", path: "/admin/live-transfer-roi", icon: PhoneArrowUpRightIcon, roles: SUPER },
      { name: "Closer Comp", path: "/admin/closer-comp", icon: ReceiptPercentIcon, roles: SUPER },
      { name: "Business Model", path: "/admin/bmc", icon: RectangleGroupIcon, roles: SUPER },
    ],
  },
  {
    title: "System",
    items: [
      { name: "Users", path: "/admin/users", icon: UsersIcon, roles: SUPER },
      { name: "Compliance", path: "/admin/compliance", icon: ShieldExclamationIcon, roles: SUPER },
      { name: "Integrations", path: "/admin/settings/integrations", icon: ArrowsRightLeftIcon, roles: SUPER },
      { name: "GHL Sync Log", path: "/admin/sync-log", icon: SignalIcon, roles: SUPER },
      { name: "Platform Config", path: "/admin/platform-config", icon: Cog6ToothIcon, roles: SUPER },
      { name: "Settings", path: "/admin/settings", icon: Cog6ToothIcon, roles: SUPER },
    ],
  },
];

export default function AdminSidebar() {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem("adminSidebarCollapsed");
    return saved ? JSON.parse(saved) : false;
  });
  const location = useLocation();
  const { profile, isSuperAdmin } = useUserProfile();
  const { canSeeRenewals, loading: renewalsLoading } = useRenewalsAccess();
  const { isCloserLens } = useCloserLens();
  const { mode, cycleMode } = useTheme();
  const ThemeIcon = mode === "dark" ? MoonIcon : mode === "light" ? SunIcon : ComputerDesktopIcon;
  const themeLabel = mode === "dark" ? "Dark" : mode === "light" ? "Light" : "System";

  useEffect(() => {
    localStorage.setItem("adminSidebarCollapsed", JSON.stringify(isCollapsed));
  }, [isCollapsed]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  // Employees have admin-level app access minus super-admin screens, so treat
  // them as "admin" for nav visibility (their role isn't itself a NavRole).
  const role: NavRole | undefined =
    profile?.role === "employee" ? "admin" : (profile?.role as NavRole | undefined);
  const canSee = (item: NavItem) => {
    // Closer lens: only the daily operating links, regardless of group.
    if (isCloserLens && !CLOSER_LENS_PATHS.has(item.path)) return false;
    if (!(isSuperAdmin || (!!role && item.roles.includes(role)))) return false;
    // Renewals is additionally gated per closer (closers.renewals_enabled).
    // super_admin always passes; for everyone else defer until the flag loads
    // so a gated closer never sees the link flash in and out.
    if (item.path === "/admin/renewals" && !isSuperAdmin) {
      return !renewalsLoading && canSeeRenewals;
    }
    return true;
  };

  const isActive = (path: string) => {
    if (path === "/admin") {
      return location.pathname === "/admin";
    }
    return location.pathname.startsWith(path);
  };

  return (
    <aside
      className={`flex flex-col h-full bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transition-all duration-300 ${
        isCollapsed ? "w-16" : "w-64"
      }`}
    >
      {/* Logo */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200 dark:border-gray-700">
        {!isCollapsed && (
          <Link to="/">
            <Logo variant="full" size="sm" theme="light" />
          </Link>
        )}
        <div className="flex items-center gap-1">
          <button
            onClick={cycleMode}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            title={`Theme: ${themeLabel}`}
          >
            <ThemeIcon className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
          >
            {isCollapsed ? (
              <ChevronRightIcon className="w-5 h-5" />
            ) : (
              <ChevronLeftIcon className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>

      {/* Navigation (role-aware, grouped) */}
      <nav className="flex-1 py-3 px-2 overflow-y-auto">
        {navGroups.map((group) => {
          const items = group.items.filter(canSee);
          if (items.length === 0) return null;
          return (
            <div key={group.title} className="mb-2">
              {!isCollapsed ? (
                <p className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  {group.title}
                </p>
              ) : (
                <div className="my-2 mx-2 border-t border-gray-100 dark:border-gray-700" />
              )}
              <div className="space-y-1">
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.path);
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                        active
                          ? "bg-mint-green/10 text-mint-green dark:text-mint-green"
                          : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white"
                      }`}
                      title={isCollapsed ? item.name : undefined}
                    >
                      <Icon className={`w-5 h-5 flex-shrink-0 ${active ? "text-mint-green" : ""}`} />
                      {!isCollapsed && (
                        <span className={`text-sm font-medium ${active ? "text-mint-green" : ""}`}>
                          {item.name}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* User section */}
      <div className="border-t border-gray-200 dark:border-gray-700 p-3">
        {!isCollapsed && (
          <div className="mb-2 px-2">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {profile?.display_name || profile?.email?.split("@")[0]}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{profile?.email}</p>
            <span
              className={`inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded-full ${
                isSuperAdmin
                  ? "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
                  : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
              }`}
            >
              {profile?.role}
            </span>
          </div>
        )}
        <button
          onClick={handleSignOut}
          className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white transition-colors ${
            isCollapsed ? "justify-center" : ""
          }`}
          title={isCollapsed ? "Sign Out" : undefined}
        >
          <ArrowLeftOnRectangleIcon className="w-5 h-5" />
          {!isCollapsed && <span className="text-sm">Sign Out</span>}
        </button>
      </div>
    </aside>
  );
}
