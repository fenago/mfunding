// positionsSource — shared precedence rule for a deal's "existing MCA positions"
// provenance (deals.existing_positions* + mca_score).
//
// A merchant's existing-positions data can come from several sources of differing
// trust. A LOWER-trust writer must never clobber a HIGHER-trust value. Every
// function that writes existing_positions/existing_funders/existing_positions_detail
// (and the paired mca_score) MUST honor these ranks so the writers compose safely.
//
//   manual / application  (a human typed it)        = 3  — highest trust
//   bank_statements       (underwriter, verified)   = 2
//   ucc                   (UCC estimate)            = 1
//   null / '' / unknown   (never set)               = 0
//
// RULE: a writer at rank R may write ONLY when the deal's CURRENT source rank <= R.
// So a UCC writer (rank 1) may write over null or 'ucc', but NEVER over
// 'bank_statements' / 'manual' / 'application'.
//
// The write itself must ALSO carry a race-safe DB guard (e.g. filter the UPDATE by
// the acceptable current sources) — canWrite() is the in-code intent; the DB filter
// makes it atomic against a concurrent higher-trust write.

export const POSITIONS_SOURCE_RANK: Record<string, number> = {
  manual: 3,
  application: 3,
  bank_statements: 2,
  ucc: 1,
};

/** Rank of an existing_positions_source value (null/empty/unknown → 0). */
export function sourceRank(source: string | null | undefined): number {
  if (source == null) return 0;
  const s = String(source).trim().toLowerCase();
  if (s === "") return 0;
  return POSITIONS_SOURCE_RANK[s] ?? 0;
}

/** May a writer whose own rank is `incomingRank` overwrite a deal whose current
 * source is `currentSource`? True iff current rank <= incoming rank. */
export function canWrite(currentSource: string | null | undefined, incomingRank: number): boolean {
  return sourceRank(currentSource) <= incomingRank;
}

/** Rank of a UCC writer. Convenience constant so UCC callers read clearly. */
export const UCC_RANK = POSITIONS_SOURCE_RANK.ucc; // 1

/** The set of existing_positions_source values a UCC writer (rank 1) is allowed to
 * overwrite: null (unset) or 'ucc'. Use for the race-safe DB UPDATE guard, e.g.
 *   .or("existing_positions_source.is.null,existing_positions_source.eq.ucc")
 * The string form is exported so the filter and the in-code check never drift. */
export const UCC_OVERWRITABLE_OR_FILTER =
  "existing_positions_source.is.null,existing_positions_source.eq.ucc";
