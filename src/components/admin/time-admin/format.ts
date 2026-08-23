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
 * An entry logged 2+ calendar days after the day it covers was backfilled from
 * memory, not checked in live — the owner wants those flagged before he pays
 * them. The check-in instant is reduced to its EASTERN calendar day first, so
 * the comparison is date-against-date and a late-evening check-in doesn't round
 * up into "late".
 */
export const LATE_LOG_DAYS = 2;

export function loggedLate(workDate: string, checkedInAt: string | null): boolean {
  if (!checkedInAt) return false;
  const loggedOn = dateKeyET(checkedInAt);
  if (!loggedOn) return false;
  const days = Math.round(
    (parseYmd(loggedOn).getTime() - parseYmd(workDate).getTime()) / 86_400_000
  );
  return days >= LATE_LOG_DAYS;
}

export const ROLE_BADGE: Record<string, string> = {
  closer: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  employee: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  admin: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  super_admin: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};
