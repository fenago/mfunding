import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ChatBubbleLeftRightIcon,
  MagnifyingGlassIcon,
  PaperAirplaneIcon,
  BuildingOffice2Icon,
  EnvelopeIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import {
  searchContacts,
  getThread,
  sendEmail,
  type GhlContact,
  type GhlMessage,
} from "../../services/commsService";
import { COMMS_TEMPLATES, getTemplate } from "../../config/commsTemplates";
import { useUserProfile } from "../../context/UserProfileContext";

// The fixed company sending address (server enforces this; shown read-only).
const COMPANY_EMAIL_FROM = "sales@send.mfunding.net";

// Tag filter chips — append the tag to the search query so GHL matches on it.
const TAG_FILTERS: { label: string; tag: string }[] = [
  { label: "Lenders", tag: "lender" },
  { label: "Lead vendors", tag: "lead-vendor" },
  { label: "Funder network", tag: "funder-network" },
  { label: "Funder active", tag: "funder-active" },
];

function contactDisplayName(c: GhlContact): string {
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return name || c.contactName || c.email || "Unknown contact";
}

// Group contacts by company so each business shows its people beneath it.
interface CompanyGroup {
  company: string;
  contacts: GhlContact[];
}
function groupByCompany(contacts: GhlContact[]): CompanyGroup[] {
  const map = new Map<string, GhlContact[]>();
  for (const c of contacts) {
    const key = (c.companyName || "").trim() || "— No company —";
    const arr = map.get(key) ?? [];
    arr.push(c);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .map(([company, list]) => ({ company, contacts: list }))
    .sort((a, b) => a.company.localeCompare(b.company));
}

function msgIsEmail(m: GhlMessage): boolean {
  const t = String(m.messageType ?? m.type ?? "").toUpperCase();
  return t.includes("EMAIL") || t === "3";
}

export default function CommsPage() {
  const { profile } = useUserProfile();
  const senderName = profile?.display_name || profile?.first_name || "MFunding";

  // --- Search state ---
  const [searchInput, setSearchInput] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [contacts, setContacts] = useState<GhlContact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // --- Selected contact + thread ---
  const [selected, setSelected] = useState<GhlContact | null>(null);
  const [messages, setMessages] = useState<GhlMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  // --- Compose ---
  const [subject, setSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendOk, setSendOk] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const runSearch = useCallback(async (query: string, tag: string | null) => {
    setLoading(true);
    setSearchError(null);
    // Combine free text with the active tag chip so GHL matches both.
    const q = [query.trim(), tag ?? ""].filter(Boolean).join(" ").trim();
    try {
      const res = await searchContacts(q, { pageLimit: 50 });
      setContacts(res.contacts ?? []);
      setTotal(res.total ?? 0);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Search failed");
      setContacts([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search whenever input or active tag changes.
  useEffect(() => {
    const t = setTimeout(() => {
      void runSearch(searchInput, activeTag);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput, activeTag, runSearch]);

  const groups = useMemo(() => groupByCompany(contacts), [contacts]);

  const loadThread = useCallback(async (contact: GhlContact) => {
    setThreadLoading(true);
    setThreadError(null);
    setMessages([]);
    try {
      const res = await getThread(contact.id);
      setMessages(res.messages ?? []);
    } catch (e) {
      setThreadError(e instanceof Error ? e.message : "Could not load history");
    } finally {
      setThreadLoading(false);
    }
  }, []);

  const selectContact = (c: GhlContact) => {
    setSelected(c);
    setSendError(null);
    setSendOk(null);
    void loadThread(c);
  };

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const tpl = getTemplate(id);
    if (!tpl) return;
    const firstName = selected?.firstName || "there";
    const fill = (s: string) =>
      s
        .replace(/{contactFirstName}/g, firstName)
        .replace(/{senderName}/g, senderName)
        .replace(/{funder}/g, selected?.companyName || "your team");
    setSubject(fill(tpl.subject));
    setEmailBody(fill(tpl.body));
  };

  const canSend = !!selected?.email && subject.trim() && emailBody.trim() && !sending;

  const doSend = async () => {
    if (!selected) return;
    setConfirmOpen(false);
    setSending(true);
    setSendError(null);
    setSendOk(null);
    try {
      const html = emailBody
        .split("\n")
        .map((line) => (line.trim() === "" ? "<br/>" : `<p style="margin:0 0 10px">${escapeHtml(line)}</p>`))
        .join("");
      await sendEmail({ contactId: selected.id, subject: subject.trim(), html, text: emailBody });
      setSendOk(`Email sent to ${selected.email}`);
      // Optimistic append to the thread.
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          messageType: "TYPE_EMAIL",
          direction: "outbound",
          subject: subject.trim(),
          body: emailBody,
          status: "sent",
          dateAdded: new Date().toISOString(),
        },
      ]);
      setSubject("");
      setEmailBody("");
      setTemplateId("");
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 h-full flex flex-col">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <ChatBubbleLeftRightIcon className="w-7 h-7 text-mint-green" />
          Comms
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Search contacts and email funders, lenders, and partners. Sending, delivery, and history
          live in GoHighLevel — this is a thin client. Email only.
        </p>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(320px,420px)_1fr] gap-4 min-h-0">
        {/* LEFT: search + results grouped by company */}
        <div className="flex flex-col bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 min-h-0">
          <div className="p-3 border-b border-gray-200 dark:border-gray-700 space-y-3">
            <div className="relative">
              <MagnifyingGlassIcon className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by name, company, or email…"
                className="input input-bordered w-full pl-10 bg-white dark:bg-gray-900"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {TAG_FILTERS.map((f) => (
                <button
                  key={f.tag}
                  onClick={() => setActiveTag(activeTag === f.tag ? null : f.tag)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    activeTag === f.tag
                      ? "bg-mint-green text-white border-mint-green"
                      : "bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-mint-green"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="text-xs text-gray-400 flex items-center gap-2">
              {loading ? (
                <>
                  <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" /> Searching…
                </>
              ) : (
                <span>{total} contact{total === 1 ? "" : "s"}</span>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {searchError && (
              <div className="m-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm flex gap-2">
                <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0" />
                {searchError}
              </div>
            )}
            {!loading && !searchError && groups.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">No contacts found.</p>
            )}
            {groups.map((g) => (
              <div key={g.company} className="mb-3">
                <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <BuildingOffice2Icon className="w-4 h-4" />
                  <span className="truncate">{g.company}</span>
                  <span className="text-gray-300 dark:text-gray-600">({g.contacts.length})</span>
                </div>
                <div className="space-y-1">
                  {g.contacts.map((c) => {
                    const active = selected?.id === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => selectContact(c)}
                        className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                          active
                            ? "bg-mint-green/10 border border-mint-green/40"
                            : "hover:bg-gray-50 dark:hover:bg-gray-700/50 border border-transparent"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {contactDisplayName(c)}
                          </span>
                        </div>
                        {c.email && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{c.email}</div>
                        )}
                        {c.tags && c.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {c.tags.slice(0, 4).map((t) => (
                              <span
                                key={t}
                                className="px-1.5 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: selected contact + compose + history */}
        <div className="flex flex-col bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 min-h-0 overflow-y-auto">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8 text-center">
              <EnvelopeIcon className="w-12 h-12 mb-3" />
              <p className="text-sm">Select a contact to view history and compose an email.</p>
            </div>
          ) : (
            <div className="p-4 sm:p-6 space-y-5">
              {/* Contact header */}
              <div className="border-b border-gray-200 dark:border-gray-700 pb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {contactDisplayName(selected)}
                </h2>
                <div className="text-sm text-gray-500 dark:text-gray-400 space-y-0.5 mt-1">
                  {selected.companyName && (
                    <div className="flex items-center gap-1.5">
                      <BuildingOffice2Icon className="w-4 h-4" /> {selected.companyName}
                    </div>
                  )}
                  {selected.email && (
                    <div className="flex items-center gap-1.5">
                      <EnvelopeIcon className="w-4 h-4" /> {selected.email}
                    </div>
                  )}
                </div>
                {selected.tags && selected.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {selected.tags.map((t) => (
                      <span
                        key={t}
                        className="px-2 py-0.5 rounded text-[11px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Compose */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Compose email</h3>

                {!selected.email && (
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm flex gap-2">
                    <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0" />
                    This contact has no email address on file in GHL.
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <label className="text-xs text-gray-500 dark:text-gray-400">From (fixed)</label>
                    <input
                      type="text"
                      value={COMPANY_EMAIL_FROM}
                      readOnly
                      className="input input-bordered input-sm w-full bg-gray-50 dark:bg-gray-900 text-gray-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 dark:text-gray-400">Template</label>
                    <select
                      value={templateId}
                      onChange={(e) => applyTemplate(e.target.value)}
                      className="select select-bordered select-sm w-full bg-white dark:bg-gray-900"
                    >
                      <option value="">— No template —</option>
                      {COMMS_TEMPLATES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400">To</label>
                  <input
                    type="text"
                    value={selected.email || "(no email)"}
                    readOnly
                    className="input input-bordered input-sm w-full bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400">Subject</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Subject"
                    className="input input-bordered w-full bg-white dark:bg-gray-900"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400">Body</label>
                  <textarea
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    rows={10}
                    placeholder="Write your message…"
                    className="textarea textarea-bordered w-full bg-white dark:bg-gray-900 font-sans text-sm"
                  />
                </div>

                {sendError && (
                  <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm flex gap-2">
                    <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0" />
                    {sendError}
                  </div>
                )}
                {sendOk && (
                  <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 text-sm">
                    {sendOk}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    onClick={() => setConfirmOpen(true)}
                    disabled={!canSend}
                    className="btn btn-sm bg-mint-green hover:bg-mint-green/90 text-white border-none disabled:opacity-50"
                  >
                    {sending ? (
                      <ArrowPathIcon className="w-4 h-4 animate-spin" />
                    ) : (
                      <PaperAirplaneIcon className="w-4 h-4" />
                    )}
                    Send email
                  </button>
                </div>
              </div>

              {/* Thread history */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
                  History
                  {threadLoading && <ArrowPathIcon className="w-3.5 h-3.5 animate-spin text-gray-400" />}
                </h3>
                {threadError && (
                  <p className="text-sm text-red-500">{threadError}</p>
                )}
                {!threadLoading && !threadError && messages.length === 0 && (
                  <p className="text-sm text-gray-400">No prior messages with this contact.</p>
                )}
                <div className="space-y-3">
                  {messages.filter(msgIsEmail).map((m, i) => (
                    <div
                      key={m.id || i}
                      className={`p-3 rounded-lg border text-sm ${
                        m.direction === "outbound"
                          ? "bg-mint-green/5 border-mint-green/20"
                          : "bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700"
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                        <span className="font-medium uppercase">
                          {m.direction === "outbound" ? "Sent" : "Received"}
                        </span>
                        <span>{m.dateAdded ? new Date(m.dateAdded).toLocaleString() : ""}</span>
                      </div>
                      {m.subject && (
                        <div className="font-medium text-gray-800 dark:text-gray-100">{m.subject}</div>
                      )}
                      {m.body && (
                        <div className="text-gray-600 dark:text-gray-300 whitespace-pre-wrap line-clamp-6 mt-0.5">
                          {stripHtml(m.body)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirm dialog */}
      {confirmOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Confirm send</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              This email will be sent through GoHighLevel:
            </p>
            <dl className="text-sm space-y-1 mb-5 bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
              <div className="flex gap-2">
                <dt className="text-gray-400 w-16">From</dt>
                <dd className="text-gray-700 dark:text-gray-200">{COMPANY_EMAIL_FROM}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-gray-400 w-16">To</dt>
                <dd className="text-gray-700 dark:text-gray-200 font-medium">
                  {selected.email} ({contactDisplayName(selected)})
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-gray-400 w-16">Subject</dt>
                <dd className="text-gray-700 dark:text-gray-200">{subject}</dd>
              </div>
            </dl>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="btn btn-sm btn-ghost"
              >
                Cancel
              </button>
              <button
                onClick={() => void doSend()}
                className="btn btn-sm bg-mint-green hover:bg-mint-green/90 text-white border-none"
              >
                <PaperAirplaneIcon className="w-4 h-4" />
                Send now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
