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
// v2 (20260823_time_tracking_v2.sql) adds real shift times — clock_in, clock_out
// and break_minutes — plus an append-only time_entry_audit trail written by a DB
// trigger on every insert/update/delete. `hours` stays the stored source of
// truth that payroll reads; clock times DERIVE it (see computeHours). Nothing
// here writes to time_entry_audit: it is trigger-written and read-only to
// clients, which is what makes "logged 2h, bumped to 4h four days later"
// impossible to hide.
//
// v3 (20260823_schedule_and_hour_cap.sql) adds the expected schedule and the
// weekly hour cap: staff_rates gains expected_weekly_hours / weekly_hours_cap /
// schedule_note, and weekly_hour_approvals holds one row per person per pay week
// saying "over the cap was OK this week". A week over cap with no approval row is
// UNAPPROVED overtime — see overCap() / unapprovedOvertime(). The cap is stored
// per person and defaults to 40 in the DB, so a missing cap here means "no rate
// row yet", not "no limit"; the helpers fall back to DEFAULT_WEEKLY_HOURS_CAP
// rather than treating an unknown cap as unlimited.
//
// Access control lives in RLS (migration 20260823_time_tracking.sql), not here:
// workers read/write only their own rows, and every write to staff_rates /
// pay_runs is super_admin-only. The "admin" functions below are ordinary
// queries that simply return nothing (or throw on write) for non-super users —
// do not treat their presence as an authorization check.

import supabase from "@/supabase";
import { mustWrite } from "@/supabase/writes";
import { APP_TZ, dateKeyET } from "@/utils/time";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TimeEntry {
  id: string;
  user_id: string;
  work_date: string; // yyyy-mm-dd
  hours: number;
  note: string | null;
  /**
   * Free-text context the worker chose to add, separate from `note` ("what did
   * you work on?"). NOT covered by the log_time_entry_change() trigger, so
   * changes to it leave no audit row — never put anything payroll depends on here.
   */
  context_note: string | null;
  /** Shift start, a real instant (ISO timestamptz). Null on hours-only entries. */
  clock_in: string | null;
  /** Shift end, a real instant (ISO timestamptz). Null on hours-only entries. */
  clock_out: string | null;
  /** Unpaid break/lunch already deducted from `hours`. Never null (DB default 0). */
  break_minutes: number;
  /** Server-stamped submission time. Compare against work_date to spot late/bulk logging. */
  checked_in_at: string;
  created_at: string;
  updated_at: string;
}

export type TimeEntryAuditAction = "insert" | "update" | "delete";

/**
 * One append-only row per change to a timesheet row, written by the
 * log_time_entry_change() trigger — never by this client. `changed_by` is
 * whoever was authenticated when the change landed, which is not necessarily
 * `user_id` (an admin editing someone else's week shows up as a difference).
 * RLS: a worker sees only their own rows; super admins see everyone's.
 */
export interface TimeEntryAudit {
  id: string;
  /** Null once the underlying entry is hard-deleted — the audit row survives it. */
  time_entry_id: string | null;
  user_id: string;
  work_date: string; // yyyy-mm-dd
  action: TimeEntryAuditAction;
  old_hours: number | null;
  new_hours: number | null;
  old_clock_in: string | null;
  new_clock_in: string | null;
  old_clock_out: string | null;
  new_clock_out: string | null;
  old_break_minutes: number | null;
  new_break_minutes: number | null;
  old_note: string | null;
  new_note: string | null;
  changed_by: string | null;
  changed_at: string;
}

export interface StaffRate {
  user_id: string;
  hourly_rate: number;
  currency: string;
  /** Hours per week the owner EXPECTS from this person. Null = never set; it is
   *  a scheduling expectation only and nothing pays or blocks on it. */
  expected_weekly_hours: number | null;
  /** Hours per week past which a week counts as overtime. Never null (DB default 40). */
  weekly_hours_cap: number;
  /** Free text: which days/hours the owner expects them online. */
  schedule_note: string | null;
  updated_at: string;
  updated_by: string | null;
}

/**
 * One row per person per pay week: "this week going over the cap is approved".
 * The ABSENCE of a row is meaningful — an over-cap week with no row is
 * unapproved overtime. `approved: false` is an explicit denial and reads the
 * same as absent to unapprovedOvertime(), but keeps the note and who set it.
 * RLS: a worker reads only their own; only super admins write.
 */
export interface WeeklyApproval {
  id: string;
  user_id: string;
  period_start: string; // Monday, yyyy-mm-dd
  approved: boolean;
  approved_by: string | null;
  approved_at: string;
  note: string | null;
}

/**
 * Schedule fields for upsertRate/upsertSchedule. Every field is optional and
 * OMITTING one leaves the stored value alone — only the keys present are
 * written. `null` is different from omitted: it CLEARS the column (cap excluded,
 * it is NOT NULL in the DB).
 */
export interface ScheduleInput {
  /** Expected hours/week; null clears it. */
  expectedWeeklyHours?: number | null;
  /**
   * Overtime threshold; must be > 0 when given. The column is NOT NULL, so null
   * (an admin blanking the field) RESETS it to DEFAULT_WEEKLY_HOURS_CAP rather
   * than clearing it — a person always has a cap, and "no cap" is not a state
   * the overtime flag could interpret. Omit the field to leave it as-is.
   */
  weeklyHoursCap?: number | null;
  /** Schedule note; null or blank clears it. */
  scheduleNote?: string | null;
}

/** The cap assumed when a person has no staff_rates row (matches the DB default). */
export const DEFAULT_WEEKLY_HOURS_CAP = 40;

/**
 * Slack when comparing hours against the cap. numeric(5,2) sums of 7 rows can
 * land on 40.00000001; without this, a dead-on-40 week would flag as overtime.
 */
const CAP_EPSILON = 0.01;

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
 *
 * INVARIANT the admin UI depends on: `rate === null` is the ONLY signal that
 * nothing is stored for this person. The flattened `weekly_hours_cap` cannot
 * carry it, because it is pre-defaulted to DEFAULT_WEEKLY_HOURS_CAP and so reads
 * identically whether the owner chose 40 or never chose anything. Do not
 * synthesize a placeholder `rate` object for people without a row — that would
 * silently turn "unset, house default applies" into "the owner set this".
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
  /** Expected hours/week, or null if never set. */
  expected_weekly_hours: number | null;
  /** The EFFECTIVE overtime threshold — DEFAULT_WEEKLY_HOURS_CAP when there is
   *  no rate row, so callers can compare against it without a fallback of their own. */
  weekly_hours_cap: number;
  schedule_note: string | null;
  rate: StaffRate | null;
}

/** Roles allowed to log time. Mirrors public.is_time_staff() in the migration —
 *  change both together. Merchants (role 'user') are excluded by design. */
export const TIME_STAFF_ROLES = ["closer", "employee", "admin", "super_admin"] as const;

export interface CheckInInput {
  workDate: string; // yyyy-mm-dd
  /**
   * Explicit hours — a manual override. Omit it and supply clockIn + clockOut
   * instead to have the shift derive the hours.
   */
  hours?: number;
  note?: string;
  /**
   * Extra context for the day. Omitted leaves any stored value alone; null or
   * blank clears it. Unaudited — see TimeEntry.context_note.
   */
  contextNote?: string | null;
  /** Shift start as a real instant (anything Date-parseable; stored as ISO). */
  clockIn?: string | null;
  /** Shift end as a real instant. `null` clears a previously stored value. */
  clockOut?: string | null;
  /** Unpaid break/lunch in minutes, deducted from the derived hours. */
  breakMinutes?: number;
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
 * Paid hours for a shift: elapsed clock time minus the unpaid break, to 2dp.
 * Null when either end of the shift is missing or unparseable — an open shift
 * has no hours yet. A break longer than the shift returns a NEGATIVE number on
 * purpose so the caller rejects it instead of silently storing zero.
 * Pure: safe for live "3.75 h" previews while someone is typing.
 */
export function computeHours(
  clockIn: string | null | undefined,
  clockOut: string | null | undefined,
  breakMinutes = 0,
): number | null {
  if (!clockIn || !clockOut) return null;
  const start = Date.parse(clockIn);
  const end = Date.parse(clockOut);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const worked = Math.max(0, (end - start) / 3_600_000);
  const unpaid = Number(breakMinutes) || 0;
  return Math.round((worked - unpaid / 60) * 100) / 100;
}

/**
 * Do a row's stored shift times still reproduce its stored `hours`?
 * Null when there's no shift to check (an hours-only entry). False means the
 * two disagree — which is legitimate (someone overrode the hours, or corrected
 * hours through the old hours-only form, which deliberately leaves the shift
 * untouched) but is worth showing the owner rather than hiding.
 * Tolerance is 0.01h to absorb numeric(5,2) rounding.
 */
export function hoursMatchShift(
  entry: Pick<TimeEntry, "hours" | "clock_in" | "clock_out" | "break_minutes">,
): boolean | null {
  const derived = computeHours(entry.clock_in, entry.clock_out, entry.break_minutes);
  if (derived === null) return null;
  return Math.abs(derived - Number(entry.hours)) <= 0.01;
}

/** An instant the caller gave us, normalized to ISO for a timestamptz column. */
function toInstantIso(value: string | null | undefined, label: string): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${label} is not a valid time.`);
  return new Date(ms).toISOString();
}

/**
 * Log (or correct) a day's work for the signed-in user.
 * Upserts on (user_id, work_date): re-submitting a day overwrites the claim and
 * the DB re-stamps checked_in_at to now (and writes a time_entry_audit row).
 *
 * `hours` is always what gets stored and paid. Supply clockIn + clockOut (and
 * optionally breakMinutes) to derive it; supply `hours` directly to override.
 * Omitting the clock fields entirely leaves any already-stored shift times
 * alone, so the legacy hours-only form keeps working unchanged; passing any one
 * of them rewrites all three together, so the stored shift can never disagree
 * with the hours it produced.
 *
 * NOTE: an OPEN shift (clock-in with no clock-out) cannot be stored — the
 * hours column is NOT NULL with a `hours > 0` check. Clock-out and clock-in
 * have to be saved in the same call, or an explicit `hours` passed.
 */
export async function checkIn(input: CheckInInput): Promise<TimeEntry> {
  const user_id = await currentUserId();

  const touchesShift =
    input.clockIn !== undefined || input.clockOut !== undefined || input.breakMinutes !== undefined;

  const breakMinutes = input.breakMinutes === undefined ? 0 : Number(input.breakMinutes);
  if (!Number.isFinite(breakMinutes) || breakMinutes < 0) {
    throw new Error("Break minutes must be zero or greater.");
  }

  const clock_in = toInstantIso(input.clockIn, "Clock-in");
  const clock_out = toInstantIso(input.clockOut, "Clock-out");
  if (clock_in && clock_out && Date.parse(clock_out) < Date.parse(clock_in)) {
    throw new Error("Clock-out must be after clock-in.");
  }

  const derived = computeHours(clock_in, clock_out, breakMinutes);
  if (derived !== null && derived <= 0 && input.hours === undefined) {
    throw new Error("The break is as long as the shift — no paid hours left to log.");
  }

  const explicit = input.hours === undefined || input.hours === null ? null : Number(input.hours);
  const hours = explicit ?? derived;
  if (hours === null) {
    throw new Error(
      clock_in && !clock_out
        ? "Add a clock-out time (or enter hours directly) to save this day."
        : "Enter the hours worked, or a clock-in and clock-out time.",
    );
  }
  // Fail here with a readable message rather than letting the CHECK constraint
  // surface as a raw Postgres error in the UI.
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    throw new Error("Hours must be greater than 0 and no more than 24.");
  }

  const note = input.note?.trim() ? input.note.trim() : null;
  // work_date is a bare calendar date and is passed straight through: parsing it
  // as a Date would land on UTC midnight and shift it a day back in Eastern.
  const row = {
    user_id,
    work_date: input.workDate,
    hours,
    note,
    ...(input.contextNote === undefined
      ? {}
      : { context_note: input.contextNote?.trim() ? input.contextNote.trim() : null }),
    ...(touchesShift ? { clock_in, clock_out, break_minutes: breakMinutes } : {}),
  };

  const rows = await mustWrite<TimeEntry>(
    "checkIn",
    supabase.from("time_entries").upsert(row, { onConflict: "user_id,work_date" }),
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

/**
 * The signed-in user's own edit history, newest change first. `fromDate` is an
 * inclusive filter on work_date (the day worked), not on when the edit landed,
 * so a late correction to an old day still shows up under that old day.
 * RLS scopes this to the caller — the user_id filter is belt-and-braces.
 */
export async function listMyAudit(fromDate?: string): Promise<TimeEntryAudit[]> {
  const user_id = await currentUserId();
  let q = supabase.from("time_entry_audit").select("*").eq("user_id", user_id);
  if (fromDate) q = q.gte("work_date", fromDate);
  const { data, error } = await q.order("changed_at", { ascending: false });
  if (error) throw error;
  return (data || []) as TimeEntryAudit[];
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

/**
 * The signed-in user's own schedule — expected hours, cap and schedule note.
 * This is the SAME staff_rates row getMyRate() returns (workers may read their
 * own row under RLS); it exists as its own name so schedule UI does not read as
 * if it were fetching pay. Null when no rate row has been created yet, in which
 * case the effective cap is DEFAULT_WEEKLY_HOURS_CAP.
 */
export async function getMySchedule(): Promise<StaffRate | null> {
  return getMyRate();
}

/**
 * The signed-in user's approval row for a week, or null if there is none.
 * Workers may read their own; a non-super caller asking about someone ELSE gets
 * null from RLS, which is indistinguishable from "not approved" — only trust a
 * null here for your own user or as a super admin.
 */
export async function getMyApproval(periodStart: string): Promise<WeeklyApproval | null> {
  const user_id = await currentUserId();
  return getApproval(user_id, periodStart);
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
      expected_weekly_hours:
        rate?.expected_weekly_hours == null ? null : Number(rate.expected_weekly_hours),
      weekly_hours_cap: effectiveCap(rate?.weekly_hours_cap),
      schedule_note: rate?.schedule_note ?? null,
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

/**
 * Translate a ScheduleInput into staff_rates columns, keeping ONLY the keys the
 * caller actually supplied. This is what makes the upserts non-destructive:
 * PostgREST builds its ON CONFLICT DO UPDATE SET list from the payload keys, so
 * a column that never enters the object is never written.
 */
function scheduleColumns(schedule: ScheduleInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (schedule.expectedWeeklyHours !== undefined) {
    if (schedule.expectedWeeklyHours === null) {
      patch.expected_weekly_hours = null;
    } else {
      const expected = Number(schedule.expectedWeeklyHours);
      if (!Number.isFinite(expected) || expected < 0 || expected > 168) {
        throw new Error("Expected weekly hours must be between 0 and 168.");
      }
      patch.expected_weekly_hours = expected;
    }
  }

  if (schedule.weeklyHoursCap !== undefined) {
    if (schedule.weeklyHoursCap === null) {
      patch.weekly_hours_cap = DEFAULT_WEEKLY_HOURS_CAP;
    } else {
      const cap = Number(schedule.weeklyHoursCap);
      // A zero or negative cap would flag every worked week as overtime — reject
      // it here rather than storing a nonsense threshold.
      if (!Number.isFinite(cap) || cap <= 0 || cap > 168) {
        throw new Error("Weekly hours cap must be greater than 0 and no more than 168.");
      }
      patch.weekly_hours_cap = cap;
    }
  }

  if (schedule.scheduleNote !== undefined) {
    patch.schedule_note = schedule.scheduleNote?.trim() ? schedule.scheduleNote.trim() : null;
  }

  return patch;
}

/** Pay + schedule columns, all optional — only the keys present get written. */
interface StaffRatePatch extends ScheduleInput {
  hourlyRate?: number;
  currency?: string;
}

/**
 * The one place staff_rates is written. `label` names the caller in any
 * DbWriteError so a failed schedule save does not report itself as a pay save.
 */
async function writeStaffRate(
  label: string,
  userId: string,
  input: StaffRatePatch,
): Promise<StaffRate> {
  const patch: Record<string, unknown> = {};

  if (input.hourlyRate !== undefined) {
    const rate = Number(input.hourlyRate);
    if (!Number.isFinite(rate) || rate < 0) throw new Error("Hourly rate must be zero or greater.");
    patch.hourly_rate = rate;
  }
  if (input.currency !== undefined) patch.currency = input.currency;
  Object.assign(patch, scheduleColumns(input));

  if (Object.keys(patch).length === 0) {
    throw new Error(`${label}: nothing to update — supply at least one field.`);
  }
  const updated_by = await currentUserId();

  const rows = await mustWrite<StaffRate>(
    label,
    supabase
      .from("staff_rates")
      // updated_at is left to the column default / touch trigger.
      .upsert({ user_id: userId, updated_by, ...patch }, { onConflict: "user_id" }),
  );
  return rows[0];
}

/**
 * Set someone's hourly rate, and optionally their schedule in the same write.
 * Super admin only; RLS rejects everyone else.
 *
 * This is a PARTIAL update: fields you leave out keep whatever is stored, since
 * only the keys passed reach the ON CONFLICT DO UPDATE SET list. So the
 * three-argument call from the pay table cannot disturb the schedule. `currency`
 * is always written, defaulting to USD.
 *
 * For a schedule-only write use upsertSchedule() — pay and schedule each have
 * exactly one way to be written, deliberately.
 */
export async function upsertRate(
  userId: string,
  hourlyRate: number,
  currency = "USD",
  schedule: ScheduleInput = {},
): Promise<StaffRate> {
  return writeStaffRate("upsertRate", userId, { hourlyRate, currency, ...schedule });
}

/**
 * Set someone's schedule WITHOUT touching their pay. Super admin only.
 * Only the supplied fields are written; the rest of the row is left alone.
 *
 * If the person has no staff_rates row yet this creates one, which means their
 * hourly_rate starts at the column default of 0 until a rate is set — a
 * schedule can exist before pay does.
 */
export async function upsertSchedule(
  userId: string,
  schedule: ScheduleInput,
): Promise<StaffRate> {
  return writeStaffRate("upsertSchedule", userId, schedule);
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

/**
 * One person's edit history for a week (inclusive work_date range), newest
 * change first — the owner's "was this edited after the fact?" view.
 * Super-admin-only in practice: RLS returns only the caller's own rows to
 * anyone else, so an empty array means "nothing to see" OR "not permitted".
 */
export async function listAuditForUser(
  userId: string,
  periodStart: string,
  periodEnd: string,
): Promise<TimeEntryAudit[]> {
  const { data, error } = await supabase
    .from("time_entry_audit")
    .select("*")
    .eq("user_id", userId)
    .gte("work_date", periodStart)
    .lte("work_date", periodEnd)
    .order("changed_at", { ascending: false });
  if (error) throw error;
  return (data || []) as TimeEntryAudit[];
}

/**
 * Every audit row in a work_date range, grouped by user_id (each list newest
 * change first) — one query for a whole week's roll-up instead of one per
 * person. Same RLS caveat as listAuditForUser.
 */
export async function listAuditForPeriod(
  periodStart: string,
  periodEnd: string,
): Promise<Map<string, TimeEntryAudit[]>> {
  const { data, error } = await supabase
    .from("time_entry_audit")
    .select("*")
    .gte("work_date", periodStart)
    .lte("work_date", periodEnd)
    .order("changed_at", { ascending: false });
  if (error) throw error;

  const byUser = new Map<string, TimeEntryAudit[]>();
  for (const row of (data || []) as TimeEntryAudit[]) {
    const list = byUser.get(row.user_id);
    if (list) list.push(row);
    else byUser.set(row.user_id, [row]);
  }
  return byUser;
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
// Weekly overtime approvals
//
// Reads are open to the row's owner and to super admins; every WRITE is
// super-admin-only via RLS. Because RLS filters rather than errors on reads, a
// null/empty result from a non-super caller means "not visible to you" as much
// as "not there" — see the note on getMyApproval.
// ---------------------------------------------------------------------------

/**
 * Every week is keyed by its MONDAY. Callers hand us whatever date they have
 * (a week picker's start, a row's work_date) and we normalize to the Monday of
 * that week, so a lookup can never miss a row that a write placed under the
 * canonical date.
 */
function weekKey(periodStart: string): string {
  return weekBoundsOf(periodStart).start;
}

/** Every approval row for one pay week — the admin week table's OT column. */
export async function listWeekApprovals(periodStart: string): Promise<WeeklyApproval[]> {
  const { data, error } = await supabase
    .from("weekly_hour_approvals")
    .select("*")
    .eq("period_start", weekKey(periodStart));
  if (error) throw error;
  return (data || []) as WeeklyApproval[];
}

/** Index a week's approvals by user_id, for row-by-row lookup in a staff table. */
export function approvalsByUser(rows: WeeklyApproval[]): Map<string, WeeklyApproval> {
  const byUser = new Map<string, WeeklyApproval>();
  for (const row of rows) byUser.set(row.user_id, row);
  return byUser;
}

/** One person's approval for one week, or null if there is none. */
export async function getApproval(
  userId: string,
  periodStart: string,
): Promise<WeeklyApproval | null> {
  const { data, error } = await supabase
    .from("weekly_hour_approvals")
    .select("*")
    .eq("user_id", userId)
    .eq("period_start", weekKey(periodStart))
    .maybeSingle();
  if (error) throw error;
  return (data as WeeklyApproval) ?? null;
}

/**
 * Approve (or explicitly deny) over-cap hours for one person for one week.
 * Upserts on (user_id, period_start), so re-deciding a week updates in place
 * and re-stamps approved_by/approved_at with whoever decided it just now.
 * Super admin only; RLS rejects everyone else.
 */
export async function setWeekApproval(
  userId: string,
  periodStart: string,
  approved: boolean,
  note?: string,
): Promise<WeeklyApproval> {
  const approved_by = await currentUserId();

  const rows = await mustWrite<WeeklyApproval>(
    "setWeekApproval",
    supabase.from("weekly_hour_approvals").upsert(
      {
        user_id: userId,
        period_start: weekKey(periodStart),
        approved,
        approved_by,
        // Stamped explicitly: the column default only fires on INSERT, and this
        // upsert's UPDATE path has to move the timestamp too.
        approved_at: new Date().toISOString(),
        note: note?.trim() ? note.trim() : null,
      },
      { onConflict: "user_id,period_start" },
    ),
  );
  return rows[0];
}

/**
 * Withdraw a week's approval by DELETING the row, so the week returns to the
 * same state as one that was never decided (unapproved, no stale note or
 * approver hanging around). Use setWeekApproval(..., false, note) instead when
 * you want an explicit, attributed refusal on the record.
 *
 * Returns true if a row was removed, false if there was nothing to remove.
 * The existence check is not just an optimization: a DELETE blocked by RLS also
 * reports zero rows, so without it "you are not allowed" would be silently
 * indistinguishable from "already gone".
 */
export async function clearWeekApproval(userId: string, periodStart: string): Promise<boolean> {
  const week = weekKey(periodStart);
  const existing = await getApproval(userId, week);
  if (!existing) return false;

  await mustWrite<WeeklyApproval>(
    "clearWeekApproval",
    supabase.from("weekly_hour_approvals").delete().eq("user_id", userId).eq("period_start", week),
  );
  return true;
}

// ---------------------------------------------------------------------------
// Roll-up helper
// ---------------------------------------------------------------------------

/**
 * The cap to judge a week against. A missing or unusable stored cap falls back
 * to DEFAULT_WEEKLY_HOURS_CAP — never to "unlimited", which would quietly turn
 * bad data into a clean bill of health.
 */
export function effectiveCap(cap: number | null | undefined): number {
  const limit = Number(cap);
  return Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_WEEKLY_HOURS_CAP;
}

/**
 * Did this week exceed the cap? Pure. Hours exactly ON the cap are fine; only a
 * real excess (beyond CAP_EPSILON of rounding noise) counts.
 * Unparseable hours return false — there is no overage to claim when we cannot
 * read the total; show the raw week rather than trusting this.
 */
export function overCap(hours: number, cap: number | null | undefined): boolean {
  const worked = Number(hours);
  if (!Number.isFinite(worked)) return false;
  return worked > effectiveCap(cap) + CAP_EPSILON;
}

/**
 * Over the cap AND nobody signed off on it — the flag the owner actually wants.
 * A missing approval row and an `approved: false` row both count as unapproved.
 */
export function unapprovedOvertime(
  hours: number,
  cap: number | null | undefined,
  approval: Pick<WeeklyApproval, "approved"> | null | undefined,
): boolean {
  return overCap(hours, cap) && !approval?.approved;
}

/**
 * Was this change made late enough to deserve a second look? True when the
 * change landed on an EASTERN calendar day two or more days after the day
 * worked — same-day and next-day corrections are normal, "I revised Monday on
 * Thursday" is the pattern the owner wants flagged.
 *
 * Accepts an audit row (uses `action` + `changed_at`; only 'update' counts, an
 * original 'insert' logged late is late LOGGING, not an edit) or a TimeEntry
 * (falls back to `checked_in_at`, which the DB re-stamps on every write).
 * Day arithmetic is done on Eastern calendar days via dateKeyET, never on raw
 * instants, so a 9pm ET edit doesn't count as the next day because UTC says so.
 */
export function editedAfterTheFact(
  row: {
    work_date: string;
    action?: TimeEntryAuditAction;
    changed_at?: string | null;
    checked_in_at?: string | null;
  },
): boolean {
  if (row.action && row.action !== "update") return false;
  const when = row.changed_at ?? row.checked_in_at;
  if (!when || !row.work_date) return false;

  const changedDay = dateKeyET(when); // "" when unparseable
  if (!changedDay) return false;
  const changedMs = Date.parse(`${changedDay}T00:00:00Z`);
  const workedMs = Date.parse(`${row.work_date}T00:00:00Z`);
  if (!Number.isFinite(changedMs) || !Number.isFinite(workedMs)) return false;

  return (changedMs - workedMs) / 86_400_000 >= 2;
}

/** Sum hours per user_id — feeds "weekly hours x rate = cost" in the admin view. */
export function totalHoursByUser(entries: TimeEntry[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const e of entries) {
    totals.set(e.user_id, (totals.get(e.user_id) ?? 0) + Number(e.hours));
  }
  return totals;
}
