import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChatBubbleLeftRightIcon,
  PaperAirplaneIcon,
  PaperClipIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { useUserProfile } from "@/context/UserProfileContext";
import { getSetting } from "@/services/platformService";
import { logContactAttempt } from "@/services/dealService";
import { parseEdgeError } from "@/lib/edgeError";
import { mintConnectBankLink } from "@/lib/connectBank";
import { normalizePhoneForStorage } from "@/lib/phone";
import {
  prettyPhone,
  uploadSmsDoc,
  SMS_DOCS_ACCEPT,
  type SmsDocAttachment,
} from "@/lib/sms";
import { loadActiveSmsLines, defaultLine, type SmsLine } from "@/lib/smsLines";

/**
 * Text a merchant on the company line — an inline compose that goes out through
 * our real JMP send path (`sms-send`), reusable on ANY page.
 *
 * This USED to open the shared Google Voice tab, reveal the team password, and
 * send through TextMagic — none of which we use anymore. Both are gone. Sending
 * is now the one gate every SMS screen uses:
 *
 *   supabase.functions.invoke("sms-send", { to, body, customer_id?, line_id? })
 *
 * `sms-send` (staff JWT) enforces suppression / DND (fail-closed), the rate cap,
 * E.164, and the MCA "loan" compliance block. Its refusal IS the answer, not an
 * app bug, so we surface it verbatim. FROM-line comes from `loadActiveSmsLines()`
 * — one line today (the JMP number +1 786 504-1159), architected for more; a
 * selector appears only when there is more than one.
 *
 * REUSABLE: the only thing required to text is a `merchantPhone`. Everything else
 * is optional enrichment:
 *   · `customerId`  threads the outbound text to the merchant in Text Messages.
 *   · `dealId`      enables the Connect-bank quick-insert (mints the merchant's
 *                   /connect-bank link) and stamps a contact-attempt touch.
 *   · `ghlContactId`+`merchantEmail` enable the "their signing links" / upload
 *                   quick-inserts. Absent → those chips simply don't render.
 * Drop it into a table cell with a compact `buttonLabel`, or into the playbook
 * contact bar with its default pill — same component either way.
 *
 * NO browser popups (owner rule): Send is an inline two-step — first tap arms
 * ("tap again to send to (xxx) …"), second tap fires, disarming after 5s.
 *
 * COMPLIANCE: an MCA is a purchase of future receivables, NEVER a loan. The
 * templates say funding / working capital / advance, and `sms-send` refuses
 * outright to transmit a body containing the word "loan".
 */

interface AdhocDocDef {
  key: string;
  label: string;
  public_link?: string;
}

/** A document already sent to this merchant, with their own signing URL. */
interface SentDocLink { name: string; signed: boolean; url: string | null }

interface Ctx { first: string; business: string; closerFirst: string }

export interface TextTemplate { id: string; label: string; body: (c: Ctx) => string }

// Where merchants can always email their documents (owner rule — offered in every
// docs-request template as the no-friction alternative to the upload link).
const DOCS_EMAIL = "sales@send.mfunding.net";

const MAX_CHARS = 1600;

interface Props {
  /** The merchant's primary number. The ONE thing needed to text. */
  merchantPhone?: string | null;
  /** customers.additional_phones — selectable alternates. */
  additionalPhones?: string[] | null;
  /** Threads the outbound text to the merchant in Text Messages. */
  customerId?: string | null;
  /** Deal-scoped features: Connect-bank quick-insert + contact-attempt stamp. */
  dealId?: string | null;
  /** Enables the "their signing links" quick-inserts. */
  ghlContactId?: string | null;
  /** Enables the prefilled upload-form quick-insert (?email=). */
  merchantEmail?: string | null;
  merchantFirstName?: string | null;
  businessName?: string | null;
  /** Initial compose body (overrides a template until one is picked). */
  prefill?: string;
  /** Override the template chips; pass [] to hide them entirely. */
  templates?: TextTemplate[];
  /** The trigger button's label. Default: "Text — company line". */
  buttonLabel?: string;
  /** Override the trigger button's classes (e.g. a compact table pill). */
  buttonClassName?: string;
  /**
   * How the compose panel is presented when opened.
   *   · "inline"  (DEFAULT) — an absolutely-positioned dropdown anchored to the
   *                trigger. The original behavior; used by the playbook contact
   *                bar and the Setter Operations comms panel. Unchanged.
   *   · "modal"  — render through a portal to <body> as a centered overlay with a
   *                click-outside backdrop and a high z-index. Use this inside a
   *                table with horizontal-scroll/overflow so the panel can't be
   *                clipped by the scroll container or render under later rows.
   */
  presentation?: "inline" | "modal";
  /** Fired after a successful send — the host refetches (this was a touch). */
  onSent?: () => void;
}

const DEFAULT_BUTTON_CLS =
  "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-200 dark:hover:bg-indigo-900/60 transition-colors";

export default function TextMerchantPanel({
  merchantPhone,
  additionalPhones,
  customerId,
  dealId,
  ghlContactId,
  merchantEmail,
  merchantFirstName,
  businessName,
  prefill,
  templates,
  buttonLabel = "Text — company line",
  buttonClassName,
  presentation = "inline",
  onSent,
}: Props) {
  const { profile } = useUserProfile();
  const isModal = presentation === "modal";
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Hosts may still pass a custom template set; with none, the SMART templates
  // below (which auto-build with this merchant's real links) render instead.
  const TEMPLATES = templates ?? [];

  // ── To ──
  const phoneOptions = useMemo(() => {
    const all = [merchantPhone, ...(additionalPhones ?? [])]
      .map((p) => (p ?? "").trim())
      .filter(Boolean)
      .map(normalizePhoneForStorage);
    return Array.from(new Set(all));
  }, [merchantPhone, additionalPhones]);
  const [phone, setPhone] = useState(phoneOptions[0] ?? "");
  useEffect(() => { setPhone((p) => (p && phoneOptions.includes(p) ? p : phoneOptions[0] ?? "")); }, [phoneOptions]);
  // Manual entry — always available; forced on when there are no numbers on file.
  const [manual, setManual] = useState(false);
  const [manualPhone, setManualPhone] = useState("");
  const manualMode = manual || phoneOptions.length === 0;
  // The number the text actually goes to (typed number wins when in manual mode).
  const toPhone = manualMode ? (normalizePhoneForStorage(manualPhone) || "") : phone;

  const ctx: Ctx = useMemo(() => ({
    first: (merchantFirstName || "there").trim(),
    business: (businessName || "your business").trim(),
    closerFirst: (profile?.first_name || "").trim() || "your rep",
  }), [merchantFirstName, businessName, profile]);

  const [text, setText] = useState(prefill ?? "");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  // Documents attached as secure links. Each upload drops its public URL into the
  // body (it sends as plain text through sms-send) AND is tracked here so the
  // operator sees a chip and can pull it back out before sending.
  const [docChips, setDocChips] = useState<SmsDocAttachment[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const docInputRef = useRef<HTMLInputElement>(null);
  // Inline two-step confirm — no browser popups (owner rule), same armOrFire as
  // AdHocSendMenu. Disarms after 5s so a walked-away-from arm can't fire later.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  // ── From-line (the company number). Falls back to the one known JMP line if
  //    sms_lines isn't populated yet (see loadActiveSmsLines). ──
  const [lines, setLines] = useState<SmsLine[]>([]);
  const [lineId, setLineId] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void loadActiveSmsLines().then((ls) => {
      if (cancelled) return;
      setLines(ls);
      setLineId((prev) => prev ?? defaultLine(ls).id);
    });
    return () => { cancelled = true; };
  }, [open]);
  const selectedLine = useMemo(
    () => lines.find((l) => l.id === lineId) ?? lines[0],
    [lines, lineId],
  );

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

  // ── Close on outside click (inline only) ──
  // In modal mode the panel lives in a portal OUTSIDE wrapRef, so this native
  // document listener would treat every in-panel click as "outside" and close
  // it. The modal's own backdrop handles click-outside instead.
  useEffect(() => {
    if (!open || isModal) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setArmed(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, isModal]);

  // ── Close on Escape ──
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setArmed(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // ── Keep the panel on-screen: if opening left-anchored would spill past the
  //    right edge, anchor it to the right so it opens INWARD. Measured on open. ──
  const [dropRight, setDropRight] = useState(false);
  useLayoutEffect(() => {
    if (!open) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const panelW = Math.min(416, window.innerWidth * 0.92); // 26rem cap
    setDropRight(rect.left + panelW > window.innerWidth - 8);
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
    if (!dealId) return;
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

  /** Upload a document to the public sms-docs bucket and drop its link into the
   *  body as plain text (NOT an MMS). A PDF/Word doc can't ride an MMS reliably,
   *  so the link IS the delivery. Shows a chip so it's removable pre-send. */
  const attachDoc = async (file: File | undefined) => {
    if (!file) return;
    setResult(null);
    setUploadingDoc(true);
    try {
      const res = await uploadSmsDoc(file);
      if ("error" in res) {
        setResult({ ok: false, text: res.error });
        return;
      }
      insertAtCursor(res.url);
      setDocChips((prev) => [...prev, { name: res.name, url: res.url }]);
    } finally {
      setUploadingDoc(false);
      if (docInputRef.current) docInputRef.current.value = "";
    }
  };

  /** Remove an attached document's link from the body (best-effort string strip)
   *  and drop its chip. The body stays the source of truth for what sends. */
  const removeDocChip = (url: string) => {
    setDocChips((prev) => prev.filter((d) => d.url !== url));
    setText((prev) => prev.replace(url, "").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").trim());
    setArmed(false);
  };

  const uploadLink = uploadFormUrl
    ? merchantEmail
      ? `${uploadFormUrl}?email=${encodeURIComponent(merchantEmail)}`
      : uploadFormUrl
    : null;

  // ── SMART TEMPLATES (owner's three core use cases) — one click builds the whole
  // message WITH this merchant's real links. Setters/processors always work the
  // COMPLETE application, so the sign-link templates use the merchant's own sent
  // e-sign document; when it hasn't been sent yet the chip is disabled with the
  // reason (be proactive: never text a link that doesn't exist). ──
  const appDoc = useMemo(
    () => (sentLinks ?? []).find((l) => /application|prefill|partial/i.test(l.name) && l.url),
    [sentLinks],
  );
  const appSignUrl = appDoc?.url ?? null;
  const appAlreadySigned = appDoc?.signed === true;
  // Why the sign-link templates can't fire yet (null = they can).
  const appLinkBlock = !ghlContactId
    ? "No VibeReach contact on this merchant yet — send the application first."
    : sentLinks === null
      ? "Checking their documents…"
      : !appSignUrl
        ? "Send the application first (Fill out application → send) — its e-sign link doesn't exist yet."
        : appAlreadySigned
          ? "Application already signed ✓ — nothing to chase."
          : null;

  const statementsAsk = (lead: string) =>
    `${lead} your last 3-4 months of business bank statements (a photo of your driver's license helps too). ` +
    (uploadLink
      ? `Upload securely here: ${uploadLink} — or just email everything to ${DOCS_EMAIL}.`
      : `Just email everything to ${DOCS_EMAIL}.`);

  interface SmartTemplate { id: string; label: string; disabled: string | null; build: () => string }
  const smartTemplates: SmartTemplate[] = [
    {
      id: "sign-app",
      label: "✍️ Sign the application",
      disabled: appLinkBlock,
      build: () =>
        `Hi ${ctx.first}, it's ${ctx.closerFirst} with Momentum Funding. Your working-capital application for ${ctx.business} is ready — tap to review and e-sign (about 2 minutes): ${appSignUrl}`,
    },
    {
      id: "bank-docs",
      label: "🏦 Request bank statements",
      disabled: null,
      build: () => statementsAsk(`${ctx.first}, to finalize your funding options for ${ctx.business} I need`),
    },
    {
      id: "intro-all",
      label: "🚀 Intro — sign + docs",
      disabled: appLinkBlock,
      build: () =>
        `Hi ${ctx.first}, it's ${ctx.closerFirst} with Momentum Funding — great speaking with you about working capital for ${ctx.business}. Two quick steps to get your options:\n` +
        `1) Review + e-sign your application: ${appSignUrl}\n` +
        `2) ${uploadLink
          ? `Send your last 3-4 months of business bank statements + driver's license — upload: ${uploadLink} or email them to ${DOCS_EMAIL}.`
          : `Email your last 3-4 months of business bank statements + driver's license to ${DOCS_EMAIL}.`}\n` +
        `Questions? Just reply here.`,
    },
    { id: "blank", label: "Blank", disabled: null, build: () => "" },
  ];

  const applySmart = (t: SmartTemplate) => {
    if (t.disabled) return;
    setText(t.build());
    setResult(null);
    setArmed(false);
  };

  const send = async () => {
    setSending(true);
    setResult(null);
    try {
      const { error } = await supabase.functions.invoke("sms-send", {
        body: {
          to: toPhone,
          body: text.trim(),
          ...(customerId ? { customer_id: customerId } : {}),
          // Only a real sms_lines row carries an id; the hardcoded fallback line
          // sends without one (single-line path).
          ...(selectedLine?.id ? { line_id: selectedLine.id } : {}),
        },
      });
      if (error) {
        // The edge function's own refusal ("Do-Not-Contact", "rate limit", "not
        // a valid E.164 number", "message mentions 'loan'") is the useful
        // message — surface it verbatim.
        const { message } = await parseEdgeError(error, "The text was not sent.");
        setResult({ ok: false, text: message });
        return;
      }

      // A sent text IS a touch — bank the SLA stamp when we're on a deal, without
      // inflating the contact rate. Best-effort: a stamp failure must never make
      // a SENT text look unsent.
      if (dealId) {
        try {
          await logContactAttempt(dealId, { outcome: "attempted", channel: "sms" });
        } catch { /* the text went out; the stamp is bookkeeping */ }
      }
      onSent?.();

      setResult({ ok: true, text: `Sent to ${prettyPhone(toPhone)}.` });
      setText("");
      setDocChips([]);
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
  const noPhone = !toPhone;
  const canSend = !noPhone && text.trim() !== "" && chars <= MAX_CHARS && !sending;
  const lineNumber = selectedLine ? prettyPhone(selectedLine.phone) : prettyPhone("+17865041159");

  const quickCls =
    "text-[10px] font-semibold px-2 py-1 rounded-full border border-ocean-blue/40 text-ocean-blue hover:bg-ocean-blue hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

  // The compose body — identical in both presentations. Only its wrapper (an
  // inline dropdown vs. a portalled modal overlay) differs below.
  const panelBody = (
    <>
      {/* ── To / From ── */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="inline-flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide text-gray-400 flex-shrink-0">To</span>
              {manualMode ? (
                <input
                  type="tel"
                  autoFocus={phoneOptions.length === 0}
                  value={manualPhone}
                  onChange={(e) => setManualPhone(e.target.value)}
                  placeholder="type a mobile number…"
                  className="text-[11px] font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2 py-0.5 w-40"
                />
              ) : phoneOptions.length === 1 ? (
                <span className="text-[11px] font-mono text-gray-800 dark:text-gray-200">{prettyPhone(phone)}</span>
              ) : (
                <select
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="text-[11px] font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-1.5 py-0.5"
                >
                  {phoneOptions.map((p) => <option key={p} value={p}>{prettyPhone(p)}</option>)}
                </select>
              )}
              {/* Toggle between on-file numbers and a typed number — always available. */}
              {phoneOptions.length > 0 && (
                <button
                  type="button"
                  onClick={() => setManual((m) => !m)}
                  className="text-[10px] font-semibold text-ocean-blue hover:underline"
                >
                  {manualMode ? "use on-file number" : "type a different number"}
                </button>
              )}
            </span>
            {selectedLine && (
              <span className="inline-flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wide text-gray-400 flex-shrink-0">From</span>
                {lines.length > 1 ? (
                  <select
                    value={lineId ?? ""}
                    onChange={(e) => setLineId(e.target.value || null)}
                    title="The company number this text is sent from"
                    className="text-[11px] rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-1.5 py-0.5"
                  >
                    {lines.map((l) => (
                      <option key={l.id ?? l.phone} value={l.id ?? ""}>
                        {prettyPhone(l.phone)} · {l.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-[11px] font-mono text-gray-700 dark:text-gray-200">
                    {prettyPhone(selectedLine.phone)}
                  </span>
                )}
              </span>
            )}
          </div>

          {/* ── Templates ── */}
          {TEMPLATES.length > 0 ? (
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
          ) : (
            <>
              <div className="mt-2 flex flex-wrap gap-1">
                {smartTemplates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={!!t.disabled}
                    onClick={() => applySmart(t)}
                    title={t.disabled ?? "One click builds the whole message with this merchant's links"}
                    className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors ${
                      t.disabled
                        ? "border-gray-200 dark:border-gray-700 text-gray-300 dark:text-gray-600 cursor-not-allowed"
                        : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-ocean-blue hover:text-ocean-blue"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {/* Proactive: say WHY the sign-link templates are greyed, right here. */}
              {appLinkBlock && sentLinks !== null && (
                <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">{appLinkBlock}</p>
              )}
            </>
          )}

          {/* ── Quick-insert links — every one reuses an existing builder ── */}
          {(dealId || uploadLink || ghlContactId || docs.some((d) => d.public_link)) && (
            <>
              <p className="mt-2 text-[10px] uppercase tracking-wide text-gray-400">Insert a link</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {dealId && (
                  <button
                    type="button"
                    disabled={minting}
                    onClick={() => void insertConnectBank()}
                    className={quickCls}
                    title="Mints this merchant's /connect-bank link (plaid-mint-link) — 60 seconds to verify revenue and pull statements"
                  >
                    {minting ? "Minting…" : "🔗 Connect bank"}
                  </button>
                )}

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
            </>
          )}

          {/* ── Attach a document (secure link, not MMS) ── */}
          <input
            ref={docInputRef}
            type="file"
            accept={SMS_DOCS_ACCEPT}
            className="hidden"
            onChange={(e) => void attachDoc(e.target.files?.[0])}
          />
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <button
              type="button"
              disabled={uploadingDoc}
              onClick={() => docInputRef.current?.click()}
              className={quickCls}
              title="Upload a PDF/Word/Excel/image and drop a secure link into the message — sends as normal text (documents can't ride an MMS)"
            >
              <PaperClipIcon className="w-3 h-3 inline -mt-0.5" />{" "}
              {uploadingDoc ? "Uploading…" : "Attach a document"}
            </button>
            {docChips.map((d) => (
              <span
                key={d.url}
                className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 max-w-[12rem]"
                title={`${d.name} — link inserted into the message`}
              >
                <span className="truncate">📎 {d.name}</span>
                <button
                  type="button"
                  onClick={() => removeDocChip(d.url)}
                  title="Remove this document's link"
                  className="shrink-0 hover:text-red-600"
                >
                  <XMarkIcon className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>

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
            <span className={`text-[10px] tabular-nums ${chars > MAX_CHARS ? "text-red-600 dark:text-red-400 font-semibold" : "text-gray-400"}`}>
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
              {sending ? "Sending…" : armed ? `Tap again — send to ${prettyPhone(toPhone)}` : "Send text"}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-gray-400">
            Goes out on the company line {lineNumber} and lands in Text Messages.
            Keep it "funding" / "working capital" — an advance is never a loan.
          </p>

      {result && (
        <p className={`mt-1.5 text-[11px] ${result.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
          {result.text}
        </p>
      )}
    </>
  );

  return (
    <div ref={wrapRef} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Text the merchant on the company line — compose and send without leaving the page"
        className={buttonClassName ?? DEFAULT_BUTTON_CLS}
      >
        <ChatBubbleLeftRightIcon className="w-3 h-3" /> {buttonLabel}
      </button>

      {/* ── Inline dropdown (default) — anchored to the trigger ── */}
      {open && !isModal && (
        <div
          className={`absolute ${dropRight ? "right-0" : "left-0"} top-full z-30 mt-1.5 w-[26rem] max-w-[92vw] max-h-[80vh] overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl p-3`}
        >
          {panelBody}
        </div>
      )}

      {/* ── Modal overlay — portalled to <body> so it floats above the table's
             overflow/stacking context and can never be clipped or hidden under
             later rows. Backdrop click / Escape close it. ── */}
      {open && isModal && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
          onMouseDown={() => { setOpen(false); setArmed(false); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="relative my-8 w-[26rem] max-w-[92vw] max-h-[85vh] overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl p-3"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => { setOpen(false); setArmed(false); }}
              title="Close"
              className="absolute top-2 right-2 rounded-full p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
            <div className="pr-6">{panelBody}</div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
