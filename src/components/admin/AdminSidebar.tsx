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
  PhoneIcon,
  ChatBubbleLeftRightIcon,
  EnvelopeIcon,
  TableCellsIcon,
  RocketLaunchIcon,
  ArrowUpTrayIcon,
  DocumentArrowUpIcon,
  AdjustmentsHorizontalIcon,
  AcademicCapIcon,
  CalendarDaysIcon,
  LightBulbIcon,
  RectangleStackIcon,
  HeartIcon,
  BeakerIcon,
  PuzzlePieceIcon,
  ShareIcon,
  CircleStackIcon,
  UserCircleIcon,
  LifebuoyIcon,
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
  "/admin/calendar", // 📅 callbacks + stips promises — RLS scopes to their book
  "/admin/comms",
  "/admin/documents", // Doc Review
  "/admin/todos", // Task Board
  "/admin/resources",
  "/admin/docs", // 📚 how the business + the product work — closers read the functional set
  "/admin/strategy", // 💡 sales doctrine — closers NEED the training
  "/admin/cheat-sheet", // 🎯 Funder Cheat Sheet — deal-matching reference, every staff role
  "/admin/closer-comp", // their comp offer sheet + payout calculator (OPS)
  "/admin/closer-docs", // 📝 their onboarding paperwork — they have to read + e-sign it
  "/admin/my-earnings", // 💰 their own commissions + projected pipeline (OPS)
  "/admin/my-profile", // 👤 self-service edit of their own name/address/1099 details (OPS)
  "/admin/renewals", // shown per closers.renewals_enabled (handled in canSee)
  // Visible through the lens but still role-gated below — so an ADMIN who also
  // has a closer row (e.g. Carlos) gets these, while pure closers never do.
  "/admin/lead-partner", // Lead Partner (Synergy)
  "/admin/email", // Email (Instantly)
  // Funder network (roles: ADMIN) — admins manage the funder relationships even
  // when they also carry a closer row. Pure closers still never see these,
  // because the ADMIN roles array below excludes them.
  // Same rule for the Dashboard + Deals list: an ADMIN with a closer row (Carlos)
  // manages the whole pipeline, not just his own book — the lens must not strip
  // the two most basic management surfaces. Pure closers stay excluded via roles.
  "/admin",
  "/admin/deals",
  "/admin/lenders",
  "/admin/funder-directory",
  "/admin/funder-matrix",
  "/admin/funder-contacts",
  "/admin/lender-catalog", // ADMIN-roled below, so pure closers still never see it
  "/admin/rnd", // R&D game plan (roles: ADMIN) — Carlos manages the build-out too; pure closers excluded via roles
  "/admin/ph-setters", // PH Setter Playbook (roles: ADMIN) — same lens treatment as R&D; pure closers excluded via roles
  "/admin/ph-ucc", // PH UCC Harvester (roles: ADMIN) — same lens treatment as PH Setters; pure closers excluded via roles
  "/admin/lead-machine", // Lead Machine (roles: ADMIN) — purchased-list upload → tag → VibeReach push; pure closers excluded via roles
  "/admin/dialer", // Dialer Metrics (roles: ADMIN) — HotProspector scorecard; pure closers excluded via roles
  "/admin/dialing-machine", // 🔗 How the Dialing Machine Works (roles: ADMIN since 8/17 — SOP still shows the retired HotProspector leg; closers use the Setter Guide)
  "/admin/ucc-machine-guide", // 🔗 How the UCC Harvester Works — the sibling one-pager, every staff role
  "/admin/setter-guide", // 🛟 Setter Onboarding Guide — day-one read, every staff role (and pure setters, see canSee)
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
      // PH Setter Playbook — the outbound-setter console. Admin + super_admin
      // (matches R&D); admins with a closer row see it through the lens.
      { name: "PH Setters", path: "/admin/ph-setters", icon: PhoneArrowUpRightIcon, roles: ADMIN },
      // UCC Harvester — outbound UCC lead engine dashboard. Directly after PH
      // Setters (owner-specified order); same ADMIN gating + closer lens.
      { name: "UCC Harvester", path: "/admin/ph-ucc", icon: RectangleStackIcon, roles: ADMIN },
      // Lead Machine — the purchased-list pipeline (upload a bought CSV, filter
      // it, tag it, push it into VibeReach for the dialer). Sits next to the UCC
      // Machine because both feed the same dial floor; same ADMIN gating + lens.
      { name: "Lead Machine", path: "/admin/lead-machine", icon: DocumentArrowUpIcon, roles: ADMIN },
      // Dialer Metrics — per-rep HotProspector scorecard for running the setter
      // floor. Sits with the other PH consoles; same ADMIN gating + closer lens.
      { name: "Dialer Metrics", path: "/admin/dialer", icon: PhoneIcon, roles: ADMIN },
      // How the Dialing Machine Works — the lists→dialer pipeline one-pager.
      // ADMIN-gated since 8/17: its SOP still describes the retired
      // HotProspector leg (owner: "we are not using hot prospector at all"),
      // so closers must not read it until it's rewritten for VibeReach+WAVV.
      // Closers get the current flow in the Setter Guide instead.
      { name: "Dialing Machine", path: "/admin/dialing-machine", icon: ShareIcon, roles: ADMIN },
      // How the UCC Harvester Works — the sibling one-pager (Source → Match →
      // Build → Skip-Trace → Activate). The owner wants the two explainers
      // adjacent, so it sits immediately after Dialing Machine. Same OPS gating:
      // it's reference material every staff role reads, and it's the EXPLAINER —
      // the operational console is "UCC Harvester" (/admin/ph-ucc) above.
      {
        name: "UCC Harvester — Guide",
        path: "/admin/ucc-machine-guide",
        icon: CircleStackIcon,
        roles: OPS,
      },
      // Setter Onboarding Guide — the day-one read for a brand-new setter (Chrome
      // + same-session login, both profiles, the dialer, the on-call flow,
      // compliance, troubleshooting). Sits with the other PH explainers. OPS, and
      // pure setters reach it too (canSee carries an explicit exception): this is
      // the one doc they have to read before their first live call.
      { name: "Setter Guide", path: "/admin/setter-guide", icon: LifebuoyIcon, roles: OPS },
      { name: "Calendar", path: "/admin/calendar", icon: CalendarDaysIcon, roles: OPS },
      { name: "Deals", path: "/admin/deals", icon: DocumentTextIcon, roles: OPS },
      // Funder Cheat Sheet — which funder gets the deal in front of you. OPS
      // (every staff role, closers included) and in the closer lens: it's the
      // reference they work off on every submission.
      { name: "Funder Cheat Sheet", path: "/admin/cheat-sheet", icon: PuzzlePieceIcon, roles: OPS },
      { name: "Lenders", path: "/admin/lenders", icon: BuildingLibraryIcon, roles: ADMIN },
      // Directly under Lenders — owner-specified order.
      { name: "Lender Catalog", path: "/admin/lender-catalog", icon: RectangleStackIcon, roles: ADMIN },
      { name: "Funder Directory", path: "/admin/funder-directory", icon: BuildingLibraryIcon, roles: ADMIN },
      { name: "Funder Approval Matrix", path: "/admin/funder-matrix", icon: TableCellsIcon, roles: ADMIN },
      { name: "Funder Contacts", path: "/admin/funder-contacts", icon: UserGroupIcon, roles: ADMIN },
      { name: "Task Board", path: "/admin/todos", icon: ClipboardDocumentListIcon, roles: ADMIN },
      { name: "Comms", path: "/admin/comms", icon: ChatBubbleLeftRightIcon, roles: OPS },
      { name: "Doc Review", path: "/admin/documents", icon: DocumentMagnifyingGlassIcon, roles: OPS },
      { name: "Customers", path: "/admin/customers", icon: UsersIcon, roles: OPS },
      { name: "Resources", path: "/admin/resources", icon: BookOpenIcon, roles: OPS },
      // Documentation — every staff role reads it. OPS here also covers `employee`,
      // which is mapped onto the "admin" NavRole below.
      { name: "Documentation", path: "/admin/docs", icon: AcademicCapIcon, roles: OPS },
      // Strategy — sales doctrine. Closers NEED it, so OPS + in the closer lens.
      { name: "Strategy", path: "/admin/strategy", icon: LightBulbIcon, roles: OPS },
      // R&D — the owner's strategic build-out game plan. Managers only (ADMIN),
      // not the closer lens: it's operation-building, not floor work.
      { name: "R&D", path: "/admin/rnd", icon: BeakerIcon, roles: ADMIN },
    ],
  },
  {
    title: "Leads & Marketing",
    items: [
      { name: "Lead Partner (Synergy)", path: "/admin/lead-partner", icon: BuildingOffice2Icon, roles: ADMIN },
      { name: "Marketing Vendors", path: "/admin/marketing", icon: MegaphoneIcon, roles: SUPER },
      { name: "Email (Instantly)", path: "/admin/email", icon: EnvelopeIcon, roles: ADMIN },
      { name: "Cold Email Planner", path: "/admin/cold-email", icon: RocketLaunchIcon, roles: ADMIN },
      { name: "Vendor Scorecard", path: "/admin/marketing/scorecard", icon: ChartBarSquareIcon, roles: SUPER },
      { name: "Live Transfer Leads", path: "/admin/marketing/live-transfers", icon: PhoneArrowUpRightIcon, roles: SUPER },
      { name: "Lead Lists & Data", path: "/admin/marketing/lead-lists", icon: WrenchScrewdriverIcon, roles: SUPER },
      { name: "Lead Import", path: "/admin/lead-import", icon: ArrowUpTrayIcon, roles: ADMIN },
      { name: "Lead Sources", path: "/admin/lead-sources", icon: SignalIcon, roles: SUPER },
      { name: "Campaigns", path: "/admin/campaigns", icon: MegaphoneIcon, roles: ADMIN },
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
      { name: "My Earnings", path: "/admin/my-earnings", icon: BanknotesIcon, roles: OPS },
      // My Profile — self-service edit of the signed-in user's own name,
      // mailing address, and 1099 business/tax details. Every staff role, and
      // reachable by pure setters (see canSee exception above).
      { name: "My Profile", path: "/admin/my-profile", icon: UserCircleIcon, roles: OPS },
      // OPS, not SUPER: a closer opens this to read and e-sign their own docs.
      // The manager view (every closer's status) only renders for admin/super.
      { name: "Closer Documents", path: "/admin/closer-docs", icon: DocumentTextIcon, roles: OPS },
      { name: "Closers", path: "/admin/closers", icon: UserGroupIcon, roles: SUPER },
      { name: "Sub-ISOs", path: "/admin/sub-isos", icon: BuildingOffice2Icon, roles: SUPER },
      { name: "Commissions", path: "/admin/commissions", icon: BanknotesIcon, roles: SUPER },
      // Owner-only: pipeline + funded commission, and measured funnel conversion vs target.
      { name: "Revenue & Commission", path: "/admin/revenue", icon: ReceiptPercentIcon, roles: SUPER },
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
      { name: "Closer Comp", path: "/admin/closer-comp", icon: ReceiptPercentIcon, roles: OPS },
      { name: "Business Model", path: "/admin/bmc", icon: RectangleGroupIcon, roles: SUPER },
    ],
  },
  {
    title: "System",
    items: [
      { name: "System Health", path: "/admin/system", icon: HeartIcon, roles: ADMIN },
      { name: "Users", path: "/admin/users", icon: UsersIcon, roles: SUPER },
      { name: "Compliance", path: "/admin/compliance", icon: ShieldExclamationIcon, roles: SUPER },
      { name: "Integrations", path: "/admin/settings/integrations", icon: ArrowsRightLeftIcon, roles: SUPER },
      { name: "Plaid", path: "/admin/plaid", icon: BanknotesIcon, roles: SUPER },
      { name: "GHL Sync Log", path: "/admin/sync-log", icon: SignalIcon, roles: SUPER },
      { name: "Underwriting Settings", path: "/admin/underwriting-settings", icon: AdjustmentsHorizontalIcon, roles: SUPER },
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
    // SETTERS ARE LOCKED TO THE PLAYBOOK. A pure setter carries role === "closer"
    // exactly; the Revenue Playbook is their ONLY screen (they open a merchant
    // from a contact deep link and work the steps there), so nothing else renders
    // in the nav. This is deliberately narrower than the closer lens below.
    // An admin who also has a closer row (e.g. Carlos) has role "admin", not
    // "closer" (see UserProfileContext) — they keep the full manager nav.
    // Exceptions: a setter can always reach "My Profile" to keep their own
    // name/address/1099 details current, and the "Setter Guide" — their day-one
    // onboarding doc, which they have to be able to re-open on the floor. Those
    // are the only two screens outside the Playbook they're allowed.
    if (
      profile?.role === "closer" &&
      item.path !== "/admin/playbooks" &&
      item.path !== "/admin/my-profile" &&
      item.path !== "/admin/setter-guide"
    )
      return false;
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

      {/* User section — the profile entry point everyone looks for. The whole
          card links to My Profile (one click, regardless of nav length). */}
      <div className="border-t border-gray-200 dark:border-gray-700 p-3">
        <Link
          to="/admin/my-profile"
          title={isCollapsed ? "My Profile" : "Open My Profile"}
          className={`flex items-center gap-3 rounded-lg mb-1 transition-colors ${
            isCollapsed ? "justify-center p-2" : "px-2 py-2"
          } ${
            isActive("/admin/my-profile")
              ? "bg-mint-green/10"
              : "hover:bg-gray-100 dark:hover:bg-gray-700"
          }`}
        >
          <UserCircleIcon
            className={`w-7 h-7 flex-shrink-0 ${
              isActive("/admin/my-profile") ? "text-mint-green" : "text-gray-400 dark:text-gray-500"
            }`}
          />
          {!isCollapsed && (
            <div className="min-w-0">
              <p
                className={`text-sm font-medium truncate ${
                  isActive("/admin/my-profile")
                    ? "text-mint-green"
                    : "text-gray-900 dark:text-gray-100"
                }`}
              >
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
        </Link>
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
