// DayRangeCalendar — pick a day, or a span of days, off a month grid.
//
// This replaces two <input type="date"> boxes. The owner's complaint was
// concrete: "there have been many times I'm just trying to find last Tuesday,
// and it's too hard to go into custom." A date input makes you know the DATE of
// last Tuesday; a month grid lets you see which square is a Tuesday and click
// it. That is the whole point — the weekday is the thing being looked for, and
// only a calendar shows it.
//
// One click is a complete answer. Click a day and that day is the range; click
// a second day and the span between them is. There is no Apply button and no
// half-entered state, because a range that needs two more actions to take
// effect is the friction this is replacing.
//
// Dates are LOCAL calendar days end to end, held as yyyy-mm-dd strings. Those
// sort lexicographically, so comparisons are plain string compares and no Date
// is constructed for anything but building the grid — which keeps this clear of
// the UTC-vs-local trap that makes calendar code go wrong by one day.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");
const key = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

interface Props {
  /** Current range, inclusive, as local yyyy-mm-dd. */
  from: string;
  to: string;
  /** Called with an inclusive local yyyy-mm-dd pair, already ordered. */
  onPick: (from: string, to: string) => void;
  onClose: () => void;
  /** Latest selectable day (today). Future days hold no data to report on. */
  maxDay: string;
  /** Which edge the panel hangs from. A control sitting on the right of its row
   *  needs "right", or a 288px panel opens off the edge of a narrow window. */
  align?: "left" | "right";
}

export default function DayRangeCalendar({ from, to, onPick, onClose, maxDay, align = "left" }: Props) {
  const panel = useRef<HTMLDivElement>(null);

  // The first click of a two-click range. Null means the next click starts one.
  const [anchor, setAnchor] = useState<string | null>(null);

  const [view, setView] = useState(() => {
    const [y, m] = from.split("-").map(Number);
    return { y: y || new Date().getFullYear(), m: (m || 1) - 1 };
  });

  // Escape closes, and so does a click anywhere outside. Both are expected of a
  // panel like this; neither is a browser dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  // Leading blanks so the 1st lands under its real weekday, then the days.
  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1).getDay();
    const days = new Date(view.y, view.m + 1, 0).getDate();
    const out: (string | null)[] = Array(first).fill(null);
    for (let d = 1; d <= days; d++) out.push(key(view.y, view.m, d));
    return out;
  }, [view]);

  const step = (by: number) => {
    const m = view.m + by;
    setView({ y: view.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 });
  };

  const pick = (day: string) => {
    if (anchor === null) {
      setAnchor(day);
      onPick(day, day); // a single click is already a complete, applied answer
    } else {
      const [a, b] = anchor <= day ? [anchor, day] : [day, anchor];
      setAnchor(null);
      onPick(a, b);
    }
  };

  const todayKey = maxDay;
  const monthLabel = `${MONTHS[view.m]} ${view.y}`;

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Pick a day or a span of days"
      // ⚠ THIS PANEL RENDERED TRANSPARENT IN LIGHT MODE UNTIL 2026-09-29, and
      // the reason is worth writing down: it was styled `bg-base-100
      // border-base-300`, and THIS PROJECT DOES NOT LOAD DAISYUI. Tailwind v4
      // needs an explicit `@plugin "daisyui"` in src/index.css and there isn't
      // one, so every base-* utility compiles to nothing (grep the built CSS:
      // zero occurrences of `base-100`). Cards elsewhere look right only
      // because src/index.css defines its own `.card`. Here there was no
      // background at all, so the page heading, the intro copy and the tab
      // strip showed straight through the day grid. Real Tailwind colours
      // only, in both themes — and `z-50` so nothing on the page overlaps it.
      // `top-full` is NOT decoration. Both callers put this inside a flex row
      // with `items-center`, and a flex container ALIGNS THE STATIC POSITION OF
      // AN ABSOLUTE CHILD — so with `top` left to auto the panel centred itself
      // on the row and computed to top: -121.75px, i.e. it hung upwards over
      // the page heading. Measured live on the deployed page; that vertical
      // float is half of what "look how ridiculous it looks" was about, and the
      // opaque background alone did not fix it. Anchor it to the bottom edge of
      // the row and it can only ever open downwards.
      className={`absolute top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white p-3 shadow-2xl ${
        align === "right" ? "right-0" : "left-0"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label="Previous month"
          className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
        >
          <ChevronLeftIcon className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold text-gray-900 dark:text-white">{monthLabel}</span>
        <button
          type="button"
          onClick={() => step(1)}
          aria-label="Next month"
          className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
        >
          <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-center text-[10px] font-medium text-gray-400 dark:text-gray-500 py-0.5">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (!day) return <div key={`b${i}`} />;
          const future = day > todayKey;
          const inSpan = day >= from && day <= to;
          const isEdge = day === from || day === to;
          const isAnchor = day === anchor;
          const isToday = day === todayKey;
          const label = Number(day.slice(8));

          return (
            <button
              key={day}
              type="button"
              disabled={future}
              onClick={() => pick(day)}
              aria-pressed={inSpan}
              title={
                future
                  ? "No data for a day that hasn't happened"
                  : anchor
                    ? "Click to end the span here"
                    : "Click for this day, then another day for a span"
              }
              className={`h-8 rounded-md text-xs tabular-nums transition-colors ${
                future
                  ? "text-gray-300 dark:text-gray-600 cursor-not-allowed"
                  : isEdge || isAnchor
                    ? "bg-mint-green text-gray-900 font-semibold"
                    : inSpan
                      ? "bg-mint-green/30 text-gray-900 dark:text-white"
                      // hover:bg-base-200 was dead for the same reason as the
                      // panel's own background — no DaisyUI, no utility.
                      : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              } ${isToday && !isEdge && !isAnchor ? "ring-1 ring-ocean-blue" : ""}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
        {anchor
          ? "Now click the last day of the span — or click the same day again to keep it to one."
          : "Click a day. Click a second for a span."}
      </p>
    </div>
  );
}
