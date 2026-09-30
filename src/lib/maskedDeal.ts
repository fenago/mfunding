// ─────────────── maskedDeal: a field the money wall WITHHELD ───────────────
//
// THE FOURTH SIBLING. `src/lib/readable.ts` names three failures its
// `Readable<T>` cannot see. This is the fourth, and it is the strangest: the
// read succeeds, the payload is well-formed, the value is `null`, and the null
// is CORRECT AND AUTHORIZED. It just doesn't mean what it looks like.
//
// `deal_row_for_caller` masks the money columns for a staff reader who is not
// ops-staff, the creator, or the assigned closer. It does not OMIT them — it
// writes JSON null over all eighteen. So downstream:
//
//     'amount_requested' in deal   -> true      presence checks PASS
//     deal.x === undefined          -> false     undefined guards SAIL THROUGH
//     deal.x ?? 0                   -> 0         coalescing FIRES
//     deal.x || 0                   -> 0         ditto
//     Number(deal.x)                -> 0
//     !deal.x                       -> true
//
// Read that second group twice, because it is the opposite of the intuition and
// it was briefed backwards once already: `??` and `||` DO fire on null. Adding a
// fallback is therefore not a fix — **it is the mechanism** that converts "you
// may not know this" into a confident zero. A consumer must learn the field was
// WITHHELD before it coalesces, and no amount of defensive defaulting can tell
// it that. Hence a marker, not a sentinel: a sentinel value is one more thing to
// forget to check, which is how we got here.
//
// Measured consequences on 2026-09-30, all from this one null:
//   • the funder scorer's `if (dealProfile.amount_requested)` skipped the whole
//     amount-range check, so funders whose box the real ask would FAIL came back
//     on the shortlist with a clean score and no "outside typical range" chip;
//   • QuickAppModal seeded a blank ask and wrote `amount_requested: null` into
//     `mca_applications` — the row that reaches funders and e-sign;
//   • FunderPicker read a masked `ai_lender_recommendations` as "never run" and
//     offered to re-run a paid LLM call.
//
// ⚠️ NAMING A WITHHELD FIELD IS NOT DISCLOSING IT. Nothing here reveals the
// value, its magnitude, or a bucket — only that the wall holds one. Keep it that
// way: a helper that said "over $50k, hidden" would be a hole in the wall.

import type { DealWithCustomer } from "@/types/deals";

/** The eighteen columns `deal_money_keys()` masks. Kept in the order the SQL
 *  returns them so the two are diffable by eye; the SERVER is the source of
 *  truth and this list is only for typing call sites. */
export const MASKED_KEYS = [
  "ai_lender_recommendations",
  "ai_recommended_at",
  "amount_funded",
  "amount_requested",
  "balance_override",
  "expected_value",
  "lead_grade",
  "lead_qual",
  "lead_score",
  "mca_score",
  "payback_amount",
  "paydown_percentage",
  "remittance_amount",
  "score_reasons",
  "score_version",
  "scored_at",
  "vcf_daily_debit",
  "vcf_total_balance",
] as const;

export type MaskedKey = (typeof MASKED_KEYS)[number];

/** A deal as the RPC returns it: the row plus the wall's own declaration of what
 *  it withheld. `masked_fields` is ALWAYS present on an RPC row — `[]` when the
 *  caller is privileged — so "absent" is not a state the server can produce. */
export type MaskAwareDeal = Partial<Record<MaskedKey, unknown>> & {
  masked_fields?: string[] | null;
};

/**
 * What a consumer gets back. There is no third arm to forget: you either have a
 * value (which may itself be legitimately null — "we can see it, and it is
 * unset") or the wall withheld it, and TypeScript will not let you reach
 * `.value` without saying which.
 */
export type DealField<T> =
  | { kind: "value"; value: T | null }
  | { kind: "withheld"; field: MaskedKey };

/**
 * TRUE when the wall withheld this field from the current reader.
 *
 * ── ON AN ABSENT `masked_fields`, WHICH IS THE ONE JUDGEMENT CALL HERE ──
 * A row with no `masked_fields` did not come from `deal_row_for_caller`; it came
 * from a direct `supabase.from("deals").select()`. Those are row-filtered by
 * RLS — you either get the whole row or no row — so a row you are holding is one
 * you are allowed to see in full, and its nulls are real. Absent therefore means
 * NOT MASKED, and that is a claim about RLS, not an assumption about the payload.
 *
 * If that ever stops being true — if some future read returns partial columns —
 * this function is where it breaks, and it should start returning `true` (the
 * safe direction: claim ignorance rather than assert a number).
 */
export function isWithheld(deal: MaskAwareDeal | null | undefined, field: MaskedKey): boolean {
  const list = deal?.masked_fields;
  if (!Array.isArray(list)) return false;
  return list.includes(field);
}

/**
 * Read one of the eighteen. THIS IS THE ONLY SUPPORTED WAY — a bare
 * `deal.amount_requested` cannot tell a withheld null from a real one, and being
 * a named call site is what makes the bare access lintable.
 *
 *     const ask = dealField<number>(deal, "amount_requested");
 *     if (ask.kind === "withheld") return <span>Hidden — not your deal</span>;
 *     if (ask.value == null) return <span>No ask on file yet</span>;
 *     return <span>{money(ask.value)}</span>;
 */
export function dealField<T = unknown>(
  deal: (MaskAwareDeal & Record<string, unknown>) | null | undefined,
  field: MaskedKey,
): DealField<T> {
  if (isWithheld(deal, field)) return { kind: "withheld", field };
  return { kind: "value", value: ((deal?.[field] ?? null) as T | null) };
}

/** Convenience for the common `DealWithCustomer` call site, so consumers don't
 *  each write their own cast to reach `masked_fields`. */
export function dealFieldOf<T = unknown>(
  deal: DealWithCustomer | null | undefined,
  field: MaskedKey,
): DealField<T> {
  return dealField<T>(deal as unknown as (MaskAwareDeal & Record<string, unknown>) | null, field);
}

/** Every field withheld from this reader — for a one-line panel note rather than
 *  eighteen separate "hidden" markers. Empty when nothing is withheld. */
export function withheldFields(deal: MaskAwareDeal | null | undefined): MaskedKey[] {
  const list = deal?.masked_fields;
  if (!Array.isArray(list)) return [];
  return MASKED_KEYS.filter((k) => list.includes(k));
}

/**
 * The sentence a surface shows in place of a withheld number.
 *
 * ── A GUARD THAT ONLY SAYS "NO" TEACHES PEOPLE TO ROUTE AROUND IT ──────────
 * Three of 2026-09-30's incidents were an agent meeting a refusal that was
 * doing its job and reaching for a bigger hammer. The first person who hits
 * `kind: "withheld"` will be tempted to cast past it, `?? 0` it, or open a
 * second unmasked read — so both of these strings say what to DO instead, not
 * just that something is missing. Keep it that way if you reword them.
 *
 * Never includes the value or any hint of its size.
 */
export function withheldNote(field: MaskedKey): string {
  return (
    `Hidden — this deal isn't assigned to you, so ${field.replace(/_/g, " ")} isn't shown. ` +
    `This is not "none on file": show a dash, don't compute with it. ` +
    `Ask the assigned closer or an admin if you need the figure.`
  );
}

/**
 * What a DEVELOPER should do at a call site that just got `withheld`. Exported
 * so the guidance lives next to the guard rather than in a review comment
 * somebody has to remember.
 *
 * Render `—` (or `withheldNote`) and skip the calculation. Do NOT:
 *   • `?? 0` / `|| 0` it — that is the exact line that produced every bug this
 *     module exists to stop; coalescing FIRES on a masked null;
 *   • cast the deal to reach the raw field;
 *   • fetch the same deal through another read hoping for a fuller row — if the
 *     wall withheld it, that is the answer, and routing around it is a
 *     permissions decision no consumer gets to make on its own.
 */
export const WITHHELD_DEV_GUIDANCE =
  "Render a dash and skip the computation. Do not coalesce (`?? 0` fires on this null), do not cast past it, and do not re-read the deal another way — the wall's answer is the answer.";

/**
 * TRUE when the reader can see enough to do arithmetic on these fields at all.
 *
 * For a caller that would otherwise total, score, threshold or grade across
 * several of the eighteen: one withheld input makes the whole figure a claim
 * with a hole in it, exactly as `allReadable` treats a mixed set of reads.
 * Prefer showing nothing over showing a total computed from a partial set.
 */
export function canComputeOn(
  deal: MaskAwareDeal | null | undefined,
  fields: readonly MaskedKey[],
): boolean {
  return !fields.some((f) => isWithheld(deal, f));
}
