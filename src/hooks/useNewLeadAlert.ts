import { useCallback, useEffect, useRef, useState } from "react";
import supabase from "../supabase";

// The two Synergy products that are TIME-CRITICAL the instant they land: a live
// transfer means the merchant is being handed to a closer on the phone RIGHT NOW;
// a real-time lead starts a 5-minute email clock. Everything else can wait for the
// My Day poll — these two get an unmissable in-app alert + chime.
const ALERT_SOURCES = new Set(["live_transfer", "realtime_appt"]);

export type AlertLeadSource = "live_transfer" | "realtime_appt";

// A bottom-right corner card. `new_lead` = a brand-new time-critical deal; the
// calmer `vendor_match` = a Synergy vendor email deduped into an EXISTING deal the
// closer is NOT currently working (the open-deal case gets the banner instead).
export interface CornerAlert {
  dealId: string;
  dealNumber: string | null;
  business: string;
  /** amount_requested off the deal row; null when the lead carries no ask yet. */
  ask: number | null;
  kind: "new_lead" | "vendor_match";
  /** Set only for new_lead — drives the red (live) vs mint (real-time) styling. */
  leadSource: AlertLeadSource | null;
  /** Date.now() when the event reached us. */
  at: number;
}

// The SPECIAL in-playbook banner: the vendor email for the deal the closer is
// working just landed and merged. Carries the mid-call essentials so a closer on
// the phone can see at a glance that they now have the merchant's full picture.
export interface MatchBanner {
  dealId: string;
  dealNumber: string | null;
  business: string;
  monthlyRevenue: number | null;
  ask: number | null;
  creditScore: string | null;
  bestTime: string | null;
  at: number;
}

// Columns we read off a deals INSERT payload.
interface DealInsertRow {
  id: string;
  lead_source: string | null;
  deal_number: string | null;
  amount_requested: number | null;
  customer_id: string | null;
}

// Columns we read off a synergy_intake_log INSERT payload.
interface IntakeLogRow {
  ghl_email_record_id: string | null;
  outcome: string | null;
  deal_id: string | null;
  received_at: string | null;
}

// ── Chimes, generated in code (no audio assets) ────────────────────────────────
// A fresh AudioContext per chime, closed once it finishes so we never leak
// contexts. Wrapped in try/catch: if the browser blocks audio the visual alert is
// still the real signal.
function playTones(tones: { freq: number; at: number; dur: number }[]) {
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const start = ctx.currentTime;
    let end = 0;
    for (const t of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = t.freq;
      const t0 = start + t.at;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.28, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + t.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + t.dur + 0.02);
      end = Math.max(end, t.at + t.dur);
    }
    setTimeout(() => ctx.close().catch(() => {}), (end + 0.2) * 1000);
  } catch {
    /* audio unavailable — the alert carries itself */
  }
}

// New lead: two rising beeps ("ding-ding").
const playNewLeadChime = () =>
  playTones([
    { freq: 660, at: 0, dur: 0.16 },
    { freq: 990, at: 0.18, dur: 0.16 },
  ]);

// Vendor email matched: ONE clean high ding — deliberately distinct from the
// two-beep new-lead chime so a closer hears the difference without looking.
const playMatchChime = () => playTones([{ freq: 1175, at: 0, dur: 0.32 }]);

// How long the special banner stays before it fades on its own.
const BANNER_TTL_MS = 30_000;

/**
 * Realtime alerts for the Revenue Playbook. Two streams, one hook:
 *
 *  1. New deals (INSERT on `deals`): a live-transfer / real-time lead becoming a
 *     deal fires a chime + a persistent bottom-right toast.
 *  2. Synergy vendor-email intake (INSERT on `synergy_intake_log`): when the
 *     vendor email dedupes into an EXISTING deal, we either
 *       · show the SPECIAL in-playbook banner + refresh the deal (if it's the deal
 *         the closer is currently working), or
 *       · drop a calmer corner toast (if it's some other deal).
 *
 * Realtime respects RLS, so staff only hear about rows they can already select.
 * Corner alerts persist until dismissed and stack up to 3 (oldest dropped). The
 * banner auto-fades after ~30s. `openDealId` + `onRefreshOpenDeal` let the caller
 * tell us which deal is on screen and how to reload it.
 */
export function useNewLeadAlert(opts?: {
  openDealId?: string | null;
  onRefreshOpenDeal?: (dealId: string) => void;
}): {
  alerts: CornerAlert[];
  dismiss: (dealId: string) => void;
  dismissAll: () => void;
  matchBanner: MatchBanner | null;
  dismissBanner: () => void;
  desktopEnabled: boolean;
  /** Request Notification permission — call ONLY from a click handler. */
  enableDesktop: () => void;
} {
  const [alerts, setAlerts] = useState<CornerAlert[]>([]);
  const [matchBanner, setMatchBanner] = useState<MatchBanner | null>(null);
  const [desktopEnabled, setDesktopEnabled] = useState<boolean>(
    () => typeof Notification !== "undefined" && Notification.permission === "granted",
  );

  // Deal ids we've already fired a NEW-LEAD alert for — dedupes across BOTH the
  // deals-INSERT stream and the intake-log 'created' stream (the same new deal can
  // surface on both). Ref so it survives re-renders without resubscribing.
  const newLeadSeenRef = useRef<Set<string>>(new Set());
  // Vendor-email events we've already handled, keyed by the email record id, so a
  // redelivered realtime event doesn't double-fire the banner/toast.
  const matchSeenRef = useRef<Set<string>>(new Set());

  // Read inside the (stable) subscription callback without forcing a resubscribe.
  const desktopRef = useRef(desktopEnabled);
  const openDealIdRef = useRef(opts?.openDealId ?? null);
  const onRefreshRef = useRef(opts?.onRefreshOpenDeal);
  useEffect(() => {
    desktopRef.current = desktopEnabled;
  }, [desktopEnabled]);
  useEffect(() => {
    openDealIdRef.current = opts?.openDealId ?? null;
  }, [opts?.openDealId]);
  useEffect(() => {
    onRefreshRef.current = opts?.onRefreshOpenDeal;
  }, [opts?.onRefreshOpenDeal]);

  const dismiss = useCallback((dealId: string) => {
    setAlerts((prev) => prev.filter((a) => a.dealId !== dealId));
  }, []);
  const dismissAll = useCallback(() => setAlerts([]), []);
  const dismissBanner = useCallback(() => setMatchBanner(null), []);

  const enableDesktop = useCallback(() => {
    if (typeof Notification === "undefined") return;
    Notification.requestPermission().then((p) => setDesktopEnabled(p === "granted"));
  }, []);

  // Auto-fade the special banner (unlike the corner toasts, which persist).
  useEffect(() => {
    if (!matchBanner) return;
    const t = setTimeout(() => setMatchBanner(null), BANNER_TTL_MS);
    return () => clearTimeout(t);
  }, [matchBanner]);

  useEffect(() => {
    const newLeadSeen = newLeadSeenRef.current;
    const matchSeen = matchSeenRef.current;

    // Fetch a merchant's display name (the insert payloads carry ids, not names).
    async function businessNameFor(customerId: string | null): Promise<string> {
      if (!customerId) return "New lead";
      const { data } = await supabase
        .from("customers")
        .select("business_name, first_name, last_name")
        .eq("id", customerId)
        .single();
      if (!data) return "New lead";
      const c = data as { business_name: string | null; first_name: string | null; last_name: string | null };
      return c.business_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || "New lead";
    }

    async function fireNewLead(row: DealInsertRow) {
      if (!row?.id || newLeadSeen.has(row.id)) return;
      if (!row.lead_source || !ALERT_SOURCES.has(row.lead_source)) return;
      newLeadSeen.add(row.id);

      const business = await businessNameFor(row.customer_id);
      const alert: CornerAlert = {
        dealId: row.id,
        dealNumber: row.deal_number,
        business,
        ask: row.amount_requested,
        kind: "new_lead",
        leadSource: row.lead_source as AlertLeadSource,
        at: Date.now(),
      };
      setAlerts((prev) => [alert, ...prev.filter((a) => a.dealId !== alert.dealId)].slice(0, 3));
      playNewLeadChime();

      if (desktopRef.current && typeof Notification !== "undefined" && Notification.permission === "granted") {
        const isLive = row.lead_source === "live_transfer";
        const askK = row.amount_requested && row.amount_requested > 0 ? ` — asking $${Math.round(row.amount_requested / 1000)}K` : "";
        new Notification(isLive ? "🔴 New live transfer" : "⏱ New real-time lead", { body: `${business}${askK}`, tag: row.id });
      }
    }

    // A Synergy vendor email deduped into an existing deal (outcome='deduped').
    async function fireVendorMatch(row: IntakeLogRow) {
      const dealId = row.deal_id;
      if (!dealId) return;
      const recId = row.ghl_email_record_id || `${dealId}:${row.received_at ?? ""}`;
      if (matchSeen.has(recId)) return;
      matchSeen.add(recId);

      // Pull the merged mid-call essentials in one query. getDealById's select
      // omits credit_score_range, so we ask for exactly the strip fields here.
      const { data } = await supabase
        .from("deals")
        .select(
          "id, deal_number, amount_requested, lead_qual, customer:customers!customer_id(business_name, first_name, last_name, monthly_revenue, credit_score_range)",
        )
        .eq("id", dealId)
        .single();
      if (!data) return;
      const d = data as {
        id: string;
        deal_number: string | null;
        amount_requested: number | null;
        lead_qual: Record<string, unknown> | null;
        customer:
          | { business_name: string | null; first_name: string | null; last_name: string | null; monthly_revenue: number | null; credit_score_range: string | null }
          | { business_name: string | null; first_name: string | null; last_name: string | null; monthly_revenue: number | null; credit_score_range: string | null }[]
          | null;
      };
      const cust = Array.isArray(d.customer) ? d.customer[0] : d.customer;
      const business = cust?.business_name || [cust?.first_name, cust?.last_name].filter(Boolean).join(" ") || "This merchant";
      const bestRaw = d.lead_qual && typeof d.lead_qual === "object" ? d.lead_qual["best_time"] : null;
      const bestTime = typeof bestRaw === "string" && bestRaw.trim() ? bestRaw.trim() : null;

      // THE SPECIAL CASE: this is the deal on screen right now. Banner + distinct
      // ding + reload the deal so the merged fields appear without a manual refresh.
      if (dealId === openDealIdRef.current) {
        setMatchBanner({
          dealId,
          dealNumber: d.deal_number,
          business,
          monthlyRevenue: cust?.monthly_revenue ?? null,
          ask: d.amount_requested,
          creditScore: cust?.credit_score_range ?? null,
          bestTime,
          at: Date.now(),
        });
        playMatchChime();
        onRefreshRef.current?.(dealId);
        return;
      }

      // Otherwise: a calmer corner toast that opens that deal on click.
      const alert: CornerAlert = {
        dealId,
        dealNumber: d.deal_number,
        business,
        ask: d.amount_requested,
        kind: "vendor_match",
        leadSource: null,
        at: Date.now(),
      };
      setAlerts((prev) => [alert, ...prev.filter((a) => a.dealId !== alert.dealId)].slice(0, 3));
      playMatchChime();
    }

    const channel = supabase
      .channel("playbook-lead-alerts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "deals" }, (payload) => {
        void fireNewLead(payload.new as DealInsertRow);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "synergy_intake_log" }, (payload) => {
        const row = payload.new as IntakeLogRow;
        // 'created' means a brand-new deal — the deals-INSERT stream is the canonical
        // trigger for that; mark it seen so the two streams can't double-fire one
        // new-lead toast, whichever arrives first. 'deduped' is the vendor-match case.
        if (row.outcome === "created" && row.deal_id) {
          newLeadSeen.add(row.deal_id);
        } else if (row.outcome === "deduped") {
          void fireVendorMatch(row);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { alerts, dismiss, dismissAll, matchBanner, dismissBanner, desktopEnabled, enableDesktop };
}
