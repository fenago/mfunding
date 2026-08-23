/**
 * Display helpers for the Time & Pay screen. The row types live in
 * `@/services/timeTracking` — this file is formatting only.
 *
 * ── A note on dates, because this screen is full of the dangerous kind ──
 *
 * work_date / period_start / period_end are BARE CALENDAR DATES ("2026-08-17"),
 * not instants. installEasternTime() makes every unqualified render Eastern, so
 * a calendar date parsed to UTC midnight and rendered by default would come out
 * as the PREVIOUS day (UTC midnight is 8 PM ET the day before) — an off-by-one
 * on a payroll screen, where it would move an entry into the wrong pay week.
 *
 * So calendar dates are parsed as UTC and rendered with an EXPLICIT
 * `timeZone: "UTC"`, which the render patch honours (an explicit zone always
 * wins). That round-trips the date verbatim on any machine, which is the point:
 * the owner is in Florida and the setters are in Manila, and both must see the
 * same Monday.
 *
 * Real INSTANTS (checked_in_at, paid_at) are the opposite case — they get
 * rendered in Eastern, via the app-wide default, like every other timestamp.
 */

import { staffName, type StaffWithRate } from "@/services/timeTracking";
import { APP_TZ, dateKeyET } from "@/utils/time";

/**
 * A staff member's name, never blank. The service's staffName() returns null
 * when a profile has no display name, no first/last, and no email — which on a
 * payroll table would render an empty cell next to a dollar amount, or the
 * literal "null" inside a confirmation toast.
 */
export function displayName(
  s: Pick<StaffWithRate, "display_name" | "first_name" | "last_name" | "email">
): string {
  return staffName(s) || "Unnamed";
}

/** A bare "YYYY-MM-DD" as UTC midnight. Never feed this an instant. */
export function parseYmd(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}

export function formatMoney(amount: number, currency?: string | null): string {
  const code = currency || "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Intl throws on a non-ISO code rather than degrading, and a thrown format
    // helper would blank the whole table.
    return `${code} ${amount.toFixed(2)}`;
  }
}

/** Payroll hours to two decimals, but "8h" reads better than "8.00h". */
export function formatHours(hours: number): string {
  return `${hours.toFixed(2).replace(/\.00$/, "")}h`;
}

/** "Mon Aug 17" — a calendar date, rendered verbatim. */
export function shortDate(ymd: string): string {
  return parseYmd(ymd).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "Aug 17 – Aug 23, 2026" for the week header and history rows. */
export function formatRange(start: string, end: string): string {
  const s = parseYmd(start);
  const e = parseYmd(end);
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
  const sFmt = s.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const eFmt = e.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${sFmt} – ${eFmt}`;
}

/** "Aug 20" from an instant — Eastern, like every other timestamp in the app. */
export function shortInstant(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: APP_TZ });
}

/** "Aug 20, 9:14 AM" from an instant — when an entry was actually recorded. */
export function instantWithTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: APP_TZ,
  });
}

/**
 * How many calendar days after the day worked an instant landed. Both sides are
 * reduced to an EASTERN calendar day first, so the comparison is date-against-
 * date and a late-evening timestamp doesn't round up into an extra day.
 * Returns null when there is no instant to measure — an UNKNOWN gap, which the
 * caller must not render as zero.
 */
export function daysAfterWorkDate(workDate: string, instant: string | null): number | null {
  if (!instant) return null;
  const on = dateKeyET(instant);
  if (!on) return null;
  return Math.round((parseYmd(on).getTime() - parseYmd(workDate).getTime()) / 86_400_000);
}

/**
 * An entry logged 2+ calendar days after the day it covers was backfilled from
 * memory, not checked in live — the owner wants those flagged before he pays
 * them.
 */
export const LATE_LOG_DAYS = 2;

/** Beyond this the backfill stops being forgetfulness and gets the red treatment. */
export const VERY_LATE_LOG_DAYS = 4;

export function loggedLate(workDate: string, checkedInAt: string | null): boolean {
  const days = daysAfterWorkDate(workDate, checkedInAt);
  return days != null && days >= LATE_LOG_DAYS;
}

/** "4 days later" / "same day" — how stale a change was when it landed. */
export function lateLabel(days: number | null): string {
  if (days == null) return "timing unknown";
  if (days <= 0) return "same day";
  if (days === 1) return "next day";
  return `${days} days later`;
}

/**
 * Tone for a gap measured by daysAfterWorkDate(). `unknown` is deliberately its
 * own tier: a missing timestamp is not a clean one.
 */
export type LateTone = "ok" | "late" | "very-late" | "unknown";

export function lateTone(days: number | null): LateTone {
  if (days == null) return "unknown";
  if (days >= VERY_LATE_LOG_DAYS) return "very-late";
  if (days >= LATE_LOG_DAYS) return "late";
  return "ok";
}

export const LATE_TONE_CLASS: Record<LateTone, string> = {
  ok: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  late: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "very-late": "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  unknown: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400",
};

// ---------------------------------------------------------------------------
// Clock times — clock_in / clock_out are real INSTANTS, so Eastern, not UTC.
// ---------------------------------------------------------------------------

/** "9:00a" — an instant as an Eastern wall clock, compact enough for a table. */
export function clockTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: APP_TZ })
    // Intl separates the meridiem with a narrow no-break space in newer ICU.
    .replace(/[\s\u202f\u00a0]*AM$/i, "a")
    .replace(/[\s\u202f\u00a0]*PM$/i, "p");
}

/** "45m" / "1h 15m" — break length, or unpaid-gap length. */
export function minutesLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

export interface ClockShape {
  clock_in?: string | null;
  clock_out?: string | null;
  break_minutes?: number | null;
}

/**
 * "9:00a–5:30p · 30m break" for a clocked shift, or null when the day was
 * entered as plain hours. Null means MANUAL ENTRY, not missing data — the
 * caller says so in words rather than leaving a blank cell.
 *
 * A shift that crosses midnight (Manila setters on a US-hours shift do this)
 * gets a "+1d" marker so 11:00p–7:00a doesn't read as an eight-hour gap
 * backwards.
 */
export function clockSpan(e: ClockShape): string | null {
  const inAt = e.clock_in ?? null;
  const outAt = e.clock_out ?? null;
  const brk = Number(e.break_minutes) || 0;
  if (!inAt && !outAt) return null;

  const start = clockTime(inAt);
  const end = clockTime(outAt);
  let span = outAt ? `${start}–${end}` : `${start}– still clocked in`;

  if (inAt && outAt) {
    const dIn = dateKeyET(inAt);
    const dOut = dateKeyET(outAt);
    if (dIn && dOut && dIn !== dOut) span += " +1d";
  }
  return brk > 0 ? `${span} · ${minutesLabel(brk)} break` : span;
}

export const ROLE_BADGE: Record<string, string> = {
  closer: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  employee: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  admin: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  super_admin: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};
