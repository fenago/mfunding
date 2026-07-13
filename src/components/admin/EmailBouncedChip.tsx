import { useCallback, useEffect, useRef, useState } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";

/**
 * "This merchant's email address is DEAD" — said out loud, on the deal, before a
 * closer spends an hour on it.
 *
 * THE INCIDENT THIS EXISTS FOR (deal MF-2026-0029): a lead vendor supplied a
 * syntactically perfect but dead mailbox. GHL's very first automated email to it
 * hard-bounced (mailgun: "1 Requested mail action aborted, mailbox not found" — a
 * 550), and GHL then rejected every subsequent send with 400 "Contact's email is
 * invalid". Nothing in this app surfaced that. The closer discovered it only after
 * qualifying the merchant and filling out the entire application — and six e-sign
 * document records had already been minted against a mailbox nobody would ever read.
 *
 * A bounce is a fact about the ADDRESS, so it is stored on the merchant
 * (customers.email_status), stamped by the check-email-bounces sweep within ~15
 * minutes of the lead landing. This chip just reads it — no GHL call per render.
 *
 *   email_status = 'bounced'  → red chip, the SMTP reason, and the only fix that works
 *   anything else             → renders NOTHING (silence = the address is fine)
 *
 * The fix is a phone call, not a GHL edit: re-saving the address or merging contacts
 * does nothing at all, which is exactly the wild-goose chase the old error copy sent
 * us on. Editing the merchant's email clears the flag automatically (DB trigger).
 */
export default function EmailBouncedChip({ customerId }: { customerId: string }) {
  const [state, setState] = useState<{ email: string | null; reason: string | null } | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("customers")
      .select("email, email_status, email_bounce_reason")
      .eq("id", customerId)
      .maybeSingle();
    setState(
      data?.email_status === "bounced"
        ? {
          email: (data?.email as string | null) ?? null,
          reason: (data?.email_bounce_reason as string | null) ?? null,
        }
        : null,
    );
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // No bounce (or not loaded yet) → say nothing. A chip that shows up when
  // everything is fine is a chip closers learn to ignore.
  if (!state) return null;

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`${state.email ?? "This address"} is undeliverable — the last email to it bounced. Get a working email before you send anything.`}
        className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border border-red-300 dark:border-red-800 hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors"
      >
        <ExclamationTriangleIcon className="w-3 h-3" />
        Email bounced — get a new one
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-96 rounded-xl border border-red-200 dark:border-red-900 bg-white dark:bg-gray-800 shadow-xl p-3">
          <p className="text-xs font-semibold text-red-700 dark:text-red-300 mb-1">
            {state.email} is undeliverable
          </p>
          <p className="text-[11px] text-gray-600 dark:text-gray-300">
            The last email we sent it bounced
            {state.reason ? <> — <span className="font-mono">{state.reason}</span></> : ""}. Our email
            provider has flagged the address and will reject every send to it, including the
            application and the e-sign documents.
          </p>
          <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-2">
            <span className="font-semibold">Call the merchant and get a working email</span>, then put it
            on the deal with “Edit lead info”. That clears this flag on its own. Re-saving the address or
            merging contacts in GHL will not fix it — the mailbox does not exist.
          </p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-2 w-full text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            Got it
          </button>
        </div>
      )}
    </div>
  );
}
