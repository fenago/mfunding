// callHistory — the TRUE dial history for a set of deals, and the types every
// surface that renders "how many times have we called them" shares.
//
// WHY IT IS NOT deals.contact_attempts (20260916a, and re-learned the hard way):
// that column is fed by the GHL telemetry path and the processor's log buttons
// and misses EVERY WAVV dial — and WAVV is the primary dialer. On 2026-09-16 a
// panel scoring off it told the team that The Goldberg Group (MF-2026-0337) had
// NEVER BEEN DIALED when Kristine Gidoc had called them the previous afternoon.
// A false accusation is worse than no alarm: it teaches the team that the alarms
// are noise, and then the genuinely untouched lead gets ignored with the rest.
//
// realtime_lead_call_history(uuid[]) unions WAVV, GHL/LeadConnector, activity_log
// call rows and manual touches, dedupes across sources, re-derives visibility
// itself rather than trusting the ids it is handed, and returns the individual
// calls.
//
// EXTRACTED from HotLeadsPanel (2026-09-17) so the processor's application-chase
// queue reads the same history through the same code. A second copy would be a
// second thing to keep correct and the first one to drift.

import supabase from "@/supabase";

/** One real dial, from whichever system recorded it. */
export interface CallEvent {
  at: string;
  /** wavv | ghl | activity | manual — which system recorded the dial. */
  source: string;
  disposition: string | null;
  seconds: number | null;
  /** The person who dialed, where the source could name them. */
  who: string | null;
}

export interface CallHistory {
  /** The TRUE total, LIFETIME. Always the full count, even when `calls` is
   *  capped. This is what a row displays and the only count "NEVER DIALED" may
   *  be judged on — if we have ever called them, they are not un-dialed. */
  attempts: number;
  /** Dials at or after this lead arrived (deals.created_at). Everything that
   *  asks "is this being worked NOW" — pace, the 5-minute badge — reads this,
   *  so a prior campaign's dials cannot make a fresh lead look attended to. */
  attempts_since_arrival: number;
  last_at: string | null;
  last_disposition: string | null;
  last_by: string | null;
  last_source: string | null;
  calls: CallEvent[];
}

/** The keys every payload MUST carry. A payload missing one is UNREADABLE — see
 *  assertShape(). Listed rather than derived because a TypeScript interface is
 *  erased at runtime and cannot check anything. */
const REQUIRED_KEYS = [
  "attempts",
  "attempts_since_arrival",
  "last_at",
  "last_disposition",
  "last_by",
  "last_source",
  "calls",
] as const;

/** Keyed by deal id. A deal ABSENT from the map is UNREADABLE, never zero. */
export type HistoryState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; byDeal: Record<string, CallHistory> };

/** Human label for where a dial was recorded, so "who called" is never a mystery. */
export const CALL_SOURCE_WORD: Record<string, string> = {
  wavv: "WAVV",
  ghl: "VibeReach",
  activity: "logged",
  manual: "logged by hand",
};

/**
 * Read the true call history for these deals in one round trip.
 *
 * Returns a HistoryState rather than throwing, because the caller's ONLY correct
 * response to a failure is to render "unreadable" — not an empty history, and
 * never a zero.
 */
export async function loadCallHistory(dealIds: string[]): Promise<HistoryState> {
  if (dealIds.length === 0) return { kind: "ready", byDeal: {} };
  const { data, error } = await supabase.rpc("realtime_lead_call_history", {
    p_deal_ids: dealIds,
  });
  if (error) return { kind: "error", message: error.message };
  return assertShape(data);
}

/**
 * A FIELD THE RPC STOPPED RETURNING MUST READ AS UNREADABLE, NOT AS ZERO.
 *
 * 2026-09-18: a migration added disposition_source to realtime_lead_call_history
 * by rewriting the function from an older migration file, and silently dropped
 * `attempts_since_arrival` in the process. Nothing failed. The interface above
 * still declared the field REQUIRED, TypeScript is erased at runtime, and so
 * every reader quietly got `undefined`:
 *
 *   · HotLeadsPanel's 5-minute badge is gated on `=== 0`. `undefined === 0` is
 *     false, so from that day the badge could not appear AT ALL.
 *   · leadHeat() falls back to the LIFETIME count when the field is absent, so
 *     the pace deficit and the blazing tier went back to judging a brand-new
 *     transfer on dials we made to that merchant months ago — the exact
 *     regression the field was added to fix.
 *
 * Eleven days, no error, no test, nothing to see. A silent undercount that
 * looked like a working panel is worse than a broken one, so the shape is now
 * checked where it arrives. A payload missing a key is an UNREADABLE history —
 * every caller already renders that honestly (no counts, no NEVER DIALED, no
 * accusations) instead of inventing a zero.
 */
function assertShape(data: unknown): HistoryState {
  const byDeal = (data ?? {}) as Record<string, CallHistory>;
  for (const [dealId, h] of Object.entries(byDeal)) {
    if (!h || typeof h !== "object") {
      return { kind: "error", message: `call history for ${dealId} was not an object` };
    }
    const missing = REQUIRED_KEYS.filter((k) => !(k in h));
    if (missing.length > 0) {
      return {
        kind: "error",
        message:
          `realtime_lead_call_history did not return ${missing.join(", ")} — ` +
          `the RPC's shape no longer matches CallHistory, so the counts cannot be trusted`,
      };
    }
  }
  return { kind: "ready", byDeal };
}
