// _shared/bestTime.ts — the merchant's stated "best time to reach you", parsed
// conservatively into an Eastern wall-clock time, plus the ONE rule for turning
// that wall time into a concrete deals.callback_at instant.
//
// ── KEEP IN SYNC ─────────────────────────────────────────────────────────────
// parseStatedTimeET + ZONE_HOURS_FROM_ET are a byte-for-byte logic mirror of
// src/utils/time.ts (parseStated / parseStatedTimeET / statedTimeInET). The UI
// parser is the LAW: it refuses anything it can't read with confidence ("4",
// "2pm" with no zone, "Morning"), because a wrong conversion sends a closer to
// the phone at confidently the wrong hour. Any change to the zone table or the
// rules MUST land in BOTH files, or the intake will schedule calls the My Day
// card can't explain (and vice versa).
//
// etOffsetMs / etWallClockToUtcIso mirror the same-named helpers in
// src/utils/time.ts. Pure TS, no Deno APIs — importable by Node tooling too.
// ─────────────────────────────────────────────────────────────────────────────

const APP_TZ = "America/New_York";

// Offsets from Eastern, in hours. Both the standard and daylight spellings are
// accepted because merchants use them interchangeably and almost always mean
// their wall clock.
const ZONE_HOURS_FROM_ET: Record<string, number> = {
  et: 0, est: 0, edt: 0, eastern: 0,
  ct: -1, cst: -1, cdt: -1, central: -1,
  mt: -2, mst: -2, mdt: -2, mountain: -2,
  pt: -3, pst: -3, pdt: -3, pacific: -3,
  akst: -4, akdt: -4,
  hst: -5,
};

/**
 * "4:00PM CST" → { hour: 17, minute: 0 } — the merchant's stated best time as an
 * EASTERN wall-clock time, or null when it can't be parsed with confidence.
 *
 * CONSERVATIVE ON PURPOSE: requires an unambiguous time AND a recognized US
 * zone. Refuses bare hours with no am/pm ("call me at 4"), zone-less times
 * ("2pm"), and words ("Morning"). Unparseable → the caller does NOTHING and the
 * raw text stays in front of a human. A wrong auto-scheduled callback is far
 * worse than no auto-scheduled callback.
 */
export function parseStatedTimeET(
  raw: string | null | undefined,
): { hour: number; minute: number } | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();

  // time: "4", "4:00", "4:00pm", "10am"
  const m = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (!m) return null;

  // zone: any of the spellings above, anywhere in the string
  const z = s.match(/\b(et|est|edt|eastern|ct|cst|cdt|central|mt|mst|mdt|mountain|pt|pst|pdt|pacific|akst|akdt|hst)\b/);
  if (!z) return null;

  const shift = ZONE_HOURS_FROM_ET[z[1]];
  if (shift === undefined) return null;

  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  const ampm = m[3];
  if (hour < 1 || hour > 23 || minute > 59) return null;
  // Bare hours with no am/pm are genuinely ambiguous ("call me at 4"). Don't guess.
  if (!ampm && hour <= 12) return null;
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  // Their wall clock → Eastern wall clock.
  let etHour = (hour - shift) % 24;
  if (etHour < 0) etHour += 24;
  return { hour: etHour, minute };
}

/** How far Eastern's wall clock is from UTC at the given instant, in ms
 * (negative: ET is behind UTC — -4h in summer, -5h in winter). */
function etOffsetMs(atUtcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TZ, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(atUtcMs))) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - atUtcMs;
}

/** A wall-clock date+time IN EASTERN → the UTC instant, as ISO. Month is 1-based.
 * Out-of-range parts (day 32, hour 24) roll over the same way Date.UTC does. */
export function etWallClockToUtcIso(
  year: number, month: number, day: number, hour: number, minute = 0,
): string {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  // Guess the offset at the naive instant, then refine once — the second pass
  // catches a wall time that lands on the far side of a DST switch.
  let ts = naive - etOffsetMs(naive);
  ts = naive - etOffsetMs(ts);
  return new Date(ts).toISOString();
}

/** Don't schedule a callback that is already (nearly) upon us: if the stated ET
 * wall time is less than this far ahead RIGHT NOW, it means tomorrow. 30 min —
 * enough that "call me at 4pm" arriving at 3:50pm doesn't book an instantly-due
 * callback that steamrolls the fresh lead's first-touch flow. */
export const CALLBACK_MIN_LEAD_MS = 30 * 60 * 1000;

/**
 * THE SCHEDULING RULE, written down once:
 *
 *   The next occurrence of an ET wall-clock time is TODAY (Eastern's today, not
 *   the server's) if that instant is still ≥ CALLBACK_MIN_LEAD_MS (30 min) in
 *   the future — otherwise TOMORROW at the same ET wall time.
 *
 * DST-safe: day+1 rolls through etWallClockToUtcIso, which resolves the offset
 * for the actual target day.
 */
export function nextEtOccurrenceIso(hour: number, minute: number, nowMs = Date.now()): string {
  // Today's date on the EASTERN calendar (en-CA locale = ISO field order).
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(nowMs))) p[part.type] = part.value;
  const today = etWallClockToUtcIso(+p.year, +p.month, +p.day, hour, minute);
  if (Date.parse(today) - nowMs >= CALLBACK_MIN_LEAD_MS) return today;
  return etWallClockToUtcIso(+p.year, +p.month, +p.day + 1, hour, minute);
}
