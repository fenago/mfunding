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
// Shares the JMP line with the playbook's TextMerchantPanel — that panel now
// sends through this SAME number via the sms-send edge function, so a text a
// setter fires from the Playbook lands in this inbox's thread (and vice-versa).
// (It is NOT a separate TextMagic number anymore.)
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
  PhotoIcon,
  PaperClipIcon,
  XMarkIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { useUserProfile } from "@/context/UserProfileContext";
import { parseEdgeError } from "@/lib/edgeError";
import { normalizePhoneForStorage } from "@/lib/phone";
import {
  prettyPhone,
  phoneVariants,
  shortWhen,
  customerNames,
  STATUS_CHIP,
  STATUS_LABEL,
  SMS_MEDIA_BUCKET,
  SMS_MEDIA_ACCEPT,
  smsMediaObjectPath,
  smsMediaRejectReason,
  uploadSmsDoc,
  SMS_DOCS_ACCEPT,
  type SmsContact,
  type SmsMessage,
  type SmsDocAttachment,
} from "@/lib/sms";
import { loadActiveSmsLines, defaultLine, type SmsLine } from "@/lib/smsLines";

const SELECT =
  "id,direction,phone,body,media_url,status,error,customer_id,created_by,created_at,sent_at,deleted_at";

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
  // Deleting a text is a super-admin-only, reversible soft delete (the row is
  // kept for TCPA/compliance). The trash control is hidden for everyone else,
  // and the RPC rejects them regardless of the UI.
  const { isSuperAdmin } = useUserProfile();
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
  // A picture message staged in the composer: the File plus a local object-URL
  // preview. Uploaded to the sms-media bucket only at send time.
  const [attachment, setAttachment] = useState<{ file: File; preview: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Documents attached as SECURE LINKS (not MMS): each upload appends its public
  // sms-docs URL to the body (sends as plain text) and shows a removable chip.
  const [docChips, setDocChips] = useState<SmsDocAttachment[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const docInputRef = useRef<HTMLInputElement>(null);
  // Which company number we send FROM. Architected for several; falls back to the
  // one known JMP line if sms_lines isn't populated yet (see loadActiveSmsLines).
  const [lines, setLines] = useState<SmsLine[]>([]);
  const [lineId, setLineId] = useState<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("sms_messages")
      .select(SELECT)
      // Soft-deleted rows (super-admin removed) are hidden everywhere: they drop
      // out of the conversation list AND the thread, since both derive from this
      // one query. The row is retained server-side for compliance/reversal.
      .is("deleted_at", null)
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

  // Load the sending lines once. Default to the flagged/first line.
  useEffect(() => {
    let cancelled = false;
    void loadActiveSmsLines().then((ls) => {
      if (cancelled) return;
      setLines(ls);
      setLineId((prev) => prev ?? defaultLine(ls).id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
        const nm = customerNames(c);
        next[m.phone] = {
          customerId: m.customer_id,
          business: nm.business,
          person: nm.person,
          label: nm.label,
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
          const nm = customerNames(c);
          next[p] = {
            customerId: c.id,
            business: nm.business,
            person: nm.person,
            label: nm.label,
            doNotContact: !!c.do_not_contact,
          };
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
  const selectedLine = useMemo(
    () => lines.find((l) => l.id === lineId) ?? lines[0],
    [lines, lineId],
  );

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [activeThread.length, activePhone]);

  // Mark the open thread READ once per open. The line is shared, so this clears
  // the unread state ORG-WIDE (sms_mark_read flips read_at on this number's unread
  // inbound rows) — the sidebar badge then drops for everyone via realtime. Cheap
  // and idempotent: it only touches read_at IS NULL rows, so a re-open or a draft
  // number with no history is a 0-row no-op that fires no realtime event.
  useEffect(() => {
    if (!activePhone) return;
    void supabase.rpc("sms_mark_read", { p_phone: activePhone });
  }, [activePhone]);

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

  // ── Attachment (picture message) ────────────────────────────────────────────
  function clearAttachment() {
    setAttachment((prev) => {
      if (prev) URL.revokeObjectURL(prev.preview);
      return null;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function pickAttachment(file: File | undefined) {
    if (!file) return;
    const reason = smsMediaRejectReason(file);
    if (reason) {
      setSendError(reason);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setSendError(null);
    setAttachment((prev) => {
      if (prev) URL.revokeObjectURL(prev.preview);
      return { file, preview: URL.createObjectURL(file) };
    });
  }

  // ── Attach a document (secure link, NOT MMS) ───────────────────────────────
  // A PDF/Word/Excel doc can't ride an MMS reliably, so a document is shared as a
  // public sms-docs link dropped into the body — it sends as ordinary text. The
  // chip is just a removable indicator; the body is the source of truth for send.
  async function attachDoc(file: File | undefined) {
    if (!file) return;
    setSendError(null);
    setUploadingDoc(true);
    try {
      const res = await uploadSmsDoc(file);
      if ("error" in res) {
        setSendError(res.error);
        return;
      }
      // One space between the message and the pasted link — never glue them.
      setBody((prev) => (prev && !/\s$/.test(prev) ? `${prev} ${res.url}` : `${prev}${res.url}`));
      setDocChips((prev) => [...prev, { name: res.name, url: res.url }]);
    } finally {
      setUploadingDoc(false);
      if (docInputRef.current) docInputRef.current.value = "";
    }
  }

  function removeDocChip(url: string) {
    setDocChips((prev) => prev.filter((d) => d.url !== url));
    setBody((prev) => prev.replace(url, "").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").trim());
  }

  // Revoke the last preview object-URL on unmount so the composer doesn't leak.
  useEffect(() => {
    return () => {
      setAttachment((prev) => {
        if (prev) URL.revokeObjectURL(prev.preview);
        return null;
      });
    };
  }, []);

  // ── Send ──────────────────────────────────────────────────────────────────
  const canSend = !!activePhone && !sending && (!!body.trim() || !!attachment) && body.length <= MAX_CHARS;

  async function send() {
    const to = activePhone;
    const text = body.trim();
    // A send needs a destination and EITHER text OR an image. Media-only is fine.
    if (!to || sending || (!text && !attachment) || text.length > MAX_CHARS) return;
    setSending(true);
    setSendError(null);
    try {
      // If an image is staged, upload it to the public sms-media bucket first and
      // hand sms-send its public URL. A failed upload must abort the send loudly —
      // never silently send text-only when the operator attached a picture.
      let mediaUrl: string | null = null;
      if (attachment) {
        const path = smsMediaObjectPath(attachment.file.name);
        const { error: upErr } = await supabase.storage
          .from(SMS_MEDIA_BUCKET)
          .upload(path, attachment.file, {
            contentType: attachment.file.type || "application/octet-stream",
            upsert: false,
          });
        if (upErr) {
          setSendError(`Image upload failed — nothing was sent. ${upErr.message}`);
          return;
        }
        const { data: pub } = supabase.storage.from(SMS_MEDIA_BUCKET).getPublicUrl(path);
        mediaUrl = pub?.publicUrl ?? null;
        if (!mediaUrl) {
          setSendError("Image uploaded but its public URL could not be resolved — nothing was sent.");
          return;
        }
      }

      const { error } = await supabase.functions.invoke("sms-send", {
        body: {
          to,
          body: text,
          ...(mediaUrl ? { media_url: mediaUrl } : {}),
          ...(activeContact?.customerId ? { customer_id: activeContact.customerId } : {}),
          // Which company number to send FROM. Only a real sms_lines row has an
          // id; the hardcoded fallback line sends without one (single-line path).
          ...(selectedLine?.id ? { line_id: selectedLine.id } : {}),
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
      clearAttachment();
      setDocChips([]);
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

  // Super-admin soft-delete of a single message. On success the row vanishes
  // (optimistic drop + refetch; realtime also fires). Returns whether it stuck,
  // so the bubble's arm/fire control knows whether to stay disarmed.
  async function deleteMessage(id: string): Promise<boolean> {
    setDeleteError(null);
    const { error } = await supabase.rpc("sms_delete_message", { p_id: id });
    if (error) {
      // The RPC's own refusal ("super_admin only", "not found") is the answer.
      setDeleteError(error.message);
      return false;
    }
    // Optimistically drop it so it disappears immediately; load() reconciles.
    setMessages((prev) => prev.filter((m) => m.id !== id));
    void load();
    return true;
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
                business={contacts[draftPhone]?.business}
                person={contacts[draftPhone]?.person}
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
                  business={contacts[c.phone]?.business}
                  person={contacts[c.phone]?.person}
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
              <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex flex-wrap items-start gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-gray-900 dark:text-white">
                      {activeContact?.business || activeContact?.person || prettyPhone(activePhone)}
                    </span>
                    {activeContact?.doNotContact && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                        <NoSymbolIcon className="w-3.5 h-3.5" /> do-not-contact
                      </span>
                    )}
                  </div>
                  {activeContact?.business && activeContact?.person && (
                    <span className="block text-sm text-gray-600 dark:text-gray-300">
                      {activeContact.person}
                    </span>
                  )}
                  {(activeContact?.business || activeContact?.person) && (
                    <span className="block text-xs text-gray-400">{prettyPhone(activePhone)}</span>
                  )}
                </div>
                <span className="text-xs text-gray-400 ml-auto shrink-0">
                  {activeThread.length} message{activeThread.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {deleteError && (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
                    <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      <strong>Message not deleted.</strong> {deleteError}
                    </span>
                  </div>
                )}
                {activeThread.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    No history with this number yet — your first text starts the thread.
                  </p>
                ) : (
                  activeThread.map((m) => (
                    <Bubble key={m.id} m={m} canDelete={isSuperAdmin} onDelete={deleteMessage} />
                  ))
                )}
                <div ref={threadEndRef} />
              </div>

              <div className="p-3 border-t border-gray-100 dark:border-gray-700">
                {sendError && (
                  <p className="mb-2 text-sm text-red-600 dark:text-red-400 flex items-start gap-1.5">
                    <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" /> {sendError}
                  </p>
                )}
                {selectedLine && (
                  <div className="mb-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <span className="shrink-0">From</span>
                    {lines.length > 1 ? (
                      <select
                        value={lineId ?? ""}
                        onChange={(e) => setLineId(e.target.value || null)}
                        title="The company number this text is sent from"
                        className="text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                      >
                        {lines.map((l) => (
                          <option key={l.id ?? l.phone} value={l.id ?? ""}>
                            {prettyPhone(l.phone)} · {l.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="font-semibold text-gray-700 dark:text-gray-200">
                        {prettyPhone(selectedLine.phone)} · {selectedLine.label}
                      </span>
                    )}
                  </div>
                )}
                {attachment && (
                  <div className="mb-2 flex items-center gap-2 p-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40">
                    <img
                      src={attachment.preview}
                      alt="Attachment preview"
                      className="w-14 h-14 object-cover rounded-md shrink-0"
                    />
                    <span className="text-xs text-gray-600 dark:text-gray-300 truncate flex-1">
                      {attachment.file.name}
                      <span className="block text-[11px] text-gray-400">
                        {(attachment.file.size / 1024).toFixed(0)} KB · sends as a picture message
                      </span>
                    </span>
                    <button
                      onClick={clearAttachment}
                      title="Remove image"
                      className="p-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
                    >
                      <XMarkIcon className="w-4 h-4" />
                    </button>
                  </div>
                )}
                {docChips.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {docChips.map((d) => (
                      <span
                        key={d.url}
                        className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 max-w-[16rem]"
                        title={`${d.name} — secure link added to the message`}
                      >
                        <span className="truncate">📎 {d.name}</span>
                        <button
                          onClick={() => removeDocChip(d.url)}
                          title="Remove this document's link"
                          className="shrink-0 hover:text-red-600"
                        >
                          <XMarkIcon className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 items-end">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={SMS_MEDIA_ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      pickAttachment(e.target.files?.[0]);
                    }}
                  />
                  <input
                    ref={docInputRef}
                    type="file"
                    accept={SMS_DOCS_ACCEPT}
                    className="hidden"
                    onChange={(e) => void attachDoc(e.target.files?.[0])}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={sending}
                    title="Attach an image (picture message)"
                    className="inline-flex items-center justify-center p-2.5 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
                  >
                    <PhotoIcon className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => docInputRef.current?.click()}
                    disabled={sending || uploadingDoc}
                    title="Attach a document (PDF/Word/Excel/image) — sends as a secure link in the text, not an MMS"
                    className="inline-flex items-center justify-center p-2.5 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
                  >
                    {uploadingDoc ? (
                      <span className="w-5 h-5 rounded-full border-2 border-gray-300 border-t-gray-500 animate-spin" />
                    ) : (
                      <PaperClipIcon className="w-5 h-5" />
                    )}
                  </button>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter sends; Shift+Enter (or ⌘/Ctrl+Enter) inserts a newline.
                      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                        e.preventDefault();
                        if (canSend) void send();
                      }
                    }}
                    rows={2}
                    placeholder={
                      attachment
                        ? `Add a caption (optional) for ${prettyPhone(activePhone)}…`
                        : `Text ${prettyPhone(activePhone)}…`
                    }
                    className="flex-1 text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white resize-y"
                  />
                  <button
                    onClick={() => void send()}
                    disabled={!canSend}
                    className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-lg bg-mint-green text-gray-900 hover:opacity-90 disabled:opacity-40"
                  >
                    <PaperAirplaneIcon className="w-4 h-4" />
                    {sending ? "Sending…" : "Send"}
                  </button>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-gray-400">
                  <span>
                    Enter sends · Shift+Enter for a new line. Goes to {prettyPhone(activePhone)}
                    {selectedLine ? ` from ${prettyPhone(selectedLine.phone)}` : " from the company line"}.
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

function ConversationRow({
  phone,
  business,
  person,
  dnc,
  preview,
  when,
  failed,
  active,
  onClick,
}: {
  phone: string;
  business?: string | null;
  person?: string | null;
  dnc?: boolean;
  preview: string;
  when: string;
  failed?: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const primary = business || person || prettyPhone(phone);
  const hasName = !!(business || person);
  // Show the person as a second line only when the business is the primary — so
  // "Acme Corp" is the headline and "Khalil Lyons" sits under it.
  const secondaryPerson = business && person ? person : null;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-50 dark:border-gray-800 ${
        active ? "bg-gray-50 dark:bg-gray-700/50" : "hover:bg-gray-50 dark:hover:bg-gray-700/30"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold text-sm text-gray-900 dark:text-white truncate">
          {primary}
        </span>
        {dnc && <NoSymbolIcon className="w-3.5 h-3.5 text-red-500 shrink-0" />}
        <span className="text-[11px] text-gray-400 ml-auto shrink-0">{when}</span>
      </div>
      {secondaryPerson && (
        <span className="block text-xs text-gray-600 dark:text-gray-300 truncate">
          {secondaryPerson}
        </span>
      )}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{preview || "—"}</span>
        {failed && (
          <span className="text-[10px] font-semibold text-red-600 dark:text-red-400 shrink-0">
            failed
          </span>
        )}
      </div>
      {hasName && <span className="block text-[11px] text-gray-400">{prettyPhone(phone)}</span>}
    </button>
  );
}

function Bubble({
  m,
  canDelete,
  onDelete,
}: {
  m: SmsMessage;
  canDelete: boolean;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const out = m.direction === "outbound";
  // Inline two-step arm/fire — NO browser confirm() popups (owner rule; mirrors
  // AdHocSendMenu's armOrFire). First tap arms ("tap again to delete"), second
  // tap fires; auto-disarms after 5s so it can't sit hot.
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  async function handleDelete() {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setBusy(true);
    try {
      await onDelete(m.id);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`group flex ${out ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[80%]">
        <div
          className={`px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words ${
            out
              ? "bg-ocean-blue text-white rounded-br-sm"
              : "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white rounded-bl-sm"
          }`}
        >
          {m.media_url && (
            <a href={m.media_url} target="_blank" rel="noreferrer" className="block mb-1.5">
              <img
                src={m.media_url}
                alt="Picture message"
                loading="lazy"
                className="max-w-full max-h-64 rounded-lg object-contain bg-black/5"
              />
              <span className={`block mt-0.5 text-[11px] underline ${out ? "text-white/90" : "text-ocean-blue"}`}>
                Open full size
              </span>
            </a>
          )}
          {m.body}
        </div>
        <div
          className={`mt-1 flex items-center gap-1.5 text-[11px] text-gray-400 ${out ? "justify-end" : ""}`}
        >
          <span>{new Date(m.created_at).toLocaleString()}</span>
          <span className={`px-1.5 py-0.5 rounded-full font-semibold ${STATUS_CHIP[m.status]}`}>
            {STATUS_LABEL[m.status]}
          </span>
          {canDelete && (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={busy}
              title={armed ? "Tap again to delete this message" : "Delete this message (super-admin, reversible)"}
              className={`inline-flex items-center gap-1 rounded px-1 py-0.5 transition-opacity disabled:opacity-40 ${
                armed
                  ? "text-amber-600 dark:text-amber-400 font-semibold"
                  : "text-gray-400 hover:text-red-600 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 focus:opacity-100"
              }`}
            >
              <TrashIcon className="w-3.5 h-3.5" />
              {busy ? "Deleting…" : armed ? "Tap again to delete" : ""}
            </button>
          )}
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
