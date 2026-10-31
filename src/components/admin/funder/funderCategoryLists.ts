// ─────────────────────────────────────────────────────────────────────────────
// "Which industry-category list do we hold for this funder?"
//
// The industry-match gate (IndustryMatchGate.tsx) is NOT a Bitty component. It
// fires for any funder whose submission recipe sets `requires_industry_match`,
// and that flag is a one-row update — so the gate must never resolve a funder
// by hard-coded id. It asks this registry instead, and gets one of two honest
// answers:
//
//   • a FunderCategoryList — we hold their category book, so the control can
//     suggest values and show the tier each one sits in.
//   • null — we hold NO list for this funder. The gate says exactly that and
//     takes free text. An absent list must never render as an empty one: a
//     closer shown a blank suggestion box reads it as "this funder has no
//     restrictions", which is the opposite of what we know (we know nothing).
//
// WHAT A LIST IS AND IS NOT. These are OUR transcription of a funder's
// published underwriting guide. They tell you the tier and the kill-list. They
// are NOT that funder's application dropdown, and at submit time the dropdown
// is the authority — see `dropdownCaveat`, which is printed in the UI rather
// than left as a comment here, because the person typing is the one who needs
// to know it.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BITTY_INDUSTRY_NOTICE,
  BITTY_PREFERRED,
  BITTY_PROHIBITED,
  BITTY_STANDARD,
} from "./bittyIndustries";

export type CategoryTier = "preferred" | "standard";

export interface FunderCategoryList {
  lenderId: string;
  funderName: string;
  /** Where OUR transcription came from. Named with the claim, always. */
  sourceLabel: string;
  /** The NAICS lookup THIS funder names, and who named it. */
  lookupUrl: string;
  lookupAttribution: string;
  /** The funder's own words on what a wrong pick costs — verbatim. */
  stakesQuote: string;
  stakesSource: string;
  /** Why the suggestions below are a guide and not their dropdown. ONE line. */
  dropdownCaveat: string;
  /** Where the full background lives, so the gate doesn't re-teach it. */
  backgroundHref: string;
  backgroundLabel: string;
  preferred: readonly string[];
  standard: readonly string[];
  prohibited: readonly string[];
}

/** The generic lookup, for a funder that names none of its own. */
export const NAICS_LOOKUP_URL = "https://www.naics.com/code-search/";

const BITTY_LENDER_ID = "46bcc237-2837-4316-8afc-6939542411e6";

// `stakesQuote` / `stakesSource` are READ from BITTY_INDUSTRY_NOTICE rather
// than retyped: it is Bitty's own sentence, and two transcriptions of a
// counterparty's words are two things that can drift apart. Quoted verbatim
// with its source, never paraphrased.
const LISTS: readonly FunderCategoryList[] = [
  {
    lenderId: BITTY_LENDER_ID,
    funderName: "Bitty Advance",
    sourceLabel: "our transcription of the Bitty Underwriting Guide, October 2026",
    lookupUrl: BITTY_INDUSTRY_NOTICE.lookup,
    lookupAttribution: "the lookup Bitty names on their own application",
    // quotes[0], NOT quotes[1] — deliberately. The second sentence names a
    // commission percentage, and that number is contested: Bitty's page says
    // 16%, our record of their October 2026 guide caps us at 12% (8% on
    // Access), and no Bitty file has ever been submitted, so neither figure has
    // been tested against a funded deal. A percentage on this screen is a
    // percentage a closer may repeat to a merchant or a sub-ISO. quotes[0] says
    // what is at stake — approval, and an incorrect decline — without a number.
    // Team-lead ruling, 2026-10-30; the conflict is an open question for the
    // owner. Both sentences are on the Bitty playbook tab in full.
    stakesQuote: BITTY_INDUSTRY_NOTICE.quotes[0],
    stakesSource: BITTY_INDUSTRY_NOTICE.source,
    dropdownCaveat:
      "Suggestions come from their underwriting guide, which is NOT their application's dropdown — " +
      "the dropdown underwrites, so record exactly what you will click even when it isn't offered here.",
    backgroundHref: "/admin/cheat-sheet",
    backgroundLabel: "Funder cheat sheet → Bitty tab, section 5",
    preferred: BITTY_PREFERRED,
    standard: BITTY_STANDARD,
    prohibited: BITTY_PROHIBITED,
  },
];

/** The category book we hold for this funder, or null when we hold none. */
export function funderCategoryList(lenderId: string): FunderCategoryList | null {
  return LISTS.find((l) => l.lenderId === lenderId) ?? null;
}

// ---- matching -------------------------------------------------------------
//
// A funder's label is prose, typed by a human, against a list we transcribed
// from a PDF. So comparison is on word tokens, case- and punctuation-blind,
// with singular/plural treated as the same word — "Pawn Shop" has to match
// "Pawn Shops" or the kill-list misses the thing it exists to catch.

const tokens = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);

/** Same word, give or take a plural. Deliberately not a stemmer. */
function tokEq(a: string, b: string): boolean {
  return a === b || `${a}s` === b || `${b}s` === a || `${a}es` === b || `${b}es` === a;
}

function sameRun(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((t, i) => tokEq(t, b[i]));
}

/** Does `needle` appear as a contiguous word run inside `hay`? */
function containsRun(hay: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((t, j) => tokEq(hay[i + j], t))) return true;
  }
  return false;
}

/**
 * The leading segment of a list entry — "Auto Dealer / New, Used" → "Auto
 * Dealer". The slashed tail of these entries is a qualifier, not a separate
 * industry, and matching on the whole string would let "Auto Dealer" through
 * the kill-list on a technicality.
 */
const headSegment = (entry: string) => entry.split(/[/,]/)[0]!.trim();

/**
 * The prohibited entry this typed value hits, or null.
 *
 * Fires on an exact match OR on the entry's leading segment appearing as a
 * word run inside the value, so "Cannabis Dispensary" and "Auto Dealer of Used
 * Cars" are both caught. Checked against our own preferred/standard lists:
 * none of them contains a prohibited head segment, so this cannot refuse a
 * category the same funder elsewhere accepts.
 */
export function prohibitedHit(list: FunderCategoryList, value: string): string | null {
  const hay = tokens(value);
  if (hay.length === 0) return null;
  for (const entry of list.prohibited) {
    if (sameRun(hay, tokens(entry))) return entry;
    if (containsRun(hay, tokens(headSegment(entry)))) return entry;
  }
  return null;
}

/** Which tier an exactly-matched value sits in, or null when it matches none. */
export function tierOf(list: FunderCategoryList, value: string): CategoryTier | null {
  const t = tokens(value);
  if (t.length === 0) return null;
  if (list.preferred.some((e) => sameRun(t, tokens(e)))) return "preferred";
  if (list.standard.some((e) => sameRun(t, tokens(e)))) return "standard";
  return null;
}

/** Suggestions for a partially typed value, preferred first, capped. */
export function suggestCategories(
  list: FunderCategoryList,
  query: string,
  limit = 8,
): { value: string; tier: CategoryTier }[] {
  const q = tokens(query).join(" ");
  const pool: { value: string; tier: CategoryTier }[] = [
    ...list.preferred.map((value) => ({ value, tier: "preferred" as const })),
    ...list.standard.map((value) => ({ value, tier: "standard" as const })),
  ];
  if (!q) return pool.slice(0, limit);
  return pool.filter((p) => tokens(p.value).join(" ").includes(q)).slice(0, limit);
}
