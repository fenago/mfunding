/**
 * Turns raw time_entry audit rows into the sentences the owner actually wants:
 * "Hours 2h → 4h, changed 4 days later".
 *
 * Pure functions only — the rendering lives in EditHistory.tsx.
 *
 * The one rule this file exists to enforce: an audit row that we cannot read as
 * a change is never silently dropped into "nothing happened". describeChanges()
 * returns an explicit "(changed)" entry when an update row's before/after are
 * indistinguishable, because an update row EXISTS — somebody touched the entry —
 * and a payroll screen must not hide that behind an empty list.
 */

import type { TimeEntryAudit } from "@/services/timeTracking";
import {
  clockTime,
  daysAfterWorkDate,
  formatHours,
  lateTone,
  minutesLabel,
  type LateTone,
} from "./format";

export type AuditField = "hours" | "clock_in" | "clock_out" | "break_minutes" | "note" | "unknown";

export interface AuditChange {
  field: AuditField;
  label: string;
  from: string;
  to: string;
  /** Hours only: +2 when hours went UP after the fact — the abuse signal. */
  deltaHours?: number;
}

/** Numeric columns can arrive as strings from PostgREST; null stays null. */
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function instantMs(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

function hoursText(v: number | null): string {
  return v == null ? "—" : formatHours(v);
}

function breakText(v: number | null): string {
  return v == null ? "—" : v === 0 ? "none" : minutesLabel(v);
}

function noteText(v: string | null): string {
  const s = (v ?? "").trim();
  if (!s) return "(blank)";
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

/** Every field that actually moved on one audit row, in reading order. */
export function describeChanges(a: TimeEntryAudit): AuditChange[] {
  const out: AuditChange[] = [];

  if (a.action === "delete") {
    // A vanished day is louder than an edited one — the generic field diff would
    // render it as a pile of "4h → —" lines and bury the fact.
    return [
      {
        field: "unknown",
        label: "Day deleted",
        from: hoursText(num(a.old_hours)),
        to: "removed",
        deltaHours: num(a.old_hours) == null ? undefined : -(num(a.old_hours) as number),
      },
    ];
  }

  const oldH = num(a.old_hours);
  const newH = num(a.new_hours);
  if (oldH !== newH) {
    out.push({
      field: "hours",
      label: "Hours",
      from: hoursText(oldH),
      to: hoursText(newH),
      deltaHours: oldH != null && newH != null ? newH - oldH : undefined,
    });
  }

  const inFrom = instantMs(a.old_clock_in);
  const inTo = instantMs(a.new_clock_in);
  if (inFrom !== inTo) {
    out.push({
      field: "clock_in",
      label: "Clock in",
      from: clockTime(a.old_clock_in),
      to: clockTime(a.new_clock_in),
    });
  }

  const outFrom = instantMs(a.old_clock_out);
  const outTo = instantMs(a.new_clock_out);
  if (outFrom !== outTo) {
    out.push({
      field: "clock_out",
      label: "Clock out",
      from: clockTime(a.old_clock_out),
      to: clockTime(a.new_clock_out),
    });
  }

  const oldB = num(a.old_break_minutes);
  const newB = num(a.new_break_minutes);
  if (oldB !== newB) {
    out.push({
      field: "break_minutes",
      label: "Break",
      from: breakText(oldB),
      to: breakText(newB),
    });
  }

  if ((a.old_note ?? "") !== (a.new_note ?? "")) {
    out.push({
      field: "note",
      label: "Note",
      from: noteText(a.old_note),
      to: noteText(a.new_note),
    });
  }

  if (out.length === 0) {
    // The row is real even if the diff reads clean — say so rather than vanish.
    out.push({ field: "unknown", label: "Entry", from: "", to: "(changed)" });
  }
  return out;
}

/** An audit row with everything the UI needs precomputed. */
export interface EditEvent {
  audit: TimeEntryAudit;
  changes: AuditChange[];
  /** Calendar days between the day worked and the day the change landed. */
  daysLate: number | null;
  tone: LateTone;
  /** Net hours movement on this edit — positive means hours were added later. */
  hoursDelta: number | null;
  isLate: boolean;
}

export function toEditEvent(a: TimeEntryAudit): EditEvent {
  const changes = describeChanges(a);
  const daysLate = daysAfterWorkDate(a.work_date, a.changed_at);
  const tone = lateTone(daysLate);
  const hoursChange = changes.find((c) => c.field === "hours");
  return {
    audit: a,
    changes,
    daysLate,
    tone,
    hoursDelta: hoursChange?.deltaHours ?? null,
    isLate: tone === "late" || tone === "very-late",
  };
}

/**
 * Everything that happened to an entry AFTER it was first logged, newest first.
 * Deletes count: an entry that was logged and then removed is a bigger deal than
 * one that was edited, and filtering to 'update' alone would hide it completely.
 */
export function editEvents(rows: TimeEntryAudit[]): EditEvent[] {
  return rows
    .filter((a) => a.action === "update" || a.action === "delete")
    .map(toEditEvent)
    .sort((x, y) => (y.audit.changed_at || "").localeCompare(x.audit.changed_at || ""));
}

/** entry id → when it was FIRST logged (the insert row), not when last touched. */
export function firstLoggedByEntry(rows: TimeEntryAudit[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of rows) {
    // time_entry_id goes null when the entry is hard-deleted (the audit row
    // outlives it), and a first-logged time keyed to a vanished entry has
    // nothing to attach to — skip rather than key the map on "null".
    if (a.action !== "insert" || !a.changed_at || !a.time_entry_id) continue;
    const prev = m.get(a.time_entry_id);
    if (!prev || a.changed_at < prev) m.set(a.time_entry_id, a.changed_at);
  }
  return m;
}

export function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = m.get(k);
    if (list) list.push(row);
    else m.set(k, [row]);
  }
  return m;
}

export interface EditSummary {
  total: number;
  late: number;
  /** Net hours added by edits that landed 2+ days after the day worked. */
  lateHoursAdded: number;
  worstTone: LateTone;
}

export function summarize(events: EditEvent[]): EditSummary {
  let late = 0;
  let lateHoursAdded = 0;
  let worstTone: LateTone = "ok";
  for (const e of events) {
    if (e.isLate) {
      late++;
      if (e.hoursDelta && e.hoursDelta > 0) lateHoursAdded += e.hoursDelta;
      if (e.tone === "very-late") worstTone = "very-late";
      else if (worstTone !== "very-late") worstTone = "late";
    }
  }
  return { total: events.length, late, lateHoursAdded, worstTone };
}
