import { useEffect, useMemo, useState } from "react";
import {
  ChatBubbleLeftRightIcon,
  PaperAirplaneIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { parseEdgeError } from "@/lib/edgeError";
import { normalizePhoneForStorage } from "@/lib/phone";
import { prettyPhone } from "@/lib/sms";
import { loadActiveSmsLines, defaultLine, type SmsLine } from "@/lib/smsLines";

/**
 * The playbook's script card, made SENDABLE.
 *
 * Every step's verbatim script used to render as a static read-aloud box. This
 * component keeps that read view AND lets a setter/closer fire the same words to
 * the merchant as a text — without leaving the playbook. The script is the
 * starting draft; it's fully editable before it goes out (a phone opener gets
 * trimmed into a text; a labelled multi-variant script gets pared to the one
 * variant you're sending).
 *
 * SEND PATH — identical to the Text Messages inbox: `sms-send` (staff JWT) is the
 * one gate. It enforces suppression / DND (fail-closed), the rate cap, E.164, and
 * the MCA "loan" compliance block. Its refusal is the answer, not an app bug, so
 * we surface it verbatim. FROM-line comes from `loadActiveSmsLines()` — one line
 * today (the JMP number), architected for more; a selector appears only when >1.
 *
 * NO PHONE, NO SEND: with no merchant number on the deal (or in browse mode with
 * no deal open) the composer is disabled with a plain note — we never invent a
 * destination.
 *
 * NO BROWSER POPUPS (owner rule): Send is an inline two-step. First tap arms
 * ("tap again to send to (xxx) …"), second tap fires; it disarms after 5s so a
 * walked-away-from arm can't fire later.
 *
 * COMPLIANCE: an MCA is a purchase of future receivables, NEVER a loan. The
 * scripts already say funding / working capital / advance, and `sms-send` refuses
 * outright to transmit a body containing "loan".
 */

// Mirrors MAX_CHARS in the sms-send edge function so the counter agrees with the
// gate that will actually refuse the send.
const MAX_CHARS = 1600;

interface Props {
  /** The step's verbatim script (`step.say`) — shown read-only, and the editable
   *  starting draft for the text. */
  script: string;
  /** The resolved merchant's primary number (deal.customer.phone). */
  merchantPhone?: string | null;
  /** customers.additional_phones — selectable alternates. */
  additionalPhones?: string[] | null;
  /** Links the outbound text to the customer so it threads in the inbox. */
  customerId?: string | null;
  /** True once a real deal/merchant is loaded. False while browsing the flow. */
  interactive: boolean;
  /** Fired after a successful send — the host can refetch (a text is a touch). */
  onSent?: () => void;
}

export default function PlaybookTextSend({
  script,
  merchantPhone,
  additionalPhones,
  customerId,
  interactive,
  onSent,
}: Props) {
  const [open, setOpen] = useState(false);

  // Every distinct number we could text this merchant on, canonicalised.
  const phoneOptions = useMemo(() => {
    const all = [merchantPhone, ...(additionalPhones ?? [])]
      .map((p) => (p ?? "").trim())
      .filter(Boolean)
      .map(normalizePhoneForStorage);
    return Array.from(new Set(all));
  }, [merchantPhone, additionalPhones]);

  const [phone, setPhone] = useState(phoneOptions[0] ?? "");
  useEffect(() => {
    setPhone((p) => (p && phoneOptions.includes(p) ? p : phoneOptions[0] ?? ""));
  }, [phoneOptions]);

  // The editable draft. Re-seed from the script whenever the script changes (a
  // different step) — but only while the composer is closed, so an open edit is
  // never yanked out from under the person typing.
  const [body, setBody] = useState(script);
  useEffect(() => {
    if (!open) setBody(script);
  }, [script, open]);

  // Sending FROM which company number. Falls back to the one known JMP line if
  // sms_lines isn't populated yet (see loadActiveSmsLines).
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
    return () => {
      cancelled = true;
    };
  }, [open]);
  const selectedLine = useMemo(
    () => lines.find((l) => l.id === lineId) ?? lines[0],
    [lines, lineId],
  );

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Inline two-step confirm — no browser popups (owner rule).
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  const noPhone = !phone;
  const overLimit = body.length > MAX_CHARS;
  const canSend = interactive && !noPhone && body.trim() !== "" && !overLimit && !sending;

  async function send() {
    if (!canSend) return;
    setSending(true);
    setResult(null);
    try {
      const { error } = await supabase.functions.invoke("sms-send", {
        body: {
          to: phone,
          body: body.trim(),
          ...(customerId ? { customer_id: customerId } : {}),
          // Only a real sms_lines row carries an id; the hardcoded fallback line
          // sends without one (single-line path).
          ...(selectedLine?.id ? { line_id: selectedLine.id } : {}),
        },
      });
      if (error) {
        // The edge function's own refusal ("merchant is on Do-Not-Contact",
        // "rate limit", "not a valid E.164 number", "message mentions 'loan'") is
        // the useful message — show it verbatim.
        const parsed = await parseEdgeError(error, "The text was not sent.");
        setResult({ ok: false, text: parsed.message });
        return;
      }
      setResult({ ok: true, text: `Sent to ${prettyPhone(phone)}.` });
      onSent?.();
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "The text was not sent." });
    } finally {
      setSending(false);
      setArmed(false);
    }
  }

  return (
    <div className="mt-3 rounded-md border-l-4 border-ocean-blue bg-ocean-blue/5 dark:bg-ocean-blue/10">
      {/* ── Read view — the verbatim script, unchanged in look ── */}
      <div className="flex gap-2 px-3 py-2">
        <ChatBubbleLeftRightIcon className="w-4 h-4 text-ocean-blue shrink-0 mt-0.5" />
        {/* whitespace-pre-line: some steps carry LABELLED script variants split by
            newlines (renewal paydown tiers, cold-dial openers). */}
        <p className="text-sm italic text-gray-700 dark:text-gray-200 whitespace-pre-line">"{script}"</p>
      </div>

      {/* ── Text-it affordance ── */}
      <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
        <button
          type="button"
          onClick={() => {
            setResult(null);
            setArmed(false);
            setOpen((o) => !o);
          }}
          disabled={!interactive}
          title={
            interactive
              ? "Text this to the merchant on the company line"
              : "Open a merchant first, then you can text this script"
          }
          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-mint-green/20 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 hover:bg-mint-green/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <PaperAirplaneIcon className="w-3 h-3" /> {open ? "Close" : "Send as a text"}
        </button>
        {!interactive && (
          <span className="text-[11px] text-gray-400">Open a merchant to send this as a text.</span>
        )}
        {interactive && noPhone && (
          <span className="text-[11px] text-amber-600 dark:text-amber-400">
            No mobile on file — add one in the deal's contact details to text.
          </span>
        )}
      </div>

      {/* ── Composer ── */}
      {open && interactive && (
        <div className="border-t border-ocean-blue/20 dark:border-ocean-blue/30 px-3 py-3 space-y-2">
          {/* To / From */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-gray-500 dark:text-gray-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="uppercase tracking-wide">To</span>
              {phoneOptions.length <= 1 ? (
                <span className="font-mono text-gray-800 dark:text-gray-200">
                  {phone ? prettyPhone(phone) : "—"}
                </span>
              ) : (
                <select
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="font-mono text-[11px] rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-1.5 py-0.5"
                >
                  {phoneOptions.map((p) => (
                    <option key={p} value={p}>
                      {prettyPhone(p)}
                    </option>
                  ))}
                </select>
              )}
            </span>
            {selectedLine && (
              <span className="inline-flex items-center gap-1.5">
                <span className="uppercase tracking-wide">From</span>
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
                  <span className="font-semibold text-gray-700 dark:text-gray-200">
                    {prettyPhone(selectedLine.phone)} · {selectedLine.label}
                  </span>
                )}
              </span>
            )}
          </div>

          <textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setResult(null);
              setArmed(false);
            }}
            rows={4}
            placeholder="Write the text…"
            className="w-full text-[12px] rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2 py-1.5 resize-y"
          />

          <div className="flex items-center justify-between gap-2">
            <span
              className={`text-[10px] tabular-nums ${overLimit ? "text-red-600 dark:text-red-400 font-semibold" : "text-gray-400"}`}
            >
              {body.length}/{MAX_CHARS}
            </span>
            <button
              type="button"
              onClick={() => {
                if (armed) void send();
                else setArmed(true);
              }}
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
              {sending ? "Sending…" : armed ? `Tap again — send to ${prettyPhone(phone)}` : "Send text"}
            </button>
          </div>

          <p className="text-[10px] text-gray-400">
            Goes out on the company line and lands in Text Messages. Keep it "funding" / "working
            capital" — an advance is never a loan.
          </p>

          {result && (
            <p
              className={`flex items-start gap-1.5 text-[11px] ${result.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
            >
              {result.ok ? (
                <CheckCircleIcon className="w-4 h-4 shrink-0 mt-px" />
              ) : (
                <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-px" />
              )}
              {result.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
