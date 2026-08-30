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
  ChevronDownIcon,
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
  ClockIcon,
  DevicePhoneMobileIcon,
} from "@heroicons/react/24/outline";
import { useUserProfile } from "../../context/UserProfileContext";
import { useRenewalsAccess, useCloserLens } from "../../hooks/useCloserSplits";
import { useUnreadSms } from "../../hooks/useUnreadSms";
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
  "/admin/data-hygiene", // Data Hygiene (roles: ADMIN) — smart lists + skip-trace/enrich/validate; pure closers excluded via roles
  "/admin/setter-performance", // Setter Performance (roles: ADMIN) — WAVV per-rep scorecard; pure closers excluded via roles
  "/admin/text-messages", // 💬 Text Messages — the shared SMS line's two-way inbox, every staff role
  "/admin/dialing-machine", // 🔗 How the Dialing Machine Works — the lists→WAVV one-pager, every staff role
  "/admin/ucc-machine-guide", // 🔗 How the UCC Harvester Works — the sibling one-pager, every staff role
  "/admin/setter-guide", // 🛟 Setter Onboarding Guide — day-one read, every staff role (and pure setters, see canSee)
]);

// NOTE: Grouping / order / collapsibility only. Every item keeps its exact
// `path` and `roles` — the closer-lens (CLOSER_LENS_PATHS), the pure-setter
// whitelist in canSee(), and all role gating are unchanged by the regroup.
const navGroups: NavGroup[] = [
  {
    // Daily — the everyday work surface. A pure setter (role "closer") sees their
    // whole world in this one group (Playbook, Texts, Setter Perf, Setter Guide,
    // Calendar, Cheat Sheet, My Profile); everyone else gets the full set.
    title: "Daily",
    items: [
      { name: "Revenue Playbook", path: "/admin/playbooks", icon: MapIcon, roles: OPS },
      // Shared company SMS line (two-way). OPS + closer lens — a setter working a
      // merchant in the Playbook reaches for the text line next. The ops half
      // lives under System → Text Message Administration.
      { name: "Text Messages", path: "/admin/text-messages", icon: DevicePhoneMobileIcon, roles: OPS },
      // Data Hygiene — smart lists + skip-trace / enrich / phone validation before
      // a book hits the floor. ADMIN (managers); also visible through the lens.
      { name: "Data Hygiene", path: "/admin/data-hygiene", icon: CircleStackIcon, roles: ADMIN },
      // Setter Performance — the dial-floor scorecard (reads WAVV). OPS + lens.
      { name: "Setter Performance", path: "/admin/setter-performance", icon: ChartBarSquareIcon, roles: OPS },
      // Setter Guide — day-one onboarding read; pure setters reach it via a canSee
      // exception (the one doc they must open before their first live call).
      { name: "Setter Guide", path: "/admin/setter-guide", icon: LifebuoyIcon, roles: OPS },
      { name: "Calendar", path: "/admin/calendar", icon: CalendarDaysIcon, roles: OPS },
      { name: "Deals", path: "/admin/deals", icon: DocumentTextIcon, roles: OPS },
      // Funder Cheat Sheet — which funder gets the deal in front of you. OPS
      // (closers included) + lens: the reference they work off on every submission.
      { name: "Funder Cheat Sheet", path: "/admin/cheat-sheet", icon: PuzzlePieceIcon, roles: OPS },
      // My Profile — self-service name/address/1099 edit. Kept in Daily so a pure
      // setter sees a single clean group; also reachable from the user card below.
      { name: "My Profile", path: "/admin/my-profile", icon: UserCircleIcon, roles: OPS },
    ],
  },
  {
    // Lead Gen — every lead-sourcing console + tool (import / campaign / outreach).
    title: "Lead Gen",
    items: [
      // PH Setters — the outbound-setter console. ADMIN + super; admins with a
      // closer row see it through the lens.
      { name: "PH Setters", path: "/admin/ph-setters", icon: PhoneArrowUpRightIcon, roles: ADMIN },
      // UCC Harvester — the outbound UCC lead engine dashboard (operational
      // console; its explainer is "UCC Harvester — Guide" below).
      { name: "UCC Harvester", path: "/admin/ph-ucc", icon: RectangleStackIcon, roles: ADMIN },
      // Lead Machine — purchased-list pipeline (upload CSV → filter → tag → push to
      // VibeReach for the dialer). Feeds the same dial floor as the UCC Harvester.
      { name: "Lead Machine", path: "/admin/lead-machine", icon: DocumentArrowUpIcon, roles: ADMIN },
      // Dialing Machine — the lists→dialer one-pager. OPS: rewritten for
      // VibeReach + WAVV, so setters can read it again.
      { name: "Dialing Machine", path: "/admin/dialing-machine", icon: ShareIcon, roles: OPS },
      // UCC Harvester — Guide — the sibling explainer (Source → Match → Build →
      // Skip-Trace → Activate). OPS reference material every staff role reads.
      { name: "UCC Harvester — Guide", path: "/admin/ucc-machine-guide", icon: CircleStackIcon, roles: OPS },
      { name: "Lead Partner (Synergy)", path: "/admin/lead-partner", icon: BuildingOffice2Icon, roles: ADMIN },
      { name: "Email (Instantly)", path: "/admin/email", icon: EnvelopeIcon, roles: ADMIN },
      { name: "Cold Email Planner", path: "/admin/cold-email", icon: RocketLaunchIcon, roles: ADMIN },
      { name: "Lead Import", path: "/admin/lead-import", icon: ArrowUpTrayIcon, roles: ADMIN },
      { name: "Campaigns", path: "/admin/campaigns", icon: MegaphoneIcon, roles: ADMIN },
      { name: "Sequences", path: "/admin/sequences", icon: ArrowPathRoundedSquareIcon, roles: OPS },
      { name: "Lead Tools", path: "/admin/lead-tools", icon: WrenchScrewdriverIcon, roles: OPS },
      { name: "Referrals", path: "/admin/referrals", icon: UserPlusIcon, roles: ADMIN },
    ],
  },
  {
    // Funder Network — the funder relationships (ADMIN manage these even with a
    // closer row; pure closers never see them via the roles array).
    title: "Funder Network",
    items: [
      { name: "Lenders", path: "/admin/lenders", icon: BuildingLibraryIcon, roles: ADMIN },
      { name: "Lender Catalog", path: "/admin/lender-catalog", icon: RectangleStackIcon, roles: ADMIN },
      { name: "Funder Directory", path: "/admin/funder-directory", icon: BuildingLibraryIcon, roles: ADMIN },
      { name: "Funder Approval Matrix", path: "/admin/funder-matrix", icon: TableCellsIcon, roles: ADMIN },
      { name: "Funder Contacts", path: "/admin/funder-contacts", icon: UserGroupIcon, roles: ADMIN },
    ],
  },
  {
    // Pipeline & Comms — the active-deal work surface.
    title: "Pipeline & Comms",
    items: [
      { name: "Customers", path: "/admin/customers", icon: UsersIcon, roles: OPS },
      { name: "Comms", path: "/admin/comms", icon: ChatBubbleLeftRightIcon, roles: OPS },
      { name: "Doc Review", path: "/admin/documents", icon: DocumentMagnifyingGlassIcon, roles: OPS },
      { name: "Renewals", path: "/admin/renewals", icon: ArrowPathIcon, roles: OPS },
      { name: "Task Board", path: "/admin/todos", icon: ClipboardDocumentListIcon, roles: ADMIN },
      // Closer Documents — OPS + lens: a closer opens this to read/e-sign their OWN
      // docs; the manager view (every closer's status) renders only for admin/super.
      { name: "Closer Documents", path: "/admin/closer-docs", icon: DocumentTextIcon, roles: OPS },
    ],
  },
  {
    // Insights — dashboards, analytics + all money/commission reporting.
    title: "Insights",
    items: [
      // Dashboard — managers only; the closer lens lands on the Revenue Playbook.
      { name: "Dashboard", path: "/admin", icon: HomeIcon, roles: ADMIN },
      { name: "Analytics", path: "/admin/analytics", icon: ChartBarSquareIcon, roles: SUPER },
      { name: "Funder Performance", path: "/admin/analytics/lenders", icon: BuildingLibraryIcon, roles: ADMIN },
      { name: "Real-Time", path: "/admin/analytics/realtime", icon: SignalIcon, roles: SUPER },
      { name: "Unit Economics (MCA)", path: "/admin/unit-economics", icon: CalculatorIcon, roles: SUPER },
      { name: "Unit Economics (VCF)", path: "/admin/unit-economics-vcf", icon: CalculatorIcon, roles: SUPER },
      { name: "Live Transfer ROI", path: "/admin/live-transfer-roi", icon: PhoneArrowUpRightIcon, roles: SUPER },
      // Owner-only: pipeline + funded commission, measured funnel conversion vs target.
      { name: "Revenue & Commission", path: "/admin/revenue", icon: ReceiptPercentIcon, roles: SUPER },
      { name: "Commissions", path: "/admin/commissions", icon: BanknotesIcon, roles: SUPER },
      // Personal money views (OPS + lens): a closer checks their own book/comp.
      { name: "My Earnings", path: "/admin/my-earnings", icon: BanknotesIcon, roles: OPS },
      { name: "Closer Comp", path: "/admin/closer-comp", icon: ReceiptPercentIcon, roles: OPS },
    ],
  },
  {
    // System — super-admin config, team/network admin, marketing-vendor admin, and
    // the reference/training library. (Resources/Documentation/Strategy are OPS and
    // in the lens; R&D is ADMIN + lens — the rest are super-admin only.)
    title: "System",
    items: [
      { name: "System Health", path: "/admin/system", icon: HeartIcon, roles: ADMIN },
      { name: "Settings", path: "/admin/settings", icon: Cog6ToothIcon, roles: SUPER },
      { name: "Platform Config", path: "/admin/platform-config", icon: Cog6ToothIcon, roles: SUPER },
      { name: "Integrations", path: "/admin/settings/integrations", icon: ArrowsRightLeftIcon, roles: SUPER },
      { name: "Underwriting Settings", path: "/admin/underwriting-settings", icon: AdjustmentsHorizontalIcon, roles: SUPER },
      { name: "Plaid", path: "/admin/plaid", icon: BanknotesIcon, roles: SUPER },
      { name: "Users", path: "/admin/users", icon: UsersIcon, roles: SUPER },
      { name: "Compliance", path: "/admin/compliance", icon: ShieldExclamationIcon, roles: SUPER },
      { name: "GHL Sync Log", path: "/admin/sync-log", icon: SignalIcon, roles: SUPER },
      // Text Message Administration — bridge health / message log / opt-out audit.
      { name: "Text Message Administration", path: "/admin/text-messages/admin", icon: DevicePhoneMobileIcon, roles: SUPER },
      { name: "Lead Sources", path: "/admin/lead-sources", icon: SignalIcon, roles: SUPER },
      { name: "Marketing Vendors", path: "/admin/marketing", icon: MegaphoneIcon, roles: SUPER },
      { name: "Vendor Scorecard", path: "/admin/marketing/scorecard", icon: ChartBarSquareIcon, roles: SUPER },
      { name: "Live Transfer Leads", path: "/admin/marketing/live-transfers", icon: PhoneArrowUpRightIcon, roles: SUPER },
      { name: "Lead Lists & Data", path: "/admin/marketing/lead-lists", icon: WrenchScrewdriverIcon, roles: SUPER },
      { name: "Budget Planner", path: "/admin/lead-budget", icon: CalculatorIcon, roles: SUPER },
      { name: "Business Model", path: "/admin/bmc", icon: RectangleGroupIcon, roles: SUPER },
      { name: "Closers", path: "/admin/closers", icon: UserGroupIcon, roles: SUPER },
      { name: "Sub-ISOs", path: "/admin/sub-isos", icon: BuildingOffice2Icon, roles: SUPER },
      // Owner-only: the weekly payroll run — hours, hourly rates, what's been paid.
      { name: "Time & Pay", path: "/admin/time-pay", icon: ClockIcon, roles: SUPER },
      { name: "Resources", path: "/admin/resources", icon: BookOpenIcon, roles: OPS },
      // Documentation — every staff role reads it. OPS also covers `employee`,
      // which is mapped onto the "admin" NavRole below.
      { name: "Documentation", path: "/admin/docs", icon: AcademicCapIcon, roles: OPS },
      // Strategy — sales doctrine. Closers NEED it, so OPS + in the lens.
      { name: "Strategy", path: "/admin/strategy", icon: LightBulbIcon, roles: OPS },
      // R&D — the owner's strategic build-out game plan. ADMIN + lens.
      { name: "R&D", path: "/admin/rnd", icon: BeakerIcon, roles: ADMIN },
    ],
  },
];

export default function AdminSidebar() {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem("adminSidebarCollapsed");
    return saved ? JSON.parse(saved) : false;
  });
  // Per-group expand/collapse (manager view only). Persisted so it survives
  // reloads. Shape: { [groupTitle]: true } means COLLAPSED; absent/false =
  // expanded. Default: every group collapsed EXCEPT "Daily" (the day-to-day
  // tools stay open; everything else folds away until the user opens it).
  // A saved preference always wins over this default.
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    const defaultCollapsed: Record<string, boolean> = {
      "Lead Gen": true,
      "Funder Network": true,
      "Pipeline & Comms": true,
      Insights: true,
      System: true,
    };
    try {
      const saved = localStorage.getItem("adminSidebarGroups");
      return saved ? (JSON.parse(saved) as Record<string, boolean>) : defaultCollapsed;
    } catch {
      return defaultCollapsed;
    }
  });
  const toggleGroup = (title: string) =>
    setCollapsedGroups((prev) => ({ ...prev, [title]: !prev[title] }));
  const location = useLocation();
  const { profile, isSuperAdmin } = useUserProfile();
  const { canSeeRenewals, loading: renewalsLoading } = useRenewalsAccess();
  const { isCloserLens } = useCloserLens();
  // Org-wide unread count for the shared SMS line → badge on "Text Messages".
  const unreadSms = useUnreadSms();
  const { mode, cycleMode } = useTheme();
  const ThemeIcon = mode === "dark" ? MoonIcon : mode === "light" ? SunIcon : ComputerDesktopIcon;
  const themeLabel = mode === "dark" ? "Dark" : mode === "light" ? "Light" : "System";

  useEffect(() => {
    localStorage.setItem("adminSidebarCollapsed", JSON.stringify(isCollapsed));
  }, [isCollapsed]);

  useEffect(() => {
    localStorage.setItem("adminSidebarGroups", JSON.stringify(collapsedGroups));
  }, [collapsedGroups]);

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
    // name/address/1099 details current, the "Setter Guide" — their day-one
    // onboarding doc, which they have to be able to re-open on the floor, the
    // "Funder Cheat Sheet" (owner request 8/23: the deal-matching reference
    // is available to closers; a closer_read_lenders RLS policy backs it), and
    // the "Calendar" (owner request 8/26: closers/setters must see their own
    // appointments + callbacks; RLS scopes it to their book).
    if (
      profile?.role === "closer" &&
      item.path !== "/admin/playbooks" &&
      item.path !== "/admin/my-profile" &&
      item.path !== "/admin/setter-guide" &&
      item.path !== "/admin/cheat-sheet" &&
      item.path !== "/admin/calendar" &&
      item.path !== "/admin/setter-performance" &&
      // Text Messages: the shared line is how merchants text back. A setter who
      // can't see the reply can't work it, so it's on the setter's short list.
      item.path !== "/admin/text-messages"
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
          const groupCollapsed = !!collapsedGroups[group.title];
          // In the collapsed icon rail there is no header to click, so groups
          // always render their items (divider-separated) — preserves the
          // existing rail behavior. Only the expanded sidebar folds groups.
          const showItems = isCollapsed || !groupCollapsed;
          return (
            <div key={group.title} className="mb-2">
              {!isCollapsed ? (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.title)}
                  aria-expanded={!groupCollapsed}
                  className="w-full flex items-center justify-between px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  <span>{group.title}</span>
                  <ChevronDownIcon
                    className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${
                      groupCollapsed ? "-rotate-90" : ""
                    }`}
                  />
                </button>
              ) : (
                <div className="my-2 mx-2 border-t border-gray-100 dark:border-gray-700" />
              )}
              {showItems && (
              <div className="space-y-1">
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.path);
                  // Unread badge, only on the shared-line Text Messages item, only
                  // when there's something waiting. Org-wide count (see useUnreadSms).
                  const badge = item.path === "/admin/text-messages" ? unreadSms : 0;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
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
                      {badge > 0 &&
                        (isCollapsed ? (
                          // Collapsed rail: a compact dot on the icon corner — the
                          // label is hidden, so a full pill has nowhere to sit.
                          <span
                            className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none tabular-nums"
                            title={`${badge} unread text${badge === 1 ? "" : "s"}`}
                          >
                            {badge > 99 ? "99+" : badge}
                          </span>
                        ) : (
                          <span
                            className="ml-auto min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold tabular-nums"
                            title={`${badge} unread text${badge === 1 ? "" : "s"}`}
                          >
                            {badge > 99 ? "99+" : badge}
                          </span>
                        ))}
                    </Link>
                  );
                })}
              </div>
              )}
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
