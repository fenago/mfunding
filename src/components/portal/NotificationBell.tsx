import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { BellIcon, PencilSquareIcon } from "@heroicons/react/24/outline";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import supabase from "../../supabase";
import { tryWrite } from "@/supabase/writes";
import {
  getMyMessages,
  getMyMerchantDocuments,
  type PortalMessage,
  type MerchantDocument,
} from "../../services/portalService";
import { classifyMessage, relativeTime } from "../../utils/portalNotifications";

interface NotificationBellProps {
  userId: string | undefined;
}

const RECENT_LIMIT = 8;

/** Quick-glance notification center in the portal header. The full two-way
 *  center is /portal/inbox — this is the peek. Unread reflects messages with
 *  status='unread' for the signed-in merchant; refetches on open and on route
 *  change (no realtime this wave). */
export default function NotificationBell({ userId }: NotificationBellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [toSign, setToSign] = useState<MerchantDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [msgs, mDocs] = await Promise.all([
        getMyMessages(userId),
        getMyMerchantDocuments().catch(() => [] as MerchantDocument[]),
      ]);
      setMessages(msgs);
      setToSign(mDocs.filter((d) => d.status === "sent"));
    } catch (e) {
      console.error("Failed to load notifications:", e);
      setMessages([]);
      setToSign([]);
    }
    setLoading(false);
  };

  // Refetch whenever the route changes (reading in the inbox clears unread) and
  // on mount.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, location.pathname]);

  // Refetch each time the panel is opened for a fresh count.
  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Agreements awaiting signature are always "action needed" — count them in the
  // badge and pin them to the top so a 'sent' doc can never be missed, even if no
  // portal message was created for it.
  const unreadCount = messages.filter((m) => m.status === "unread").length + toSign.length;
  const recent = messages.slice(0, RECENT_LIMIT);

  const markRead = async (m: PortalMessage) => {
    if (m.status !== "unread") return;
    setMessages((prev) =>
      prev.map((x) => (x.id === m.id ? { ...x, status: "read" as const } : x)),
    );
    await tryWrite(
      "mark notification read",
      supabase
        .from("messages")
        .update({ status: "read", read_at: new Date().toISOString() })
        .eq("id", m.id),
    );
  };

  const markAllRead = async () => {
    const unread = messages.filter((m) => m.status === "unread");
    if (unread.length === 0) return;
    setMessages((prev) => prev.map((m) => ({ ...m, status: "read" as const })));
    await tryWrite(
      "mark all notifications read",
      supabase
        .from("messages")
        .update({ status: "read", read_at: new Date().toISOString() })
        .eq("to_user_id", userId ?? "")
        .eq("status", "unread"),
    );
  };

  const onRowClick = (m: PortalMessage) => {
    const { deepLink } = classifyMessage(m);
    void markRead(m);
    setOpen(false);
    navigate(deepLink || "/portal/inbox");
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative p-1.5 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
      >
        <BellIcon className="w-6 h-6" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 bg-mint-green text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Mobile backdrop */}
          <div className="fixed inset-0 z-30 bg-black/20 sm:hidden" aria-hidden />
          <div
            className="fixed inset-x-2 top-16 z-40 sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <span className="font-semibold text-gray-900 dark:text-white">Notifications</span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="text-xs font-medium text-ocean-blue hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-[60vh] sm:max-h-96 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
              {/* Pinned: agreements ready to sign — always on top */}
              {toSign.map((d) => (
                <button
                  key={`sign-${d.id}`}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate(`/portal/sign/${d.id}`);
                  }}
                  className="w-full text-left px-4 py-3 flex items-start gap-3 bg-ocean-blue/5 hover:bg-ocean-blue/10 transition-colors"
                >
                  <span className="p-1.5 rounded-lg bg-ocean-blue/10 text-ocean-blue flex-shrink-0">
                    <PencilSquareIcon className="w-4 h-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                      Agreement ready to sign
                    </p>
                    <p className="text-xs text-gray-500 truncate">{d.name}</p>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-mint-green flex-shrink-0 mt-1.5" />
                </button>
              ))}

              {loading && recent.length === 0 && toSign.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-500">Loading…</div>
              ) : recent.length === 0 && toSign.length === 0 ? (
                <div className="p-6 text-center">
                  <CheckCircleIcon className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">You're all caught up.</p>
                </div>
              ) : (
                recent.map((m) => {
                  const { Icon } = classifyMessage(m);
                  const unread = m.status === "unread";
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onRowClick(m)}
                      className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                        unread ? "bg-mint-green/5" : ""
                      }`}
                    >
                      <span className="p-1.5 rounded-lg bg-ocean-blue/10 text-ocean-blue flex-shrink-0">
                        <Icon className="w-4 h-4" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm truncate ${
                            unread
                              ? "font-semibold text-gray-900 dark:text-white"
                              : "text-gray-700 dark:text-gray-300"
                          }`}
                        >
                          {m.subject || "Update on your file"}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {m.body.slice(0, 60)}
                          {m.body.length > 60 ? "…" : ""}
                        </p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {relativeTime(m.created_at)}
                        </p>
                      </div>
                      {unread && (
                        <span className="w-2 h-2 rounded-full bg-mint-green flex-shrink-0 mt-1.5" />
                      )}
                    </button>
                  );
                })
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate("/portal/inbox");
              }}
              className="w-full px-4 py-3 text-sm font-semibold text-ocean-blue hover:bg-gray-50 dark:hover:bg-gray-700/50 border-t border-gray-200 dark:border-gray-700 transition-colors"
            >
              View all
            </button>
          </div>
        </>
      )}
    </div>
  );
}
