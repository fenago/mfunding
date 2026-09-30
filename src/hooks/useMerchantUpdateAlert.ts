import { useCallback, useEffect, useRef, useState } from "react";
import supabase from "../supabase";
import { playUpdateChime } from "../lib/chime";
import type { CornerAlert, MerchantUpdateKind } from "../lib/cornerAlert";

// useMerchantUpdateAlert — the corner card that fires when SOMETHING CHANGES ON
// A MERCHANT'S FILE.
//
// ── WHY IT EXISTS ───────────────────────────────────────────────────────────
// 2026-09-30, owner: "whenever there is anything that changes or updates in the
// merchants file, can we get a pop-up to show for anybody that has the processor
// role? Bankers LLC sent in a change, and our processor just completely missed
// it."
//
// Bankers LLC / MF-2026-0425, that morning: at 16:54 the merchant wrote in to
// correct his corporate name, his email and his phone — after we had already
// emailed him an application addressed to a mistyped version of the name he was
// correcting. Nobody saw it. The deal is still called "Bankers LLC".
//
// ⚠️ THE DATA WAS ALREADY RIGHT. `deals.merchant_reply_at` was stamped 17:07 and
// `merchant_reply_summary` held the correct summary. Every write path worked.
// The only thing missing was a surface. This hook is that surface's live half;
// the durable half is the Updates tab on /admin/processor, and the two read the
// same table.
//
// ── THE TOAST IS NOT THE GUARANTEE ──────────────────────────────────────────
// The whole failure mode is nobody being on the page at 12:54. A toast is for
// the processor who IS looking; the table + badge + Updates tab are for the one
// who is not. If this hook never fires — tab closed, browser asleep, realtime
// dropped — the change is still waiting when she comes back, and the badge still
// counts it. Nothing here is load-bearing for the guarantee, which is exactly
// how it should be.
//
// ── WHAT COUNTS AS A CHANGE ─────────────────────────────────────────────────
// This hook does NOT decide. It subscribes to INSERTs on
// `public.processor_notifications`, which only the triggers in
// 20260930g_processor_sees_what_changed.sql write. The in/out list and the
// 45-day volumes behind each decision live in that migration's header — one
// definition, in SQL, because a TypeScript mirror of a rule like this drifts.
//
// Briefly, so a reader here is not left guessing: a merchant replying, a
// merchant signing, documents landing, a funder replying/offering/declining.
// NOT the GHL stage mirror (716 rows in 45 days — it would be ~90% of the
// feed), not our own dialling, not our own outbound email, and never
// `deals.updated_at` (the nightly scorer rewrites every row).
//
// ── DEDUPE HAPPENS IN THE DATABASE, NOT HERE ────────────────────────────────
// Bankers produced TWO `merchant:signed` rows for the same document 84 seconds
// apart, and one merchant landed ELEVEN `customer_documents` rows in 35 seconds.
// Both collapse before they ever become a row in this table (unique
// `dedupe_key`; documents roll up per deal per 10-minute bucket with an
// incrementing `event_count`). So one INSERT here really is one event, and this
// hook can stay simple.
//
// The only dedupe left to do client-side is REDELIVERY — the same INSERT
// arriving twice on a reconnect — which `seen` handles, keyed on the
// notification id and persisted so an F5 does not resurrect a dismissed card.

/** How recent the EVENT must be for a card. Anything older is history: the
 *  Updates tab lists it, the badge counts it, but nothing chimes. */
const FRESH_MS = 6 * 60 * 60 * 1000;

/** Fired ids are pruned after this. Long enough that nothing re-announces,
 *  short enough that the entry never grows without bound. */
const SEEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const SEEN_KEY = "mf.merchantUpdateAlerts.v1";

/** The columns we read off a processor_notifications INSERT payload. */
interface NotificationRow {
  id: string | null;
  deal_id: string | null;
  kind: string | null;
  event_at: string | null;
}

/** public.processor_notification_card() — the server's resolved card. */
interface CardRow {
  id: string;
  kind: MerchantUpdateKind;
  deal_id: string;
  deal_number: string | null;
  business_name: string | null;
  title: string;
  detail: string | null;
  event_count: number | null;
  event_at: string;
  is_read: boolean | null;
}

/** Fired-id bookkeeping. Blocked or full localStorage must never break the
 *  alert — worst case we lose the dedupe for this tab, not the signal. */
function loadSeen(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    const cutoff = Date.now() - SEEN_TTL_MS;
    const kept: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && v > cutoff) kept[k] = v;
    }
    return kept;
  } catch {
    return {};
  }
}

function saveSeen(seen: Record<string, number>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* storage unavailable — dedupe degrades to this tab's memory */
  }
}

/** Fired when a card is raised, so the sidebar badge and the Updates tab can
 *  recount without either surface having to know about the other. */
export const MERCHANT_UPDATE_EVENT = "mf:merchant-update";

export function useMerchantUpdateAlert(opts?: {
  /**
   * Only subscribe for someone who can actually receive these. A setter's
   * browser should not hold a channel whose rows RLS will never hand it.
   * Fail-closed: default false, flipped on once the capability read succeeds.
   */
  enabled?: boolean;
  /** Mirror of the lead stream's desktop-notification permission state. */
  desktopEnabled?: boolean;
}): {
  alerts: CornerAlert[];
  dismiss: (key: string) => void;
} {
  const enabled = opts?.enabled ?? false;
  const [alerts, setAlerts] = useState<CornerAlert[]>([]);
  const seenRef = useRef<Record<string, number>>({});
  const desktopRef = useRef(!!opts?.desktopEnabled);

  useEffect(() => {
    desktopRef.current = !!opts?.desktopEnabled;
  }, [opts?.desktopEnabled]);

  const dismiss = useCallback((key: string) => {
    setAlerts((prev) => prev.filter((a) => a.key !== key));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    seenRef.current = loadSeen();

    async function fire(row: NotificationRow) {
      const id = row.id;
      if (!id) return;
      if (seenRef.current[id]) return;

      // FRESHNESS, before any round trip. The seed in 20260930h wrote three days
      // of real history in one transaction; if this hook had been mounted it
      // must not have chimed twenty-four times. Same guard protects any future
      // backfill.
      const eventMs = row.event_at ? Date.parse(row.event_at) : NaN;
      if (!Number.isFinite(eventMs) || Date.now() - eventMs > FRESH_MS) return;

      // Ask the DATABASE who this merchant is and whether this viewer may see
      // it. A null answer means one of: not a processor, or the deal has left
      // the open stages. Both are silence.
      const { data, error } = await supabase.rpc("processor_notification_card", { p_id: id });
      if (error) {
        // Unreadable. Do NOT mark it seen — the badge is the durable surface and
        // a redelivery gets another chance.
        console.warn("[merchant-update-alert] resolve failed:", error.message);
        return;
      }
      const r = data as CardRow | null;
      // Mark seen ONLY when a card actually fires. A null answer is not a
      // verdict for all time: a deal can re-enter an open stage, and a
      // capability read can have been mid-flight.
      if (!r) return;
      // Already read elsewhere (this processor's own upload auto-marks read).
      if (r.is_read) {
        seenRef.current[id] = Date.now();
        saveSeen(seenRef.current);
        return;
      }
      seenRef.current[id] = Date.now();
      saveSeen(seenRef.current);

      const business = r.business_name || "This merchant";
      const alert: CornerAlert = {
        key: `upd:${r.id}`,
        dealId: r.deal_id,
        dealNumber: r.deal_number,
        business,
        ask: null,
        kind: "merchant_update",
        leadSource: null,
        update: {
          notificationId: r.id,
          updateKind: r.kind,
          title: r.title,
          detail: r.detail,
          eventCount: r.event_count ?? 1,
          eventAt: r.event_at,
        },
        at: Date.now(),
      };
      setAlerts((prev) => [alert, ...prev.filter((a) => a.key !== alert.key)].slice(0, 3));
      playUpdateChime();
      window.dispatchEvent(new CustomEvent(MERCHANT_UPDATE_EVENT));

      if (desktopRef.current && typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(`📝 ${r.title}`, {
          body: `${business}${r.detail ? ` — ${r.detail}` : ""}`,
          tag: `upd:${r.id}`,
        });
      }
    }

    // INSERT ONLY. An UPDATE on this table is a document burst rolling up
    // inside its 10-minute bucket — the same arrival, counted — and re-carding
    // it would rebuild the eleven-cards problem the roll-up exists to prevent.
    const channel = supabase
      .channel("merchant-update-alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "processor_notifications" },
        (payload) => {
          void fire(payload.new as NotificationRow);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled]);

  return { alerts, dismiss };
}

export default useMerchantUpdateAlert;
