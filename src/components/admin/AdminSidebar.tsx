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
} from "@heroicons/react/24/outline";
import { useUserProfile } from "../../context/UserProfileContext";
import supabase from "../../supabase";
import Logo from "../ui/Logo";

interface NavItem {
  name: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: ("admin" | "super_admin")[];
}

const navItems: NavItem[] = [
  { name: "Dashboard", path: "/admin", icon: HomeIcon, roles: ["admin", "super_admin"] },
  { name: "Launch Board", path: "/admin/todos", icon: ClipboardDocumentListIcon, roles: ["admin", "super_admin"] },
  { name: "Lenders", path: "/admin/lenders", icon: BuildingLibraryIcon, roles: ["super_admin"] },
  { name: "Customers", path: "/admin/customers", icon: UsersIcon, roles: ["admin", "super_admin"] },
  { name: "Marketing", path: "/admin/marketing", icon: MegaphoneIcon, roles: ["super_admin"] },
  { name: "Unit Economics", path: "/admin/unit-economics", icon: CalculatorIcon, roles: ["super_admin"] },
  { name: "Business Model", path: "/admin/bmc", icon: RectangleGroupIcon, roles: ["super_admin"] },
  { name: "Settings", path: "/admin/settings", icon: Cog6ToothIcon, roles: ["super_admin"] },
];

export default function AdminSidebar() {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem("adminSidebarCollapsed");
    return saved ? JSON.parse(saved) : false;
  });
  const location = useLocation();
  const { profile, isSuperAdmin, isAdmin } = useUserProfile();

  useEffect(() => {
    localStorage.setItem("adminSidebarCollapsed", JSON.stringify(isCollapsed));
  }, [isCollapsed]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const filteredNavItems = navItems.filter((item) => {
    if (isSuperAdmin) return true;
    if (isAdmin && item.roles.includes("admin")) return true;
    return false;
  });

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

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {filteredNavItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                active
                  ? "bg-mint-green/10 text-mint-green dark:text-mint-green"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
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
      </nav>

      {/* User section */}
      <div className="border-t border-gray-200 dark:border-gray-700 p-3">
        {!isCollapsed && (
          <div className="mb-2 px-2">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {profile?.display_name || profile?.email?.split("@")[0]}
            </p>
            <p className="text-xs text-gray-500 truncate">{profile?.email}</p>
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
          className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
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
