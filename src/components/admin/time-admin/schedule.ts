/**
 * View-model helpers for the expected schedule and the weekly hour cap.
 *
 * The service owns the rules (`effectiveCap`, `overCap`, `unapprovedOvertime`)
 * and `listStaffWithRates()` already flattens the schedule columns onto the
 * staff row with the cap pre-defaulted. This file only shapes those columns for
 * the table and keeps the optimistic patch honest.
 *
 * One distinction worth holding on to: `weekly_hours_cap` is never null, so it
 * cannot tell you whether the owner actually chose 40 or simply never set
 * anything. `rate === null` is what says "nothing is stored for this person",
 * and that is what the UI labels as the default.
 */

import {
  DEFAULT_WEEKLY_HOURS_CAP,
  type ScheduleInput,
  type StaffWithRate,
  type WeeklyApproval,
} from "@/services/timeTracking";

export interface Schedule {
  /** Hours a normal week should come to. null = never set; render a dash, not 0. */
  expectedWeeklyHours: number | null;
  /** The threshold in force — already defaulted by the service. */
  cap: number;
  /** false when nothing is stored for this person, so `cap` is the house default. */
  capStored: boolean;
  /** "Mon–Fri 9:00–5:00 ET". null = never set. */
  scheduleNote: string | null;
}

export function scheduleOf(s: StaffWithRate): Schedule {
  return {
    expectedWeeklyHours: s.expected_weekly_hours,
    cap: s.weekly_hours_cap,
    capStored: s.rate != null,
    scheduleNote: s.schedule_note?.trim() ? s.schedule_note.trim() : null,
  };
}

/** Hours worked past the cap, at payroll precision. 0 when the week is inside it. */
export function overageHours(hours: number, cap: number): number {
  const over = (Number(hours) || 0) - cap;
  return over > 0 ? Math.round(over * 100) / 100 : 0;
}

/**
 * Approved means the row says so. A row with `approved: false` is an explicit
 * denial, which reads the same as no row at all — this matches the service's
 * unapprovedOvertime(), and the two must not drift apart or a denied week would
 * show a green badge over a red total.
 */
export function isApproved(a: WeeklyApproval | null | undefined): boolean {
  return a?.approved === true;
}

/**
 * Optimistic local patch of the schedule columns. Both copies the service
 * returns — flattened on the staff row and nested under `.rate` — move
 * together, so the edit does not appear to revert on the next read.
 */
export function applySchedulePatch(s: StaffWithRate, patch: ScheduleInput): StaffWithRate {
  const next: StaffWithRate = { ...s };

  if (patch.expectedWeeklyHours !== undefined) {
    next.expected_weekly_hours = patch.expectedWeeklyHours;
  }
  if (patch.weeklyHoursCap !== undefined) {
    // A cleared cap RESETS to the house default rather than clearing — a person
    // always has a cap, and the service stores it that way too.
    next.weekly_hours_cap = patch.weeklyHoursCap ?? DEFAULT_WEEKLY_HOURS_CAP;
  }
  if (patch.scheduleNote !== undefined) {
    next.schedule_note = patch.scheduleNote?.trim() ? patch.scheduleNote.trim() : null;
  }

  if (s.rate) {
    next.rate = {
      ...s.rate,
      expected_weekly_hours: next.expected_weekly_hours,
      weekly_hours_cap: next.weekly_hours_cap,
      schedule_note: next.schedule_note,
    };
  }
  return next;
}
