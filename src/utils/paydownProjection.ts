// Paydown projection math for the post-funding renewal tracker.
//
// Everything here is an ESTIMATE and the UI must frame it that way ("may
// qualify", "estimated", "around {date}"). We never promise a renewal or a
// specific qualification date — this is a reassuring forward look, not a term.
//
// COMPLIANCE: MCA-family only. Copy that consumes these numbers uses
// "additional capital" / "funding" language, never "loan".

/** Renewal milestones, in ascending order. */
export const PAYDOWN_MILESTONES = [40, 60, 75, 100] as const;
export type PaydownMilestone = (typeof PAYDOWN_MILESTONES)[number];

/** Short label shown at each checkpoint on the progress bar. */
export const MILESTONE_LABEL: Record<PaydownMilestone, string> = {
  40: "You may qualify for additional capital",
  60: "Renewal options typically improve",
  75: "Often the best time to renew",
  100: "Paid in full 🎉",
};

/** Natural-language phrase for the headline projection, e.g.
 *  "≈ 45 days until {phrase}". Kept lowercase to slot mid-sentence. */
export const MILESTONE_PROJECTION_PHRASE: Record<PaydownMilestone, string> = {
  40: "you may qualify for additional capital",
  60: "your renewal options typically improve",
  75: "you reach the point that's often best to renew",
  100: "you're paid in full",
};

/** The next milestone strictly above the current paydown %, or null once the
 *  merchant is at/over 100%. */
export function nextMilestone(paydownPct: number): PaydownMilestone | null {
  for (const m of PAYDOWN_MILESTONES) {
    if (paydownPct < m) return m;
  }
  return null;
}

export type RemittanceFrequency = "daily" | "weekly";

export interface ProjectionInputs {
  /** Current paydown percentage (0–100) — the value the UI is displaying. */
  paydownPct: number | null | undefined;
  /** Total amount to be repaid (advance × factor). */
  paybackAmount: number | null | undefined;
  /** Amount debited each remittance. */
  remittanceAmount: number | null | undefined;
  /** How often the debit happens. */
  remittanceFrequency: RemittanceFrequency | null | undefined;
}

export interface Projection {
  milestone: PaydownMilestone;
  /** Whole calendar days from today until the projected date. */
  days: number;
  /** The projected local date the milestone is reached. */
  date: Date;
}

/** Add N business days (Mon–Fri) to a date. N counts only weekdays. */
export function addBusinessDays(from: Date, businessDays: number): Date {
  const d = new Date(from.getTime());
  let remaining = Math.max(0, Math.ceil(businessDays));
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay(); // 0 Sun … 6 Sat
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return d;
}

/** Whole calendar days between two dates (ceil, never negative). */
function calendarDaysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/**
 * Project when the deal will reach the next paydown milestone, from the
 * remittance schedule. Returns null when we lack the fields to project (the UI
 * then shows the paydown % alone, with no projection). Daily remittances are
 * modeled Mon–Fri; weekly as calendar weeks.
 */
export function projectNextMilestone(
  inputs: ProjectionInputs,
  now: Date = new Date(),
): Projection | null {
  const paydown = inputs.paydownPct ?? 0;
  const milestone = nextMilestone(paydown);
  if (milestone == null) return null; // already paid in full

  const { paybackAmount, remittanceAmount, remittanceFrequency } = inputs;
  if (
    !paybackAmount ||
    paybackAmount <= 0 ||
    !remittanceAmount ||
    remittanceAmount <= 0 ||
    (remittanceFrequency !== "daily" && remittanceFrequency !== "weekly")
  ) {
    return null;
  }

  // Dollars still to be paid before the milestone is reached.
  const remainingToMilestone = paybackAmount * ((milestone - paydown) / 100);
  if (remainingToMilestone <= 0) {
    // Already at/past this milestone by dollars — treat as reached today.
    return { milestone, days: 0, date: new Date(now.getTime()) };
  }

  const remittancesNeeded = Math.ceil(remainingToMilestone / remittanceAmount);

  const date =
    remittanceFrequency === "daily"
      ? addBusinessDays(now, remittancesNeeded)
      : new Date(now.getTime() + remittancesNeeded * 7 * 24 * 60 * 60 * 1000);

  return { milestone, days: calendarDaysBetween(now, date), date };
}
