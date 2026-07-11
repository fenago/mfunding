// Deadline parsing shared by the portal countdowns.
//
// `deals.stips_promised_by` is a SQL `date` — it arrives as 'YYYY-MM-DD'. Parsing
// that with `new Date('2026-07-11')` yields UTC midnight, which in a US timezone
// is the evening BEFORE — so a deadline of "today" would read as overdue by 9am.
// We treat a bare date as the END of that local day; full timestamps parse as-is.

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Parse a deadline value to a Date. Bare 'YYYY-MM-DD' → local end-of-day. */
export function parseDeadline(value: string | Date): Date {
  if (value instanceof Date) return value;
  if (DATE_ONLY.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d, 23, 59, 59, 999);
  }
  return new Date(value);
}

/** True once the deadline has fully passed (date-only aware). */
export function isDeadlinePast(value: string | null | undefined): boolean {
  if (!value) return false;
  const t = parseDeadline(value).getTime();
  return !Number.isNaN(t) && t <= Date.now();
}
