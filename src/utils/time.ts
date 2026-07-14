/**
 * THE WHOLE APP RUNS ON EASTERN TIME. All of it. Always.
 *
 * Why this is forced rather than left to the browser:
 *
 * Momentum operates on Eastern. Funder cut-offs, the daily submission rhythm, "call
 * them at 4pm" — every operational time in this business is an Eastern time. But a
 * date rendered with the browser's default timezone shows whatever timezone the
 * LAPTOP happens to be in. A closer working from Phoenix would see a callback
 * scheduled for "1:00 PM", dial at 1:00 PM Arizona time, and be three hours late to a
 * call the merchant agreed to. Nothing in the UI would look wrong. That is the worst
 * kind of bug: silent, plausible, and it loses the deal.
 *
 * There were 213 date renders across 97 files. Converting them one by one guarantees
 * the 214th is written wrong, so instead the DEFAULT is changed once, here:
 * `Date.prototype.toLocale*` and `Intl.DateTimeFormat` are patched to fall back to
 * America/New_York when no timezone is given. Anything that explicitly passes a
 * timeZone still wins — the patch only supplies a default, it never overrides.
 *
 * America/New_York (not a fixed -05:00) so daylight saving is handled: the zone label
 * correctly reads EDT in summer and EST in winter. Hardcoding "EST" year-round would
 * be wrong for eight months of the year and would drift an hour off every real clock
 * in the office.
 */

export const APP_TZ = "America/New_York";

/**
 * Make America/New_York the default timezone for every date the app renders.
 * Call ONCE, at startup, before anything renders.
 */
export function installEasternTime(): void {
  const withTz = (o?: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions => ({
    timeZone: APP_TZ,
    ...(o ?? {}), // an explicit timeZone from the caller still wins
  });

  const dateProto = Date.prototype;
  const origString = dateProto.toLocaleString;
  const origDate = dateProto.toLocaleDateString;
  const origTime = dateProto.toLocaleTimeString;

  dateProto.toLocaleString = function (locale?: never, options?: Intl.DateTimeFormatOptions) {
    return origString.call(this, locale, withTz(options));
  };
  dateProto.toLocaleDateString = function (locale?: never, options?: Intl.DateTimeFormatOptions) {
    return origDate.call(this, locale, withTz(options));
  };
  dateProto.toLocaleTimeString = function (locale?: never, options?: Intl.DateTimeFormatOptions) {
    return origTime.call(this, locale, withTz(options));
  };

  const OrigDTF = Intl.DateTimeFormat;
  function Patched(locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
    return new OrigDTF(locales, withTz(options));
  }
  // Carry the statics + prototype across so `instanceof` and supportedLocalesOf still
  // behave. Object.defineProperty because `prototype` on a function is read-only.
  Object.defineProperty(Patched, "prototype", { value: OrigDTF.prototype, writable: false });
  (Patched as unknown as { supportedLocalesOf: unknown }).supportedLocalesOf =
    OrigDTF.supportedLocalesOf;
  Intl.DateTimeFormat = Patched as unknown as typeof Intl.DateTimeFormat;
}

/** "3:05 PM ET" — a time, in Eastern, labelled so nobody has to wonder. */
export function timeET(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: APP_TZ })} ET`;
}

/** "Jul 13, 3:05 PM ET" */
export function dateTimeET(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  const s = d.toLocaleString([], {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: APP_TZ,
  });
  return `${s} ET`;
}

/** The EASTERN calendar day an instant falls on, as "YYYY-MM-DD". This is what
 * decides which day-cell a timestamp lands in — a 11:30 PM ET callback is that
 * day even though it's already tomorrow in UTC. (en-CA locale = ISO ordering.) */
export function dateKeyET(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

// ── ENTERING a time as Eastern (the write-side twin of the render patch) ──────
//
// installEasternTime() fixes every RENDER, but `new Date("2026-07-14T16:00")` still
// parses in the BROWSER's timezone — so a closer in Phoenix typing 4:00 PM into a
// datetime-local field used to book the callback at 4:00 PM *Arizona* time, three
// hours after the merchant expected the call. Same silent, plausible, deal-losing
// bug the render patch killed, one layer up. These helpers interpret a wall-clock
// time AS Eastern and return the true UTC instant for storage.

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

/** A `<input type="datetime-local">` value ("2026-07-14T16:00"), interpreted as
 * EASTERN wall time → UTC ISO. Null when the string isn't a datetime-local. */
export function etDateTimeLocalToUtcIso(local: string): string | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return etWallClockToUtcIso(+m[1], +m[2], +m[3], +m[4], +m[5]);
}

/** Tomorrow at H:MM **Eastern** → UTC ISO. "Tomorrow" is Eastern's tomorrow, not
 * the browser's — a Phoenix closer at 10:30 PM MST is already past midnight ET. */
export function tomorrowAtEtIso(hour: number, minute = 0): string {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date())) p[part.type] = part.value;
  return etWallClockToUtcIso(+p.year, +p.month, +p.day + 1, hour, minute);
}

// ── The merchant's own stated call time ───────────────────────────────────────
//
// Synergy asks "What is the best time to reach you?" and the merchant answers in free
// text, in THEIR timezone: "4:00PM CST", "10am PST", "1:00 Pm EST". A closer on Eastern
// reading "4:00PM CST" has to do the conversion in their head, mid-call, and will get it
// wrong often enough to matter.
//
// So we translate it — CONSERVATIVELY. If the string doesn't parse cleanly into a time
// plus a US zone we recognise, we return null and the raw text is shown untouched. A
// wrong conversion is far worse than no conversion: it would send a closer to the phone
// at confidently the wrong hour.

// Offsets from Eastern, in hours. Both the standard and daylight spellings are accepted
// because merchants use them interchangeably and almost always mean their wall clock.
const ZONE_HOURS_FROM_ET: Record<string, number> = {
  et: 0, est: 0, edt: 0, eastern: 0,
  ct: -1, cst: -1, cdt: -1, central: -1,
  mt: -2, mst: -2, mdt: -2, mountain: -2,
  pt: -3, pst: -3, pdt: -3, pacific: -3,
  akst: -4, akdt: -4,
  hst: -5,
};

// ── KEEP IN SYNC ─────────────────────────────────────────────────────────────
// The parse below (ZONE_HOURS_FROM_ET + parseStatedTimeET) has a Deno twin in
// supabase/functions/_shared/bestTime.ts, used by live-transfer-intake to
// auto-schedule deals.callback_at from the merchant's stated best time. Any
// change to the zone table or the parsing rules MUST be mirrored there, or the
// intake will schedule calls the UI can't explain (and vice versa).
// ─────────────────────────────────────────────────────────────────────────────

/** The machine-readable core of statedTimeInET. shift = hours the stated zone
 * sits behind Eastern (0 when they spoke in ET); nextDay = the ET wall time
 * rolled past midnight relative to their stated day ("11pm PST" = 2 AM ET). */
interface StatedTime { etHour: number; etMinute: number; shift: number; nextDay: boolean }

function parseStated(raw: string | null | undefined): StatedTime | null {
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
  return { etHour, etMinute: minute, shift, nextDay: hour - shift >= 24 };
}

/**
 * "4:00PM CST" → { hour: 17, minute: 0 } — the merchant's stated best time as an
 * EASTERN wall-clock time, or null when it can't be parsed with confidence.
 * Same conservative rules as statedTimeInET (this IS its machine twin), except
 * an ET-stated time is returned rather than refused: "4:03 PM EST" is a
 * perfectly schedulable {16, 3} even though there's nothing to *convert*.
 */
export function parseStatedTimeET(
  raw: string | null | undefined,
): { hour: number; minute: number } | null {
  const p = parseStated(raw);
  return p ? { hour: p.etHour, minute: p.etMinute } : null;
}

/**
 * "4:00PM CST" → "5:00 PM ET". Returns null when it can't be parsed with confidence,
 * or when the merchant already spoke in Eastern (nothing to convert).
 */
export function statedTimeInET(raw: string | null | undefined): string | null {
  const p = parseStated(raw);
  if (!p) return null;
  if (p.shift === 0) return null; // already Eastern — nothing useful to add

  const h12 = p.etHour % 12 === 0 ? 12 : p.etHour % 12;
  const suffix = p.etHour < 12 ? "AM" : "PM";
  const dayNote = p.nextDay ? " next day" : "";
  return `${h12}:${String(p.etMinute).padStart(2, "0")} ${suffix} ET${dayNote}`;
}
