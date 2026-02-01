import { useState, useEffect } from "react";
import {
  InboxIcon,
  EnvelopeIcon,
  EnvelopeOpenIcon,
} from "@heroicons/react/24/outline";
import { useSession } from "../../context/SessionContext";
import supabase from "../../supabase";

interface Message {
  id: string;
  subject: string;
  body: string;
  status: "unread" | "read";
  created_at: string;
  from_user_id: string;
}

export default function PortalInboxPage() {
  const { session } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);

  useEffect(() => {
    if (session?.user?.id) {
      fetchMessages();
    }
  }, [session]);

  const fetchMessages = async () => {
    setIsLoading(true);

    // Get profile ID for the current user
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", session?.user?.id)
      .single();

    if (profile) {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("to_user_id", profile.id)
        .order("created_at", { ascending: false });

      setMessages(data || []);
    }

    setIsLoading(false);
  };

  const handleSelectMessage = async (message: Message) => {
    setSelectedMessage(message);

    // Mark as read if unread
    if (message.status === "unread") {
      await supabase
        .from("messages")
        .update({ status: "read", read_at: new Date().toISOString() })
        .eq("id", message.id);

      setMessages((prev) =>
        prev.map((m) => (m.id === message.id ? { ...m, status: "read" as const } : m))
      );
    }
  };

  const unreadCount = messages.filter((m) => m.status === "unread").length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Inbox</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Messages from your funding advisor
          {unreadCount > 0 && (
            <span className="ml-2 px-2 py-0.5 bg-mint-green text-white text-xs rounded-full">
              {unreadCount} new
            </span>
          )}
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Messages List */}
        <div className="lg:col-span-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {messages.length === 0 ? (
            <div className="p-8 text-center">
              <InboxIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">No messages yet</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-[600px] overflow-y-auto">
              {messages.map((message) => (
                <button
                  key={message.id}
                  onClick={() => handleSelectMessage(message)}
                  className={`w-full text-left p-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                    selectedMessage?.id === message.id
                      ? "bg-mint-green/10"
                      : ""
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {message.status === "unread" ? (
                      <EnvelopeIcon className="w-5 h-5 text-mint-green mt-0.5" />
                    ) : (
                      <EnvelopeOpenIcon className="w-5 h-5 text-gray-400 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p
                        className={`truncate ${
                          message.status === "unread"
                            ? "font-semibold text-gray-900 dark:text-white"
                            : "text-gray-700 dark:text-gray-300"
                        }`}
                      >
                        {message.subject || "No Subject"}
                      </p>
                      <p className="text-sm text-gray-500 truncate">
                        {message.body.substring(0, 50)}...
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {new Date(message.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Message Detail */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          {selectedMessage ? (
            <div className="p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                {selectedMessage.subject || "No Subject"}
              </h2>
              <p className="text-sm text-gray-500 mb-6">
                Received on{" "}
                {new Date(selectedMessage.created_at).toLocaleDateString("en-US", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
              <div className="prose dark:prose-invert max-w-none">
                <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                  {selectedMessage.body}
                </p>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center h-full flex flex-col items-center justify-center">
              <EnvelopeIcon className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
              <p className="text-gray-500 dark:text-gray-400">
                Select a message to read
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
