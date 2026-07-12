import { useEffect, useState } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import {
  HomeIcon,
  DocumentIcon,
  InboxIcon,
  QuestionMarkCircleIcon,
  ArrowLeftOnRectangleIcon,
} from "@heroicons/react/24/outline";
import { useUserProfile } from "../../context/UserProfileContext";
import supabase from "../../supabase";
import Logo from "../../components/ui/Logo";
import SEO from "../../components/seo/SEO";
import NotificationBell from "../../components/portal/NotificationBell";
import VersionRefreshToast from "../../components/portal/VersionRefreshToast";

const navItems = [
  { name: "Dashboard", path: "/portal", icon: HomeIcon },
  { name: "Documents", path: "/portal/documents", icon: DocumentIcon },
  { name: "Inbox", path: "/portal/inbox", icon: InboxIcon },
  { name: "How it works", path: "/portal/how-it-works", icon: QuestionMarkCircleIcon },
];

export default function PortalLayout() {
  const location = useLocation();
  const { profile } = useUserProfile();
  const [unreadMessages, setUnreadMessages] = useState(0);

  // Unread-message count for the Inbox nav badge. Re-checked on navigation so
  // reading messages clears the badge without a full reload.
  useEffect(() => {
    const uid = profile?.id;
    if (!uid) return;
    let alive = true;
    supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("to_user_id", uid)
      .eq("status", "unread")
      .then(({ count }) => {
        if (alive) setUnreadMessages(count || 0);
      });
    return () => {
      alive = false;
    };
  }, [profile?.id, location.pathname]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const isActive = (path: string) => {
    if (path === "/portal") {
      return location.pathname === "/portal";
    }
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <SEO title="Customer Portal" noIndex={true} />
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link to="/">
              <Logo variant="full" size="sm" theme="light" />
            </Link>

            <nav className="flex items-center gap-6">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.path);
                const showBadge = item.path === "/portal/inbox" && unreadMessages > 0;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`relative flex items-center gap-2 text-sm font-medium transition-colors ${
                      active
                        ? "text-mint-green"
                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    }`}
                  >
                    <span className="relative">
                      <Icon className="w-5 h-5" />
                      {showBadge && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 bg-mint-green text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                          {unreadMessages > 9 ? "9+" : unreadMessages}
                        </span>
                      )}
                    </span>
                    <span className="hidden sm:inline">{item.name}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="flex items-center gap-4">
              <NotificationBell userId={profile?.id} />
              <span className="text-sm text-gray-500 dark:text-gray-400 hidden sm:inline">
                {profile?.email}
              </span>
              <button
                onClick={handleSignOut}
                className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              >
                <ArrowLeftOnRectangleIcon className="w-5 h-5" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      {/* New-deploy detector — unobtrusive "Refresh" toast, never auto-reloads */}
      <VersionRefreshToast />
    </div>
  );
}
