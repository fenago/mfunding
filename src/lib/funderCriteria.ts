// ─────────────────────────────────────────────────────────────────────────────
// Funder underwriting criteria — `lenders.category.criteria`
//
// Written by the funder-criteria extraction pass off real ISO packets, rate
// sheets and (for `decline_signal`) actual decline emails. EVERY field is
// optional: older lender rows have no `criteria` key at all, and plenty of the
// funders that do have one leave individual fields null because the funder
// never published them. Nothing here may assume a value exists.
//
// Shared by the cheat sheet (/admin/cheat-sheet) and the lender catalog
// (/admin/lender-catalog) so the two surfaces can never disagree about what
// "≤4 positions" or "no defaults" means.
// ─────────────────────────────────────────────────────────────────────────────

export type FunderCriteria = {
  max_positions?: number | null;
  positions_note?: string | null;
  first_position_only?: boolean | null;
  collections_policy?: string | null;
  decline_signal?: string | null;
  min_tib_months?: number | null;
  min_monthly_revenue?: number | null;
  fico_floor?: number | null;
  max_nsf_monthly?: number | null;
  negative_days_policy?: string | null;
  restricted_industries?: string[] | null;
  restricted_states?: string[] | null;
  preferred_industries?: string[] | null;
  funding_speed?: string | null;
  factor_range?: string | null;
  remittance?: string | null;
  commission_points?: string | null;
  confidence?: string | null;
  notes?: string | null;
};

type WithCriteria = { category?: { criteria?: FunderCriteria | null } | null } | null | undefined;

/** The criteria payload, or an empty object. Never throws on a null category. */
export const criteriaOf = (l: WithCriteria): FunderCriteria => l?.category?.criteria ?? {};

/** True when the row carries any recorded criteria at all. */
export const hasCriteria = (l: WithCriteria): boolean => Object.keys(criteriaOf(l)).length > 0;

// ── Position stance ──────────────────────────────────────────────────────────
// The owner's #1 field. `max_positions` is a hard number when the funder
// published one; when it's null the truth lives in the prose `positions_note`
// ("NO MAX POSITIONS" vs "NOT PUBLISHED" vs "not a funder"), so read both.

export type PositionTone = "cap" | "deep" | "unknown" | "na";
export type PositionStance = {
  tone: PositionTone;
  /** Short, scannable label for the card/row chip. */
  label: string;
  /** Numeric ceiling when one is published. */
  max: number | null;
  /** Stacks behind anyone — no published ceiling, by policy not by omission. */
  deep: boolean;
};

// A funder that says "NO MAX POSITIONS" is deep by policy. One whose note only
// says "not published" is unknown — the difference decides whether a 4-stack
// merchant can be sent, so the two never collapse into each other.
const DEEP_RX =
  /no max(?:imum)? positions?|no maximum position count|no position cap|no published position cap|no hard (?:numeric )?cap|stack behind anyone|no cap\b/i;
// Rows that have no position box to publish at all: marketplaces and referral
// partners who route the file on, and non-MCA products.
const NA_RX =
  /\bn\/a\b|not a funder|not a direct funder|not an mca|no position box|is an aggregator|position (?:limits?|policy) (?:are|is) set by|belongs to which/i;

export const positionStance = (l: WithCriteria): PositionStance => {
  const c = criteriaOf(l);
  const note = c.positions_note ?? "";
  const max = typeof c.max_positions === "number" && Number.isFinite(c.max_positions) ? c.max_positions : null;
  if (max != null) return { tone: "cap", label: `≤ ${max} positions`, max, deep: false };
  if (NA_RX.test(note)) return { tone: "na", label: "No position box", max: null, deep: false };
  if (DEEP_RX.test(note)) return { tone: "deep", label: "Deep — no cap", max: null, deep: true };
  if (c.first_position_only === true) return { tone: "cap", label: "1st position only", max: 1, deep: false };
  return { tone: "unknown", label: "Positions not published", max: null, deep: false };
};

/**
 * Would this funder take a merchant already carrying `n` positions (i.e. we'd
 * be writing position n+1)? Only ever true off a published ceiling or an
 * explicit no-cap policy — an unrecorded box is never a yes.
 */
export const acceptsPositions = (l: WithCriteria, n: number): boolean => {
  const s = positionStance(l);
  if (s.deep) return true;
  return s.max != null && s.max >= n;
};

// ── Collections / default stance ─────────────────────────────────────────────
// Two badges only, and only when the funder's own words are unambiguous. A
// funder with a long neutral policy gets no badge rather than a guess.

export type CollectionsTone = "hard" | "open" | null;

const OPEN_RX =
  /accepts? default|tax liens? acceptable|unusually lenient|fund even with tax|delinquent merchant|defaulted and delinquent/i;
const HARD_RX =
  /hard gate|hardest gate|hard auto-decline|auto-decline|zero active defaults|0 active defaults|no previous or current default|recent default|debt collection activity|already in default/i;

export const collectionsTone = (l: WithCriteria): CollectionsTone => {
  const c = criteriaOf(l);
  const text = `${c.collections_policy ?? ""} ${c.decline_signal ?? ""}`;
  if (!text.trim()) return null;
  if (OPEN_RX.test(text)) return "open";
  if (HARD_RX.test(text)) return "hard";
  return null;
};

export const collectionsLabel = (tone: CollectionsTone): string | null =>
  tone === "hard" ? "No defaults / collections" : tone === "open" ? "Takes defaults / tax liens" : null;

// ── Small formatters shared by both surfaces ─────────────────────────────────
export const fmtRev = (n: number | null | undefined): string | null => {
  if (n == null || !Number.isFinite(n)) return null;
  return n >= 1000 ? `$${Math.round(n / 1000)}K/mo` : `$${n}/mo`;
};

export const fmtTib = (n: number | null | undefined): string | null => {
  if (n == null || !Number.isFinite(n)) return null;
  if (n === 0) return "startups OK";
  return n >= 12 && n % 12 === 0 ? `${n / 12} yr${n === 12 ? "" : "s"}` : `${n} mo`;
};

/** FICO floors are recorded as 0 where the funder explicitly doesn't screen credit. */
export const fmtFico = (n: number | null | undefined): string | null => {
  if (n == null || !Number.isFinite(n)) return null;
  return n <= 0 ? "no FICO floor" : String(n);
};

export const listOf = (v: string[] | null | undefined): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
