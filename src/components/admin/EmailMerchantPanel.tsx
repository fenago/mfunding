import { useMemo, useState } from "react";
import {
  EnvelopeIcon,
  XMarkIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  PaperAirplaneIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { useUserProfile } from "@/context/UserProfileContext";

/**
 * Email the merchant, from inside the playbook, on any deal, at any step.
 *
 * The closer lives in the playbook. Until now, sending the merchant a line meant
 * leaving it — go to Comms, find the contact, compose, come back — which is exactly
 * the kind of context switch that doesn't happen when you're on a clock. It matters
 * most on a REAL-TIME lead, where the 5-minute speed-to-lead window is satisfied by
 * an EMAIL (nobody is on the phone, and the merchant told us when to call). If the
 * email is three screens away, that window is missed.
 *
 * Transport is `send-merchant-email` — the SAME function the Funder Responses board
 * uses. It goes out through GHL, so it lands in the merchant's existing Conversations
 * thread, which stays the system of record for comms. Nothing new is invented here and
 * NO automation is touched: this fires only on an explicit click, exactly like the
 * existing send path.
 *
 * COMPLIANCE: MCA = a purchase of future receivables, NOT a loan. Every template below
 * says "funding" / "capital" / "options" and makes no approval promise. The closer can
 * edit freely before sending — this is a starting point, not a wrapper.
 */

interface Props {
  dealId: string;
  merchantEmail?: string | null;
  merchantFirstName?: string | null;
  businessName?: string | null;
  /** deals.lead_source — picks the default template. */
  leadSource?: string | null;
  /** deals.lead_qual.best_time — the merchant's own "best time to reach you" answer. */
  bestTime?: string | null;
  className?: string;
}

interface Template {
  id: string;
  label: string;
  subject: (c: Ctx) => string;
  body: (c: Ctx) => string;
}
interface Ctx {
  first: string;
  business: string;
  closer: string;
  bestTime: string;
}

const TEMPLATES: Template[] = [
  {
    // THE speed-to-lead touch on a real-time lead. It exists to satisfy the 5-minute
    // window WITHOUT cold-calling someone who told us to reach them at 4pm.
    id: "realtime-intro",
    label: "Real-time intro (5-min touch)",
    subject: (c) => `${c.business} — your funding options`,
    body: (c) =>
      `Hi ${c.first},\n\n` +
      `${c.closer} here with Momentum Funding. You just spoke with our team about working capital for ${c.business} — I have your details in front of me and I'm pulling your options now.\n\n` +
      (c.bestTime
        ? `You mentioned ${c.bestTime} is the best time to reach you, so I'll give you a call then.\n\nIf you'd rather talk sooner, just reply to this email and I'll ring you right away.\n\n`
        : `I'll give you a call shortly. If there's a better time to reach you, just reply and let me know.\n\n`) +
      `To move fast, the only thing I'll need is your last 3-4 months of business bank statements.\n\n` +
      `Talk soon,\n${c.closer}\nMomentum Funding`,
  },
  {
    id: "missed-call",
    label: "Tried you / missed connection",
    subject: (c) => `Tried you — ${c.business}`,
    body: (c) =>
      `Hi ${c.first},\n\n` +
      `${c.closer} with Momentum Funding — I gave you a call about working capital for ${c.business} and didn't catch you.\n\n` +
      `What's a good time to reach you? Reply here with a window and I'll make it work.\n\n` +
      `Thanks,\n${c.closer}\nMomentum Funding`,
  },
  {
    id: "statements",
    label: "Chase bank statements",
    subject: (c) => `Last piece for ${c.business}`,
    body: (c) =>
      `Hi ${c.first},\n\n` +
      `Quick one — to get your funding options in front of you, I just need your last 3-4 months of business bank statements.\n\n` +
      `You can reply to this email with PDFs, or upload them in your portal — whichever is easier.\n\n` +
      `As soon as those are in, I can get you numbers.\n\n` +
      `Thanks,\n${c.closer}\nMomentum Funding`,
  },
  { id: "blank", label: "Blank — write my own", subject: () => "", body: () => "" },
];

export default function EmailMerchantPanel({
  dealId,
  merchantEmail,
  merchantFirstName,
  businessName,
  leadSource,
  bestTime,
  className = "",
}: Props) {
  const { profile } = useUserProfile();
  const [open, setOpen] = useState(false);

  const ctx: Ctx = useMemo(
    () => ({
      first: (merchantFirstName || "there").trim(),
      business: (businessName || "your business").trim(),
      closer: [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || "Your rep",
      bestTime: (bestTime || "").trim(),
    }),
    [merchantFirstName, businessName, profile, bestTime],
  );

  // A real-time lead opens on the speed-to-lead template; everything else on the
  // missed-connection one. Either way the closer can switch or rewrite.
  const defaultTpl = leadSource === "realtime_appt" ? "realtime-intro" : "missed-call";
  const [tplId, setTplId] = useState(defaultTpl);
  const tpl = TEMPLATES.find((t) => t.id === tplId) ?? TEMPLATES[0];

  const [subject, setSubject] = useState(() => tpl.subject(ctx));
  const [bodyText, setBodyText] = useState(() => tpl.body(ctx));
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const applyTemplate = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    setTplId(id);
    setSubject(t.subject(ctx));
    setBodyText(t.body(ctx));
    setResult(null);
  };

  const openPanel = () => {
    applyTemplate(defaultTpl);
    setOpen(true);
  };

  const send = async () => {
    setSending(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("send-merchant-email", {
        body: { dealId, subject: subject.trim(), body: bodyText.trim() },
      });
      if (error) throw error;
      const d = data as { error?: string } | null;
      if (d?.error) throw new Error(d.error);
      setResult({ ok: true, text: "Sent. It's in their Conversations thread." });
      setTimeout(() => setOpen(false), 1400);
    } catch (e) {
      setResult({
        ok: false,
        text: e instanceof Error ? e.message : "Could not send. Try again.",
      });
    } finally {
      setSending(false);
    }
  };

  // No email on file = nothing to send to. Say so plainly instead of failing on click.
  const noEmail = !merchantEmail;
  const canSend = !noEmail && subject.trim() !== "" && bodyText.trim() !== "" && !sending;

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={openPanel}
        title={noEmail ? "This merchant has no email on file yet" : `Email ${merchantEmail}`}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-ocean-blue/40 text-ocean-blue hover:bg-ocean-blue hover:text-white transition-colors"
      >
        <EnvelopeIcon className="w-3.5 h-3.5" />
        Email merchant
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-20" onClick={() => setOpen(false)}>
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-xl flex flex-col max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-gray-900 dark:text-white">Email the merchant</h3>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                  To {merchantEmail || "— no email on file"} · lands in their Conversations thread
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-3">
              {noEmail && (
                <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  <ExclamationCircleIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>
                    No email on file for this merchant. Add one in the deal's contact details first — then you can send.
                  </span>
                </div>
              )}

              {/* The merchant's own words about when to call. Right above the compose
                  box, because it's what the email is supposed to acknowledge. */}
              {bestTime && (
                <div className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  They asked to be called at <b>{bestTime}</b> — the template below says you'll call then.
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => applyTemplate(t.id)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                      tplId === t.id
                        ? "bg-ocean-blue text-white border-ocean-blue"
                        : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-ocean-blue"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1">Subject</label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-ocean-blue"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1">Message</label>
                <textarea
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  rows={12}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-ocean-blue resize-y"
                />
                <p className="mt-1 text-[10px] text-gray-400">
                  Edit freely before sending. Keep it "funding" / "capital" — never call an advance a loan.
                </p>
              </div>

              {result && (
                <p
                  className={`flex items-center gap-1.5 text-xs ${
                    result.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {result.ok ? (
                    <CheckCircleIcon className="w-4 h-4 flex-shrink-0" />
                  ) : (
                    <ExclamationCircleIcon className="w-4 h-4 flex-shrink-0" />
                  )}
                  {result.text}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={send}
                disabled={!canSend}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-ocean-blue hover:bg-deep-sea disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              >
                {sending ? (
                  <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                ) : (
                  <PaperAirplaneIcon className="w-4 h-4" />
                )}
                Send email
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
