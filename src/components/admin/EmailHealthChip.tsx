import { useCallback, useEffect, useRef, useState } from "react";
import { ExclamationTriangleIcon, QuestionMarkCircleIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import { mustWrite } from "../../supabase/writes";

/**
 * "This merchant's email is DEAD" — said out loud, on the deal, before a closer
 * spends an hour on it.
 *
 * THE INCIDENT (deal MF-2026-0029): a lead vendor supplied a syntactically perfect
 * but dead mailbox. GHL's first automated email hard-bounced (550, "mailbox not
 * found"); GHL then rejected every send with 400 "Contact's email is invalid".
 * Nothing surfaced any of it. The closer found out only after qualifying the merchant
 * and filling in the whole application — and six e-sign documents had already been
 * minted against a mailbox nobody would ever read.
 *
 * Now every merchant email is verified by Instantly the moment the lead lands (a DB
 * trigger, so it fires no matter which road the lead came in on), and a real bounce
 * overwrites the guess with proof. This chip reads the stored verdict — no API call
 * per render:
 *
 *   invalid / bounced  → RED. The mailbox does not exist. Sends are BLOCKED upstream.
 *   catch_all / risky  → AMBER, and honest: "can't verify" is NOT "fine".
 *   verified           → renders NOTHING. A chip that shows when all is well is a
 *                        chip closers learn to ignore.
 *
 * And it closes the loop: the closer has the merchant on the phone and the correct
 * address in their ear, so the fix is an input box RIGHT HERE. Saving it re-verifies
 * automatically (same DB trigger) — ten seconds, not thirty minutes.
 */
type Health = "verified" | "catch_all" | "risky" | "invalid" | "bounced" | "unknown";

export default function EmailHealthChip({ customerId }: { customerId: string }) {
  const [state, setState] = useState<{ email: string | null; health: Health | null; reason: string | null } | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"save" | "verify" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("customers")
      .select("email, email_status, email_bounce_reason")
      .eq("id", customerId)
      .maybeSingle();
    setState({
      email: (data?.email as string | null) ?? null,
      health: (data?.email_status as Health | null) ?? null,
      reason: (data?.email_bounce_reason as string | null) ?? null,
    });
  }, [customerId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Save the corrected address. The DB trigger re-verifies it on its own, so we just
  // poll the row back a moment later — the closer sees the chip clear itself.
  const saveEmail = async () => {
    const next = draft.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) { setNote("That doesn't look like an email address."); return; }
    setBusy("save"); setNote(null);
    try {
      await mustWrite("customers.email (fix bad address)",
        supabase.from("customers").update({ email: next }).eq("id", customerId));
      setNote("Saved — verifying the new address…");
      setDraft("");
      // Verification takes ~20s; show the result when it lands.
      setTimeout(() => { void load().then(() => setNote(null)); }, 25000);
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not save the new email.");
    } finally { setBusy(null); }
  };

  const reverify = async () => {
    setBusy("verify"); setNote(null);
    try {
      const { data, error } = await supabase.functions.invoke("verify-merchant-email", {
        body: { customerId },
      });
      if (error) throw error;
      setNote(`Verifier says: ${(data as { health?: string })?.health ?? "unknown"}`);
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Re-verify failed.");
    } finally { setBusy(null); }
  };

  if (!state) return null;
  const h = state.health;
  // Silence when the address is good (or we simply haven't established it yet).
  if (h !== "invalid" && h !== "bounced" && h !== "catch_all" && h !== "risky") return null;

  const bad = h === "invalid" || h === "bounced";
  const label = h === "bounced"
    ? "Email bounced — get a new one"
    : h === "invalid"
      ? "Email invalid — get a new one"
      : "Email can't be verified";

  const chipClass = bad
    ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border border-red-300 dark:border-red-800 hover:bg-red-200 dark:hover:bg-red-900/60"
    : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-800 hover:bg-amber-200 dark:hover:bg-amber-900/60";

  const headline = h === "bounced"
    ? `${state.email} is undeliverable — a real email to it bounced.`
    : h === "invalid"
      ? `${state.email} does not exist — our verifier could not find the mailbox.`
      : `We cannot confirm ${state.email} is a real mailbox.`;

  const detail = bad
    ? "Our email provider will reject every send to it — the application and the e-sign documents will never arrive. Sending is blocked so we don't create documents the merchant can never receive."
    : h === "catch_all"
      ? "The domain accepts mail for any address, so a verification cannot prove this mailbox exists. It may work, it may not — confirm it on the phone before you rely on it."
      : "The verifier isn't confident about this address. Confirm it on the phone before you send anything important.";

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setDraft(state.email ?? ""); }}
        title={headline}
        className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full transition-colors ${chipClass}`}
      >
        {bad ? <ExclamationTriangleIcon className="w-3 h-3" /> : <QuestionMarkCircleIcon className="w-3 h-3" />}
        {label}
      </button>

      {open && (
        <div className={`absolute left-0 top-full z-30 mt-1.5 w-96 rounded-xl border bg-white dark:bg-gray-800 shadow-xl p-3 ${bad ? "border-red-200 dark:border-red-900" : "border-amber-200 dark:border-amber-900"}`}>
          <p className={`text-xs font-semibold mb-1 ${bad ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300"}`}>
            {headline}
          </p>
          {state.reason && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 font-mono mb-1">{state.reason}</p>
          )}
          <p className="text-[11px] text-gray-600 dark:text-gray-300">{detail}</p>

          {/* THE FIX, right here. They have the merchant on the phone. */}
          <label className="block mt-2.5 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
            Got a working email? Put it in — it re-verifies itself.
          </label>
          <div className="mt-1 flex gap-1.5">
            <input
              type="email"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void saveEmail(); }}
              placeholder="owner@theirbusiness.com"
              className="flex-1 text-[11px] rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 px-2 py-1"
            />
            <button
              type="button"
              onClick={() => void saveEmail()}
              disabled={busy !== null || !draft.trim() || draft.trim() === state.email}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy === "save" ? "Saving…" : "Save"}
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => void reverify()}
              disabled={busy !== null}
              className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-50"
            >
              <ArrowPathIcon className={`w-3 h-3 ${busy === "verify" ? "animate-spin" : ""}`} />
              {busy === "verify" ? "Re-verifying…" : "Re-verify"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              Close
            </button>
          </div>
          {note && <p className="mt-1.5 text-[11px] text-gray-600 dark:text-gray-300">{note}</p>}
        </div>
      )}
    </div>
  );
}
