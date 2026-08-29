import { useEffect, useState } from "react";
import { PhoneIcon } from "@heroicons/react/24/outline";
import {
  logContactAttempt,
  updateDealStatus,
  addDealNote,
  type ContactOutcome,
} from "../../../services/dealService";
import { etDateTimeLocalToUtcIso, etDateTimeLocalValue, tomorrowAtEtIso, dateTimeET } from "../../../utils/time";
import type { DealWithCustomer, DealStatus } from "../../../types/deals";

/**
 * SetterCallOutcome — log a call disposition + (optionally) set a callback,
 * end-to-end, without leaving the console. Every mutation reuses the EXACT
 * mechanism the Revenue Playbook / My Day use — nothing new is invented:
 *
 *   · Connected        → logContactAttempt(reached)   — stamps contacted_at + spoke_at,
 *                                                        advances New → Contacted
 *   · No answer        → logContactAttempt(attempted) — bumps contact_attempts + SLA clock
 *   · Left voicemail   → logContactAttempt(attempted)
 *   · Callback         → logContactAttempt(callback, callbackAt[, spoke]) — writes
 *                                                        callback_at + fires callback-calendar-sync
 *   · Not interested   → updateDealStatus(nurture)     — the app's soft-no park (My Day pattern)
 *
 * An optional note rides along via addDealNote (activity_log, author-stamped, then
 * best-effort GHL contact-note sync) so the disposition leaves a readable trail in
 * the deal history and the Notes panel.
 *
 * Callback time is entered AS EASTERN (etDateTimeLocalToUtcIso), same as the
 * Playbook's callback/appointment pickers. Two-step inline confirm on save — the
 * owner's rule is no browser popups.
 */

type OutcomeKey = "connected" | "no_answer" | "voicemail" | "callback" | "not_interested";

interface OutcomeDef {
  key: OutcomeKey;
  label: string;
  emoji: string;
  /** How this maps onto the canonical mechanism. */
  kind: "attempt" | "park";
  outcome?: ContactOutcome;
  /** Terminal stage for `park` outcomes (updateDealStatus). */
  stage?: DealStatus;
  activeCls: string;
}

const OUTCOMES: OutcomeDef[] = [
  { key: "connected", label: "Connected", emoji: "🗣", kind: "attempt", outcome: "reached", activeCls: "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  { key: "no_answer", label: "No answer", emoji: "📵", kind: "attempt", outcome: "attempted", activeCls: "border-gray-400 bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200" },
  { key: "voicemail", label: "Left voicemail", emoji: "📼", kind: "attempt", outcome: "attempted", activeCls: "border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300" },
  { key: "callback", label: "Callback", emoji: "🕐", kind: "attempt", outcome: "callback", activeCls: "border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  { key: "not_interested", label: "Not interested", emoji: "🚫", kind: "park", stage: "nurture", activeCls: "border-rose-500 bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300" },
];

const ARM_MS = 5000;

export default function SetterCallOutcome({
  deal,
  onRefresh,
}: {
  deal: DealWithCustomer;
  onRefresh: () => void;
}) {
  const [picked, setPicked] = useState<OutcomeKey | null>(null);
  const [callbackLocal, setCallbackLocal] = useState(() => etDateTimeLocalValue(tomorrowAtEtIso(10, 0)));
  const [spoke, setSpoke] = useState(false);
  const [note, setNote] = useState("");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const def = OUTCOMES.find((o) => o.key === picked) ?? null;

  // Armed save disarms itself so a stray first tap can't be completed later.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);

  // Changing the selection cancels any armed save (the confirm was for the old pick).
  useEffect(() => {
    setArmed(false);
    setError(null);
  }, [picked]);

  const reset = () => {
    setPicked(null);
    setSpoke(false);
    setNote("");
    setArmed(false);
  };

  const save = async () => {
    if (!def) return;
    // Two-step confirm: first tap arms, second fires.
    if (!armed) {
      setError(null);
      setArmed(true);
      return;
    }
    setArmed(false);

    let callbackIso: string | null = null;
    if (def.outcome === "callback") {
      callbackIso = etDateTimeLocalToUtcIso(callbackLocal);
      if (!callbackIso) {
        setError("Enter the callback date & time (ET).");
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      if (def.kind === "park" && def.stage) {
        await updateDealStatus(deal.id, def.stage);
      } else if (def.outcome) {
        await logContactAttempt(deal.id, {
          outcome: def.outcome,
          channel: "call",
          callbackAt: callbackIso,
          spoke: def.outcome === "callback" ? spoke : undefined,
        });
      }

      // Optional note — needs the customer to hang it off; the disposition itself is
      // already recorded on the deal above, so a missing customer id only skips the note.
      const trimmed = note.trim();
      if (trimmed && deal.customer?.id) {
        const label = `${def.emoji} ${def.label}${callbackIso ? ` · callback ${dateTimeET(callbackIso)}` : ""}`;
        await addDealNote({
          dealId: deal.id,
          customerId: deal.customer.id,
          content: `${label} — ${trimmed}`,
          interactionType: "call",
        });
      }

      setDone(
        def.outcome === "callback" && callbackIso
          ? `Callback set for ${dateTimeET(callbackIso)}.`
          : `Logged: ${def.label}.`,
      );
      setTimeout(() => setDone(null), 4000);
      reset();
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not log the outcome. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const fieldCls =
    "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-ocean-blue";

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <PhoneIcon className="h-4 w-4" />
        Log the call
      </h3>

      {/* Disposition picker */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {OUTCOMES.map((o) => {
          const active = picked === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => setPicked(active ? null : o.key)}
              className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                active
                  ? o.activeCls
                  : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
              }`}
            >
              <span className="mr-1">{o.emoji}</span>
              {o.label}
            </button>
          );
        })}
      </div>

      {/* Callback time + "did they answer?" — only for the callback outcome */}
      {def?.outcome === "callback" && (
        <div className="space-y-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/10 p-2.5">
          <label className="block">
            <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">
              Call back at — <b>ET</b>
            </span>
            <input
              type="datetime-local"
              value={callbackLocal}
              onChange={(e) => setCallbackLocal(e.target.value)}
              className={`${fieldCls} mt-1 tabular-nums`}
            />
          </label>
          <label className="flex items-center gap-2 text-[12px] text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={spoke}
              onChange={(e) => setSpoke(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600"
            />
            They answered and asked me to call back
            <span className="text-[10px] text-gray-400">(counts as contact)</span>
          </label>
        </div>
      )}

      {/* Not-interested is a park — say what it does */}
      {def?.kind === "park" && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50/60 dark:bg-rose-900/10 px-2.5 py-2 text-[12px] text-rose-700 dark:text-rose-300">
          Moves the deal to <b>Nurture</b> — it leaves the active board but the email
          sequence keeps the door open. Nothing is sent to the merchant now.
        </p>
      )}

      {/* Optional note */}
      <label className="block">
        <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">Note (optional)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="What was said…"
          className={`${fieldCls} mt-1 resize-y`}
        />
      </label>

      {error && <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
      {done && <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{done}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!def || busy}
          className={`rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50 ${
            armed ? "bg-emerald-600 hover:bg-emerald-700" : "bg-ocean-blue hover:bg-ocean-blue/90"
          }`}
        >
          {busy ? "Saving…" : armed ? "Tap again to log it" : def ? `Log "${def.label}"` : "Pick an outcome"}
        </button>
        {armed && !busy && (
          <button
            type="button"
            onClick={() => setArmed(false)}
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
