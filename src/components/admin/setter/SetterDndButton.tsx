import { useEffect, useRef, useState } from "react";
import type { DealWithCustomer } from "@/types/deals";
import { setContactDnd } from "@/services/dealService";

// ── "🚫 Add to DND" — standalone Setter Operations control ──
// The merchant says "take me off your list" MID-CALL. This is the one press that
// honors it: set-contact-dnd flips `dnd` on the GHL contact, which is the durable
// suppression the dialer actually enforces (WAVV/LeadConnector will not place a
// call or send a text to a DND contact) — so we can no longer reach them, by
// accident or otherwise. It does NOT close the deal; suppressing the contact and
// dispositioning the opportunity are separate decisions.
//
// Two-step confirm INLINE (no browser popups — owner rule): the first tap arms,
// the second tap fires, and an armed button disarms itself after DISARM_MS so a
// stray tap can't be completed by an unrelated one later.
//
// `do_not_contact` is tri-state on purpose: `undefined` means the deal projection
// didn't read the flag (UNREAD ≠ "not suppressed"), so we show the actionable
// button rather than claiming they're callable. Firing on an already-DND contact
// is a harmless no-op. setContactDnd only SETS `dnd` (no clear in its signature),
// so an already-suppressed contact shows an inert badge — lift it in GHL.

const DND_DISARM_MS = 5000;

export default function SetterDndButton({
  deal,
  onRefresh,
}: {
  deal: DealWithCustomer;
  onRefresh: () => void;
}) {
  const dealId = deal.id;
  const ghlContactId = deal.ghl_contact_id;
  const alreadyDnd = deal.customer?.do_not_contact;

  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), DND_DISARM_MS);
    return () => clearTimeout(t);
  }, [armed]);

  // Suppressed already (locally mirrored, or we just did it) — a muted, inert badge.
  if (done || alreadyDnd === true) {
    return (
      <div className="inline-flex flex-col gap-1">
        <span
          title="This contact is on Do-Not-Contact — the dialer will not call or text them. Lift it in GHL if they ask back in."
          className="inline-flex items-center gap-1 text-[12px] font-medium px-2 py-0.5 rounded-full border border-gray-300 text-gray-500 bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:bg-gray-800"
        >
          🚫 On Do-Not-Contact
        </span>
        {status && (
          <span className={`text-[11px] ${status.tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {status.text}
          </span>
        )}
      </div>
    );
  }

  const fire = async () => {
    if (busy) return;
    if (!armed) { setArmed(true); return; }
    setBusy(true);
    try {
      const { mirrored } = await setContactDnd({ dealId, ghlContactId, reason: "Merchant asked not to be contacted" });
      if (!alive.current) return;
      setDone(true);
      // The GHL flag is what stops the dialer, so that's the promise we make. A
      // failed LOCAL mirror is still said out loud — it's the only reason this
      // control might not read "On Do-Not-Contact" on the next open.
      setStatus({
        text: mirrored
          ? "Added to DND — they won't be called"
          : "Added to DND in GHL — they won't be called (local record didn't update)",
        tone: mirrored ? "ok" : "error",
      });
      onRefresh();
    } catch (e) {
      if (!alive.current) return;
      setStatus({ text: e instanceof Error ? e.message : "Could not add this contact to DND.", tone: "error" });
    } finally {
      if (alive.current) { setBusy(false); setArmed(false); }
    }
  };

  return (
    <div className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={fire}
        disabled={busy || !ghlContactId}
        title={
          ghlContactId
            ? "Stop all calls and texts to this contact. Sets Do-Not-Contact on their CRM record — the dialer will refuse to reach them. Does not close the deal."
            : "No linked contact — nothing for the dialer to suppress yet"
        }
        className={`inline-flex items-center gap-1 text-[12px] font-medium px-2 py-0.5 rounded-full border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          armed
            ? "border-red-500 text-white bg-red-600 hover:bg-red-700 dark:border-red-500 dark:bg-red-600"
            : "border-gray-300 text-gray-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-red-900/25 dark:hover:text-red-300 dark:hover:border-red-800"
        }`}
      >
        {busy ? "🚫 …" : armed ? "🚫 Tap again to confirm" : "🚫 Add to DND"}
      </button>
      {status && (
        <span className={`text-[11px] ${status.tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
          {status.text}
        </span>
      )}
    </div>
  );
}
