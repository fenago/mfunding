// ChaseTracker (MiniTracker) — a 14-day chase tracker sized to live inside a
// list row: one cell per day since the clock started, green with a count where
// the merchant was called, light red for an elapsed day with none, grey for days
// not yet reached.
//
// EXTRACTED from HotLeadsPanel (2026-09-17). The processor's application-chase
// queue needs the identical widget — the owner asked for "the 14 day countdown
// and basically all of the things that are in the Hot Realtime Leads tab" — and
// a copy-paste would be the fifth lockstep duplicate this codebase has had to
// unpick. Same arithmetic, same window, same "day 1 = the clock started" rule as
// TouchTracker in ProcessorDetailDrawer.
//
// THE DAY -1 FOLD is deliberate and matches the drawer: a WAVV call that ends in
// "Appointment Set" MINTS the deal, so the call that created the lead is stamped
// minutes BEFORE the deal row exists. Without the fold, day 1 shows red over the
// very call that produced the merchant.
//
// NEVER DRAWN FROM AN UNREADABLE HISTORY. Callers render this only when they
// hold real calls — a tracker built from a failed read would paint fourteen red
// days over a merchant somebody called every morning.

import type { CallEvent } from "@/lib/callHistory";

export const TRACKER_DAYS = 14;
const DAY_MS = 24 * 3_600_000;

interface Props {
  /** When the 14 days started. The lead's arrival on a hot lead; the day the
   *  application went out on the processor's chase queue. */
  startAt: string;
  calls: CallEvent[];
  /** What the clock is counting, for the trailing label: "14-day chase". */
  label?: string;
}

export default function ChaseTracker({ startAt, calls, label = "14-day chase" }: Props) {
  const started = Date.parse(startAt);
  const now = Date.now();
  const elapsed = Math.floor((now - started) / DAY_MS);
  const counts = new Array(TRACKER_DAYS).fill(0) as number[];
  for (const c of calls) {
    let idx = Math.floor((Date.parse(c.at) - started) / DAY_MS);
    if (idx === -1) idx = 0; // the day -1 fold — see the header comment.
    if (idx >= 0 && idx < TRACKER_DAYS) counts[idx] += 1;
  }
  const missed = counts.filter((c, i) => i <= Math.min(elapsed, TRACKER_DAYS - 1) && c === 0).length;
  const daysLeft = TRACKER_DAYS - elapsed;

  return (
    <div className="mt-1 flex items-center gap-1.5">
      <div className="flex gap-[2px]">
        {counts.map((c, i) => {
          const future = i > elapsed;
          const today = i === elapsed && elapsed < TRACKER_DAYS;
          const cls = future
            ? "bg-gray-100 dark:bg-gray-800"
            : c > 0
              ? "bg-emerald-500 text-white"
              : "bg-red-100 text-red-400 dark:bg-red-900/30 dark:text-red-400";
          return (
            <div
              key={i}
              title={`Day ${i + 1}${today ? " (today)" : ""} — ${
                future ? "not reached yet" : c > 0 ? `${c} call${c === 1 ? "" : "s"}` : "no calls"
              }`}
              className={`w-3 h-3.5 rounded-[2px] flex items-center justify-center text-[8px] font-bold leading-none ${cls} ${
                today ? "ring-1 ring-ocean-blue" : ""
              }`}
            >
              {future ? "" : c > 0 ? c : ""}
            </div>
          );
        })}
      </div>
      <span className="text-[10px] text-gray-500 dark:text-gray-400 shrink-0">
        {label}
        {missed > 0 && elapsed < TRACKER_DAYS
          ? ` · ${missed} silent day${missed === 1 ? "" : "s"}`
          : ""}
        {elapsed >= TRACKER_DAYS ? " · 14 days up" : daysLeft <= 3 ? ` · ${daysLeft}d left` : ""}
      </span>
    </div>
  );
}
