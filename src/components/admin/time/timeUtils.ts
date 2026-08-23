// Local-date + display helpers for the Time & Pay tab.
//
// work_date / period_start / period_end are plain YYYY-MM-DD strings. Never
// parse them with `new Date(iso)` — that reads as UTC midnight and renders as
// the PREVIOUS day for anyone west of UTC.
//
// These helpers FORMAT and shift date strings only. What "today" is, and where a
// pay week starts, are decided in Eastern by todayISO()/weekBounds() in
// @/services/timeTracking — never re-derived here from the browser clock.

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

/**
 * A date string as a Date safe to hand to weekBounds(). Noon UTC lands on the
 * same calendar day in Eastern; UTC midnight would resolve to the day BEFORE
 * and silently shift the whole week.
 */
export function atNoonUTC(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
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

/** Always "$" — the currency code is appended only when it isn't USD. */
export function fmtMoney(amount: number | null | undefined, currency?: string | null): string {
  const n = Number(amount) || 0;
  const s = `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const cur = (currency || "USD").toUpperCase();
  return cur === "USD" ? s : `${s} ${cur}`;
}
