import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  InboxIcon,
  PaperAirplaneIcon,
  ArrowUturnLeftIcon,
  ArrowRightIcon,
  ChatBubbleLeftRightIcon,
} from "@heroicons/react/24/outline";
import { useSession } from "../../context/SessionContext";
import supabase from "../../supabase";
import { tryWrite } from "@/supabase/writes";
import {
  getMyConversation,
  getMyPortalDeals,
  sendMessageToAdvisor,
  SendMessageError,
  type PortalMessage,
  type PortalDeal,
} from "../../services/portalService";
import { classifyMessage, relativeTime } from "../../utils/portalNotifications";

/** Short label for a deal in the "about which request" picker. */
function dealLabel(d: PortalDeal): string {
  const num = d.deal_number || "Your request";
  const amt = d.amount_requested != null ? ` · $${d.amount_requested.toLocaleString()}` : "";
  return `${num}${amt}`;
}

export default function PortalInboxPage() {
  const { session } = useSession();
  const uid = session?.user?.id;
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [deals, setDeals] = useState<PortalDeal[]>([]);
  const [selectedDealId, setSelectedDealId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Compose (new message to the funding specialist).
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentOk, setSentOk] = useState(false);

  // Inline reply (keyed to the message being replied to).
  const [replyTo, setReplyTo] = useState<PortalMessage | null>(null);
  const [replyBody, setReplyBody] = useState("");

  useEffect(() => {
    if (uid) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const load = async () => {
    if (!uid) return;
    setIsLoading(true);
    try {
      const [msgs, dls] = await Promise.all([
        getMyConversation(uid),
        getMyPortalDeals().catch(() => [] as PortalDeal[]),
      ]);
      setMessages(msgs);
      setDeals(dls);
      setSelectedDealId((prev) => prev || dls[0]?.id || "");
    } catch (e) {
      console.error("Failed to load messages:", e);
      setMessages([]);
    }
    setIsLoading(false);
  };

  const markRead = async (m: PortalMessage) => {
    // Only inbound messages (addressed TO the merchant) are theirs to mark read.
    if (m.to_user_id !== uid || m.status !== "unread") return;
    setMessages((prev) =>
      prev.map((x) => (x.id === m.id ? { ...x, status: "read" as const } : x)),
    );
    await tryWrite(
      "mark message read",
      supabase
        .from("messages")
        .update({ status: "read", read_at: new Date().toISOString() })
        .eq("id", m.id),
    );
  };

  const toggleExpand = (m: PortalMessage) => {
    const next = expandedId === m.id ? null : m.id;
    setExpandedId(next);
    if (next) void markRead(m);
  };

  const canSend = !!selectedDealId;

  const handleSend = async () => {
    const body = composeBody.trim();
    if (!body || !canSend) return;
    setSending(true);
    setSendError(null);
    setSentOk(false);
    try {
      await sendMessageToAdvisor({
        dealId: selectedDealId,
        body,
        subject: "Message from your portal",
      });
      setComposeBody("");
      setSentOk(true);
      void load();
    } catch (e) {
      setSendError(
        e instanceof SendMessageError ? e.message : "We couldn't send that. Please try again.",
      );
    } finally {
      setSending(false);
    }
  };

  const handleReply = async (parent: PortalMessage) => {
    const body = replyBody.trim();
    if (!body || !canSend) return;
    setSending(true);
    setSendError(null);
    try {
      await sendMessageToAdvisor({
        dealId: selectedDealId,
        body,
        subject: parent.subject ? `Re: ${parent.subject}` : "Re: your message",
      });
      setReplyBody("");
      setReplyTo(null);
      setSentOk(true);
      void load();
    } catch (e) {
      setSendError(
        e instanceof SendMessageError ? e.message : "We couldn't send that. Please try again.",
      );
    } finally {
      setSending(false);
    }
  };

  // Unread is received-only (outbound messages carry the closer's read state).
  const unreadCount = messages.filter(
    (m) => m.to_user_id === uid && m.status === "unread",
  ).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Messages</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Talk to your funding specialist and see updates on your file
          {unreadCount > 0 && (
            <span className="ml-2 px-2 py-0.5 bg-mint-green text-white text-xs rounded-full">
              {unreadCount} new
            </span>
          )}
        </p>
      </div>

      {/* Compose */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <label className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white mb-2">
          <ChatBubbleLeftRightIcon className="w-5 h-5 text-mint-green" />
          Message your funding specialist
        </label>

        {/* "About which request" picker only when the merchant has more than one */}
        {deals.length > 1 && (
          <select
            value={selectedDealId}
            onChange={(e) => setSelectedDealId(e.target.value)}
            className="w-full mb-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2"
          >
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                About: {dealLabel(d)}
              </option>
            ))}
          </select>
        )}

        <textarea
          value={composeBody}
          onChange={(e) => {
            setComposeBody(e.target.value);
            setSentOk(false);
          }}
          rows={3}
          placeholder="Ask a question or send an update…"
          className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-mint-green/40"
        />
        {!canSend && (
          <p className="text-sm text-gray-500 mt-2">
            Once your funding request is started, you'll be able to message your specialist here.
          </p>
        )}
        {sendError && <p className="text-sm text-red-500 mt-2">{sendError}</p>}
        {sentOk && !sendError && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-2">
            Sent — your specialist will get back to you shortly.
          </p>
        )}
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !composeBody.trim() || !canSend}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-mint-green text-white text-sm font-semibold hover:brightness-95 disabled:opacity-50 transition"
          >
            <PaperAirplaneIcon className="w-4 h-4" />
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>

      {/* Thread */}
      {messages.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center">
          <InboxIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500">No messages yet — say hello above anytime.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map((m) => {
            // Merchant's own sent messages render as right-aligned "you" bubbles.
            if (m.from_user_id === uid) {
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-mint-green text-white px-4 py-2.5">
                    <p className="text-[11px] font-semibold opacity-80">You</p>
                    <p className="text-sm whitespace-pre-wrap">{m.body}</p>
                    <p className="text-[11px] opacity-70 mt-1 text-right">
                      {relativeTime(m.created_at)}
                    </p>
                  </div>
                </div>
              );
            }

            const { Icon, isNotification, deepLink } = classifyMessage(m);
            const expanded = expandedId === m.id;
            const unread = m.status === "unread";
            return (
              <div
                key={m.id}
                className={`rounded-xl border transition-colors ${
                  unread
                    ? "border-mint-green/50 bg-mint-green/5 dark:bg-mint-green/10"
                    : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleExpand(m)}
                  className="w-full text-left p-4 flex items-start gap-3"
                >
                  <span
                    className={`p-2 rounded-lg flex-shrink-0 ${
                      isNotification
                        ? "bg-ocean-blue/10 text-ocean-blue"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300"
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p
                        className={`truncate ${
                          unread
                            ? "font-semibold text-gray-900 dark:text-white"
                            : "text-gray-700 dark:text-gray-300"
                        }`}
                      >
                        {m.subject || (isNotification ? "Update on your file" : "Message")}
                      </p>
                      {unread && (
                        <span className="w-2 h-2 rounded-full bg-mint-green flex-shrink-0" />
                      )}
                    </div>
                    {!expanded && (
                      <p className="text-sm text-gray-500 truncate mt-0.5">
                        {m.body.slice(0, 80)}
                        {m.body.length > 80 ? "…" : ""}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">{relativeTime(m.created_at)}</p>
                  </div>
                </button>

                {expanded && (
                  <div className="px-4 pb-4 -mt-1">
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap pl-12">
                      {m.body}
                    </p>

                    {/* Deep-link for actionable notifications */}
                    {isNotification && deepLink && (
                      <div className="pl-12 mt-3">
                        <Link
                          to={deepLink}
                          onClick={() => void markRead(m)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ocean-blue text-white text-sm font-semibold hover:brightness-95 transition"
                        >
                          Take a look
                          <ArrowRightIcon className="w-4 h-4" />
                        </Link>
                      </div>
                    )}

                    {/* Reply to a person's message */}
                    {!isNotification && (
                      <div className="pl-12 mt-3">
                        {replyTo?.id === m.id ? (
                          <div className="space-y-2">
                            <textarea
                              value={replyBody}
                              onChange={(e) => setReplyBody(e.target.value)}
                              rows={3}
                              autoFocus
                              placeholder="Write your reply…"
                              className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-mint-green/40"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleReply(m)}
                                disabled={sending || !replyBody.trim() || !canSend}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-mint-green text-white text-sm font-semibold hover:brightness-95 disabled:opacity-50 transition"
                              >
                                <PaperAirplaneIcon className="w-4 h-4" />
                                {sending ? "Sending…" : "Send reply"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setReplyTo(null);
                                  setReplyBody("");
                                }}
                                className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setReplyTo(m);
                              setReplyBody("");
                              setSendError(null);
                            }}
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-ocean-blue hover:underline"
                          >
                            <ArrowUturnLeftIcon className="w-4 h-4" />
                            Reply
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
