/**
 * REAL-TIME LEAD LOGIC — the one place that decides whether a live transfer was
 * caught, and how badly a real-time lead is being neglected.
 *
 * Why it lives here and not in a component: My Day (MyDayQueue) and the Hot Leads
 * panel in Setter Operations both have to answer "was this handoff taken?" and they
 * must never disagree. handoffState() used to be a private function inside
 * MyDayQueue; it now lives here and My Day imports it, so there is exactly one
 * definition to change.
 */

// ── Was the warm handoff actually taken? ──
// A live transfer means a human was mid-phone-call the moment this deal was born.
// Captured: a closer created the deal at hello via "Start the call" (created_by is
// set — the intake's own deals are service-role and carry NULL), OR a confirmed
// conversation landed inside the transfer window around creation. The window
// reaches BACKWARD too: when the vendor email runs 20-80 min late, the closer's
// call finishes before the intake's deal even exists, so contacted_at can predate
// created_at. No capture signal once the grace period passes = the merchant was
// on the line and nobody got them — the single worst miss on the board.
export const HANDOFF_WINDOW_MS = 15 * 60 * 1000;
export const HANDOFF_GRACE_MS = 10 * 60 * 1000;

/** The minimum a row must carry for handoffState() to grade it. Both QueueDeal and
 *  the Hot Leads panel's narrow row satisfy this structurally. */
export interface HandoffCandidate {
  lead_source: string | null;
  created_by?: string | null;
  contacted_at: string | null;
  created_at: string;
}

export function handoffState(
  d: HandoffCandidate,
  now: number,
): "captured" | "missed" | null {
  if (d.lead_source !== "live_transfer") return null;
  if (d.created_by) return "captured";
  if (d.contacted_at && Date.parse(d.contacted_at) <= Date.parse(d.created_at) + HANDOFF_WINDOW_MS) {
    return "captured";
  }
  // Too early to call it: the handoff may literally be happening right now.
  if (now - Date.parse(d.created_at) < HANDOFF_GRACE_MS) return null;
  return "missed";
}

// ── HOW HARD IS THIS LEAD BEING NEGLECTED? ───────────────────────────────────
//
// The owner's instruction for real-time leads is "call those immediately and
// repeatedly", so heat is NOT just age — a three-day-old lead that has been dialed
// five times is being worked, and a twenty-minute-old one nobody has touched is an
// emergency. Heat is therefore the GAP between the attempts a lead of this age
// should have collected and the attempts it actually has.
//
// The ladder below is the "repeatedly" part made explicit. It is deliberately
// coarse — it decides a colour, not a commission.
const MIN = 60_000;
const HOUR = 60 * MIN;

/** Attempts a real-time lead of this age should already have on it. */
export function expectedAttempts(ageMs: number): number {
  if (ageMs < 5 * MIN) return 0;
  if (ageMs < HOUR) return 1;
  if (ageMs < 4 * HOUR) return 2;
  if (ageMs < 24 * HOUR) return 3;
  if (ageMs < 72 * HOUR) return 5;
  return 6;
}

/**
 * blazing  — brand new and untouched. The live transfer is ON THE LINE / the
 *            real-time email clock is running. Nothing outranks this.
 * burning  — badly behind on attempts (3+ short of pace). Expensive lead rotting.
 * hot      — behind on attempts (1–2 short). Needs another dial today.
 * working  — on or ahead of pace, no conversation yet. Being worked; stay calm.
 * connected— a real conversation happened (spoke_at). Not a chase any more.
 * parked   — nurture/declined/dead/funded etc. Kept visible for honesty, never loud.
 */
export type HeatTier = "blazing" | "burning" | "hot" | "working" | "connected" | "parked";

/** Rank for sorting — lower is hotter. */
export const HEAT_RANK: Record<HeatTier, number> = {
  blazing: 0,
  burning: 1,
  hot: 2,
  working: 3,
  connected: 4,
  parked: 5,
};

export interface HeatInput {
  created_at: string;
  status: string | null;
  contact_attempts: number | null;
  spoke_at: string | null;
  /**
   * The TRUE dial count, from the realtime_lead_call_history RPC — the union of
   * WAVV, GHL/LeadConnector, activity_log call rows and manual touches.
   *
   * This exists because deals.contact_attempts is NOT the number of dials. It is
   * fed by the GHL telemetry path and the processor's log buttons, and misses
   * every WAVV call — and WAVV is the primary dialer. Scoring heat off it told a
   * setter "NEVER DIALED" about a merchant they had called the day before
   * (MF-2026-0337, measured 2026-09-16), which is the fastest way to teach a team
   * that the flames mean nothing.
   *
   * `undefined`/`null` means UNREADABLE, never zero — see attemptsKnown below.
   */
  true_attempts?: number | null;
  /**
   * Dials made at or AFTER this lead arrived (deals.created_at), from the same
   * RPC. This — not the lifetime count — is what pace is judged on.
   *
   * `deficit = expectedAttempts(ageMs) - attempts`, and ageMs is the lead's age
   * since arrival. The numerator has to cover the same interval as the
   * denominator. It didn't: `true_attempts` is the merchant's LIFETIME dial
   * count, so once the call window was widened to a deal's whole engagement
   * (20260916m), dials from a purchased-list campaign last month started being
   * subtracted from a pace expectation covering only the hours since a live
   * transfer arrived. Measured before the fix: MF-2026-0349 would have carried 5
   * attempts instead of 1. Against the 0/1/2/3/5/6 ladder that is enough to move
   * an untouched brand-new transfer from burning down to cool — a lead getting
   * buried because we once called the same merchant, which is the exact
   * complaint this panel was built to answer.
   *
   * The cut is made on the UNIFIED event stream (realtime_lead_call_history),
   * not inside deal_call_events' window — and that distinction is load-bearing.
   * The window scopes the WAVV branch only, because WAVV is phone-keyed and
   * needs attributing to a deal; ghl_call_log and activity_log rows are
   * deal-keyed and pass through unwindowed, so they routinely predate the deal.
   * Measured 2026-09-16: 91 deals carry deal-keyed call rows older than the deal
   * itself (110 GHL rows, worst 14), one of them in the live hot window. Cutting
   * inside the window would have looked right and fixed none of them.
   *
   * `undefined`/`null` means UNREADABLE, same as true_attempts.
   */
  attempts_since_arrival?: number | null;
  /** Terminal / parked statuses — pass the shared QUEUE_CLOSED_STATUSES set. */
}

export interface Heat {
  tier: HeatTier;
  /** How many attempts short of pace this lead is. Negative = ahead of pace.
   *  Measured on attempts SINCE ARRIVAL — see HeatInput.attempts_since_arrival. */
  deficit: number;
  /** LIFETIME dials on this merchant. What the row displays, and the only count
   *  "NEVER DIALED" may be judged on: if we have ever called them, they are not
   *  un-dialed. Never use this for pace. */
  attempts: number;
  /** Dials since this lead arrived. Drives pace, the blazing tier and the
   *  5-minute badge — every question of the form "is this being worked NOW". */
  attemptsSinceArrival: number;
  ageMs: number;
  /**
   * False when the real call history could not be read. `attempts` is then the
   * deals.contact_attempts FLOOR — a known undercount — so no surface may render
   * it as a fact and none may say "never dialed".
   */
  attemptsKnown: boolean;
}

export function leadHeat(
  d: HeatInput,
  now: number,
  isParked: (status: string | null) => boolean,
): Heat {
  const ageMs = Math.max(0, now - Date.parse(d.created_at));
  const attemptsKnown = d.true_attempts !== undefined && d.true_attempts !== null;
  const attempts = attemptsKnown ? (d.true_attempts as number) : (d.contact_attempts ?? 0);
  // Pace is judged on work done SINCE THIS LEAD ARRIVED. When the history is
  // unreadable both counts fall back to the same deals.contact_attempts floor —
  // a known undercount, which attemptsKnown already forces every surface to
  // treat as unproven rather than as zero.
  const attemptsSinceArrival =
    d.attempts_since_arrival !== undefined && d.attempts_since_arrival !== null
      ? d.attempts_since_arrival
      : attempts;
  const deficit = expectedAttempts(ageMs) - attemptsSinceArrival;
  const base = { deficit, attempts, attemptsSinceArrival, ageMs, attemptsKnown };

  if (isParked(d.status)) return { ...base, tier: "parked" };
  if (d.spoke_at) return { ...base, tier: "connected" };
  // The first hour with nobody having lifted a finger is the whole reason this
  // panel exists — it outranks the pace maths entirely. But "blazing" accuses a
  // named setter of doing nothing, so it may only fire on a count we can PROVE.
  // With an unreadable history the lead still lands on the pace ladder below; it
  // just doesn't scream UNTOUCHED at someone who may well have dialed.
  // Untouched SINCE IT ARRIVED — a transfer nobody has picked up in its first
  // hour is an emergency whether or not we happened to dial this merchant on a
  // list last month. Judging this on the lifetime count is how a brand-new lead
  // stops screaming.
  if (attemptsKnown && attemptsSinceArrival === 0 && ageMs < HOUR) return { ...base, tier: "blazing" };
  if (deficit >= 3) return { ...base, tier: "burning" };
  if (deficit >= 1) return { ...base, tier: "hot" };
  return { ...base, tier: "working" };
}
