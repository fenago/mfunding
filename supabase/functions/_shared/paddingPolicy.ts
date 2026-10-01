// Deterministic padding policy for the bank-statement underwriter.
//
// Lives in _shared (not inside the edge function) for two reasons: it is a pure
// function of already-extracted data, so it is unit-testable without booting the
// server, and it is the intended home for the descriptor-keyed classifier that
// will take over the mechanical categories from the model.

const numOr0 = (v: unknown): number => {
  const x = typeof v === "string" ? Number(v.replace(/[^0-9.\-]/g, "")) : Number(v);
  return Number.isFinite(x) ? x : 0;
};

// ── PADDING POLICY — deterministic, code-side ────────────────────────────────
// Two rules that must NOT be left to the model. Measured 2026-10-01 over NINE
// same-input runs of MF-2026-0442 (identical 4 documents, same docs_hash, same
// extraction model) which produced EIGHT different verified revenues, while the
// reported deposit totals came back byte-identical every single time:
//
// (1) DEDUPE. The padding categories are not mutually exclusive — a $40,000
//     "Online Transfer From Personal Line of Credit" is BOTH an internal transfer
//     and a round number — so the model can legitimately list ONE transaction
//     twice. Summing the raw array then subtracts it twice. One run stripped
//     $80,000 for a single $40,000 deposit, which pushed that month's padding
//     ($98,770.19) ABOVE its deposits ($81,051.23). Collapse on (date, amount) and
//     keep the highest-priority category.
//
// (2) NOT EVERY CATEGORY MAY DEDUCT. `round_number` has no mechanical definition —
//     "suspiciously round large deposits inconsistent with sales" sets no
//     threshold, no definition of "large" and none of "inconsistent" — so the model
//     invents one per run. It ranged $0 .. $40,500 across those nine runs and was
//     the single largest source of movement in the funder-facing revenue figure. It
//     also misfires in the direction that HARMS the merchant: it stripped a $24,000
//     wire from "Oil and Gas Pro Consulting Serv" out of a DRILLING-FLUIDS
//     company's revenue — i.e. a customer paying an invoice. House doctrine: a risk
//     signal is context/watch_out, never an auto-deduction. So round_number is
//     still extracted and still SHOWN, but it never moves a dollar of revenue.
//
// Priority order is MOST MECHANICAL FIRST. A category keyed on a literal statement
// descriptor is evidence ("HIST RTN" for reversal — 11 of 11 items carried it, and
// that category returned the identical $27,855.09 in 9 of 9 runs; "ONLINE TRANSFER
// FROM" for internal_transfer). A category keyed on the model's impression of an
// amount is not.
export const PADDING_CATEGORY_PRIORITY = [
  "reversal", "internal_transfer", "same_day_in_out",
  "zelle", "venmo", "cashapp", "paypal_personal",
  "owner_deposit", "round_number",
];

/** Categories that are REPORTED but never SUBTRACTED from revenue. See (2) above. */
export const NON_DEDUCTING_PADDING_CATEGORIES = new Set(["round_number"]);

export function paddingPriority(cat: string | undefined): number {
  const i = PADDING_CATEGORY_PRIORITY.indexOf((cat ?? "").trim().toLowerCase());
  return i === -1 ? PADDING_CATEGORY_PRIORITY.length : i;
}

export interface PaddingTally {
  /** Dollars actually REMOVED from revenue (deduped, deducting categories only). */
  deducted: number;
  /** Dollars flagged for review but deliberately NOT removed (e.g. round_number). */
  flaggedOnly: number;
  deductedByCategory: Record<string, number>;
  flaggedByCategory: Record<string, number>;
  /** Duplicate (date, amount) entries collapsed, and what they'd have cost. */
  duplicatesCollapsed: number;
  duplicateDollars: number;
  /** Count of DEDUCTED items — drives the per-month true-deposit-count derivation. */
  deductedItemCount: number;
}

/** Collapse a statement's padding_deposits and split it into deducting vs
 *  flag-only money. Pure function of the extracted array — no model involved. */
export function tallyPadding(
  items: Array<{ date?: string; desc?: string; amount?: number; category?: string }> | undefined,
): PaddingTally {
  const t: PaddingTally = {
    deducted: 0, flaggedOnly: 0, deductedByCategory: {}, flaggedByCategory: {},
    duplicatesCollapsed: 0, duplicateDollars: 0, deductedItemCount: 0,
  };
  // Same money on the same day is the same credit, whichever two categories the
  // model filed it under. An UNDATED item is never collapsed: without a date two
  // equal amounts are more likely to be two real credits (e.g. the same recurring
  // $1,975.35 return in two different months) than one listed twice, and a wrong
  // merge would UNDER-state padding — the opposite error, equally wrong.
  const best = new Map<string, { amt: number; cat: string | undefined }>();
  let undated = 0;
  for (const p of items ?? []) {
    const amt = Math.abs(numOr0(p.amount));
    if (!(amt > 0)) continue;
    const date = (p.date ?? "").toString().trim();
    const key = date ? `${date}|${amt.toFixed(2)}` : `__undated_${undated++}`;
    const prev = best.get(key);
    if (!prev) { best.set(key, { amt, cat: p.category }); continue; }
    t.duplicatesCollapsed++;
    t.duplicateDollars += amt;
    // Keep whichever category is more mechanical.
    if (paddingPriority(p.category) < paddingPriority(prev.cat)) best.set(key, { amt, cat: p.category });
  }
  for (const { amt, cat } of best.values()) {
    const c = (cat ?? "uncategorized").trim().toLowerCase();
    if (NON_DEDUCTING_PADDING_CATEGORIES.has(c)) {
      t.flaggedOnly += amt;
      t.flaggedByCategory[c] = (t.flaggedByCategory[c] ?? 0) + amt;
    } else {
      t.deducted += amt;
      t.deductedItemCount++;
      t.deductedByCategory[c] = (t.deductedByCategory[c] ?? 0) + amt;
    }
  }
  return t;
}

