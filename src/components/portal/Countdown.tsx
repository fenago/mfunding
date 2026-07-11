import { useEffect, useState } from "react";
import { ClockIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { parseDeadline } from "../../utils/deadline";

interface CountdownProps {
  /** Target moment — ISO string or Date. */
  target: string | Date;
  /** Prefix label, e.g. "Bank statements due". */
  label?: string;
  /** Copy shown once the target has passed. Defaults to "{label} — overdue". */
  overdueLabel?: string;
  /**
   * Visual weight. "urgent" = amber attention (stips deadline), "soft" =
   * quiet/reassuring (offer expiry with lots of runway), "neutral" = plain.
   */
  variant?: "urgent" | "soft" | "neutral";
  className?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "1 day 4 hrs", "6 hrs 12 min", "14 min" — most-significant two units. */
function fmtRemaining(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hrs = Math.floor((totalMin % (60 * 24)) / 60);
  const min = totalMin % 60;
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} ${hrs} hr${hrs === 1 ? "" : "s"}`;
  if (hrs > 0) return `${hrs} hr${hrs === 1 ? "" : "s"} ${min} min`;
  return `${min} min`;
}

/**
 * Live-ticking countdown to a target moment. When the target is more than a
 * week out it degrades to just the date (no need to watch seconds tick for a
 * two-week deadline). Within a week it counts down live and re-renders each
 * minute; once passed it shows an overdue state.
 *
 * Designed so the Wave-2 offer-expiry clock drops straight in (same props).
 */
export default function Countdown({
  target,
  label,
  overdueLabel,
  variant = "neutral",
  className = "",
}: CountdownProps) {
  // Bare 'YYYY-MM-DD' deadlines (e.g. stips_promised_by, a SQL date) resolve to
  // local end-of-day so "due today" doesn't read as overdue in the morning.
  const targetMs = parseDeadline(target).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Only tick when we're actually counting down live (within a week).
    if (targetMs - Date.now() > WEEK_MS) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [targetMs]);

  if (Number.isNaN(targetMs)) return null;

  const remaining = targetMs - now;
  const isOverdue = remaining <= 0;
  const isFarOut = remaining > WEEK_MS;

  const tone =
    isOverdue || variant === "urgent"
      ? isOverdue
        ? "text-red-700 dark:text-red-300"
        : "text-amber-700 dark:text-amber-300"
      : variant === "soft"
        ? "text-gray-600 dark:text-gray-300"
        : "text-gray-700 dark:text-gray-200";

  const Icon = isOverdue ? ExclamationTriangleIcon : ClockIcon;

  let text: string;
  if (isOverdue) {
    text = overdueLabel ?? `${label ? `${label} — ` : ""}overdue`;
  } else if (isFarOut) {
    const target_ = new Date(targetMs);
    text = `${label ? `${label}: ` : ""}${fmtDate(target_)}`;
  } else {
    text = `${label ? `${label} in ` : ""}${fmtRemaining(remaining)}`;
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${tone} ${className}`}>
      <Icon className="w-4 h-4 flex-shrink-0" />
      {text}
    </span>
  );
}
