// Staff time tracking + weekly pay runs.
//
// Staff check in daily: they enter the hours they worked for a date. The DB
// stamps checked_in_at itself (default now(), re-stamped by an UPDATE trigger),
// so the owner can compare CLAIMED hours against WHEN they were actually
// logged. This client therefore NEVER sends checked_in_at — writing it here
// would defeat the entire point of the column.
//
// Pay weeks run MONDAY -> SUNDAY. See weekBounds().
//
// Access control lives in RLS (migration 20260823_time_tracking.sql), not here:
// workers read/write only their own rows, and every write to staff_rates /
// pay_runs is super_admin-only. The "admin" functions below are ordinary
// queries that simply return nothing (or throw on write) for non-super users —
// do not treat their presence as an authorization check.

import supabase from "@/supabase";
import { mustWrite } from "@/supabase/writes";
import { APP_TZ } from "@/utils/time";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimeEntry {
  id: string;
  user_id: string;
  work_date: string; // yyyy-mm-dd
  hours: number;
  note: string | null;
  /** Server-stamped submission time. Compare against work_date to spot late/bulk logging. */
  checked_in_at: string;
  created_at: string;
  updated_at: string;
}

export interface StaffRate {
  user_id: string;
  hourly_rate: number;
  currency: string;
  updated_at: string;
  updated_by: string | null;
}

export type PayRunStatus = "pending" | "paid";

export interface PayRun {
  id: string;
  user_id: string;
  period_start: string; // Monday, yyyy-mm-dd
  period_end: string; // Sunday, yyyy-mm-dd
  hours: number;
  hourly_rate: number;
  amount: number;
  currency: string;
  status: PayRunStatus;
  paid_at: string | null;
  note: string | null;
  created_at: string;
}

/**
 * A staff profile with its rate row (null until a super admin sets one).
 * `hourly_rate` / `currency` / `full_name` are flattened conveniences for the
 * admin table; `rate` keeps the full row (updated_at / updated_by) for anyone
 * who needs to show when a rate last changed.
 */
export interface StaffWithRate {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  full_name: string | null;
  role: string;
  hourly_rate: number | null;
  currency: string | null;
  rate: StaffRate | null;
}

/** Roles allowed to log time. Mirrors public.is_time_staff() in the migration —
 *  change both together. Merchants (role 'user') are excluded by design. */
export const TIME_STAFF_ROLES = ["closer", "employee", "admin", "super_admin"] as const;

export interface CheckInInput {
  workDate: string; // yyyy-mm-dd
  hours: number;
  note?: string;
}

export interface PayRunInput {
  userId: string;
  periodStart: string;
  periodEnd: string;
  hours: number;
  hourlyRate: number;
  amount: number;
  note?: string;
  currency?: string;
}

// ---------------------------------------------------------------------------
// Dates — MONDAY-start weeks, in Eastern (the app's one true timezone)
// ---------------------------------------------------------------------------

/**
 * The calendar date in Eastern, re-anchored to UTC midnight so day arithmetic
 * is DST-immune. A worker in Manila and one in Phoenix must agree on which day
 * "today" is; browser-local components would disagree by up to a day.
 * timeZone is passed explicitly so this does not depend on installEasternTime().
 */
function easternCalendarDate(d: Date): Date {
  const [y, m, day] = d.toLocaleDateString("en-CA", { timeZone: APP_TZ }).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Today's work date (Eastern), yyyy-mm-dd — the default for the check-in form. */
export function todayISO(): string {
  return iso(easternCalendarDate(new Date()));
}

/**
 * The MONDAY-start pay week containing a plain calendar date (yyyy-mm-dd).
 * Pure calendar math with no timezone conversion — use this for values that are
 * ALREADY dates (a row's work_date, a week picker's start). Passing a converted
 * instant back through easternCalendarDate would shift it a day and, at week
 * boundaries, a whole week.
 */
export function weekBoundsOf(workDate: string): { start: string; end: string } {
  const d = new Date(`${workDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`weekBoundsOf: invalid date "${workDate}"`);
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // getUTCDay: 0=Sun..6=Sat
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { start: iso(start), end: iso(end) };
}

/**
 * The MONDAY-start pay week containing `date`.
 * A Date is an instant and is read in Eastern; a yyyy-mm-dd string is already a
 * calendar date and is used as-is (converting it would shift it a day west).
 */
export function weekBounds(date: Date | string): { start: string; end: string } {
  return weekBoundsOf(typeof date === "string" ? date : iso(easternCalendarDate(date)));
}

/** Shift a week by `n` weeks (-1 = previous week). Convenience for week pickers. */
export function shiftWeek(weekStart: string, n: number): { start: string; end: string } {
  const d = new Date(`${weekStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n * 7);
  return weekBoundsOf(iso(d));
}

// ---------------------------------------------------------------------------
// Worker — own time entries
// ---------------------------------------------------------------------------

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const id = data.user?.id;
  if (!id) throw new Error("Not signed in");
  return id;
}

/**
 * Log (or correct) the hours worked on a date for the signed-in user.
 * Upserts on (user_id, work_date): re-submitting a day overwrites the claim and
 * the DB re-stamps checked_in_at to now.
 */
export async function checkIn(input: CheckInInput): Promise<TimeEntry> {
  const user_id = await currentUserId();
  const hours = Number(input.hours);
  // Fail here with a readable message rather than letting the CHECK constraint
  // surface as a raw Postgres error in the UI.
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    throw new Error("Hours must be greater than 0 and no more than 24.");
  }
  const note = input.note?.trim() ? input.note.trim() : null;

  const rows = await mustWrite<TimeEntry>(
    "checkIn",
    supabase
      .from("time_entries")
      .upsert({ user_id, work_date: input.workDate, hours, note }, { onConflict: "user_id,work_date" }),
  );
  return rows[0];
}

/** The signed-in user's entries, newest first. `fromDate` is inclusive. */
export async function listMyEntries(fromDate?: string): Promise<TimeEntry[]> {
  const user_id = await currentUserId();
  let q = supabase.from("time_entries").select("*").eq("user_id", user_id);
  if (fromDate) q = q.gte("work_date", fromDate);
  const { data, error } = await q.order("work_date", { ascending: false });
  if (error) throw error;
  return (data || []) as TimeEntry[];
}

/** The signed-in user's pay history, newest period first. */
export async function listMyPayRuns(): Promise<PayRun[]> {
  const user_id = await currentUserId();
  const { data, error } = await supabase
    .from("pay_runs")
    .select("*")
    .eq("user_id", user_id)
    .order("period_start", { ascending: false });
  if (error) throw error;
  return (data || []) as PayRun[];
}

/** The signed-in user's own rate, or null if a super admin has not set one. */
export async function getMyRate(): Promise<StaffRate | null> {
  const user_id = await currentUserId();
  const { data, error } = await supabase
    .from("staff_rates")
    .select("*")
    .eq("user_id", user_id)
    .maybeSingle();
  if (error) throw error;
  return (data as StaffRate) ?? null;
}

// ---------------------------------------------------------------------------
// Admin (super_admin only — enforced by RLS)
// ---------------------------------------------------------------------------

/** Every staff profile with its rate. Two queries, joined client-side. */
export async function listStaffWithRates(): Promise<StaffWithRate[]> {
  const { data: profiles, error: pErr } = await supabase
    .from("profiles")
    .select("id, email, first_name, last_name, display_name, role")
    .in("role", [...TIME_STAFF_ROLES])
    .order("first_name", { ascending: true });
  if (pErr) throw pErr;

  const { data: rates, error: rErr } = await supabase.from("staff_rates").select("*");
  if (rErr) throw rErr;

  const byUser = new Map<string, StaffRate>();
  for (const r of (rates || []) as StaffRate[]) byUser.set(r.user_id, r);

  type ProfileRow = Pick<
    StaffWithRate,
    "id" | "email" | "first_name" | "last_name" | "display_name" | "role"
  >;

  return ((profiles || []) as ProfileRow[]).map((p) => {
    const rate = byUser.get(p.id) ?? null;
    return {
      ...p,
      full_name: staffName(p),
      hourly_rate: rate ? Number(rate.hourly_rate) : null,
      currency: rate?.currency ?? null,
      rate,
    };
  });
}

/** Display name for a staff member, falling back through the name columns. */
export function staffName(
  p: Pick<StaffWithRate, "display_name" | "first_name" | "last_name" | "email">,
): string | null {
  const full = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return p.display_name?.trim() || full || p.email || null;
}

/** Set someone's hourly rate. Super admin only; RLS rejects everyone else. */
export async function upsertRate(
  userId: string,
  hourlyRate: number,
  currency = "USD",
): Promise<StaffRate> {
  const rate = Number(hourlyRate);
  if (!Number.isFinite(rate) || rate < 0) throw new Error("Hourly rate must be zero or greater.");
  const updated_by = await currentUserId();

  const rows = await mustWrite<StaffRate>(
    "upsertRate",
    supabase
      .from("staff_rates")
      // updated_at is left to the column default / touch trigger.
      .upsert({ user_id: userId, hourly_rate: rate, currency, updated_by }, { onConflict: "user_id" }),
  );
  return rows[0];
}

/** All staff entries in a date range (inclusive) — the weekly cost roll-up. */
export async function listAllEntries(periodStart: string, periodEnd: string): Promise<TimeEntry[]> {
  const { data, error } = await supabase
    .from("time_entries")
    .select("*")
    .gte("work_date", periodStart)
    .lte("work_date", periodEnd)
    .order("work_date", { ascending: false });
  if (error) throw error;
  return (data || []) as TimeEntry[];
}

/** Every pay run, newest period first. */
export async function listAllPayRuns(): Promise<PayRun[]> {
  const { data, error } = await supabase
    .from("pay_runs")
    .select("*")
    .order("period_start", { ascending: false });
  if (error) throw error;
  return (data || []) as PayRun[];
}

function payRunRow(input: PayRunInput, status: PayRunStatus) {
  return {
    user_id: input.userId,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    hours: Number(input.hours),
    hourly_rate: Number(input.hourlyRate),
    amount: Number(input.amount),
    currency: input.currency ?? "USD",
    status,
    paid_at: status === "paid" ? new Date().toISOString() : null,
    note: input.note?.trim() ? input.note.trim() : null,
  };
}

/**
 * Mark a week paid for one person. Upserts on (user_id, period_start,
 * period_end), so marking an already-recorded week paid updates it in place
 * rather than failing on the unique constraint.
 */
export async function markPaid(input: PayRunInput): Promise<PayRun> {
  const rows = await mustWrite<PayRun>(
    "markPaid",
    supabase
      .from("pay_runs")
      .upsert(payRunRow(input, "paid"), { onConflict: "user_id,period_start,period_end" }),
  );
  return rows[0];
}

/** Record a week as owed but not yet paid. */
export async function createPendingRun(input: PayRunInput): Promise<PayRun> {
  const rows = await mustWrite<PayRun>(
    "createPendingRun",
    supabase
      .from("pay_runs")
      .upsert(payRunRow(input, "pending"), { onConflict: "user_id,period_start,period_end" }),
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Roll-up helper
// ---------------------------------------------------------------------------

/** Sum hours per user_id — feeds "weekly hours x rate = cost" in the admin view. */
export function totalHoursByUser(entries: TimeEntry[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const e of entries) {
    totals.set(e.user_id, (totals.get(e.user_id) ?? 0) + Number(e.hours));
  }
  return totals;
}
