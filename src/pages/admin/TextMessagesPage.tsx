// Text Messages — the two-way SMS inbox for the company line.
//
// One consumer number (JMP.chat, bridged over XMPP) that the whole floor shares.
// Left: every phone we've ever texted or been texted by, newest first, named
// when the customer row resolves. Right: that number's thread, plus a compose
// that goes out through the `sms-send` edge function (which enforces DND, the
// rate limit, and E.164 — its refusal is shown verbatim, because "merchant is on
// Do-Not-Contact" is the answer, not an app bug).
//
// LIVE: a realtime subscription on sms_messages. If the socket doesn't come up,
// the page falls back to a 3s poll and SAYS SO in the header — a silently dead
// inbox is worse than a slow one.
//
// HONEST STATES: a read that FAILS renders a red banner, never an empty inbox.
// Per-message status (queued / sending / sent / failed) is on every bubble, and
// a failed row prints its error. Nothing here implies a merchant received a text
// that didn't actually go out.
//
// This is NOT the playbook's TextMerchantPanel (TextMagic, a different number).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChatBubbleLeftRightIcon,
  ArrowPathIcon,
  PaperAirplaneIcon,
  PencilSquareIcon,
  ExclamationTriangleIcon,
  BoltIcon,
  MagnifyingGlassIcon,
  NoSymbolIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { parseEdgeError } from "@/lib/edgeError";
import { normalizePhoneForStorage } from "@/lib/phone";
import {
  prettyPhone,
  phoneVariants,
  shortWhen,
  STATUS_CHIP,
  STATUS_LABEL,
  type SmsContact,
  type SmsMessage,
} from "@/lib/sms";

const SELECT =
  "id,direction,phone,body,media_url,status,error,customer_id,created_by,created_at,sent_at";

/** How much history the inbox holds in memory. The line is conversational
 *  (support volume, not campaign volume), so the whole recent book fits. */
const HISTORY = 1000;
/** Mirrors MAX_CHARS in the sms-send edge function — the counter has to agree
 *  with the gate that will actually refuse the send. */
const MAX_CHARS = 1600;
/** The safety-net refetch when realtime IS connected. */
const SLOW_POLL_MS = 20_000;
/** The fallback refetch when realtime is NOT connected. */
const FAST_POLL_MS = 3_000;

/** The slice of a customer row the inbox needs to put a name on a number. */
interface CustomerRow {
  id: string;
  business_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  do_not_contact: boolean | null;
}

interface Conversation {
  phone: string;
  messages: SmsMessage[]; // ascending (oldest first)
  last: SmsMessage;
}

export default function TextMessagesPage() {
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [contacts, setContacts] = useState<Record<string, SmsContact>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [draftPhone, setDraftPhone] = useState<string | null>(null); // a "new message" number with no history yet
  const [newNumber, setNewNumber] = useState("");
  const [composingNew, setComposingNew] = useState(false);
  const [search, setSearch] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("sms_messages")
      .select(SELECT)
      .order("created_at", { ascending: false })
      .limit(HISTORY);
    if (error) {
      // UNREADABLE ≠ EMPTY. Keep whatever we already have on screen and say
      // plainly that the refresh failed.
      setLoadError(error.message);
      setLoaded(true);
      return;
    }
    setLoadError(null);
    setMessages((data ?? []) as SmsMessage[]);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime, with a poll behind it. `live` drives both the poll interval and
  // the badge in the header, so the operator always knows which one is running.
  useEffect(() => {
    const channel = supabase
      .channel("sms-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "sms_messages" }, () => {
        void load();
      })
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => void load(), live ? SLOW_POLL_MS : FAST_POLL_MS);
    const onFocus = () => {
      if (!document.hidden) void load();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load, live]);

  // ── Conversations ─────────────────────────────────────────────────────────
  const conversations = useMemo<Conversation[]>(() => {
    const byPhone = new Map<string, SmsMessage[]>();
    for (const m of messages) {
      const list = byPhone.get(m.phone);
      if (list) list.push(m);
      else byPhone.set(m.phone, [m]);
    }
    const out: Conversation[] = [];
    for (const [phone, list] of byPhone) {
      // `messages` arrives newest-first; a thread reads oldest-first.
      const asc = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
      out.push({ phone, messages: asc, last: asc[asc.length - 1] });
    }
    return out.sort((a, b) => b.last.created_at.localeCompare(a.last.created_at));
  }, [messages]);

  // Resolve names once per distinct set of ids/phones — not on every 3s poll.
  const resolveKey = useMemo(() => {
    const ids = [...new Set(messages.map((m) => m.customer_id).filter(Boolean))].sort();
    const phones = [...new Set(messages.map((m) => m.phone))].sort();
    return JSON.stringify([ids, phones]);
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    const [ids, phones] = JSON.parse(resolveKey) as [string[], string[]];
    if (!ids.length && !phones.length) return;
    (async () => {
      const next: Record<string, SmsContact> = {};
      // 1. The authoritative link: sms_messages.customer_id.
      const byId = new Map<string, CustomerRow>();
      if (ids.length) {
        const { data } = await supabase
          .from("customers")
          .select("id,business_name,first_name,last_name,phone,do_not_contact")
          .in("id", ids);
        for (const c of (data ?? []) as CustomerRow[]) byId.set(c.id, c);
      }
      for (const m of messages) {
        if (!m.customer_id) continue;
        const c = byId.get(m.customer_id);
        if (!c || next[m.phone]) continue;
        next[m.phone] = {
          customerId: m.customer_id,
          label: nameOf(c),
          doNotContact: !!c.do_not_contact,
        };
      }
      // 2. Best effort for the rest: match the number against the customer book
      //    (whole-book readable for staff). An unknown number still texts us.
      const unresolved = phones.filter((p) => !next[p]);
      if (unresolved.length) {
        const variants = [...new Set(unresolved.flatMap(phoneVariants))];
        const { data } = await supabase
          .from("customers")
          .select("id,business_name,first_name,last_name,phone,do_not_contact")
          .in("phone", variants)
          .limit(500);
        const byDigits = new Map<string, CustomerRow>();
        for (const c of (data ?? []) as CustomerRow[]) {
          const d = String(c.phone ?? "").replace(/\D/g, "").slice(-10);
          if (d.length === 10 && !byDigits.has(d)) byDigits.set(d, c);
        }
        for (const p of unresolved) {
          const c = byDigits.get(p.replace(/\D/g, "").slice(-10));
          if (!c) continue;
          next[p] = { customerId: c.id, label: nameOf(c), doNotContact: !!c.do_not_contact };
        }
      }
      if (!cancelled) setContacts(next);
    })();
    return () => {
      cancelled = true;
    };
    // `messages` is intentionally excluded — resolveKey is its stable digest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveKey]);

  // Auto-select the newest conversation once, so the page opens on real content.
  useEffect(() => {
    if (!selected && !draftPhone && conversations.length) setSelected(conversations[0].phone);
  }, [conversations, selected, draftPhone]);

  const activePhone = draftPhone ?? selected;
  const activeThread = useMemo(
    () => conversations.find((c) => c.phone === activePhone)?.messages ?? [],
    [conversations, activePhone],
  );
  const activeContact = activePhone ? contacts[activePhone] : undefined;

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [activeThread.length, activePhone]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    const digits = q.replace(/\D/g, "");
    return conversations.filter(
      (c) =>
        (digits && c.phone.replace(/\D/g, "").includes(digits)) ||
        (contacts[c.phone]?.label ?? "").toLowerCase().includes(q) ||
        (c.last.body ?? "").toLowerCase().includes(q),
    );
  }, [conversations, contacts, search]);

  // ── Send ──────────────────────────────────────────────────────────────────
  async function send() {
    const to = activePhone;
    const text = body.trim();
    if (!to || !text || sending || text.length > MAX_CHARS) return;
    setSending(true);
    setSendError(null);
    try {
      const { error } = await supabase.functions.invoke("sms-send", {
        body: {
          to,
          body: text,
          ...(activeContact?.customerId ? { customer_id: activeContact.customerId } : {}),
        },
      });
      if (error) {
        // The edge function's own refusal ("merchant is on Do-Not-Contact",
        // "rate limit", "not a valid E.164 number") is the useful message.
        const parsed = await parseEdgeError(error, "Send failed.");
        setSendError(parsed.message);
        return;
      }
      setBody("");
      // The draft number now has history — it's a real conversation.
      if (draftPhone) {
        setSelected(draftPhone);
        setDraftPhone(null);
      }
      await load();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setSending(false);
    }
  }

  function startNew() {
    const normalized = normalizePhoneForStorage(newNumber);
    if (!/^\+\d{10,15}$/.test(normalized)) {
      setSendError("Enter a valid US number, e.g. (843) 555-1234.");
      return;
    }
    setSendError(null);
    setNewNumber("");
    setComposingNew(false);
    const existing = conversations.find((c) => c.phone === normalized);
    if (existing) {
      setDraftPhone(null);
      setSelected(normalized);
    } else {
      setDraftPhone(normalized);
    }
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ChatBubbleLeftRightIcon className="w-6 h-6 text-mint-green" /> Text Messages
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            The shared company line — two-way texting with merchants. Conversational replies and
            support only, never bulk.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
              live
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            }`}
            title={
              live
                ? "Realtime subscription is connected — inbound texts appear within a second or two."
                : "Realtime is not connected, so the page is refetching every 3 seconds instead. Still live, just slower."
            }
          >
            <BoltIcon className="w-3.5 h-3.5" /> {live ? "Live" : "Polling (3s)"}
          </span>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 text-sm text-ocean-blue hover:underline"
          >
            <ArrowPathIcon className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

      {loadError && (
        <div className="mb-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0" />
          <div>
            <strong>Couldn't read the message log.</strong> What's on screen may be stale or
            incomplete — this is not an empty inbox.
            <span className="block text-xs mt-0.5 opacity-80">{loadError}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
        {/* ── Conversations ── */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[calc(100vh-13rem)]">
          <div className="p-3 border-b border-gray-100 dark:border-gray-700 space-y-2">
            <button
              onClick={() => setComposingNew((v) => !v)}
              className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold px-3 py-2 rounded-lg bg-ocean-blue text-white hover:opacity-90"
            >
              <PencilSquareIcon className="w-4 h-4" /> New message
            </button>
            {composingNew && (
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={newNumber}
                  onChange={(e) => setNewNumber(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && startNew()}
                  placeholder="(843) 555-1234"
                  className="flex-1 text-sm px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
                <button
                  onClick={startNew}
                  className="text-sm font-semibold px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-600 text-white"
                >
                  Open
                </button>
              </div>
            )}
            <div className="relative">
              <MagnifyingGlassIcon className="w-4 h-4 absolute left-2.5 top-2.5 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, number, text"
                className="w-full text-sm pl-8 pr-2.5 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
          </div>

          <div className="overflow-y-auto flex-1">
            {draftPhone && (
              <ConversationRow
                phone={draftPhone}
                label={contacts[draftPhone]?.label}
                preview="New message — nothing sent yet"
                when=""
                active
                onClick={() => undefined}
              />
            )}
            {!loaded ? (
              <p className="text-sm text-gray-400 p-6">Loading conversations…</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-gray-400 p-6">
                {loadError
                  ? "Conversations couldn't be loaded — see the error above."
                  : conversations.length === 0
                    ? "No texts yet. Start one with “New message”."
                    : "No conversation matches that search."}
              </p>
            ) : (
              filtered.map((c) => (
                <ConversationRow
                  key={c.phone}
                  phone={c.phone}
                  label={contacts[c.phone]?.label}
                  dnc={contacts[c.phone]?.doNotContact}
                  preview={
                    (c.last.direction === "outbound" ? "You: " : "") +
                    (c.last.body || (c.last.media_url ? "[media]" : ""))
                  }
                  when={shortWhen(c.last.created_at)}
                  failed={c.last.status === "failed"}
                  active={!draftPhone && selected === c.phone}
                  onClick={() => {
                    setDraftPhone(null);
                    setSelected(c.phone);
                    setSendError(null);
                  }}
                />
              ))
            )}
          </div>
        </div>

        {/* ── Thread ── */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col max-h-[calc(100vh-13rem)]">
          {!activePhone ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400 p-10">
              Pick a conversation on the left, or start a new one.
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex flex-wrap items-center gap-2">
                <span className="font-bold text-gray-900 dark:text-white">
                  {activeContact?.label ?? prettyPhone(activePhone)}
                </span>
                {activeContact?.label && (
                  <span className="text-xs text-gray-400">{prettyPhone(activePhone)}</span>
                )}
                {activeContact?.doNotContact && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                    <NoSymbolIcon className="w-3.5 h-3.5" /> do-not-contact
                  </span>
                )}
                <span className="text-xs text-gray-400 ml-auto">
                  {activeThread.length} message{activeThread.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {activeThread.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    No history with this number yet — your first text starts the thread.
                  </p>
                ) : (
                  activeThread.map((m) => <Bubble key={m.id} m={m} />)
                )}
                <div ref={threadEndRef} />
              </div>

              <div className="p-3 border-t border-gray-100 dark:border-gray-700">
                {sendError && (
                  <p className="mb-2 text-sm text-red-600 dark:text-red-400 flex items-start gap-1.5">
                    <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" /> {sendError}
                  </p>
                )}
                <div className="flex gap-2 items-end">
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
                    }}
                    rows={2}
                    placeholder={`Text ${prettyPhone(activePhone)}…`}
                    className="flex-1 text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white resize-y"
                  />
                  <button
                    onClick={() => void send()}
                    disabled={sending || !body.trim() || body.length > MAX_CHARS}
                    className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-lg bg-mint-green text-gray-900 hover:opacity-90 disabled:opacity-40"
                  >
                    <PaperAirplaneIcon className="w-4 h-4" />
                    {sending ? "Sending…" : "Send"}
                  </button>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-gray-400">
                  <span>
                    ⌘/Ctrl + Enter sends. Goes to {prettyPhone(activePhone)} from the company line.
                  </span>
                  <span
                    className={`ml-auto tabular-nums ${body.length > MAX_CHARS ? "text-red-600 dark:text-red-400 font-semibold" : ""}`}
                  >
                    {body.length}/{MAX_CHARS}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function nameOf(c: {
  business_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}): string {
  return (
    c.business_name?.trim() ||
    [c.first_name, c.last_name].filter(Boolean).join(" ").trim() ||
    "Unnamed contact"
  );
}

function ConversationRow({
  phone,
  label,
  dnc,
  preview,
  when,
  failed,
  active,
  onClick,
}: {
  phone: string;
  label?: string;
  dnc?: boolean;
  preview: string;
  when: string;
  failed?: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-50 dark:border-gray-800 ${
        active ? "bg-gray-50 dark:bg-gray-700/50" : "hover:bg-gray-50 dark:hover:bg-gray-700/30"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold text-sm text-gray-900 dark:text-white truncate">
          {label ?? prettyPhone(phone)}
        </span>
        {dnc && <NoSymbolIcon className="w-3.5 h-3.5 text-red-500 shrink-0" />}
        <span className="text-[11px] text-gray-400 ml-auto shrink-0">{when}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{preview || "—"}</span>
        {failed && (
          <span className="text-[10px] font-semibold text-red-600 dark:text-red-400 shrink-0">
            failed
          </span>
        )}
      </div>
      {label && <span className="block text-[11px] text-gray-400">{prettyPhone(phone)}</span>}
    </button>
  );
}

function Bubble({ m }: { m: SmsMessage }) {
  const out = m.direction === "outbound";
  return (
    <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[80%]">
        <div
          className={`px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words ${
            out
              ? "bg-ocean-blue text-white rounded-br-sm"
              : "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white rounded-bl-sm"
          }`}
        >
          {m.body}
          {m.media_url && (
            <a
              href={m.media_url}
              target="_blank"
              rel="noreferrer"
              className={`block mt-1.5 text-xs underline ${out ? "text-white/90" : "text-ocean-blue"}`}
            >
              View attachment
            </a>
          )}
        </div>
        <div
          className={`mt-1 flex items-center gap-1.5 text-[11px] text-gray-400 ${out ? "justify-end" : ""}`}
        >
          <span>{new Date(m.created_at).toLocaleString()}</span>
          <span className={`px-1.5 py-0.5 rounded-full font-semibold ${STATUS_CHIP[m.status]}`}>
            {STATUS_LABEL[m.status]}
          </span>
        </div>
        {m.status === "failed" && m.error && (
          <p className={`mt-0.5 text-[11px] text-red-600 dark:text-red-400 ${out ? "text-right" : ""}`}>
            {m.error}
          </p>
        )}
      </div>
    </div>
  );
}
