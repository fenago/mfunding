// Local-date + display helpers for the Time & Pay tab.
//
// work_date / period_start / period_end are plain YYYY-MM-DD strings. Never
// parse them with `new Date(iso)` — that reads as UTC midnight and renders as
// the PREVIOUS day for anyone west of UTC.
//
// These helpers FORMAT and shift date strings only. What "today" is, and where a
// pay week starts, are decided in Eastern by todayISO()/weekBounds() in
// @/services/timeTracking — never re-derived here from the browser clock.
//
// Clock in/out are stored as timestamptz. Both directions of that conversion
// (a "HH:mm" the worker typed -> a UTC instant, and back) go through the
// Eastern helpers in @/utils/time. A setter in Manila typing "9:00" means 9 AM
// on the COMPANY's clock; `new Date("2026-08-23T09:00")` would silently record
// it as 9 AM Manila — a 12-hour lie in the payroll table.

import { APP_TZ, etWallClockToUtcIso } from "@/utils/time";

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local noon, not midnight — so an added day can't land on a skipped DST hour. */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1, 12);
}

export function addDays(iso: string, n: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** "Mon" */
export function fmtWeekday(iso: string): string {
  return parseISODate(iso).toLocaleDateString(undefined, { weekday: "short" });
}

/** "18" */
export function fmtDayNum(iso: string): string {
  return String(parseISODate(iso).getDate());
}

/** "Aug 18, 2026" */
export function fmtDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "Aug 18 – Aug 24, 2026" */
export function fmtRange(startISO: string, endISO: string): string {
  const s = parseISODate(startISO);
  const e = parseISODate(endISO);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const left = s.toLocaleDateString(undefined, opts);
  const right = e.toLocaleDateString(undefined, opts);
  const year = e.getFullYear();
  return `${left} – ${right}, ${year}`;
}

/** "Aug 20, 2026" from a full timestamp (paid_at) — not a plain date string. */
export function fmtStampDate(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** "9:14 PM" — for the checked_in_at confirmation. */
export function fmtTimeOfDay(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** 8 → "8", 7.5 → "7.5", 7.25 → "7.25" */
export function fmtHours(n: number | null | undefined): string {
  const v = Number(n) || 0;
  return String(Number(v.toFixed(2)));
}

// ---------------------------------------------------------------------------
// Shift times (clock in / clock out)
// ---------------------------------------------------------------------------

/** "09:00" -> minutes since midnight, or null if it isn't a wall-clock time. */
export function parseTimeInput(value: string): number | null {
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** A stored timestamp -> the "HH:mm" a time input needs, read in EASTERN. */
export function etTimeInputValue(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const h = get("hour");
  const min = get("minute");
  if (!h || !min) return "";
  // hourCycle h23 can still surface "24" for midnight in some engines.
  return `${String(Number(h) % 24).padStart(2, "0")}:${min}`;
}

/**
 * A work date (yyyy-mm-dd) + a "HH:mm" the worker typed -> the UTC instant,
 * interpreting the time AS EASTERN. Null when either piece is malformed, so a
 * bad value is never stored as a plausible-looking wrong one.
 */
export function etStampFor(workDate: string, timeValue: string): string | null {
  const dm = workDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const minutes = parseTimeInput(timeValue);
  if (!dm || minutes === null) return null;
  return etWallClockToUtcIso(+dm[1], +dm[2], +dm[3], Math.floor(minutes / 60), minutes % 60);
}

/** "9:00 AM" — a stored shift timestamp, in Eastern. */
export function fmtClock(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: APP_TZ,
  });
}

/** "9:00a–5:30p" — the compact form for a day cell. Empty when not clocked. */
export function fmtClockRange(
  clockIn: string | null | undefined,
  clockOut: string | null | undefined,
): string {
  const a = fmtClock(clockIn);
  const b = fmtClock(clockOut);
  if (!a || !b) return "";
  const tiny = (s: string) => s.replace(/\s?AM$/i, "a").replace(/\s?PM$/i, "p");
  return `${tiny(a)}–${tiny(b)}`;
}

/** Always "$" — the currency code is appended only when it isn't USD. */
export function fmtMoney(amount: number | null | undefined, currency?: string | null): string {
  const n = Number(amount) || 0;
  const s = `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const cur = (currency || "USD").toUpperCase();
  return cur === "USD" ? s : `${s} ${cur}`;
}
