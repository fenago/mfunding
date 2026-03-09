import { Link, useLocation } from "react-router-dom";

const TABS = [
  { path: "/admin/analytics", label: "Overview", exact: true },
  { path: "/admin/analytics/realtime", label: "Real-Time" },
  { path: "/admin/analytics/deals", label: "Deal Analytics" },
  { path: "/admin/analytics/closers", label: "Closers" },
  { path: "/admin/analytics/lenders", label: "Lenders" },
  { path: "/admin/analytics/markets", label: "Markets" },
  { path: "/admin/analytics/lead-sources", label: "Lead Sources" },
];

export default function AnalyticsTabNav() {
  const location = useLocation();

  const isActive = (tab: typeof TABS[0]) => {
    if (tab.exact) {
      return location.pathname === tab.path;
    }
    return location.pathname === tab.path;
  };

  return (
    <div className="border-b border-gray-200 dark:border-gray-700">
      <nav className="flex gap-1 overflow-x-auto -mb-px" aria-label="Analytics tabs">
        {TABS.map((tab) => (
          <Link
            key={tab.path}
            to={tab.path}
            className={`whitespace-nowrap px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
              isActive(tab)
                ? "border-ocean-blue text-ocean-blue dark:text-blue-400 dark:border-blue-400 bg-blue-50/50 dark:bg-blue-900/10"
                : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
