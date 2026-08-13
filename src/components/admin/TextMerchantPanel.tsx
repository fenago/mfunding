import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChatBubbleLeftRightIcon,
  ArrowTopRightOnSquareIcon,
  EyeIcon,
  EyeSlashIcon,
  ClipboardIcon,
  CheckIcon,
  PaperAirplaneIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { useUserProfile } from "@/context/UserProfileContext";
import { getCompanyVoice, getSetting, type CompanyVoice } from "@/services/platformService";
import { logContactAttempt } from "@/services/dealService";
import { parseEdgeError } from "@/lib/edgeError";
import { mintConnectBankLink } from "@/lib/connectBank";
import { normalizePhoneForStorage } from "@/lib/phone";

/**
 * Text the merchant, from inside the playbook, on any deal, at any step.
 *
 * This chip used to be a LOGIN affordance — it opened the shared Google Voice tab
 * and revealed the team password. Texting therefore meant leaving the playbook,
 * finding the thread, and typing the link from memory. Now the chip IS the send:
 * an inline compose that goes out through TextMagic (`textmagic-send`), with the
 * links a closer actually texts one tap away. The Google Voice sign-in is still
 * here, at the bottom of the panel, because the shared line is also how we CALL.
 *
 * The quick-insert links are NOT new flows — every one of them reuses the exact
 * builder the email/copy paths already use, so a texted link is byte-identical to
 * an emailed one:
 *   · Upload documents  → platform_settings.adhoc_docs.upload_form_url + ?email=
 *                         (the same URL AdHocSendMenu copies)
 *   · Connect bank      → plaid-mint-link via mintConnectBankLink() (the same fn
 *                         behind the Connect-Bank chip and the Send-docs menu)
 *   · Application / agreements → the merchant's OWN per-recipient signing URLs,
 *                         read from ghl-docs-status — the same source as the
 *                         Send-docs menu's "Their signing links". These exist only
 *                         once a document has been sent, so the panel says so
 *                         plainly rather than inventing a token flow.
 *   · Blank form links  → adhoc_docs[].public_link, as-is.
 *
 * NO browser popups (owner rule): Send is an inline two-step — first tap arms
 * ("tap again to send to +1…"), second tap fires, disarming after 5s.
 *
 * COMPLIANCE: an MCA is a purchase of future receivables, NEVER a loan. The
 * templates below say funding / working capital / advance, and the edge function
 * refuses outright to transmit a message containing the word "loan".
 */

interface AdhocDocDef {
  key: string;
  label: string;
  public_link?: string;
}

/** A document already sent to this merchant, with their own signing URL. */
interface SentDocLink { name: string; signed: boolean; url: string | null }

interface Props {
  dealId: string;
  merchantPhone?: string | null;
  /** customers.additional_phones — selectable alternates. */
  additionalPhones?: string[] | null;
  merchantEmail?: string | null;
  merchantFirstName?: string | null;
  businessName?: string | null;
  /** Enables the "their signing links" quick-inserts. */
  ghlContactId?: string | null;
  /** Fired after a successful send — the host refetches (this was a touch). */
  onSent?: () => void;
}

const MAX_CHARS = 1600;

interface Ctx { first: string; business: string; closerFirst: string }

const TEMPLATES: { id: string; label: string; body: (c: Ctx) => string }[] = [
  {
    id: "intro",
    label: "Intro + application",
    body: (c) =>
      `Hi ${c.first}, it's ${c.closerFirst} with Momentum Funding about working capital for ${c.business}. ` +
      `Here's the application — takes about 3 minutes: `,
  },
  {
    id: "docs",
    label: "Docs chase",
    body: (c) =>
      `${c.first}, last piece before I can get you numbers: your last 3-4 months of business bank statements. ` +
      `Upload them here: `,
  },
  {
    id: "bank",
    label: "Bank-connect nudge",
    body: (c) =>
      `${c.first}, skip the PDFs — connect your bank in about 60 seconds and I'll have your funding options today: `,
  },
  { id: "blank", label: "Blank", body: () => "" },
];

export default function TextMerchantPanel({
  dealId,
  merchantPhone,
  additionalPhones,
  merchantEmail,
  merchantFirstName,
  businessName,
  ghlContactId,
  onSent,
}: Props) {
  const { profile } = useUserProfile();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // ── Compose state ──
  const phoneOptions = useMemo(() => {
    const all = [merchantPhone, ...(additionalPhones ?? [])]
      .map((p) => (p ?? "").trim())
      .filter(Boolean)
      .map(normalizePhoneForStorage);
    return Array.from(new Set(all));
  }, [merchantPhone, additionalPhones]);
  const [phone, setPhone] = useState(phoneOptions[0] ?? "");
  useEffect(() => { setPhone((p) => (p && phoneOptions.includes(p) ? p : phoneOptions[0] ?? "")); }, [phoneOptions]);

  const ctx: Ctx = useMemo(() => ({
    first: (merchantFirstName || "there").trim(),
    business: (businessName || "your business").trim(),
    closerFirst: (profile?.first_name || "").trim() || "your rep",
  }), [merchantFirstName, businessName, profile]);

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  // Inline two-step confirm — no browser popups (owner rule), same armOrFire as
  // AdHocSendMenu. Disarms after 5s so a walked-away-from arm can't fire later.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  // ── Link sources (fetched when the panel opens) ──
  const [uploadFormUrl, setUploadFormUrl] = useState<string | null>(null);
  const [docs, setDocs] = useState<AdhocDocDef[]>([]);
  const [sentLinks, setSentLinks] = useState<SentDocLink[] | null>(null);
  const [minting, setMinting] = useState(false);

  useEffect(() => {
    if (!open) return;
    void getSetting<{ docs?: AdhocDocDef[]; upload_form_url?: string }>("adhoc_docs", {}).then((v) => {
      setDocs(v.docs ?? []);
      setUploadFormUrl(v.upload_form_url ?? null);
    });
  }, [open]);

  useEffect(() => {
    if (!open || !ghlContactId) return;
    let cancelled = false;
    setSentLinks(null);
    supabase.functions.invoke("ghl-docs-status", { body: { ghl_contact_id: ghlContactId } })
      .then(({ data }) => {
        if (cancelled) return;
        const d = data as { documents?: SentDocLink[]; error?: string } | null;
        setSentLinks(d?.error ? [] : (d?.documents ?? []).filter((x) => x.url));
      })
      .catch(() => { if (!cancelled) setSentLinks([]); });
    return () => { cancelled = true; };
  }, [open, ghlContactId]);

  // ── Google Voice sign-in (the panel's footer — the shared CALLING line) ──
  const [creds, setCreds] = useState<CompanyVoice | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<"user" | "pass" | null>(null);
  useEffect(() => { void getCompanyVoice().then(setCreds); }, []);
  const copy = useCallback(async (which: "user" | "pass", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* clipboard blocked — nothing to do */ }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setRevealed(false);
        setArmed(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  /** Insert text at the caret (or append), keeping the caret after it. */
  const insertAtCursor = (snippet: string) => {
    setArmed(false);
    setResult(null);
    const ta = taRef.current;
    setText((prev) => {
      const start = ta?.selectionStart ?? prev.length;
      const end = ta?.selectionEnd ?? prev.length;
      const before = prev.slice(0, start);
      const after = prev.slice(end);
      // One space between the message and a pasted link — never glue them together.
      const pad = before && !/\s$/.test(before) ? " " : "";
      const next = `${before}${pad}${snippet}${after}`;
      requestAnimationFrame(() => {
        const pos = (before + pad + snippet).length;
        ta?.focus();
        ta?.setSelectionRange(pos, pos);
      });
      return next;
    });
  };

  const applyTemplate = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    setText(t.body(ctx));
    setResult(null);
    setArmed(false);
  };

  const insertConnectBank = async () => {
    setMinting(true);
    setResult(null);
    try {
      insertAtCursor(await mintConnectBankLink(dealId));
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "Could not create a Connect-Bank link." });
    } finally {
      setMinting(false);
    }
  };

  const uploadLink = uploadFormUrl
    ? merchantEmail
      ? `${uploadFormUrl}?email=${encodeURIComponent(merchantEmail)}`
      : uploadFormUrl
    : null;

  const send = async () => {
    setSending(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("textmagic-send", {
        body: { deal_id: dealId, phone, message: text.trim() },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; error?: string } | null;
      if (d?.error || d?.ok === false) throw new Error(d?.error || "The text was not sent.");

      // A sent text IS a touch — bank the SLA stamp without inflating the contact
      // rate (an unanswered text is not a conversation). Best-effort: a stamp
      // failure must never make a SENT text look unsent.
      try {
        await logContactAttempt(dealId, { outcome: "attempted", channel: "sms" });
        onSent?.();
      } catch { /* the text went out; the stamp is bookkeeping */ }

      setResult({ ok: true, text: `Sent to ${phone}.` });
      setText("");
    } catch (e) {
      const { message } = await parseEdgeError(e, "Could not send the text.");
      setResult({ ok: false, text: message });
    } finally {
      setSending(false);
      setArmed(false);
    }
  };

  const chars = text.length;
  const segments = chars === 0 ? 0 : Math.ceil(chars / 160);
  const noPhone = !phone;
  const canSend = !noPhone && text.trim() !== "" && chars <= MAX_CHARS && !sending;
  const url = creds?.url || "https://voice.google.com";
  const hasLogin = !!(creds?.username || creds?.password);

  const quickCls =
    "text-[10px] font-semibold px-2 py-1 rounded-full border border-ocean-blue/40 text-ocean-blue hover:bg-ocean-blue hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div ref={wrapRef} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Text the merchant on the company line — compose and send without leaving the deal"
        className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-200 dark:hover:bg-indigo-900/60 transition-colors"
      >
        <ChatBubbleLeftRightIcon className="w-3 h-3" /> Text — company line
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-[26rem] max-w-[92vw] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl p-3">
          {/* ── To ── */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-gray-400 flex-shrink-0">To</span>
            {phoneOptions.length === 0 ? (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">
                No mobile on file — add one in the deal's contact details.
              </span>
            ) : phoneOptions.length === 1 ? (
              <span className="text-[11px] font-mono text-gray-800 dark:text-gray-200">{phone}</span>
            ) : (
              <select
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="text-[11px] font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-1.5 py-0.5"
              >
                {phoneOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
          </div>

          {/* ── Templates ── */}
          <div className="mt-2 flex flex-wrap gap-1">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => applyTemplate(t.id)}
                className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-ocean-blue hover:text-ocean-blue transition-colors"
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Quick-insert links — every one reuses an existing builder ── */}
          <p className="mt-2 text-[10px] uppercase tracking-wide text-gray-400">Insert a link</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <button
              type="button"
              disabled={minting}
              onClick={() => void insertConnectBank()}
              className={quickCls}
              title="Mints this merchant's /connect-bank link (plaid-mint-link) — 60 seconds to verify revenue and pull statements"
            >
              {minting ? "Minting…" : "🔗 Connect bank"}
            </button>

            <button
              type="button"
              disabled={!uploadLink}
              onClick={() => uploadLink && insertAtCursor(uploadLink)}
              className={quickCls}
              title={uploadLink
                ? "The secure upload form, prefilled with their email so files attach to this merchant"
                : "No upload form is configured in platform_settings.adhoc_docs"}
            >
              📤 Upload documents
            </button>

            {/* Their OWN application / agreement links — only real once something
                has been sent. Same source as the Send-docs menu's signing links. */}
            {ghlContactId && sentLinks === null && (
              <span className="text-[10px] text-gray-400 self-center">checking their documents…</span>
            )}
            {(sentLinks ?? []).map((l, i) => (
              <button
                key={i}
                type="button"
                onClick={() => insertAtCursor(l.url!)}
                className={quickCls}
                title={`This merchant's own link for ${l.name}${l.signed ? " (already signed — view link)" : ""}`}
              >
                📄 {l.name}{l.signed ? " ✓" : ""}
              </button>
            ))}

            {/* Public blank-form links (broker agreement, etc.) — textable as-is. */}
            {docs.filter((d) => d.public_link).map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => insertAtCursor(d.public_link!)}
                className={quickCls}
                title={`Public blank form link for ${d.label}`}
              >
                📝 {d.label}
              </button>
            ))}
          </div>
          {ghlContactId && sentLinks?.length === 0 && (
            <p className="mt-1 text-[10px] text-gray-400">
              No application sent yet — send it from <b>Send docs</b> and its link appears here to text.
            </p>
          )}
          {!ghlContactId && (
            <p className="mt-1 text-[10px] text-gray-400">
              No GHL contact on this deal yet, so there are no application links to insert.
            </p>
          )}

          {/* ── Message ── */}
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => { setText(e.target.value); setResult(null); setArmed(false); }}
            rows={4}
            placeholder="Write the text…"
            className="mt-2 w-full text-[12px] rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2 py-1.5 resize-y"
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className={`text-[10px] ${chars > MAX_CHARS ? "text-red-600 dark:text-red-400 font-semibold" : "text-gray-400"}`}>
              {chars}/{MAX_CHARS}{segments > 0 && ` · ${segments} segment${segments === 1 ? "" : "s"}`}
            </span>
            <button
              type="button"
              onClick={() => { if (armed) void send(); else setArmed(true); }}
              disabled={!canSend}
              className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1 rounded-full text-white disabled:opacity-50 transition-colors ${
                armed ? "bg-amber-600 hover:bg-amber-700" : "bg-ocean-blue hover:bg-deep-sea"
              }`}
            >
              {sending ? (
                <span className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
              ) : (
                <PaperAirplaneIcon className="w-3.5 h-3.5" />
              )}
              {sending ? "Sending…" : armed ? `Tap again — send to ${phone}` : "Send text"}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-gray-400">
            Goes out on the company line via TextMagic and lands on the deal's activity trail.
            Keep it "funding" / "working capital" — an advance is never a loan.
          </p>

          {result && (
            <p className={`mt-1.5 text-[11px] ${result.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              {result.text}
            </p>
          )}

          {/* ── The shared Google Voice line — still how we CALL, so the sign-in
                stays exactly where closers already look for it. ── */}
          <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-700">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">Company Google Voice line (calling)</p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold px-2 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
            >
              <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" /> Open Google Voice
            </a>

            {hasLogin ? (
              <div className="mt-2 space-y-1.5">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">Username</p>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-mono text-gray-800 dark:text-gray-200 truncate flex-1">
                      {creds?.username || "—"}
                    </span>
                    {creds?.username && (
                      <button
                        type="button"
                        onClick={() => void copy("user", creds.username)}
                        title="Copy username"
                        className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded"
                      >
                        {copied === "user" ? <CheckIcon className="w-3.5 h-3.5 text-emerald-500" /> : <ClipboardIcon className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">Password</p>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-mono text-gray-800 dark:text-gray-200 truncate flex-1">
                      {creds?.password ? (revealed ? creds.password : "•".repeat(Math.min(creds.password.length, 12))) : "—"}
                    </span>
                    {creds?.password && (
                      <>
                        <button
                          type="button"
                          onClick={() => setRevealed((r) => !r)}
                          title={revealed ? "Hide password" : "Reveal password"}
                          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded"
                        >
                          {revealed ? <EyeSlashIcon className="w-3.5 h-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => void copy("pass", creds.password)}
                          title="Copy password"
                          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded"
                        >
                          {copied === "pass" ? <CheckIcon className="w-3.5 h-3.5 text-emerald-500" /> : <ClipboardIcon className="w-3.5 h-3.5" />}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">No shared login on file yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
