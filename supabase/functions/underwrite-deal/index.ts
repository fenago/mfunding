// underwrite-deal — AI Internal Underwriter (Phase 1).
//
// Analyzes a deal's bank statements with Claude and produces an affordability-
// focused risk read. Three passes:
//   A) EXTRACTION (Claude, extraction_model) — each bank-statement PDF is sent as
//      a native PDF document block; the model returns structured per-statement
//      figures (deposits, withdrawals, balances, NSF, negative days, and classified
//      padding + MCA debits).
//   B) AGGREGATION (deterministic TS, NO AI) — computes the metrics object incl.
//      true revenue (deposits − padding), safe daily debit capacity, max affordable
//      advance, debt-service %, and builds flags from the admin-tunable thresholds.
//   C) JUDGE (Claude, judge_model) — given the metrics + flags + the funders'
//      minimums, returns a short narrative + risk_rating + a paper/fit note.
//
// It NEVER moves money. An MCA is a purchase of future receivables, NOT a loan —
// the prompts enforce receivables language.
//
// POST body: { dealId: string, mode?: 'manual' | 'auto' }
//   manual — signed-in admin/super_admin, or a closer running THEIR OWN deal.
//   auto   — invoked server-side with the service-role key (e.g. from ghl-webhook
//            when new bank statements arrive). Deduped by docs_hash so an identical
//            doc set never re-runs. Manual runs ALWAYS run.
//
// verify_jwt = true — but a service-role bearer (SUPABASE_SERVICE_ROLE_KEY) is
// accepted for auto calls (detected below), mirroring how other functions let the
// platform invoke them server-side.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { ingestGhlDocuments } from "../_shared/ghlDocs.ts";
import { reconcileDocumentType } from "../_shared/docClassify.ts";
import { callAnthropicBlocks, callLLM } from "../_shared/llm.ts";
import { fireAndForgetScore } from "../_shared/scoreLeadInvoke.ts";
import { getPlaidSettings } from "../_shared/plaid.ts";

// ── PROVIDER-FAILURE PREDICATE ───────────────────────────────────────────────
// Distinguishes "the AI provider is down / out of credit / misconfigured" from
// "the model read the data and the data was odd". The first is INFRASTRUCTURE:
// the run is worthless, re-running after a top-up fixes it, and it must NEVER be
// persisted as a new underwriting version (a zeroed row becomes the newest row
// and buries the deal's last good analysis everywhere). The second is tolerated
// and still persists with loud flags, exactly as before.
//
// Shapes matched come from _shared/llm.ts: `anthropic HTTP 400: {...credit
// balance is too low...}`, `No API key configured for provider "x"`, etc.
const PROVIDER_ERROR_RE = new RegExp([
  String.raw`\bHTTP\s+[45]\d\d\b`,                 // "anthropic HTTP 400:", "gemini HTTP 529:"
  String.raw`credit balance is too low`,
  String.raw`insufficient[_ ]?quota`,
  String.raw`\bquota\b[^|]{0,40}\bexceed`,
  String.raw`No API key configured for provider`,
  String.raw`Could not read key for provider`,
  String.raw`Unknown LLM provider`,
  String.raw`\brate[_ ]?limit`,
  String.raw`\boverloaded\b`,
  String.raw`authentication[_ ]?error`,
  String.raw`\bbilling\b`,
].join("|"), "i");
function isProviderError(msg: unknown): boolean {
  return PROVIDER_ERROR_RE.test(String(msg ?? ""));
}
// The subset the owner can fix with a card: out of credit / over quota / unpaid.
const CREDITS_RE = /credit balance is too low|insufficient[_ ]?quota|\bbilling\b|payment required|HTTP\s+402\b|\bquota\b[^|]{0,40}\bexceed/i;
function isCreditsExhausted(msg: unknown): boolean {
  return CREDITS_RE.test(String(msg ?? ""));
}
// The caller-facing sentence for a provider failure. The credit case gets plain
// English (it is the one the owner can FIX in a minute); anything else carries a
// trimmed detail — the provider's raw JSON body is 400 chars of noise in a toast,
// and the full string still rides on `provider_error` for the log.
function providerErrorMessage(detail: string): string {
  const tail = "No version was saved; the previous underwriting is unchanged.";
  if (isCreditsExhausted(detail)) {
    return `Underwriting could not run: the AI provider is out of credit — top up the account in Plans & Billing, then re-run. ${tail}`;
  }
  const short = detail.length > 220 ? `${detail.slice(0, 220)}…` : detail;
  return `Underwriting could not run: AI provider error — ${short}. ${tail}`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const DOC_BUCKET = "customer-documents";
const SIGNED_URL_TTL = 10 * 60; // 10 min — just long enough to fetch the bytes.

// Business-day assumptions used across the affordability math (documented once):
//   ~21 business days per month → daily revenue = monthly / 21.
//   ~4.33 weeks per month (52/12) → weekly figures convert monthly ÷ 4.33.
//   ~110 business days ≈ a 5–6 month MCA term → the LEGACY max affordable advance is
//   roughly the safe daily debit capacity sustained over that term. (The first-class
//   affordability block below uses the admin-tunable term_daily_biz_days /
//   term_weekly_weeks + factor instead — this constant stays for backward compat.)
const BIZ_DAYS_PER_MONTH = 21;
const WEEKS_PER_MONTH = 52 / 12; // 4.333…
const BIZ_DAYS_PER_WEEK = 5;
const TERM_BIZ_DAYS = 110;

// Coded fallback settings — used when no underwriting_settings row exists (the
// migration seeds one, so this is just belt-and-suspenders).
const DEFAULT_SETTINGS = {
  padding_categories: {
    zelle: true, venmo: true, cashapp: true, paypal_personal: true,
    internal_transfer: true, owner_deposit: true, reversal: true,
    round_number: true, same_day_in_out: true,
  } as Record<string, boolean>,
  revenue_quality_flag_pct: 85,
  holdback_ceiling_pct: 15,
  nsf_monthly_cap: 5,
  negative_days_flag: 3,
  debt_service_flag_pct: 20,
  min_avg_daily_balance: null as number | null,
  // ── First-class affordability knobs (see 20260710 migration). ──
  // Total debt-service ceiling (existing positions + new advance) as a % of TRUE
  // monthly revenue. Industry MCA sizing is 8–15%; 10% = middle of the band.
  max_payment_pct_of_revenue: 10,
  // Second, independent guard: the NEW payment may not exceed this % of the worst
  // month's average daily balance (a thin-balance merchant can't be sized on
  // revenue math alone).
  balance_buffer_pct: 50,
  // Assumed MCA structure used to convert a sustainable payment → an advance size
  // (advance = payment × term ÷ factor). Shown for BOTH daily and weekly remits.
  affordability_factor_rate: 1.35,
  term_daily_biz_days: 120,
  term_weekly_weeks: 26,
  // How to treat recurring third-party PAYROLL paid to the OWNER's own name — a
  // judgment call between business commission income and personal W-2 pay.
  // 'count' | 'flag_and_discount' (default: count but flag + compute downside) | 'exclude'.
  owner_payroll_treatment: "flag_and_discount" as "count" | "flag_and_discount" | "exclude",
  extraction_model: "claude-sonnet-5",
  judge_model: "claude-opus-5",
};

type Settings = typeof DEFAULT_SETTINGS;

// deno-lint-ignore no-explicit-any
type Any = Record<string, any>;

const num = (v: unknown): number | null => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const numOr0 = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
// MISSING-DATA-SAFE number. num() above looks null-safe but is NOT: Number(null) === 0
// and Number("") === 0, both finite, so num(null) returns 0. Anywhere that 0 is a
// MEANINGFUL value — a funder's approval_max, a revenue floor, a TIB minimum — that
// silently turns "not recorded" into "zero" and makes missing data a hard
// disqualifier. Use numOrNull for every criterion box field and every merchant value
// compared against one: unknown stays unknown (⇒ no constraint / don't disqualify).
// A genuinely recorded 0 still comes through as 0 and is honored.
const numOrNull = (v: unknown): number | null => {
  if (v == null || (typeof v === "string" && v.trim() === "")) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

// US state name → USPS code. Funder criteria record restricted states as free-ish
// text ("CA", "HI (not currently funding)", "Canada (non-US)") and the merchant
// record may carry either a code or a full name, so both sides are normalized to a
// code before anything is compared. Anything that resolves to no code (Canada,
// "Puerto Rico" for a merchant with no state) is simply not a match — never a
// silent exclusion.
const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "puerto rico": "PR", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const US_STATE_CODES = new Set(Object.values(US_STATES));

// A single free-text value ("TX", "texas", "Texas ") → USPS code, else null.
const normStateCode = (v: unknown): string | null => {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  if (/^[A-Za-z]{2}$/.test(raw)) {
    const code = raw.toUpperCase();
    return US_STATE_CODES.has(code) ? code : null;
  }
  return US_STATES[raw.toLowerCase()] ?? null;
};

// ZIP3 → state. The merchant record often carries a zip with NO state (GHL and the
// intake form both let state through empty), and a zip is deterministic data — it
// beats any AI read. Ranges are inclusive ZIP3 prefixes; gaps (military/territory
// prefixes) resolve to null rather than guessing.
const ZIP3_RANGES: Array<[number, number, string]> = [
  [5, 5, "NY"], [6, 9, "PR"], [10, 27, "MA"], [28, 29, "RI"], [30, 38, "NH"],
  [39, 49, "ME"], [50, 59, "VT"], [60, 69, "CT"], [70, 89, "NJ"], [100, 149, "NY"],
  [150, 196, "PA"], [197, 199, "DE"], [200, 200, "DC"], [201, 201, "VA"],
  [202, 205, "DC"], [206, 219, "MD"], [220, 246, "VA"], [247, 268, "WV"],
  [270, 289, "NC"], [290, 299, "SC"], [300, 319, "GA"], [320, 339, "FL"],
  [341, 349, "FL"], [350, 369, "AL"], [370, 385, "TN"], [386, 397, "MS"],
  [398, 399, "GA"], [400, 427, "KY"], [430, 459, "OH"], [460, 479, "IN"],
  [480, 499, "MI"], [500, 528, "IA"], [530, 549, "WI"], [550, 567, "MN"],
  [570, 577, "SD"], [580, 588, "ND"], [590, 599, "MT"], [600, 629, "IL"],
  [630, 658, "MO"], [660, 679, "KS"], [680, 693, "NE"], [700, 714, "LA"],
  [716, 729, "AR"], [730, 749, "OK"], [750, 799, "TX"], [800, 816, "CO"],
  [820, 831, "WY"], [832, 838, "ID"], [840, 847, "UT"], [850, 865, "AZ"],
  [870, 884, "NM"], [885, 885, "TX"], [889, 898, "NV"], [900, 961, "CA"],
  [967, 968, "HI"], [970, 979, "OR"], [980, 994, "WA"], [995, 999, "AK"],
];
const stateFromZip = (v: unknown): string | null => {
  const m = String(v ?? "").trim().match(/^(\d{3})\d*/);
  if (!m) return null;
  const p = Number(m[1]);
  for (const [lo, hi, code] of ZIP3_RANGES) if (p >= lo && p <= hi) return code;
  return null;
};

// NANP area code → state. The WEAKEST derivation (a cell number travels with its
// owner), used only as a last resort and always marked low-confidence — it is
// enough to raise a "verify the state" flag, never enough to hard-exclude a funder.
const AREA_CODES_BY_STATE: Record<string, number[]> = {
  AL: [205, 251, 256, 334, 659, 938], AK: [907], AZ: [480, 520, 602, 623, 928],
  AR: [327, 479, 501, 870],
  CA: [209, 213, 279, 310, 323, 341, 350, 408, 415, 424, 442, 510, 530, 559, 562, 619, 626,
    628, 650, 657, 661, 669, 707, 714, 747, 760, 805, 818, 820, 831, 840, 858, 909, 916, 925, 949, 951],
  CO: [303, 719, 720, 970, 983], CT: [203, 475, 860, 959], DE: [302], DC: [202],
  FL: [239, 305, 321, 324, 352, 386, 407, 448, 561, 656, 689, 727, 754, 772, 786, 813, 850, 863, 904, 941, 954],
  GA: [229, 404, 470, 478, 678, 706, 762, 770, 912, 943], HI: [808], ID: [208, 986],
  IL: [217, 224, 309, 312, 331, 447, 464, 618, 630, 708, 730, 773, 779, 815, 847, 872],
  IN: [219, 260, 317, 463, 574, 765, 812, 930], IA: [319, 515, 563, 641, 712],
  KS: [316, 620, 785, 913], KY: [270, 364, 502, 606, 859], LA: [225, 318, 337, 504, 985],
  ME: [207], MD: [227, 240, 301, 410, 443, 667],
  MA: [339, 351, 413, 508, 617, 774, 781, 857, 978],
  MI: [231, 248, 269, 313, 517, 586, 616, 679, 734, 810, 906, 947, 989],
  MN: [218, 320, 507, 612, 651, 763, 952], MS: [228, 601, 662, 769],
  MO: [235, 314, 417, 557, 573, 636, 660, 816, 975], MT: [406], NE: [308, 402, 531],
  NV: [702, 725, 775], NH: [603],
  NJ: [201, 551, 609, 640, 732, 848, 856, 862, 908, 973], NM: [505, 575],
  NY: [212, 315, 329, 332, 347, 363, 516, 518, 585, 607, 631, 646, 680, 716, 718, 838, 845, 914, 917, 929, 934],
  NC: [252, 336, 704, 743, 828, 910, 919, 980, 984], ND: [701],
  OH: [216, 220, 234, 283, 326, 330, 380, 419, 436, 440, 513, 567, 614, 740, 937],
  OK: [405, 539, 572, 580, 918], OR: [458, 503, 541, 971],
  PA: [215, 223, 267, 272, 412, 445, 484, 570, 582, 610, 717, 724, 814, 835, 878],
  RI: [401], SC: [803, 821, 839, 843, 854, 864], SD: [605],
  TN: [423, 615, 629, 731, 865, 901, 931],
  TX: [210, 214, 254, 281, 325, 346, 361, 409, 430, 432, 469, 512, 682, 713, 726, 737, 806,
    817, 830, 832, 903, 915, 936, 940, 945, 956, 972, 979],
  UT: [385, 435, 801], VT: [802],
  VA: [276, 434, 540, 571, 686, 703, 757, 804, 826, 948],
  WA: [206, 253, 360, 425, 509, 564], WV: [304, 681],
  WI: [262, 274, 414, 534, 608, 715, 920], WY: [307], PR: [787, 939],
};
const AREA_CODE_STATE: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [code, acs] of Object.entries(AREA_CODES_BY_STATE)) for (const ac of acs) m[String(ac)] = code;
  return m;
})();
const stateFromPhone = (v: unknown): string | null => {
  const digits = String(v ?? "").replace(/\D+/g, "");
  const nat = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (nat.length < 10) return null;
  return AREA_CODE_STATE[nat.slice(0, 3)] ?? null;
};

// FNV-1a hash of a string → stable short hex. Used for docs_hash so an identical
// analyzed doc set (same ids + timestamps) produces the same hash across runs.
function stableHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ---- Per-statement extraction shape (what Claude returns per PDF) -----------
interface PerStatement {
  month: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  total_deposits: number | null;
  total_withdrawals: number | null;
  avg_daily_balance: number | null;
  min_balance: number | null;
  negative_days: number | null;
  nsf_count: number | null;
  overdraft_fee_total: number | null;
  // TOTAL count of deposit/credit transactions posted in the month (every credit
  // line). The "true" (non-padding) deposit count shown per-month is derived
  // deterministically in aggregation as deposit_count − padding items.
  deposit_count: number | null;
  account_last4: string | null;
  deposits: Array<{ date?: string; desc?: string; amount?: number; classified_type?: string }>;
  padding_deposits: Array<{ date?: string; desc?: string; amount?: number; category?: string }>;
  // Recurring third-party PAYROLL paid to the OWNER's own name (and similar
  // owner-personal-income patterns) — a distinct bucket from padding. Whether it
  // counts as true revenue is a judgment call resolved by owner_payroll_treatment.
  questionable_deposits: Array<{ date?: string; desc?: string; amount?: number; source?: string; reason?: string }>;
  mca_debits: Array<{ date?: string; desc?: string; amount?: number; occurrences?: number; cadence?: string; funder?: string; debit_class?: string }>;
  // COLLECTION-ACTIVITY candidates the model flagged while reading this statement —
  // debts being collected FROM the merchant by force or by a collector: collection
  // agencies, wage/bank garnishments, tax levies, judgments/writs. NOT ordinary
  // vendor payments, and NOT the merchant paying an agency to collect its OWN A/R.
  // Deliberately separate from mca_debits: a collection debit is a legal/distress
  // event, not a financing position, and must never inflate the stacking count.
  collection_debits: Array<{ date?: string; desc?: string; amount?: number; type?: string; confidence?: string; reason?: string }>;
  // USPS code for the state in the ACCOUNT-HOLDER address block printed on the
  // statement. Statements are the one document we always have, so this is the
  // fallback that keeps a state-restricted funder from being recommended blind
  // when the CRM record has no state. Never used to override a recorded state.
  business_state?: string | null;
  _filename?: string;
  // EVERY source filename represented by this statement — the byte-identical group
  // members PLUS any files period-dedup folded in. Drives the per-document ledger so
  // no source file is ever silently dropped. _filename stays as the representative
  // (first) name for back-compat with the existing per-statement UI drilldown.
  _filenames?: string[];
  _error?: string;
  // Provenance for post-extraction period dedup (not sent to Claude / persisted for
  // debugging only): how many source files collapsed into this unique period.
  _dupe_count?: number;
  // EVIDENCE SOURCE. 'statement_pdf' = Claude read an uploaded bank-statement PDF
  // (a merchant could in principle alter it). 'plaid' = a month synthesized from the
  // merchant's CONNECTED bank feed — unfalsifiable, the highest-trust source. Default
  // 'statement_pdf'; set explicitly by the Plaid builder.
  source?: "statement_pdf" | "plaid";
}

function extractionSystem(enabledCategories: string[]): string {
  return (
    "You are a bank-statement analyst for an MCA underwriter at an ISO (broker). " +
    "An MCA is a purchase of future receivables, NOT a loan — never call it a loan. " +
    "You are given ONE business bank statement as a PDF. Read it and return STRICT JSON " +
    "describing that statement. Be precise and conservative; if a figure is not present, use null. " +
    "Classify each notable deposit's classified_type as one of: 'sales_revenue', 'transfer', " +
    "'owner_deposit', 'loan_or_advance', 'refund_reversal', 'other'. " +
    "Separately, list PADDING deposits — deposits that are NOT true operating sales revenue and should " +
    "be REMOVED when computing real revenue. ONLY classify a deposit as padding if its category is one " +
    "of these ENABLED categories: [" + enabledCategories.join(", ") + "]. " +
    "Padding categories mean: zelle/venmo/cashapp = peer-to-peer app transfers in; paypal_personal = " +
    "personal (non-merchant) PayPal transfers; internal_transfer = transfer between the owner's own " +
    "accounts; owner_deposit = owner capital injection / personal money in; reversal = a returned/reversed " +
    "debit credited back; round_number = suspiciously round large deposits inconsistent with sales; " +
    "same_day_in_out = money deposited and withdrawn same day (wash). If a category is NOT in the enabled " +
    "list, do NOT treat that type as padding. " +
    "SEPARATELY from padding, list QUESTIONABLE deposits: recurring third-party PAYROLL deposits paid to the " +
    "OWNER's own name (e.g. an ACH labeled 'DES:PAYROLL' / 'PAYROLL' with 'INDN:<owner name>', or similar " +
    "owner-personal-income patterns like recurring W-2-style direct deposits to the owner). These are AMBIGUOUS: " +
    "they may be legitimate business commission income OR personal employment pay — do NOT put them in " +
    "padding_deposits and do NOT silently drop them; capture each with the paying source and why it's ambiguous. " +
    "Also list RECURRING FINANCING DEBITS in mca_debits — scheduled fixed withdrawals that repay a financing " +
    "obligation. AGGREGATE them: return ONE entry per distinct (funder + amount + cadence), with 'occurrences' = " +
    "how many times that exact debit posted THIS month (e.g. a $540 daily remittance that hit 15 times → one entry, " +
    "occurrences: 15). Do NOT list one line per date. mca_debits is REQUIRED whenever the statement shows recurring " +
    "fixed daily/weekly remittances — a working-capital merchant's statement will have several; do NOT return an " +
    "empty mca_debits array when such debits are present. For each entry return the " +
    "amount, the 'occurrences' (integer, >=1), the cadence ('daily' | 'weekly' | 'monthly' | 'unknown'), the creditor as a clean 'funder' name " +
    "(strip transaction/account ids, e.g. 'Calabria Funding LLC 51647' -> 'Calabria Funding'; 'Dedicated Financ " +
    "D002703625' -> 'Dedicated Financial'), and a 'debit_class' classifying WHAT KIND of obligation it is: " +
    "'mca' = a merchant cash advance / future-receivables purchase remittance (typically daily or weekly, to an " +
    "advance funder); 'sba_loan' = an SBA or bank TERM-LOAN payment (e.g. 'SBA EIDL', 'NORTHEAST BANK SBA PYMT', " +
    "ReadyCap / bank loan servicing); 'equipment_lease' = an equipment finance/lease payment (e.g. Marlin Leasing); " +
    "'consumer_finance' = a consumer-installment lender (e.g. Lendmark Financial); 'vendor_other' = a one-off or " +
    "vendor/supplier/bill ACH that is NOT a financing obligation. Put the SAME funder's two distinct recurring " +
    "amounts as SEPARATE lines (they are separate tranches — e.g. Calabria at $352.95/day and $230.77/day). " +
    "SEPARATELY AGAIN, list COLLECTION-ACTIVITY debits in collection_debits — debits that show a debt being " +
    "collected FROM this merchant by a collector or by legal force. Real examples: a payment to a debt-collection " +
    "agency (Portfolio Recovery, Midland Credit/Funding, IC System, Convergent, Enhanced Recovery/ERC, NCB " +
    "Management, Cavalry Portfolio, LVNV Funding, Transworld Systems, Nationwide Recovery); a WAGE or BANK " +
    "GARNISHMENT; a TAX LEVY / IRS LEVY / state revenue levy; a JUDGMENT, WRIT OF EXECUTION, court-ordered " +
    "attachment, or sheriff's levy; a lien payoff being enforced. Set type to one of 'collections', " +
    "'garnishment', 'tax_levy', 'judgment'. " +
    "BE CONSERVATIVE — this flag can cost the merchant a funder, so do NOT guess. An ordinary vendor, supplier, " +
    "insurance, payroll-service or software payment is NOT collection activity even if the company's NAME happens " +
    "to contain a word like 'lien', 'recovery', 'collection' or 'levy' (e.g. 'Lien Solutions' is a UCC filing " +
    "service; 'Levy Brothers Produce' is a food vendor; a towing/auto 'Recovery' company is a vendor). Likewise, a " +
    "merchant PAYING a collection agency a fee to collect ITS OWN receivables is a business expense, not collection " +
    "activity against the merchant — if you cannot tell which it is, include it with confidence 'low'. " +
    "Set confidence to 'high' only when the descriptor unmistakably reads as a garnishment, levy, judgment or a " +
    "debt-collection payment; 'medium' when it very likely is; 'low' when it is a guess. Give a short 'reason'. " +
    "Return an EMPTY collection_debits array when the statement shows none — that is the normal case. " +
    "Return the statement's account_last4 (last 4 digits of the account number) if visible, else null. " +
    "Return business_state = the two-letter USPS state code from the ACCOUNT-HOLDER / mailing address block " +
    "printed on the statement (the 'CITY ST 12345' line under the business name, usually page 1). Return the " +
    "STATE OF THE ACCOUNT HOLDER — never the bank's own corporate address, and never a state that merely appears " +
    "in a transaction descriptor. If no account-holder address is printed, return null (do not guess). " +
    "CRITICAL — DEBIT vs CREDIT COLUMNS: total_deposits is the CREDITS/deposits total (money IN); total_withdrawals " +
    "is the DEBITS total (money OUT). Some statement formats (e.g. Banc of California 'Activity & Balances Summary') " +
    "print the DEBITS column BEFORE the Credits column, or a Totals row reading 'Debits $X | Credits $Y' — do NOT " +
    "transpose them. total_deposits must equal the CREDITS figure and must reconcile with the deposit lines you " +
    "list (their sum should be within a few percent of total_deposits); if your total_deposits is far above the sum " +
    "of the credits you listed, you have likely grabbed the Debits column — re-read and use the Credits total. " +
    "overdraft_fee_total = the SUM of overdraft / NSF / returned-item FEE charges debited this month (e.g. 7 x $40 " +
    "OD fees = 280); 0 if none. " +
    "You MUST fill every field of the report_statement tool for THIS statement — do not omit any. " +
    "Every real bank statement shows an ENDING balance and a statement period, so closing_balance and month are " +
    "ALWAYS present, never null. Provide avg_daily_balance from the statement's average-daily-balance line if " +
    "printed, otherwise estimate it from the running daily ledger balances (do not leave it null). " +
    "negative_days = the number of days the ledger balance was below zero (0 if none). " +
    "deposit_count = the TOTAL number of deposit/credit transactions posted in the month — count EVERY credit " +
    "line item (sales, transfers, owner deposits, everything). It must be >= the number of deposits you list and " +
    "must NEVER be 0 when the statement has any deposits. Padding is handled separately via padding_deposits — do " +
    "NOT subtract padding from deposit_count. " +
    "Call the report_statement tool with your findings (do not also write prose)."
  );
}

// The extraction tool — a structured schema whose required fields the model cannot
// omit. Forcing a single tool call is what guarantees the four owner-mandated
// per-statement fields (deposit_count, ending/closing balance, avg daily balance,
// negative_days) are always present, unlike a free-form JSON prompt where the model
// silently dropped deposit_count on some statements.
const EXTRACTION_TOOL = {
  name: "report_statement",
  description: "Report the extracted figures for exactly one business bank statement.",
  input_schema: {
    type: "object",
    properties: {
      month: { type: ["string", "null"], description: "Statement period, e.g. 'March 2026'. Always present on a real statement." },
      account_last4: { type: ["string", "null"] },
      business_state: {
        type: ["string", "null"],
        description: "Two-letter USPS state code from the ACCOUNT-HOLDER mailing address printed on the statement (not the bank's address). null if no account-holder address is shown.",
      },
      opening_balance: { type: ["number", "null"] },
      closing_balance: { type: "number", description: "Ending balance shown on the statement. Always present." },
      total_deposits: { type: ["number", "null"], description: "Sum of all deposits/credits for the month." },
      total_withdrawals: { type: ["number", "null"] },
      avg_daily_balance: { type: "number", description: "Average daily balance — from the statement if printed, else estimated from daily ledger balances." },
      min_balance: { type: ["number", "null"] },
      negative_days: { type: "integer", description: "Count of days the balance was negative (0 if none)." },
      nsf_count: { type: ["integer", "null"] },
      overdraft_fee_total: { type: ["number", "null"], description: "Sum of overdraft/NSF/returned-item FEE charges debited this month (0 if none)." },
      deposit_count: { type: "integer", description: "TOTAL count of deposit/credit transactions this month; never 0 when deposits exist." },
      deposits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: "string" }, desc: { type: "string" }, amount: { type: "number" },
            classified_type: { type: "string" },
          },
        },
      },
      padding_deposits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: "string" }, desc: { type: "string" }, amount: { type: "number" }, category: { type: "string" },
          },
        },
      },
      questionable_deposits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: "string" }, desc: { type: "string" }, amount: { type: "number" },
            source: { type: "string" }, reason: { type: "string" },
          },
        },
      },
      mca_debits: {
        type: "array",
        description: "Every recurring FINANCING debit occurrence (MCA remittances, SBA/term-loan payments, equipment leases, consumer-finance installments). One entry per occurrence; the underwriter groups + dedupes them.",
        items: {
          type: "object",
          properties: {
            desc: { type: "string" }, amount: { type: "number" },
            occurrences: { type: "integer", description: "Times this exact debit posted THIS month (>=1). Aggregate; do not list per-date." },
            cadence: { type: "string", description: "'daily' | 'weekly' | 'monthly' | 'unknown'" },
            funder: { type: "string", description: "Clean creditor name with transaction/account ids stripped." },
            debit_class: { type: "string", description: "'mca' | 'sba_loan' | 'equipment_lease' | 'consumer_finance' | 'vendor_other'" },
          },
        },
      },
      collection_debits: {
        type: "array",
        description: "Debits showing a debt being collected FROM the merchant (collection agency, garnishment, tax levy, judgment/writ). Empty array when none — the normal case. Never include ordinary vendor payments.",
        items: {
          type: "object",
          properties: {
            date: { type: "string" }, desc: { type: "string" }, amount: { type: "number" },
            type: { type: "string", description: "'collections' | 'garnishment' | 'tax_levy' | 'judgment'" },
            confidence: { type: "string", description: "'high' | 'medium' | 'low'" },
            reason: { type: "string", description: "Short why — what in the descriptor makes this collection activity." },
          },
        },
      },
    },
    required: [
      "month", "closing_balance", "avg_daily_balance", "negative_days", "deposit_count",
      "total_deposits", "deposits", "padding_deposits", "questionable_deposits", "mca_debits",
      "collection_debits", "business_state",
    ],
  },
};

// Decode a JWT's payload and return its "role" claim (no signature check — used
// ONLY to recognize a service_role token for trusted server-side auto calls; the
// token still had to be a valid bearer to reach an authenticated request path).
function jwtRole(token: string): string | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const payload = JSON.parse(atob(b64)) as { role?: string };
    return payload.role ?? null;
  } catch {
    return null;
  }
}

function safeParseJson(text: string): Any | null {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ }
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: { dealId?: string; mode?: string; plaidEnv?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const dealId = body.dealId;
  const mode = body.mode === "auto" ? "auto" : "manual";
  if (!dealId) return json({ error: "dealId is required" }, 400);

  const db = serviceClient();

  // --- Auth. A service-role bearer marks a trusted server-side auto call (e.g.
  // from ghl-webhook). Otherwise the caller must be signed-in staff; a closer may
  // run only their OWN deal (mirrors submit-to-funders). We detect the service key
  // two ways for robustness: equality with the injected SUPABASE_SERVICE_ROLE_KEY,
  // OR a JWT whose "role" claim is "service_role" (the key format env can vary).
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const isServiceCall = !!token && (token === serviceKey || jwtRole(token) === "service_role");

  let callerId: string | null = null;
  if (!isServiceCall) {
    if (!token) return json({ error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid session" }, 401);
    callerId = caller.id;
    const { data: prof } = await db.from("profiles").select("role").eq("id", caller.id).single();
    const role = prof?.role as string | undefined;
    if (!role || !["closer", "admin", "super_admin"].includes(role)) {
      return json({ error: "Forbidden — staff only" }, 403);
    }
    if (role === "closer") {
      const { data: owns } = await db.rpc("closer_owns_deal", { uid: caller.id, d_id: dealId });
      if (!owns) return json({ error: "Forbidden — this deal isn't assigned to you" }, 403);
    }
  }

  try {
    // --- Settings (fall back to coded defaults if the singleton is missing). ---
    const { data: sRow } = await db
      .from("underwriting_settings")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      ...(sRow ?? {}),
      padding_categories: {
        ...DEFAULT_SETTINGS.padding_categories,
        ...((sRow?.padding_categories as Record<string, boolean> | undefined) ?? {}),
      },
    };
    const enabledCategories = Object.entries(settings.padding_categories)
      .filter(([, on]) => on === true)
      .map(([k]) => k);

    // --- Model resolution (owner-switchable) ---
    // platform_settings key "underwriting_models" is the top-priority override the
    // super-admin sets in the UI; it falls back to the underwriting_settings row and
    // then the hardcoded code defaults, so a missing/partial row NEVER breaks a run.
    // A bad model id is NOT silently swapped — the run fails loudly (extraction errors
    // land in the ledger + coverage flags; a judge failure surfaces in the narrative).
    const { data: pmRow } = await db
      .from("platform_settings").select("value").eq("key", "underwriting_models").maybeSingle();
    const modelOverride = (pmRow?.value ?? {}) as { judge_model?: string; extraction_model?: string };
    const extractionModel =
      (modelOverride.extraction_model || settings.extraction_model || DEFAULT_SETTINGS.extraction_model).trim();
    const judgeModel =
      (modelOverride.judge_model || settings.judge_model || DEFAULT_SETTINGS.judge_model).trim();

    // --- Deal + customer. ---
    const { data: deal, error: dErr } = await db
      .from("deals")
      .select("id, deal_number, deal_type, amount_requested, use_of_funds, underwriting_context, customer_id, vcf_active_positions, vcf_daily_debit, customer:customers!customer_id(business_name, monthly_revenue, time_in_business, industry, business_type, address_state, address_zip, phone, credit_score_range, ghl_contact_id)")
      .eq("id", dealId).maybeSingle();
    if (dErr || !deal) return json({ error: `deal not found: ${dErr?.message ?? dealId}` }, 404);
    const cust = (deal.customer ?? {}) as Any;
    // Owner-supplied free-text context (things the statements can't tell — seasonality,
    // a baseline the current months undershoot, etc.). Injected into the JUDGE prompt
    // as a clearly-labeled block: weighed in the verdict/paths, but it NEVER overrides
    // hard evidence (a $100K-baseline claim against $12K statements produces a
    // "verify with prior-year statements" path, not a fabricated approval).
    const ownerContext = ((deal.underwriting_context as string | null | undefined) ?? "").trim();

    // --- MCA application on file (deterministic merchant facts the CRM record may be
    // missing). Today it is read only for the merchant's STATE: the CRM's
    // customers.address_state is blank on most real deals, and a blank state used to
    // let a state-restricted funder onto the shortlist unchecked (a TX merchant was
    // recommended True Advance, who does not fund TX). Deal-scoped app first, then any
    // app for this customer. Best-effort: a failure here never sinks the run.
    let appRow: Any | null = null;
    try {
      const { data: apps } = await db
        .from("mca_applications")
        .select("id, deal_id, business_state, business_zip, business_phone, owner_home_state, owner_home_zip, created_at")
        .eq("customer_id", deal.customer_id)
        .order("created_at", { ascending: false });
      const list = (apps ?? []) as Any[];
      appRow = list.find((a) => a.deal_id === deal.id) ?? list[0] ?? null;
    } catch (e) {
      console.warn("[underwrite-deal] application load failed:", e instanceof Error ? e.message : e);
    }

    // --- Documents: bank statements (analyzed) + applications (context only). ---
    const loadDocs = async (): Promise<Any[]> => {
      const { data: rows, error } = await db
        .from("customer_documents")
        .select("id, document_type, filename, storage_path, mime_type, created_at, updated_at")
        .eq("customer_id", deal.customer_id)
        .in("document_type", ["bank_statement", "application"]);
      if (error) throw new Error(`could not read documents: ${error.message}`);
      return (rows ?? []) as Any[];
    };

    // ── PREFLIGHT: content-classify any "other"-typed docs BEFORE selecting bank
    // statements. This is the direct fix for the SIS-Financial failure: three bank
    // statements were typed "other" (filename had no "statement") and the underwriter
    // never saw them. Reading the first page corrects the type so they're analyzed.
    // Best-effort, never throws (docClassify guarantees it).
    let reclassifiedNote: string | null = null;
    try {
      const { data: otherDocs } = await db
        .from("customer_documents")
        .select("id")
        .eq("customer_id", deal.customer_id)
        .eq("document_type", "other");
      if (otherDocs && otherDocs.length) {
        const outcomes = await Promise.all(
          otherDocs.map((d) => reconcileDocumentType(db, { documentId: d.id as string, authority: "machine" })),
        );
        const promoted = outcomes.filter((o) => o.changed);
        if (promoted.length) {
          const toBank = promoted.filter((o) => o.to === "bank_statement").length;
          reclassifiedNote = `Content-corrected ${promoted.length} previously-"other" document(s) before underwriting` +
            (toBank ? ` (${toBank} now bank statement${toBank === 1 ? "" : "s"})` : "") + ".";
          console.log(`[underwrite-deal] preflight reclassify for deal ${deal.deal_number}: ${reclassifiedNote}`);
        }
      }
    } catch (e) {
      console.warn("[underwrite-deal] preflight reclassify failed:", e instanceof Error ? e.message : e);
    }

    let docs = await loadDocs();
    let bankDocs = docs.filter((d) => d.document_type === "bank_statement");

    // ── SELF-HEAL: the merchant's statements usually live in GHL, not here. ──
    // Merchants upload through the GHL secure-upload link, so their files sit on the
    // GHL contact's FILE_UPLOAD fields. The playbook's doc checklist reads GHL and
    // shows them ticked, but this function reads `customer_documents` — which was
    // EMPTY for every real merchant, so underwriting 422'd on every genuine deal.
    // When we find nothing locally, pull the files across (read-only against GHL,
    // idempotent on external_ref) and re-read, so "Run underwriting" simply works.
    let ingestNote: string | null = null;
    const ghlContactId = (cust.ghl_contact_id as string | null | undefined) ?? null;
    if (bankDocs.length === 0 && ghlContactId) {
      try {
        const res = await ingestGhlDocuments(db, deal.customer_id as string, ghlContactId);
        console.log(
          `[underwrite-deal] GHL ingest for deal ${deal.deal_number}: found=${res.found} synced=${res.synced} skipped=${res.skipped} failed=${res.failed} bank=${res.bankStatementsAdded}`,
        );
        if (res.synced > 0) {
          ingestNote = `Imported ${res.synced} document(s) the merchant uploaded in GoHighLevel.`;
          docs = await loadDocs();
          bankDocs = docs.filter((d) => d.document_type === "bank_statement");
        }
      } catch (e) {
        console.warn("[underwrite-deal] GHL ingest failed:", e instanceof Error ? e.message : e);
      }
    }

    // ── PLAID BANK FEED (env-scoped, first-class evidence) ─────────────────────
    // The merchant's CONNECTED bank is analyzed alongside (or instead of) uploaded
    // PDFs. We synthesize per-month statement entries from plaid_transactions in the
    // SAME shape the PDF extraction produces, so ONE aggregation consumes both.
    // ENV-SCOPED: we only read the active-environment item — a production underwrite
    // never mixes in sandbox transactions, and vice versa. `plaidEnv` in the body
    // overrides which environment we read for DIAGNOSTICS/TESTING only (it changes
    // nothing global). The merge (overlap cross-check vs. plaid-only months) happens
    // after extraction + dedup below.
    let plaidInstitution: string | null = null;
    let allPlaidStatements: PerStatement[] = [];
    try {
      const plaidSettings = await getPlaidSettings(db);
      const plaidEnv = (body.plaidEnv === "sandbox" || body.plaidEnv === "production")
        ? body.plaidEnv : plaidSettings.environment;
      const { data: pItem } = await db
        .from("plaid_items")
        .select("id, institution_name, environment, status, last_pull_at")
        .eq("customer_id", deal.customer_id)
        .eq("status", "active")
        .eq("environment", plaidEnv)
        .order("last_pull_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (pItem) {
        plaidInstitution = (pItem.institution_name as string | null) ?? null;
        const { data: txns } = await db
          .from("plaid_transactions")
          .select("date, amount, name, merchant_name, account_id")
          .eq("plaid_item_pk", pItem.id)
          .order("date", { ascending: true });
        if (txns && txns.length) {
          allPlaidStatements = buildPlaidStatements(txns as PlaidTxRow[], plaidInstitution);
          console.log(
            `[underwrite-deal] plaid feed (${plaidEnv}) for deal ${deal.deal_number}: ${txns.length} txn(s) → ${allPlaidStatements.length} bank-feed month(s)`,
          );
        }
      }
    } catch (e) {
      console.warn("[underwrite-deal] plaid feed load failed:", e instanceof Error ? e.message : e);
    }

    if (bankDocs.length === 0 && allPlaidStatements.length === 0) {
      return json({
        error: ghlContactId
          ? "No bank statements on file for this deal yet — nothing found in our storage, on the merchant's GoHighLevel contact, or from a connected bank feed."
          : "No bank statements on file for this deal yet, and no connected bank feed.",
        dealId,
      }, 422);
    }

    // --- docs_hash: stable hash of the analyzed doc set (bank + application),
    // sorted by id, each id + its last-touched timestamp. If auto mode and the
    // latest run already analyzed this exact set, skip (dedup the trickle-in case).
    const hashSource = docs
      .map((d) => `${d.id}:${d.updated_at ?? d.created_at ?? ""}`)
      .sort()
      .join("|");
    const docsHash = stableHash(hashSource);

    if (mode === "auto") {
      const { data: last } = await db
        .from("deal_underwriting")
        .select("id, docs_hash, version")
        .eq("deal_id", dealId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (last?.docs_hash === docsHash) {
        return json({ ok: true, skipped: true, reason: "docs_hash unchanged", dealId, version: last.version });
      }
    }

    // ---- PASS A: EXTRACTION (Claude reads each bank-statement PDF) ----
    // Statements are independent, so extract them CONCURRENTLY — 6 statements in
    // series would blow the edge-function wall-clock; in parallel it's one round
    // trip's latency. Each task never throws (errors become an _error statement).
    const exSystem = extractionSystem(enabledCategories);

    // Step 1: fetch each bank doc, compute a content hash, and base64-encode it —
    // then DROP the raw bytes (keeping only the b64 string) to stay within the edge
    // worker's memory wall on a many-statement deal. The hash lets us DEDUP
    // byte-identical uploads BEFORE spending a Claude call: if a merchant uploads the
    // exact same file twice (even renamed), we send it to Claude once and reuse the
    // extraction for every copy.
    const loadOne = async (d: Any): Promise<{ filename: string; hash: string | null; b64: string | null; err?: string }> => {
      const filename = (d.filename as string) || "statement.pdf";
      const isPdf = /pdf/i.test((d.mime_type as string) || "") || /\.pdf$/i.test(filename);
      if (!isPdf) return { filename, hash: null, b64: null, err: "not a PDF — skipped from extraction" };
      const { data: signed } = await db.storage.from(DOC_BUCKET).createSignedUrl(d.storage_path, SIGNED_URL_TTL);
      const url = signed?.signedUrl;
      if (!url) return { filename, hash: null, b64: null, err: "could not sign URL" };
      try {
        const bin = await fetch(url);
        if (!bin.ok) return { filename, hash: null, b64: null, err: `fetch ${bin.status}` };
        const bytes = new Uint8Array(await bin.arrayBuffer());
        if (!bytes.length) return { filename, hash: null, b64: null, err: "empty file" };
        const hash = `${bytes.length}:${hashBytes(bytes)}`;
        const b64 = base64FromBytes(bytes);
        return { filename, hash, b64 }; // raw bytes go out of scope here.
      } catch (e) {
        return { filename, hash: null, b64: null, err: `fetch error: ${e instanceof Error ? e.message : e}` };
      }
    };
    const loaded = await Promise.all(bankDocs.map(loadOne));

    // Group by the byte fingerprint. Byte-identical files share one Claude extraction;
    // the result is fanned back to every copy.
    const groups = new Map<string, { b64: string; filenames: string[] }>();
    for (const l of loaded) {
      if (!l.b64 || !l.hash) continue; // non-PDF / fetch errors: handled individually below.
      const g = groups.get(l.hash);
      if (g) g.filenames.push(l.filename);
      else groups.set(l.hash, { b64: l.b64, filenames: [l.filename] });
    }

    const extractGroup = async (g: { b64: string; filenames: string[] }): Promise<PerStatement> => {
      const filename = g.filenames[0];
      // Transient failures are common on real runs — the API overloads (HTTP 529/429)
      // or the model returns a JSON near-miss. One short retry recovers most of them
      // without pushing the whole (concurrent) run past the worker wall-clock/CPU wall.
      const MAX_ATTEMPTS = 2;
      let lastErr = "extraction failed";
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const text = await callAnthropicBlocks(
            db,
            extractionModel,
            [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: g.b64 } },
              { type: "text", text: "Extract this bank statement per your instructions and call the report_statement tool." },
            ],
            // A busy month has a long deposits/mca_debits array — 4096 tokens can
            // truncate the tool JSON mid-array and fail parsing, so give it room.
            // Forcing report_statement guarantees the required per-statement fields.
            {
              // 16k so a busy month's deposits + AGGREGATED debits never truncate the
              // tool JSON (per-date debit listing once truncated July's mca_debits to
              // empty; aggregation + headroom fixes it).
              system: exSystem, maxTokens: 16384, temperature: 0, jsonMode: true,
              tools: [EXTRACTION_TOOL],
              toolChoice: { type: "tool", name: "report_statement" },
            },
          );
          const parsed = safeParseJson(text);
          if (!parsed) { lastErr = "could not parse extraction JSON"; }
          else {
            const st = normalizeStatement(parsed, filename);
            // A byte-identical duplicate uploaded twice yields the SAME result as once.
            st._dupe_count = g.filenames.length;
            st._filenames = [...g.filenames];
            return st;
          }
        } catch (e) {
          lastErr = `extraction error: ${e instanceof Error ? e.message : e}`;
        }
        if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 600));
      }
      // A whole byte-group that never extracted: every member is an error row.
      return emptyStatement(filename, lastErr, g.filenames);
    };

    // Extract one statement per unique byte-set, plus carry through the non-PDF /
    // fetch-error docs as _error statements (so extraction_gaps still counts them).
    const errorStatements = loaded
      .filter((l) => !l.b64)
      .map((l) => emptyStatement(l.filename, l.err ?? "could not load file", [l.filename]));
    const extracted = await Promise.all(Array.from(groups.values()).map(extractGroup));
    let perStatement: PerStatement[] = [...extracted, ...errorStatements];

    // Post-extraction PERIOD dedup: even non-byte-identical files can be the same
    // statement (re-scanned, re-exported, renamed). Dedup successful extractions by
    // (account, period); keep the richer extraction (more line items), first on tie.
    // Net effect: the same statement uploaded twice produces the same result as once.
    perStatement = dedupByPeriod(perStatement);

    // ── MERGE THE PLAID BANK FEED (honest data) ────────────────────────────────
    // Partition the synthesized bank-feed months against the PDF-covered months:
    //   · a month with NO uploaded PDF  → JOINS the analyzed series as bank-feed
    //     evidence (higher trust — unfalsifiable), tagged source:'plaid';
    //   · a month WITH an uploaded PDF  → held aside for the fraud CROSS-CHECK below;
    //     the PDF stays primary and the feed becomes a verification signal (if the
    //     PDF claims materially MORE deposits than the feed, that's a doctored-doc flag).
    const pdfMonthKeys = new Set(
      perStatement.filter((s) => !s._error && s.month)
        .map((s) => monthKey(s.month)).filter((k): k is number => k != null),
    );
    const plaidOnly: PerStatement[] = [];
    const plaidOverlap: PerStatement[] = [];
    for (const ps of allPlaidStatements) {
      const mk = monthKey(ps.month);
      if (mk != null && pdfMonthKeys.has(mk)) plaidOverlap.push(ps);
      else plaidOnly.push(ps);
    }
    perStatement = [...perStatement, ...plaidOnly];
    const bankFeedMonths = plaidOnly.map((s) => s.month).filter((m): m is string => !!m);

    // ---- PER-DOCUMENT EXTRACTION LEDGER ----
    // One row per SOURCE bank-statement file → its final disposition (analyzed with
    // the month extracted, a duplicate folded into another file, or an error). This
    // is the anti-SILENT-ZERO guarantee: a file that fails to load, fails extraction,
    // or collapses in dedup is recorded EXPLICITLY here (and, for errors, surfaced as
    // a loud coverage flag below) — never dropped without a trace. Verifiable in the
    // UI against the file list the merchant/closer uploaded.
    type LedgerRow = {
      filename: string;
      status: "analyzed" | "duplicate" | "error" | "cross_check";
      month: string | null;
      account_last4: string | null;
      detail: string;
      // Provenance so the coverage table can badge 🏦 bank feed vs 📄 statement.
      source?: "statement_pdf" | "plaid";
    };
    const documentLedger: LedgerRow[] = [];
    for (const s of perStatement) {
      const names = (s._filenames && s._filenames.length ? s._filenames : [s._filename ?? "statement.pdf"]);
      const src = s.source ?? "statement_pdf";
      if (s._error) {
        for (const fn of names) {
          documentLedger.push({ filename: fn, status: "error", month: null, account_last4: null, detail: s._error, source: src });
        }
        continue;
      }
      documentLedger.push({
        filename: names[0],
        status: "analyzed",
        month: s.month,
        account_last4: s.account_last4,
        detail: src === "plaid"
          ? `bank feed (Plaid) — ${s.deposit_count ?? s.deposits?.length ?? 0} deposit(s), $${Math.round(numOr0(s.total_deposits)).toLocaleString("en-US")} in; unfalsifiable`
          : `${s.deposits?.length ?? 0} deposit line(s), ${s.mca_debits?.length ?? 0} debit line(s)`,
        source: src,
      });
      // Extra source files folded into this one statement (byte-identical re-uploads
      // OR the same account+period from a different file) — expected + harmless, but
      // shown so coverage is auditable.
      for (const fn of names.slice(1)) {
        documentLedger.push({
          filename: fn,
          status: "duplicate",
          month: s.month,
          account_last4: s.account_last4,
          detail: `same statement as "${names[0]}" — deduplicated, not double-counted`,
          source: src,
        });
      }
    }

    // ---- PASS B: AGGREGATION (deterministic — no AI) ----
    // Aggregation runs over the UNIQUE set only, so months_covered /
    // statements_analyzed / all revenue math never double-count a duplicate.
    const analyzed = perStatement.filter((s) => !s._error);
    // money formatter — used across the position/timeline/refi blocks below and the
    // scenarios/verdict later.
    const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

    // ── DEPOSIT-TOTAL INTEGRITY GUARD (deterministic, per statement) ────────────
    // claude-sonnet-5's monthly total_deposits is unreliable on the Banc of
    // California "Activity & Balances Summary" — across runs the SAME July statement
    // came back as $40,293.21 (the DEBIT column, transposed), $6,703.86 (a wrong
    // subtotal), and the true $31,326.20. The RELIABLE anchor is the sum of the CREDIT
    // LINE ITEMS the model lists (consistently ~$31,326 every run). Two deterministic
    // corrections, both keyed off that anchor:
    //   1) TRANSPOSE — the listed credits reconcile with the WITHDRAWALS figure, not
    //      the deposits figure ⇒ the columns were swapped; swap them back.
    //   2) FLOOR — a reported total can never be BELOW the sum of its own listed
    //      credit lines; when it is (understated / mis-read / truncated), raise it to
    //      the sum. A legitimately-higher reported total (unlisted small deposits) is
    //      left untouched.
    // Both are flagged loudly; a residual large gap is surfaced as a heads-up.
    const swapNotes: string[] = [];
    const floorNotes: string[] = [];
    const reconNotes: string[] = [];
    for (const s of analyzed) {
      const wd = num(s.total_withdrawals);
      const sumLines = round2((s.deposits ?? []).reduce((a, d) => a + Math.abs(numOr0(d.amount)), 0));
      if (sumLines <= 0) continue; // no listed credits to reconcile against
      const label = s.month ?? s._filename ?? "a statement";
      const nLines = (s.deposits ?? []).length;
      const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1);
      // (1) Transpose.
      const dep = num(s.total_deposits);
      if (dep != null && wd != null && dep > 0 && wd > 0) {
        if (rel(sumLines, dep) > 0.10 && rel(sumLines, wd) <= 0.05 && wd < dep) {
          s.total_deposits = wd;
          s.total_withdrawals = dep;
          swapNotes.push(`${label}: debit/credit columns were transposed — corrected deposits to ${money(wd)} (matches the ${nLines} listed credit lines; the ${money(dep)} figure was the Debits column)`);
        }
      }
      // (2) Floor to the sum of listed credit lines (>2% below is impossible-low).
      const depNow = numOr0(s.total_deposits);
      if (sumLines > depNow * 1.02) {
        s.total_deposits = sumLines;
        floorNotes.push(`${label}: deposit total ${money(depNow)} was below the ${nLines} listed credit lines summing ${money(sumLines)} — corrected up to ${money(sumLines)}`);
      }
      // (3) Residual heads-up: many unlisted deposits (reported materially ABOVE the
      // itemized credits). Informational — the revenue basis is auditable.
      const depFinal = numOr0(s.total_deposits);
      if (depFinal > 0 && depFinal > sumLines * 1.15) {
        reconNotes.push(`${label}: deposit total ${money(depFinal)} exceeds the ${nLines} itemized credit lines (${money(sumLines)}) by ${Math.round(rel(sumLines, depFinal) * 100)}% — includes unlisted deposits`);
      }
    }

    // ── PLAID CROSS-CHECK (fraud defense) ──────────────────────────────────────
    // For every month covered by BOTH an uploaded PDF and the connected bank feed,
    // compare the PDF's (integrity-corrected) deposit total against the feed's. A
    // >5% gap is surfaced; when the PDF claims materially MORE than the unfalsifiable
    // feed shows (>10% higher), that is a DOCTORED-STATEMENT signal (critical). Each
    // cross-check lands in the ledger, the metrics.provenance block, and (for gaps)
    // a loud flag below. The feed is never silently swapped in — the PDF stays primary.
    const bankFeedCrossChecks: Array<{ month: string; pdf_deposits: number; plaid_deposits: number; pct_diff: number; fraud: boolean }> = [];
    for (const ps of plaidOverlap) {
      const mk = monthKey(ps.month);
      const pdf = analyzed.find((s) => s.source !== "plaid" && monthKey(s.month) === mk);
      if (!pdf) continue;
      const pdfDep = round2(numOr0(pdf.total_deposits));
      const plaidDep = round2(numOr0(ps.total_deposits));
      const pctDiff = round2(((pdfDep - plaidDep) / Math.max(plaidDep, 1)) * 100);
      const material = Math.abs(pctDiff) > 5;
      const fraud = pdfDep > plaidDep && pctDiff > 10;
      if (material) bankFeedCrossChecks.push({ month: ps.month ?? "", pdf_deposits: pdfDep, plaid_deposits: plaidDep, pct_diff: pctDiff, fraud });
      documentLedger.push({
        filename: ps._filenames?.[0] ?? `Bank feed — ${ps.month}`,
        status: "cross_check",
        month: ps.month,
        account_last4: null,
        source: "plaid",
        detail: material
          ? `bank feed shows ${money(plaidDep)} deposits vs the statement's ${money(pdfDep)} — ${pctDiff > 0 ? "+" : ""}${pctDiff}% ${fraud ? "(statement HIGHER than the feed — possible doctored doc)" : "variance"}`
          : `bank feed ${money(plaidDep)} reconciles with the statement's ${money(pdfDep)} (${pctDiff > 0 ? "+" : ""}${pctDiff}%)`,
      });
    }

    // DISTINCT calendar months — a two-account merchant's pair of April statements
    // is ONE month of coverage, not two. (statements_analyzed carries the file
    // count.) Fall back to the statement count only when no month labels came back.
    const monthsCovered =
      new Set(analyzed.map((s) => String(s.month ?? "").trim().toLowerCase()).filter(Boolean)).size ||
      analyzed.length;

    // ── FAILED-RUN GUARD #1: nothing extracted ──────────────────────────────
    // Not one statement (or bank-feed month) survived extraction, so months_covered
    // is 0 and EVERY metric below would be a zero that is not a fact. Persisting
    // that as a new version silently buries the deal's last good underwriting in
    // every UI that reads the newest row — which is exactly what happened when the
    // Anthropic key ran out of credit: a 200 response carrying months_covered=0 and
    // true_avg_monthly_revenue=0 for two real deals. House rule: loud error, never a
    // silent zero. We write NOTHING here, so the previous version stays the latest.
    if (analyzed.length === 0) {
      const stErrors = perStatement.map((s) => s._error).filter((e): e is string => !!e);
      const providerErr = stErrors.find(isProviderError) ?? null;
      console.error(
        `[underwrite-deal] refusing to persist an empty run for deal ${dealId} — ` +
        (stErrors.join(" | ") || "no statements extracted"),
      );
      return json({
        error: providerErr
          ? providerErrorMessage(providerErr)
          : `Underwriting could not run: none of the ${perStatement.length} bank statement(s) could be read — ${stErrors[0] ?? "unknown extraction failure"}. No version was saved; the previous underwriting is unchanged.`,
        code: providerErr ? "ai_provider_error" : "extraction_failed",
        provider_error: providerErr,
        credits_exhausted: isCreditsExhausted(providerErr),
        persisted: false,
        dealId,
        statement_errors: stErrors.slice(0, 12),
        document_ledger: documentLedger,
      }, providerErr ? 502 : 422);
    }

    // Explicit per-month table rows (chronologically sortable in the UI):
    // month | true deposit count | true-deposit $ | ending balance | avg daily balance | negative days.
    const perMonth: Array<{
      month: string | null;
      deposit_count: number | null;
      true_deposits: number;
      ending_balance: number | null;
      average_daily_balance: number | null;
      negative_days: number;
      // Cash-stress + revenue-quality + holdback (per-month intelligence). mca_daily_debit
      // and holdback_pct are filled in the MCA-positions block below (need the positions).
      nsf_count: number;
      overdraft_fees: number;
      revenue_card: number;
      revenue_cash_check: number;
      revenue_transfer_other: number;
      avg_daily_deposits: number;
      mca_daily_debit: number | null;
      holdback_pct: number | null;
      // Per-month provenance: 📄 statement PDF vs 🏦 bank feed (Plaid). Additive.
      source: "statement_pdf" | "plaid";
    }> = [];
    const perMonthReported: number[] = [];
    const perMonthPadding: number[] = [];
    // Owner-payroll ("questionable") revenue per month — deposits that ARE credited
    // as true revenue by default but are a judgment call (see owner_payroll_treatment).
    const perMonthQuestionable: number[] = [];
    const perMonthNet: number[] = [];
    const paddingByCategory: Record<string, number> = {};
    const questionableBySource: Record<string, number> = {};
    let nsfTotal = 0;
    let negativeDays = 0;
    const balances: number[] = [];
    const minBalances: number[] = [];
    // Statements whose owner-mandated per-month fields had to be repaired/inferred
    // (e.g. the model returned deposit_count 0 despite deposits, or omitted a
    // balance). Surfaced as a data_quality flag — never silently stored.
    const dataQualityIssues: string[] = [];

    for (const s of analyzed) {
      const reported = numOr0(s.total_deposits);
      const padding = (s.padding_deposits ?? []).reduce((sum, p) => {
        const amt = Math.abs(numOr0(p.amount));
        if (p.category) paddingByCategory[p.category] = (paddingByCategory[p.category] ?? 0) + amt;
        return sum + amt;
      }, 0);
      const questionable = (s.questionable_deposits ?? []).reduce((sum, q) => {
        const amt = Math.abs(numOr0(q.amount));
        // Collapse case/whitespace variants of the same payer (e.g. "Your Health
        // Quot" vs "YOUR HEALTH QUOT") so the by-source breakdown doesn't split one
        // source into two lines.
        const src = (q.source || q.desc || "owner payroll").toString().trim().toUpperCase().replace(/\s+/g, " ").slice(0, 80);
        questionableBySource[src] = (questionableBySource[src] ?? 0) + amt;
        return sum + amt;
      }, 0);
      // "net" (true revenue) = deposits − padding. Questionable owner-payroll is NOT
      // padding, so by default it stays IN net (the 'count' / 'flag_and_discount'
      // behavior). It is subtracted below only when treatment == 'exclude'.
      const net = Math.max(0, reported - padding);
      perMonthReported.push(reported);
      perMonthPadding.push(padding);
      perMonthQuestionable.push(questionable);
      perMonthNet.push(net);
      nsfTotal += numOr0(s.nsf_count);
      const monthNegDays = numOr0(s.negative_days);
      negativeDays += monthNegDays;
      if (s.avg_daily_balance != null) balances.push(numOr0(s.avg_daily_balance));
      if (s.min_balance != null) minBalances.push(numOr0(s.min_balance));

      // Per-month row.
      const label = s.month ?? s._filename ?? "a statement";
      const listedDeposits = s.deposits?.length ?? 0;
      const paddingItems = s.padding_deposits?.length ?? 0;
      // TOTAL credit count from the model. Repair when it's missing or implausibly
      // zero while deposits clearly exist — fall back to the listed-deposit count
      // and record a data-quality note (never silently store a 0).
      let totalDepositCount: number | null =
        s.deposit_count != null ? Math.max(0, Math.round(numOr0(s.deposit_count))) : null;
      if ((totalDepositCount == null || totalDepositCount === 0) && (listedDeposits > 0 || reported > 0)) {
        totalDepositCount = listedDeposits > 0 ? listedDeposits : null;
        dataQualityIssues.push(`${label}: deposit count came back 0 despite $${Math.round(reported).toLocaleString("en-US")} in deposits — inferred ${totalDepositCount ?? "n/a"} from line items`);
      }
      // TRUE (revenue) deposit count = total credits − padding transactions.
      const trueDepositCount = totalDepositCount != null ? Math.max(0, totalDepositCount - paddingItems) : null;
      // Bank-feed months legitimately carry no ledger balances (a transaction feed has
      // no running balance) — that is expected, not a data-quality defect, so only the
      // PDF path raises these.
      if (s.source !== "plaid") {
        if (s.closing_balance == null) dataQualityIssues.push(`${label}: no ending balance extracted`);
        if (s.avg_daily_balance == null) dataQualityIssues.push(`${label}: no average daily balance extracted`);
      }

      // Revenue-quality split — card settlements (verifiable; funders trust them) vs
      // cash/branch/check vs transfers/other. Card is detected on the descriptor
      // (BNKCD / Merchant Bankcard / card settlement); transfers via classified_type
      // or descriptor; the remainder is cash/check/other sales. Padding is already out
      // of `net`, so we split the NON-padding credits proportionally to what we can class.
      let card = 0, cashCheck = 0, transferOther = 0;
      for (const dep of (s.deposits ?? [])) {
        const amt = Math.abs(numOr0(dep.amount));
        if (amt <= 0) continue;
        const d = String(dep.desc ?? "").toLowerCase();
        const ct = String(dep.classified_type ?? "").toLowerCase();
        if (/bnkcd|bankcd|bankcard|merch.*card|card settle|cardconnect|mer bnkcd|deposit settle/.test(d)) card += amt;
        else if (ct === "transfer" || /transfer|zelle|xfer|venmo|cashapp/.test(d)) transferOther += amt;
        else if (/cash|branch|check|mobile dep|atm dep|remote dep/.test(d)) cashCheck += amt;
        else transferOther += amt; // unlabeled credits: conservative — NOT card
      }

      perMonth.push({
        month: s.month,
        deposit_count: trueDepositCount,
        true_deposits: round2(net),
        ending_balance: s.closing_balance != null ? round2(numOr0(s.closing_balance)) : null,
        average_daily_balance: s.avg_daily_balance != null ? round2(numOr0(s.avg_daily_balance)) : null,
        negative_days: monthNegDays,
        nsf_count: numOr0(s.nsf_count),
        overdraft_fees: round2(Math.abs(numOr0(s.overdraft_fee_total))),
        revenue_card: round2(card),
        revenue_cash_check: round2(cashCheck),
        revenue_transfer_other: round2(transferOther),
        avg_daily_deposits: round2(net / BIZ_DAYS_PER_MONTH),
        mca_daily_debit: null, // filled in the MCA-positions block below
        holdback_pct: null,
        source: s.source ?? "statement_pdf",
      });
    }
    const overdraftFeesTotal = round2(perMonth.reduce((a, r) => a + r.overdraft_fees, 0));

    // ── COLLECTION ACTIVITY — the funder-gating signal ──────────────────────────
    // Two readers, merged: the extraction model's collection_debits (primary — it
    // saw every line of the statement) and a keyword backstop over the same debits
    // PLUS the financing-debit list (so a garnishment the model filed as an
    // ordinary vendor ACH is still caught). The keyword read is authoritative on
    // TYPE when it fires, because "garnishment"/"levy"/"judgment" in a descriptor
    // is not a judgment call; the model's confidence is honored only downward.
    interface CollectionItem {
      date: string | null; desc: string; amount: number;
      type: CollectionType; month: string | null;
      confidence: CollectionConfidence; source: "ai" | "keyword";
    }
    // De-duped on (month, normalized descriptor, rounded amount) so the same debit
    // reported by BOTH readers lands once, keeping the stronger confidence.
    const collectionByKey = new Map<string, CollectionItem>();
    const CONF_RANK: Record<CollectionConfidence, number> = { low: 0, medium: 1, high: 2 };
    const pushCollection = (it: CollectionItem) => {
      const key = `${it.month ?? "?"}|${it.desc.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60)}|${Math.round(it.amount)}`;
      const prior = collectionByKey.get(key);
      if (!prior) { collectionByKey.set(key, it); return; }
      if (CONF_RANK[it.confidence] > CONF_RANK[prior.confidence]) {
        prior.confidence = it.confidence; prior.source = it.source; prior.type = it.type;
      }
    };

    for (const s of analyzed) {
      const mLabel = s.month ?? null;
      // (1) Model-flagged candidates.
      for (const c of (s.collection_debits ?? [])) {
        const desc = String(c.desc ?? "").trim();
        if (!desc) continue;
        const kw = readCollectionText(desc);
        // A descriptor the false-friend guard vetoes is dropped even when the model
        // flagged it — "Lien Solutions" is a UCC vendor, not a collections event.
        if (COLLECTION_FALSE_FRIEND_RE.test(desc)) continue;
        const type = kw?.type ?? normCollectionType(c.type) ?? "collections";
        const modelConf = normCollectionConfidence(c.confidence) ?? "medium";
        // Keyword corroboration can raise the read to high; without it the model's
        // own word is capped at medium — an unverifiable AI hunch never hard-gates.
        const confidence: CollectionConfidence =
          kw && kw.confidence === "high" ? "high" : modelConf === "high" ? "medium" : modelConf;
        pushCollection({
          date: c.date ? String(c.date) : null, desc, amount: round2(Math.abs(numOr0(c.amount))),
          type, month: mLabel, confidence, source: "ai",
        });
      }
      // (2) Keyword backstop over the financing/vendor debits the model DID return.
      for (const d of (s.mca_debits ?? [])) {
        const desc = String(d.desc ?? d.funder ?? "").trim();
        if (!desc) continue;
        const kw = readCollectionText(desc);
        if (!kw || kw.confidence !== "high") continue; // backstop only promotes unmistakable hits
        pushCollection({
          date: d.date ? String(d.date) : null, desc, amount: round2(Math.abs(numOr0(d.amount))),
          type: kw.type, month: mLabel, confidence: "high", source: "keyword",
        });
      }
    }

    const collectionItems = [...collectionByKey.values()];
    // DETECTION RULE (conservative on purpose): one unmistakable hit is enough, or
    // two independent medium hits. A pile of low-confidence wording alone is NOT
    // collection activity — it is surfaced in items but never fires the gate.
    const highHits = collectionItems.filter((i) => i.confidence === "high");
    const medHits = collectionItems.filter((i) => i.confidence === "medium");
    const collectionDetected = highHits.length >= 1 || medHits.length >= 2;
    const firingItems = collectionDetected ? [...highHits, ...medHits] : [];
    const collectionConfidence: CollectionConfidence =
      highHits.length >= 1 ? "high" : medHits.length >= 2 ? "medium" : "low";
    const collectionTypes = [...new Set(firingItems.map((i) => i.type))];
    const collectionMonths = new Set(firingItems.map((i) => i.month).filter(Boolean));
    const collectionTotal = round2(firingItems.reduce((a, i) => a + i.amount, 0));
    const monthsForRate = Math.max(1, analyzed.filter((s) => !s._error).length);
    const TYPE_LABEL: Record<CollectionType, string> = {
      collections: "collection-agency payment", garnishment: "garnishment",
      tax_levy: "tax levy/lien", judgment: "judgment / writ",
    };

    // ── SECONDARY: UCC corroboration (a DISTINCT signal, never conflated) ────────
    // A UCC lien on the business confirms existing FINANCED POSITIONS — it is the
    // normal footprint of an MCA, not evidence of collection activity. It rides
    // alongside as corroboration only, and never sets or clears the flag.
    let uccCorroboration: {
      matched: boolean; business_name: string | null; filings: number;
      secured_parties: string[]; note: string;
    } | null = null;
    try {
      const bizName = String(cust.business_name ?? "").trim();
      if (bizName.length >= 4) {
        // EXACT (case-insensitive) name match only — a fuzzy match would hang some
        // other business's liens on this merchant. LIKE wildcards in the name are
        // escaped so a stray % can't turn the lookup into a prefix scan.
        const likeSafe = bizName.replace(/[%_\\]/g, (ch) => `\\${ch}`);
        const { data: uccRows } = await db
          .from("ph_ucc_filings")
          .select("secured_party_raw, filed_date, state")
          .ilike("debtor_name", likeSafe)
          .limit(25);
        const rows = (uccRows ?? []) as Any[];
        if (rows.length) {
          const parties = [...new Set(rows.map((r) => String(r.secured_party_raw ?? "").trim()).filter(Boolean))].slice(0, 6);
          uccCorroboration = {
            matched: true,
            business_name: bizName,
            filings: rows.length,
            secured_parties: parties,
            note: `${rows.length} public UCC filing(s) on record for this business${parties.length ? ` (${parties.join(", ")})` : ""}. A UCC lien is the normal footprint of an existing financed position — it is NOT collection activity, but it corroborates that the business already carries secured obligations.`,
          };
        }
      }
    } catch (e) {
      // UCC is a nice-to-have cross-reference; it must never sink an underwriting run.
      console.warn("[underwrite-deal] ucc corroboration lookup failed:", e instanceof Error ? e.message : e);
    }

    const collectionNote = collectionDetected
      ? `${firingItems.length} collection-activity debit(s) across ${collectionMonths.size || 1} statement month(s) — ` +
        `${collectionTypes.map((t) => TYPE_LABEL[t]).join(", ")}${collectionTotal > 0 ? `, ${money(collectionTotal)} total` : ""}. ` +
        `Several funders auto-decline on active collection activity, so confirm this with the merchant before submitting.` +
        (collectionConfidence !== "high" ? " Read is MEDIUM confidence — verify the descriptors on the statements." : "")
      : collectionItems.length > 0
        ? `No collection activity detected. ${collectionItems.length} debit(s) carried collections-adjacent wording but read as ordinary business payments — not flagged.`
        : "No collection activity detected in the analyzed statements — no garnishments, levies, judgments or collection-agency debits.";

    const collectionActivity = {
      detected: collectionDetected,
      confidence: collectionConfidence,
      types: collectionTypes,
      items: (collectionDetected ? firingItems : collectionItems).slice(0, 25),
      monthly_count: round2(firingItems.length / monthsForRate),
      months_with_activity: collectionMonths.size,
      total_amount: collectionTotal,
      note: collectionNote,
      ucc_corroboration: uccCorroboration,
    };

    // ── MCA POSITIONS — grouped, classified, LATEST-MONTH-anchored ──────────────
    // The core fix for the position-inflation bug. Previously mca_debits were unioned
    // across ALL months as if concurrent, so (a) a daily remittance's ~22 dated lines
    // counted as ~22 positions, (b) paid-off advances (LCF, Likety, Marlin, ReadyCap)
    // were summed alongside still-open ones, and (c) non-MCA debt (SBA/EIDL, equipment
    // leases, consumer finance, one-off vendor ACHs) was swept into the MCA bucket —
    // inflating "~24 positions at $6,349/day (267% of revenue)" for a merchant actually
    // carrying ~6 open MCAs. Instead we:
    //   1) group each month's debits into POSITIONS by (funder, recurring amount) —
    //      many dated occurrences of ONE daily amount collapse to one position; the
    //      SAME funder's two distinct recurring amounts stay as two tranches;
    //   2) classify each (mca vs sba_loan / equipment_lease / consumer_finance /
    //      vendor_other) — only 'mca' counts toward stacking + capacity math;
    //   3) ANCHOR active positions + daily debt service to the LATEST month only;
    //      MCA funders seen earlier but absent from the latest month are PAID OFF /
    //      ENDED (reported separately — a positive paydown signal).
    // Because a position's contribution is a per-business-day RATE, a partial latest
    // month (e.g. July through the 21st) neither over- nor under-states the burden.
    type DebitClass = "mca" | "sba_loan" | "equipment_lease" | "consumer_finance" | "vendor_other";
    const NON_MCA_OBLIGATIONS: DebitClass[] = ["sba_loan", "equipment_lease", "consumer_finance"];
    interface PosAgg {
      funderKey: string; funderDisplay: string; amount: number;
      cadenceVotes: Record<string, number>; count: number;
    }
    const monthPositions = new Map<number, { label: string; positions: Map<string, PosAgg> }>();
    // Cross-month funder rollups: class/cadence backfill, timeline, ended detection.
    const funderClassVotes = new Map<string, Record<string, number>>();
    const funderCadenceVotes = new Map<string, Record<string, number>>();
    const funderFirstMonthKey = new Map<string, number>();
    const funderFirstMonthLabel = new Map<string, string>();
    const funderLastMonthKey = new Map<string, number>();
    const funderLastMonthLabel = new Map<string, string>();
    const funderDisplayName = new Map<string, string>();
    // Per-funder occurrence count per month — the deterministic CADENCE signal. A
    // daily remittance hits ~20x in a full month; a weekly one ~4-5x. Occurrence
    // count beats the model's per-line cadence LABEL, which drifts run-to-run.
    const funderMonthCount = new Map<string, Map<number, number>>();
    // Per-funder max recurring amount per month — drives change-event detection
    // (Calabria upsized $272.73→$352.95; Dedicated stepped $500→$1,175.08).
    const funderMonthMaxAmt = new Map<string, Map<number, number>>();
    // Total occurrences of an exact (funder, amount) tranche across ALL months —
    // the payments-to-date proxy for remaining-balance estimation.
    const posTotalOcc = new Map<string, number>();

    for (const s of analyzed) {
      const t = Date.parse(`1 ${String(s.month ?? "").trim()}`);
      if (Number.isNaN(t)) continue; // a periodless statement can't be anchored — its debits drop out
      const d = new Date(t);
      const mKey = d.getUTCFullYear() * 12 + d.getUTCMonth();
      const label = String(s.month).trim();
      let bucket = monthPositions.get(mKey);
      if (!bucket) { bucket = { label, positions: new Map() }; monthPositions.set(mKey, bucket); }
      for (const dbt of (s.mca_debits ?? [])) {
        const amt = Math.abs(numOr0(dbt.amount));
        if (amt <= 0) continue;
        const rawFunder = (dbt.funder && String(dbt.funder).trim()) || String(dbt.desc ?? "").trim() || "Unknown";
        const funderKey = normFunder(rawFunder) || "UNKNOWN";
        const cadence = (dbt.cadence || "unknown").toLowerCase();
        const klass = normDebitClass(dbt.debit_class);
        // A position = (funder, recurring amount). Many dated hits of the same daily
        // amount fold into one; a second distinct amount for the same funder is a tranche.
        // Honor an aggregated 'occurrences' count when present (one entry per
        // funder+amount with occurrences:N); falls back to 1 when the model lists
        // one line per date. Either extraction style yields the same monthly count.
        const occ = Math.max(1, Math.round(numOr0(dbt.occurrences) || 1));
        const posKey = `${funderKey}|${Math.round(amt)}`;
        let pos = bucket.positions.get(posKey);
        if (!pos) {
          pos = { funderKey, funderDisplay: cleanFunderDisplay(rawFunder), amount: amt, cadenceVotes: {}, count: 0 };
          bucket.positions.set(posKey, pos);
        }
        pos.count += occ;
        pos.cadenceVotes[cadence] = (pos.cadenceVotes[cadence] ?? 0) + occ;
        posTotalOcc.set(posKey, (posTotalOcc.get(posKey) ?? 0) + occ);
        const fcv = funderClassVotes.get(funderKey) ?? {};
        fcv[klass] = (fcv[klass] ?? 0) + occ; funderClassVotes.set(funderKey, fcv);
        if (cadence !== "unknown") {
          const fca = funderCadenceVotes.get(funderKey) ?? {};
          fca[cadence] = (fca[cadence] ?? 0) + occ; funderCadenceVotes.set(funderKey, fca);
        }
        if (!funderDisplayName.has(funderKey)) funderDisplayName.set(funderKey, cleanFunderDisplay(rawFunder));
        if ((funderFirstMonthKey.get(funderKey) ?? Infinity) > mKey) {
          funderFirstMonthKey.set(funderKey, mKey); funderFirstMonthLabel.set(funderKey, label);
        }
        if ((funderLastMonthKey.get(funderKey) ?? -Infinity) < mKey) {
          funderLastMonthKey.set(funderKey, mKey); funderLastMonthLabel.set(funderKey, label);
        }
        const fmc = funderMonthCount.get(funderKey) ?? new Map<number, number>();
        fmc.set(mKey, (fmc.get(mKey) ?? 0) + occ); funderMonthCount.set(funderKey, fmc);
        const fma = funderMonthMaxAmt.get(funderKey) ?? new Map<number, number>();
        fma.set(mKey, Math.max(fma.get(mKey) ?? 0, amt)); funderMonthMaxAmt.set(funderKey, fma);
      }
    }

    const latestKey = monthPositions.size ? Math.max(...monthPositions.keys()) : null;
    const latestBucket = latestKey != null ? monthPositions.get(latestKey)! : null;
    const latestMonthLabel = latestBucket?.label ?? null;

    const majorityVote = (votes: Record<string, number>): string | null => {
      let best: string | null = null; let bestN = -1;
      for (const [k, n] of Object.entries(votes)) if (n > bestN) { best = k; bestN = n; }
      return best;
    };
    // A funder's class is decided ONCE across all months (a line the model missed one
    // month can't split one funder across two classes). Default 'mca' = conservative.
    const funderClass = (fk: string): DebitClass =>
      (majorityVote(funderClassVotes.get(fk) ?? {}) as DebitClass) || "mca";
    // Cadence per funder, deterministic occurrence-count first (see funderMonthCount).
    const funderCadence = (fk: string): string => {
      const fm = funderMonthCount.get(fk);
      if (fm) {
        let maxAll = 0; let maxFull = 0;
        for (const [mk, c] of fm) {
          if (c > maxAll) maxAll = c;
          if (mk !== latestKey && c > maxFull) maxFull = c;
        }
        if (maxAll >= 10) return "daily";   // ~daily hit rate in some month
        if (maxFull >= 2) return "weekly";  // multiple hits in a FULL month, never near-daily
        if (maxAll === 1) return "monthly"; // at most one hit in every month ⇒ monthly
      }
      const lbl = majorityVote(funderCadenceVotes.get(fk) ?? {});
      return lbl ?? "weekly"; // last resort: weekly (mid estimate)
    };
    const dailyRateOf = (amount: number, cadence: string): number =>
      cadence === "daily" ? amount
      : cadence === "weekly" ? amount / BIZ_DAYS_PER_WEEK
      : cadence === "monthly" ? amount / BIZ_DAYS_PER_MONTH
      : amount / BIZ_DAYS_PER_WEEK; // unknown ≈ weekly (mid estimate, avoids understating)

    // ── ACTIVE POSITIONS vs ONE-OFF/STEP-UP ANOMALIES (latest month) ──
    // Within the latest month, group a funder's tranches. A tranche that RECURS
    // (>=2 hits, or the funder's only amount) is a real position; a SINGLE hit of a
    // second amount alongside a recurring stream is a one-off charge or a stepped-up/
    // catch-up payment (Nav Kapital's lone $150 next to its $540/day stream; Dedicated
    // stepping $500/wk → $1,175.08 on the 21st) — surfaced as an anomaly, NOT counted
    // as its own daily position (which would double the funder's burden).
    const activePositions: Array<{ funder: string; cadence: string; amount: number; daily_amount: number; class: DebitClass; occurrences_latest: number }> = [];
    const otherObligations: Array<{ funder: string; class: DebitClass; cadence: string; amount: number; monthly: number }> = [];
    const positionAnomalies: Array<{ funder: string; class: DebitClass; amount: number; note: string }> = [];
    let mcaDailyLatest = 0;
    let otherObligationsMonthly = 0;
    const latestMcaFunders = new Set<string>();
    if (latestBucket) {
      const byFunder = new Map<string, PosAgg[]>();
      for (const pos of latestBucket.positions.values()) {
        (byFunder.get(pos.funderKey) ?? byFunder.set(pos.funderKey, []).get(pos.funderKey)!).push(pos);
      }
      for (const [fk, poss] of byFunder) {
        const klass = funderClass(fk);
        const cadence = funderCadence(fk);
        const maxCount = Math.max(...poss.map((p) => p.count));
        for (const pos of poss) {
          const recurring = pos.count >= 2 || maxCount === 1;
          if (!recurring) {
            positionAnomalies.push({
              funder: pos.funderDisplay, class: klass, amount: round2(pos.amount),
              note: `single ${money(pos.amount)} debit in ${latestMonthLabel} beside ${pos.funderDisplay}'s recurring ${cadence} stream — a one-off charge or a stepped-up/catch-up payment, not a separate position`,
            });
            continue;
          }
          const daily = round2(dailyRateOf(pos.amount, cadence));
          if (klass === "mca") {
            latestMcaFunders.add(fk);
            mcaDailyLatest += daily;
            activePositions.push({ funder: pos.funderDisplay, cadence, amount: round2(pos.amount), daily_amount: daily, class: "mca", occurrences_latest: pos.count });
          } else if (NON_MCA_OBLIGATIONS.includes(klass)) {
            const monthly = round2(daily * BIZ_DAYS_PER_MONTH);
            otherObligationsMonthly += monthly;
            otherObligations.push({ funder: pos.funderDisplay, class: klass, cadence, amount: round2(pos.amount), monthly });
          }
          // vendor_other: dropped — one-off supplier/bill ACHs are not a recurring obligation.
        }
      }
    }
    mcaDailyLatest = round2(mcaDailyLatest);
    otherObligationsMonthly = round2(otherObligationsMonthly);
    activePositions.sort((a, b) => b.daily_amount - a.daily_amount);
    otherObligations.sort((a, b) => b.monthly - a.monthly);
    positionAnomalies.sort((a, b) => b.amount - a.amount);

    // Funder-variant matching — the model's spelling drifts month to month ("Unifie
    // Fund" vs "Unified Funding", "Likety Cap" vs "Liketycap"); match on a first-token
    // prefix (>=4 chars) so a still-active funder isn't reported as paid off, and
    // variant duplicates collapse.
    const firstTok = (k: string) => k.split(" ")[0] ?? k;
    const sameFunder = (a: string, b: string): boolean => {
      const ta = firstTok(a); const tb = firstTok(b);
      if (ta === tb) return true;
      const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
      return short.length >= 4 && long.startsWith(short);
    };
    const activeFunderKeys = [...latestMcaFunders];

    // ── ENDED MCA POSITIONS (paid off / gone from the latest month) ──
    const endedByKey = new Map<string, { funderKey: string; funder: string; monthKey: number; last_seen_month: string }>();
    for (const [fk, klassVotes] of funderClassVotes.entries()) {
      if (((majorityVote(klassVotes) as DebitClass) || "mca") !== "mca") continue;
      if (activeFunderKeys.some((af) => sameFunder(af, fk))) continue; // still open under any name variant
      const mKey = funderLastMonthKey.get(fk) ?? 0;
      const dupeKey = [...endedByKey.keys()].find((k) => sameFunder(k, fk));
      if (dupeKey) {
        const cur = endedByKey.get(dupeKey)!;
        if (mKey > cur.monthKey) endedByKey.set(dupeKey, { funderKey: fk, funder: funderDisplayName.get(fk) ?? fk, monthKey: mKey, last_seen_month: funderLastMonthLabel.get(fk) ?? "" });
      } else {
        endedByKey.set(fk, { funderKey: fk, funder: funderDisplayName.get(fk) ?? fk, monthKey: mKey, last_seen_month: funderLastMonthLabel.get(fk) ?? "" });
      }
    }
    const endedPositions: Array<{ funder: string; last_seen_month: string; class: DebitClass }> =
      [...endedByKey.values()]
        .sort((a, b) => b.monthKey - a.monthKey)
        .map((e) => ({ funder: e.funder, last_seen_month: e.last_seen_month, class: "mca" as DebitClass }));

    // ── POSITION TIMELINE — every recurring debitor across ALL months ──
    // funder, class, cadence, representative amount, first/last seen, status, and any
    // change event (upsize/step-up). The at-a-glance history the owner wants on screen.
    const monthLabelOf = (mk: number) =>
      new Date(Date.UTC(Math.floor(mk / 12), mk % 12, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    const positionTimeline = [...funderClassVotes.keys()].map((fk) => {
      const klass = funderClass(fk);
      const cadence = funderCadence(fk);
      const firstK = funderFirstMonthKey.get(fk) ?? 0;
      const lastK = funderLastMonthKey.get(fk) ?? 0;
      const active = activeFunderKeys.some((af) => sameFunder(af, fk));
      // Representative amount: the funder's max amount in its last-seen month.
      const lastMaxAmt = funderMonthMaxAmt.get(fk)?.get(lastK) ?? 0;
      const firstMaxAmt = funderMonthMaxAmt.get(fk)?.get(firstK) ?? 0;
      const changed = firstMaxAmt > 0 && lastMaxAmt > firstMaxAmt * 1.1;
      return {
        funder: funderDisplayName.get(fk) ?? fk,
        class: klass,
        cadence,
        amount: round2(lastMaxAmt),
        first_seen_month: funderFirstMonthLabel.get(fk) ?? monthLabelOf(firstK),
        last_seen_month: funderLastMonthLabel.get(fk) ?? monthLabelOf(lastK),
        status: (active ? "active" : "paid_off") as "active" | "paid_off",
        change_event: changed
          ? `increased from ${money(firstMaxAmt)} to ${money(lastMaxAmt)} (renewal / step-up)`
          : null,
        _firstK: firstK, _lastK: lastK,
      };
    }).sort((a, b) =>
      (a.status === b.status ? b._lastK - a._lastK : a.status === "active" ? -1 : 1),
    ).map(({ _firstK: _f, _lastK: _l, ...t }) => t);

    // ── ESTIMATED REMAINING BALANCE per active MCA position ──
    // original ≈ daily_rate × typical term (60 / 80 / 100 business days = low/mid/high),
    // minus payments-to-date (actual debit occurrences × amount, across all statements).
    // ESTIMATE ONLY — payoff letters required to confirm. Term-band low→high maps to
    // shorter→longer assumed term (bigger original ⇒ bigger remaining).
    const TERM_BANDS = { low: 60, mid: 80, high: 100 };
    const remainingByPosition = activePositions.map((p) => {
      const posKey = `${normFunder(p.funder)}|${Math.round(p.amount)}`;
      const occ = posTotalOcc.get(posKey) ?? 0;
      const paidToDate = round2(occ * p.amount);
      const est = (biz: number) => Math.max(0, round2(p.daily_amount * biz - paidToDate));
      return {
        funder: p.funder, cadence: p.cadence, daily_amount: p.daily_amount,
        payments_to_date: paidToDate, occurrences: occ,
        remaining_low: est(TERM_BANDS.low), remaining_mid: est(TERM_BANDS.mid), remaining_high: est(TERM_BANDS.high),
      };
    });
    const outstandingLow = round2(remainingByPosition.reduce((a, r) => a + r.remaining_low, 0));
    const outstandingMid = round2(remainingByPosition.reduce((a, r) => a + r.remaining_mid, 0));
    const outstandingHigh = round2(remainingByPosition.reduce((a, r) => a + r.remaining_high, 0));

    // ── STACKING VELOCITY — positions added vs retired per month ──
    const velocityByMonth = [...monthPositions.keys()].sort((a, b) => a - b).map((mk) => {
      let added = 0; let ended = 0;
      for (const [fk, votes] of funderClassVotes.entries()) {
        if (((majorityVote(votes) as DebitClass) || "mca") !== "mca") continue;
        if ((funderFirstMonthKey.get(fk) ?? -1) === mk) added += 1;
        if ((funderLastMonthKey.get(fk) ?? -1) === mk && !activeFunderKeys.some((af) => sameFunder(af, fk))) ended += 1;
      }
      return { month: monthPositions.get(mk)!.label, added, ended };
    });
    const addedFunders = [...funderClassVotes.keys()]
      .filter((fk) => funderClass(fk) === "mca" && (funderFirstMonthKey.get(fk) ?? 0) > (monthPositions.size ? Math.min(...monthPositions.keys()) : 0) && activeFunderKeys.some((af) => sameFunder(af, fk)))
      .map((fk) => `${funderDisplayName.get(fk) ?? fk} (${funderFirstMonthLabel.get(fk) ?? ""})`);
    const retiredFunders = endedPositions.map((e) => `${e.funder} (${e.last_seen_month})`);
    const stackingVelocityNarrative =
      (addedFunders.length
        ? `Added ${addedFunders.length} MCA position(s) mid-period: ${addedFunders.join(", ")}. `
        : "No new MCA positions added within the analyzed window. ") +
      (retiredFunders.length
        ? `Retired: ${retiredFunders.join(", ")}. ${addedFunders.length && retiredFunders.length ? "New advances are largely REPLACING retired ones (replacement stacking), not pure accumulation." : ""}`
        : "");

    // ── HOLDBACK RATIO per month — MCA daily remittance ÷ avg daily deposits ──
    // >100% means the merchant remits more per day to advances than he deposits.
    // Attach to the per-month rows (which already carry avg_daily_deposits).
    for (const [mk, bucket] of monthPositions) {
      let mcaDaily = 0;
      const byF = new Map<string, PosAgg[]>();
      for (const pos of bucket.positions.values()) (byF.get(pos.funderKey) ?? byF.set(pos.funderKey, []).get(pos.funderKey)!).push(pos);
      for (const [fk, poss] of byF) {
        if (funderClass(fk) !== "mca") continue;
        const cad = funderCadence(fk);
        const maxC = Math.max(...poss.map((p) => p.count));
        for (const pos of poss) {
          if (!(pos.count >= 2 || maxC === 1)) continue; // skip one-off/step-up hits
          mcaDaily += dailyRateOf(pos.amount, cad);
        }
      }
      const row = perMonth.find((r) => r.month && Date.parse(`1 ${r.month}`) === Date.parse(`1 ${bucket.label}`));
      if (row) {
        row.mca_daily_debit = round2(mcaDaily);
        row.holdback_pct = row.avg_daily_deposits > 0 ? round2((mcaDaily / row.avg_daily_deposits) * 100) : null;
      }
    }

    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const reportedAvgMonthlyRevenue = round2(avg(perMonthReported));
    const paddingTotal = round2(perMonthPadding.reduce((a, b) => a + b, 0));

    // Owner-payroll ("questionable") treatment. 'count'/'flag_and_discount' leave it
    // IN true revenue; 'exclude' removes it. The conservative figure (revenue if the
    // questionable income were personal/W-2 rather than business) is always computed
    // so the judge + assumptions can state the downside without a merchant round-trip.
    const ownerPayrollTreatment = ((settings.owner_payroll_treatment as string) || "flag_and_discount");
    const questionableTotal = round2(perMonthQuestionable.reduce((a, b) => a + b, 0));
    const avgQuestionableMonthly = round2(avg(perMonthQuestionable));
    // per-month net EXCLUDING questionable income = the conservative revenue series.
    const perMonthNetConservative = perMonthNet.map((n, i) => Math.max(0, n - (perMonthQuestionable[i] ?? 0)));
    const conservativeAvgMonthlyRevenue = round2(avg(perMonthNetConservative));

    // Effective net series feeding the affordability math depends on the treatment:
    //   count / flag_and_discount → keep questionable in (base case)
    //   exclude                   → drop it (use the conservative series)
    const effPerMonthNet = ownerPayrollTreatment === "exclude" ? perMonthNetConservative : perMonthNet;
    const trueAvgMonthlyRevenue = round2(avg(effPerMonthNet));
    const avgNetRetained = trueAvgMonthlyRevenue; // deposits − padding (− questionable if excluded)
    const revenueQualityPct = reportedAvgMonthlyRevenue > 0
      ? round2((trueAvgMonthlyRevenue / reportedAvgMonthlyRevenue) * 100)
      : 100;

    // ── NORMAL-SEASON vs PARTIAL/WORST month revenue ──
    // The latest statement is often the CURRENT (partial) month — including it drags
    // the average below the merchant's real run-rate. Compute a normal-season average
    // over the FULL months only when the latest month looks partial (its net is well
    // below the others), plus the worst-month figure, for the refi feasibility read
    // and the judge (which weighs a real seasonal dip without fabricating revenue).
    const netByMonthK = new Map<number, number>();
    analyzed.forEach((s, i) => {
      const t = Date.parse(`1 ${String(s.month ?? "").trim()}`);
      if (Number.isNaN(t)) return;
      const mk = new Date(t).getUTCFullYear() * 12 + new Date(t).getUTCMonth();
      netByMonthK.set(mk, (netByMonthK.get(mk) ?? 0) + (effPerMonthNet[i] ?? 0));
    });
    const otherMonthsNet = [...netByMonthK.entries()].filter(([mk]) => mk !== latestKey).map(([, v]) => v);
    const latestMonthNet = latestKey != null ? (netByMonthK.get(latestKey) ?? 0) : 0;
    const latestIsPartial = otherMonthsNet.length >= 1 && latestMonthNet > 0 &&
      latestMonthNet < 0.7 * avg(otherMonthsNet);
    const normalSeasonAvgMonthlyRevenue = latestIsPartial && otherMonthsNet.length >= 1
      ? round2(avg(otherMonthsNet))
      : trueAvgMonthlyRevenue;
    const allMonthsNetVals = [...netByMonthK.values()];
    const worstMonthRevenue = allMonthsNetVals.length ? round2(Math.min(...allMonthsNetVals)) : trueAvgMonthlyRevenue;

    // ── REFI / CONSOLIDATION FEASIBILITY ──
    // Roll the estimated outstanding MCA balance (mid-case) into one longer-term
    // payment: payback = outstanding × factor, spread over 12/18/24 months. Each
    // monthly payment is measured against BOTH normal-season revenue and the worst
    // month. A consolidation is a longer-term product than an MCA, so the viability
    // band is more lenient than the MCA holdback cap: <=15% of revenue = viable,
    // 15-22% = tight, >22% = not viable. Payoff letters required to confirm balances.
    const REFI_FACTOR = 1.45;
    const refiPayback = round2(outstandingMid * REFI_FACTOR);
    const refiViabilityOf = (pct: number): "viable" | "tight" | "not_viable" =>
      pct <= 15 ? "viable" : pct <= 22 ? "tight" : "not_viable";
    const refiTerms = [12, 18, 24].map((months) => {
      const monthly = round2(refiPayback / months);
      const pctNormal = normalSeasonAvgMonthlyRevenue > 0 ? round2((monthly / normalSeasonAvgMonthlyRevenue) * 100) : null;
      const pctWorst = worstMonthRevenue > 0 ? round2((monthly / worstMonthRevenue) * 100) : null;
      return {
        months, monthly_payment: monthly,
        pct_of_normal_revenue: pctNormal, pct_of_worst_month: pctWorst,
        verdict: pctNormal != null ? refiViabilityOf(pctNormal) : ("tight" as "viable" | "tight" | "not_viable"),
      };
    });
    const bestRefi = refiTerms.find((t) => t.verdict === "viable") ?? refiTerms.find((t) => t.verdict === "tight") ?? null;
    const refiFeasible = refiTerms.some((t) => t.verdict === "viable");
    const refiVerdict = outstandingMid <= 0
      ? "No meaningful MCA balance to consolidate."
      : bestRefi
        ? `Consolidating ~${money(outstandingMid)} at ${bestRefi.months}mo ≈ ${money(bestRefi.monthly_payment)}/mo = ${bestRefi.pct_of_normal_revenue}% of normal-season revenue — ${bestRefi.verdict === "viable" ? "VIABLE" : "TIGHT"} pending payoff letters.`
        : `Even at 24 months, consolidating ~${money(outstandingMid)} lands above ${refiTerms[refiTerms.length - 1].pct_of_normal_revenue}% of normal-season revenue — not viable in-network without more revenue.`;
    const refi = {
      est_outstanding_low: outstandingLow,
      est_outstanding_mid: outstandingMid,
      est_outstanding_high: outstandingHigh,
      factor: REFI_FACTOR,
      payback_mid: refiPayback,
      normal_season_revenue: normalSeasonAvgMonthlyRevenue,
      worst_month_revenue: worstMonthRevenue,
      terms: refiTerms,
      feasible: refiFeasible,
      verdict: refiVerdict,
      caveat: "Balances are ESTIMATES (daily rate × 60/80/100 business-day term − payments observed); payoff letters required to confirm.",
    };

    // Existing daily MCA debit — prefer the deal's known VCF daily debit if set,
    // else the LATEST-MONTH active-MCA daily remittance (NOT a cross-month union of
    // every debit ever seen; see the MCA POSITIONS block above).
    const dealDailyDebit = num(deal.vcf_daily_debit);
    const existingDailyDebit = dealDailyDebit != null && dealDailyDebit > 0
      ? round2(dealDailyDebit)
      : mcaDailyLatest;

    // Affordability math (see BIZ_DAYS constants above).
    const trueDailyRevenue = trueAvgMonthlyRevenue / BIZ_DAYS_PER_MONTH;
    const holdbackFraction = numOr0(settings.holdback_ceiling_pct) / 100;
    const safeDailyDebitCapacity = round2(Math.max(0, trueDailyRevenue * holdbackFraction - existingDailyDebit));
    const maxAffordableAdvance = round2(safeDailyDebitCapacity * TERM_BIZ_DAYS);
    const debtServicePct = trueAvgMonthlyRevenue > 0
      ? round2(((existingDailyDebit * BIZ_DAYS_PER_MONTH) / trueAvgMonthlyRevenue) * 100)
      : 0;

    const estOpenPositions = activePositions.length ||
      (num(deal.vcf_active_positions) ?? 0) || (existingDailyDebit > 0 ? 1 : 0);

    // Revenue trend across the analyzed months (first vs last third).
    const revenueTrend = trendOf(effPerMonthNet);

    // Deposit concentration — largest single sales deposit vs total deposits
    // (a proxy for one-customer dependency). Computed across all analyzed months.
    let biggestDeposit = 0;
    let allDepositsTotal = 0;
    for (const s of analyzed) {
      for (const dep of (s.deposits ?? [])) {
        const amt = Math.abs(numOr0(dep.amount));
        allDepositsTotal += amt;
        if (amt > biggestDeposit) biggestDeposit = amt;
      }
    }
    const depositConcentrationPct = allDepositsTotal > 0
      ? round2((biggestDeposit / allDepositsTotal) * 100)
      : 0;

    const amountRequested = num(deal.amount_requested);
    const avgDailyBalance = balances.length ? round2(avg(balances)) : null;
    const minBalance = minBalances.length ? round2(Math.min(...minBalances)) : null;

    // Conservative sensitivity: what the affordability looks like if the questionable
    // owner-payroll income turned out to be personal (excluded). Always computed so
    // the judge can state base-vs-conservative even under 'count'/'flag_and_discount'.
    const consDailyRevenue = conservativeAvgMonthlyRevenue / BIZ_DAYS_PER_MONTH;
    const consSafeDailyCapacity = round2(Math.max(0, consDailyRevenue * holdbackFraction - existingDailyDebit));
    const conservativeMaxAffordableAdvance = round2(consSafeDailyCapacity * TERM_BIZ_DAYS);
    const hasQuestionable = questionableTotal > 0;

    // Chronological per-month table (upload order is arbitrary — sort by month).
    perMonth.sort((a, b) => {
      const ta = Date.parse(`1 ${a.month ?? ""}`);
      const tb = Date.parse(`1 ${b.month ?? ""}`);
      return Number.isNaN(ta) || Number.isNaN(tb) ? 0 : ta - tb;
    });

    // ── FIRST-CLASS AFFORDABILITY (deterministic — daily vs weekly) ──
    // Two independent ceilings, we take the tighter:
    //   1) REVENUE ceiling — total debt service (existing positions + new advance)
    //      must stay within max_payment_pct_of_revenue of TRUE monthly revenue.
    //      New capacity = pct×revenue − existing debits, spread over the month.
    //   2) BALANCE ceiling — the new payment may not exceed balance_buffer_pct of
    //      the WORST month's average daily balance, so a thin-balance merchant
    //      can't be sized on revenue math alone.
    // Then advance = sustainable payment × term ÷ factor, for BOTH a daily remit
    // (term_daily_biz_days) and a weekly remit (term_weekly_weeks).
    const maxPayPct = numOr0(settings.max_payment_pct_of_revenue) / 100;
    const bufferPct = numOr0(settings.balance_buffer_pct) / 100;
    const factorRate = numOr0(settings.affordability_factor_rate) || 1.35;
    const termDailyDays = numOr0(settings.term_daily_biz_days) || 120;
    const termWeeklyWeeks = numOr0(settings.term_weekly_weeks) || 26;
    const existingMonthlyDebt = round2(existingDailyDebit * BIZ_DAYS_PER_MONTH);
    // Worst-month avg daily balance drives the balance guard (fallback: overall avg).
    const perMonthAvgBalances = perMonth
      .map((r) => r.average_daily_balance)
      .filter((x): x is number => x != null);
    const worstMonthAvgBalance = perMonthAvgBalances.length
      ? Math.min(...perMonthAvgBalances)
      : avgDailyBalance;

    // Builds an affordability read for a given true-monthly-revenue figure.
    const affordabilityFor = (monthlyRevenue: number) => {
      const allowedTotalMonthly = maxPayPct * Math.max(0, monthlyRevenue);
      const allowedNewMonthly = Math.max(0, allowedTotalMonthly - existingMonthlyDebt);
      const revDaily = allowedNewMonthly / BIZ_DAYS_PER_MONTH;
      const revWeekly = allowedNewMonthly / WEEKS_PER_MONTH;
      // Balance guard: cap the daily pull at a fraction of the worst avg balance.
      const balDaily = worstMonthAvgBalance != null && worstMonthAvgBalance > 0
        ? bufferPct * worstMonthAvgBalance
        : (worstMonthAvgBalance != null ? 0 : Infinity); // <=0 balance ⇒ no room; unknown ⇒ no cap
      const balWeekly = balDaily === Infinity ? Infinity : balDaily * BIZ_DAYS_PER_WEEK;
      const maxDaily = round2(Math.max(0, Math.min(revDaily, balDaily)));
      const maxWeekly = round2(Math.max(0, Math.min(revWeekly, balWeekly)));
      const bindingDaily = balDaily < revDaily ? "balance" : "revenue";
      const bindingWeekly = balWeekly < revWeekly ? "balance" : "revenue";
      return {
        max_daily_payment: maxDaily,
        max_weekly_payment: maxWeekly,
        max_advance_daily: round2((maxDaily * termDailyDays) / factorRate),
        max_advance_weekly: round2((maxWeekly * termWeeklyWeeks) / factorRate),
        binding_daily: bindingDaily,
        binding_weekly: bindingWeekly,
      };
    };

    const affBase = affordabilityFor(trueAvgMonthlyRevenue);
    const affCons = affordabilityFor(conservativeAvgMonthlyRevenue);
    // What the requested amount WOULD demand as a daily / weekly pull.
    const reqDailyPayment = amountRequested != null && amountRequested > 0
      ? round2((amountRequested * factorRate) / termDailyDays) : null;
    const reqWeeklyPayment = amountRequested != null && amountRequested > 0
      ? round2((amountRequested * factorRate) / termWeeklyWeeks) : null;
    const affordableDaily = reqDailyPayment == null ? null : affBase.max_daily_payment >= reqDailyPayment;
    const affordableWeekly = reqWeeklyPayment == null ? null : affBase.max_weekly_payment >= reqWeeklyPayment;

    const affordability = {
      // knobs used (surfaced as assumptions text in the UI)
      max_payment_pct_of_revenue: numOr0(settings.max_payment_pct_of_revenue),
      balance_buffer_pct: numOr0(settings.balance_buffer_pct),
      factor_rate: factorRate,
      term_daily_biz_days: termDailyDays,
      term_weekly_weeks: termWeeklyWeeks,
      // inputs
      monthly_revenue_basis: trueAvgMonthlyRevenue,
      existing_daily_debit: existingDailyDebit,
      existing_monthly_debt_service: existingMonthlyDebt,
      balance_basis: worstMonthAvgBalance != null ? round2(worstMonthAvgBalance) : null,
      // base-case results
      max_daily_payment: affBase.max_daily_payment,
      max_weekly_payment: affBase.max_weekly_payment,
      max_advance_daily: affBase.max_advance_daily,
      max_advance_weekly: affBase.max_advance_weekly,
      binding_constraint_daily: affBase.binding_daily,
      binding_constraint_weekly: affBase.binding_weekly,
      // requested-amount comparison
      amount_requested: amountRequested,
      required_daily_payment: reqDailyPayment,
      required_weekly_payment: reqWeeklyPayment,
      affordable_daily: affordableDaily,
      affordable_weekly: affordableWeekly,
      // conservative sensitivity (owner-payroll excluded) — only meaningful when present
      conservative: hasQuestionable
        ? {
            monthly_revenue_basis: conservativeAvgMonthlyRevenue,
            max_daily_payment: affCons.max_daily_payment,
            max_weekly_payment: affCons.max_weekly_payment,
            max_advance_daily: affCons.max_advance_daily,
            max_advance_weekly: affCons.max_advance_weekly,
            affordable_daily: reqDailyPayment == null ? null : affCons.max_daily_payment >= reqDailyPayment,
            affordable_weekly: reqWeeklyPayment == null ? null : affCons.max_weekly_payment >= reqWeeklyPayment,
          }
        : null,
    };


    // ── FUNDER BOXES (for path box-matching AND the judge minimums) ──
    // Load every active MCA program once, with the lender's onboarding STATUS +
    // name, so the paths below can name which funders' recorded boxes fit a given
    // size/revenue/TIB. Box-matching is deterministic (never an AI call).
    const { data: mcaPrograms } = await db
      .from("lender_programs")
      .select("monthly_revenue_required, min_credit_score, approval_min, approval_max, time_in_business_months, lenders!inner(company_name, status)")
      .eq("product_type", "mca").eq("is_active", true);
    const funderBoxes = ((mcaPrograms ?? []) as Any[]).map((p) => {
      const l = (Array.isArray(p.lenders) ? p.lenders[0] : p.lenders) as Any | undefined;
      return {
        name: (l?.company_name as string) ?? "Funder",
        status: (l?.status as string) ?? "",
        // numOrNull, NOT num(): an unrecorded box field must stay null so it reads as
        // "no constraint". With num() a blank approval_max became 0 and excluded the
        // funder from every path (advance > 0 is always true).
        rev_req: numOrNull(p.monthly_revenue_required),
        approval_min: numOrNull(p.approval_min),
        approval_max: numOrNull(p.approval_max),
        tib: numOrNull(p.time_in_business_months),
        min_credit_score: numOrNull(p.min_credit_score),
      };
    });

    // ── WHAT-IF SCENARIOS (deterministic — NO extra LLM call) ──
    // The single verdict can't answer the two questions a closer actually asks on a
    // stacked, padded deal: "if he RESTRUCTURES his existing MCAs, does the math
    // change?" and "what if ALL his revenue were real?". We answer both with the
    // SAME first-class affordability math (payment cap, balance buffer, factor, term
    // — see affordabilityFor above); only two inputs move: the revenue basis (true
    // vs reported) and the existing monthly debt (as-is vs zeroed by a clean
    // restructure). Each scenario reports the daily-remit capacity + max advance and
    // how it stacks against the ask.
    const askAmt = amountRequested != null && amountRequested > 0 ? amountRequested : null;
    const vsAsk = (adv: number): { status: "green" | "amber" | "red" | "na"; delta: number | null } => {
      if (askAmt == null) return { status: "na", delta: null };
      const delta = round2(adv - askAmt);
      const status = adv >= askAmt ? "green" : adv >= askAmt * 0.7 ? "amber" : "red";
      return { status, delta };
    };
    // Daily-remit affordability for an arbitrary (revenue, existing-monthly-debt)
    // pair — identical revenue-cap + balance-buffer logic to affordabilityFor, but
    // the existing debt is a parameter so a restructure can zero it out.
    const scenarioDaily = (monthlyRevenue: number, existingMonthly: number) => {
      const allowedTotalMonthly = maxPayPct * Math.max(0, monthlyRevenue);
      const allowedNewMonthly = Math.max(0, allowedTotalMonthly - Math.max(0, existingMonthly));
      const revDaily = allowedNewMonthly / BIZ_DAYS_PER_MONTH;
      const balDaily = worstMonthAvgBalance != null && worstMonthAvgBalance > 0
        ? bufferPct * worstMonthAvgBalance
        : (worstMonthAvgBalance != null ? 0 : Infinity); // <=0 balance ⇒ no room; unknown ⇒ no cap
      const capacity = round2(Math.max(0, Math.min(revDaily, balDaily)));
      const binding = balDaily < revDaily ? "balance" : "revenue";
      const advance = round2((capacity * termDailyDays) / factorRate);
      return { capacity, advance, binding };
    };
    const buildScenario = (
      key: string, label: string, monthlyRevenue: number, existingMonthly: number, note: string,
    ) => {
      const r = scenarioDaily(monthlyRevenue, existingMonthly);
      return {
        key, label,
        capacity_per_day: r.capacity,
        max_affordable_advance: r.advance,
        binding_constraint: r.binding,
        affordable_vs_ask: vsAsk(r.advance),
        note,
      };
    };
    const scAsIs = buildScenario(
      "as_is", "As-is (current verdict)", trueAvgMonthlyRevenue, existingMonthlyDebt,
      `True revenue ${money(trueAvgMonthlyRevenue)}/mo with ${money(existingDailyDebit)}/day existing debits netted out; ${affBase.binding_daily}-bound.`,
    );
    const scRevReal = buildScenario(
      "revenue_all_real", "If all stated revenue were real", reportedAvgMonthlyRevenue, existingMonthlyDebt,
      `Credits the full ${money(reportedAvgMonthlyRevenue)}/mo of reported deposits (no padding stripped); existing debits unchanged.`,
    );
    const scRestruct = buildScenario(
      "debt_restructured", "If existing positions were restructured (upper bound)", trueAvgMonthlyRevenue, 0,
      "UPPER BOUND — assumes existing positions FULLY cleared; post-restructure reality lands between as-is and this.",
    );
    const scBoth = buildScenario(
      "both", "Both (absolute ceiling)", reportedAvgMonthlyRevenue, 0,
      "Absolute ceiling — full stated revenue AND zero existing debits; every real position lands below this.",
    );
    const scenarios = [scAsIs, scRevReal, scRestruct, scBoth];

    // One-line derived verdict summarizing the two levers vs. the ask.
    const restructUnlock = round2(scRestruct.max_affordable_advance - scAsIs.max_affordable_advance);
    const revenueUnlock = round2(scRevReal.max_affordable_advance - scAsIs.max_affordable_advance);
    const scParts: string[] = [];
    if (restructUnlock > 0) scParts.push(`restructuring existing positions unlocks ~${money(restructUnlock)}`);
    if (revenueUnlock > 0) scParts.push(`full-revenue credit unlocks ~${money(revenueUnlock)}`);
    let askClause = "";
    if (askAmt != null) {
      if (scAsIs.max_affordable_advance >= askAmt) {
        askClause = `the ${money(askAmt)} ask is already covered as-is`;
      } else {
        const firstCover = scenarios.find((s) => s.max_affordable_advance >= askAmt);
        askClause = firstCover
          ? `the ${money(askAmt)} ask is reachable only under "${firstCover.label}"`
          : `the ${money(askAmt)} ask is unreachable in every scenario`;
      }
    }
    const lead = scParts.join("; ");
    let scenariosVerdict: string;
    if (lead && askClause) scenariosVerdict = `${lead.charAt(0).toUpperCase() + lead.slice(1)} — ${askClause}.`;
    else if (lead) scenariosVerdict = `${lead.charAt(0).toUpperCase() + lead.slice(1)}.`;
    else if (askClause) scenariosVerdict = `${askClause.charAt(0).toUpperCase() + askClause.slice(1)}.`;
    else scenariosVerdict = "Neither a restructure nor crediting full revenue changes capacity materially here.";

    // ── PATHS TO REVENUE (deterministic) — the product. The IRON RULE: every run
    // emits at least one ACTIONABLE path; a bare "decline" is forbidden output.
    // Each path is derived from the scenarios above + our real funder rails (box-
    // matching, NEVER an AI call), ranked by expected revenue.
    // numOrNull: an unrecorded time-in-business must stay null. num() read it as
    // "0 months", which tripped EVERY funder's min-TIB gate.
    const tibMonths = numOrNull(cust.time_in_business);
    const POINTS = 0.08;          // MFunding's new-deal commission (8 points).
    const COUNTER_FLOOR = 5000;   // smallest advance worth countering / a funder box wants.
    const cleanTo = (n: number) => Math.max(0, Math.floor(n / 1000) * 1000); // clean counter figure
    const listNames = (a: string[], max = 4) =>
      a.length <= max ? a.join(", ") : `${a.slice(0, max).join(", ")} +${a.length - max} more`;

    // Which onboarded funders' recorded boxes fit a given (advance, revenue)?
    // Partitioned by how we'd submit TODAY. Credit score UNKNOWN never disqualifies
    // (MCA = cash-flow underwriting); missing box fields don't exclude a funder.
    const fitFunders = (advance: number, revenue: number) => {
      const live: string[] = []; const referral: string[] = []; const pending: string[] = [];
      let tibUnverified = false; // a matched funder has a TIB floor we could not check
      for (const b of funderBoxes) {
        if (b.rev_req != null && revenue < b.rev_req) continue;
        if (b.approval_min != null && advance < b.approval_min) continue;
        if (b.approval_max != null && advance > b.approval_max) continue;
        // TIB gate. A funder with no recorded floor has no minimum. When the FUNDER has
        // a floor but the MERCHANT's TIB is unrecorded we PASS (unknown is a stipulation,
        // never a decline) and report it so the closer verifies before submitting.
        if (b.tib != null) {
          if (tibMonths == null) tibUnverified = true;
          else if (tibMonths < b.tib) continue;
        }
        if (b.status === "live_vendor") live.push(b.name);
        else if (b.status === "affiliate_referral") referral.push(b.name);
        else if (b.status === "application_submitted") pending.push(b.name);
      }
      return { live, referral, pending, tib_unverified: tibUnverified };
    };

    type Path = {
      rank: number; key: string; label: string; action: string; expected_note: string;
      expected_revenue: number; // internal — drives ranking only
    };
    const paths: Path[] = [];

    // 1) RIGHT-SIZED COUNTER — when a "now" scenario (no restructure) supports ≥ $5K.
    //    Emit the as-is counter AND the full-revenue counter when they differ.
    const counterSeen = new Set<number>();
    for (const c of [
      { adv: scAsIs.max_affordable_advance, cap: scAsIs.capacity_per_day, rev: trueAvgMonthlyRevenue, basis: "as_is" as const },
      { adv: scRevReal.max_affordable_advance, cap: scRevReal.capacity_per_day, rev: reportedAvgMonthlyRevenue, basis: "full_revenue" as const },
    ]) {
      const amt = cleanTo(c.adv);
      if (amt < COUNTER_FLOOR || counterSeen.has(amt)) continue;
      counterSeen.add(amt);
      const fit = fitFunders(amt, c.rev);
      const submitNow = [...fit.live, ...fit.referral];
      const action = submitNow.length
        ? `Counter at ${money(amt)} → submit to ${listNames(submitNow)}`
        : fit.pending.length
          ? `Counter at ${money(amt)} → ${listNames(fit.pending)} (ISO app pending — call to expedite)`
          : `Counter at ${money(amt)} — no onboarded funder box fits this size yet; widen the network`;
      paths.push({
        rank: 0,
        key: c.basis === "as_is" ? "counter_as_is" : "counter_full_revenue",
        label: c.basis === "as_is" ? `Right-sized counter — ${money(amt)}` : `Full-revenue counter — ${money(amt)}`,
        action,
        expected_note: `Capacity ${money(c.cap)}/day supports ${money(amt)}` +
          (c.basis === "full_revenue" ? ` if the full ${money(reportedAvgMonthlyRevenue)}/mo verifies` : "") +
          `. ${fit.live.length} live + ${fit.referral.length} referral fit, ${fit.pending.length} pending.` +
          (fit.tib_unverified
            ? " TIB UNVERIFIED — time in business is not on the merchant record; confirm it before submitting (some of these funders have a TIB floor)."
            : ""),
        expected_revenue: amt * POINTS,
      });
    }

    // 2) RESTRUCTURE FIRST (VCF) — heavily stacked: OUR relief product is the play.
    //    Frame the post-restructure capacity as revenue, not consolation.
    if (debtServicePct > 50 && scRestruct.max_affordable_advance >= COUNTER_FLOOR) {
      const z = cleanTo(scRestruct.max_affordable_advance);
      paths.push({
        rank: 0, key: "restructure_vcf",
        label: `Restructure first (Relief) → unlocks ~${money(z)} new money`,
        action: "Toggle this deal to Relief and run the VCF flow; after a clean restructure this merchant supports new financing",
        expected_note: `Existing debits eat ${Math.round(debtServicePct)}% of true revenue. Clear them and capacity opens to ~${money(scRestruct.capacity_per_day)}/day → ~${money(z)} new money (upper bound — real post-restructure lands between as-is and this).`,
        expected_revenue: z * POINTS,
      });
    }

    // 2b) REFI / CONSOLIDATION — roll the stack into one longer-term payment. Viable
    //     when the consolidated payment fits normal-season revenue at some term.
    if (refi.feasible && bestRefi) {
      paths.push({
        rank: 0, key: "refi_consolidation",
        label: `Consolidate the stack → ~${money(bestRefi.monthly_payment)}/mo at ${bestRefi.months}mo`,
        action: `Pull payoff letters on the ${activePositions.length} active position(s), then place a consolidation of ~${money(outstandingMid)} at ${bestRefi.months} months — one payment ≈ ${money(bestRefi.monthly_payment)}/mo (${bestRefi.pct_of_normal_revenue}% of normal-season revenue)`,
        expected_note: `Est. outstanding ~${money(outstandingLow)}–${money(outstandingHigh)} (mid ${money(outstandingMid)}). ${refi.verdict}`,
        // Consolidation commission is on the consolidated amount.
        expected_revenue: outstandingMid * POINTS,
      });
    }

    // 3) MICRO-MCA TIER — real revenue but below mainstream live floors.
    if (trueAvgMonthlyRevenue >= COUNTER_FLOOR && trueAvgMonthlyRevenue < 15000) {
      const microNames = ["Bitty Advance", "Greenbox Capital", "Giggle Finance"];
      const statusOf = new Map(funderBoxes.map((b) => [b.name, b.status]));
      const statusLabel = (s?: string) =>
        s === "live_vendor" ? "live" : s === "affiliate_referral" ? "live via referral"
        : s === "application_submitted" ? "ISO app pending" : "not onboarded";
      const parts = microNames.filter((n) => statusOf.has(n)).map((n) => `${n} (${statusLabel(statusOf.get(n))})`);
      if (parts.length) {
        paths.push({
          rank: 0, key: "micro_mca",
          label: "Micro-MCA tier",
          action: `Route to the micro rail: ${parts.join(", ")}`,
          expected_note: `True revenue ${money(trueAvgMonthlyRevenue)}/mo clears the $5K micro floors but sits below most mainstream live funders — the micro rail is where this funds.`,
          expected_revenue: Math.max(cleanTo(scRevReal.max_affordable_advance), COUNTER_FLOOR) * POINTS * 0.5,
        });
      }
    }

    // 4) PRODUCT SWITCH — MCA unaffordable but revenue steady. Statements can't see
    //    collateral / receivables, so emit as closer QUESTIONS, not a verdict.
    if (scAsIs.max_affordable_advance < COUNTER_FLOOR && trueAvgMonthlyRevenue >= COUNTER_FLOOR && revenueTrend !== "down") {
      paths.push({
        rank: 0, key: "product_switch",
        label: "Product switch — ask two questions",
        action: "Ask the merchant: (1) equipment owned free-and-clear? (2) unpaid B2B invoices / receivables? A yes on either opens Equipment financing or invoice factoring where an MCA can't fit",
        expected_note: `Steady ${money(trueAvgMonthlyRevenue)}/mo revenue but the MCA math is tight — a collateral- or receivables-backed product may work. Catalog: /admin/lender-catalog`,
        expected_revenue: 1, // unknown size — ranks below sized paths, above nurture.
      });
    }

    // 5) NURTURE WITH A CONCRETE RE-ENTRY TRIGGER — never "dead". Compute the exact
    //    condition that would flip the verdict (paydown target OR revenue target).
    {
      const requiredCapacity = (COUNTER_FLOOR * factorRate) / termDailyDays; // $/day to support a $5K advance
      const requiredNewMonthly = requiredCapacity * BIZ_DAYS_PER_MONTH;
      const roomFromRevenue = maxPayPct * trueAvgMonthlyRevenue - requiredNewMonthly;
      let action: string; let note: string;
      if (existingMonthlyDebt > 0 && roomFromRevenue > 0) {
        const targetDaily = roomFromRevenue / BIZ_DAYS_PER_MONTH; // existing daily debit at/below which a $5K counter clears
        const paydownPct = existingDailyDebit > 0
          ? Math.max(0, Math.min(99, Math.round((1 - targetDaily / existingDailyDebit) * 100)))
          : 0;
        action = `Nurture until existing daily debits drop below ${money(targetDaily)}/day, then re-run`;
        note = `At today's ${money(existingDailyDebit)}/day that's ≈${paydownPct}% paydown of the current position(s). Set the re-entry trigger and move on — not dead, just early.`;
      } else {
        const targetRev = (requiredNewMonthly + existingMonthlyDebt) / maxPayPct;
        action = `Nurture until true revenue reaches ~${money(targetRev)}/mo (2+ clean months), then re-run`;
        note = `Revenue is the binding constraint, not stacking — re-enter on growth, not a paydown.`;
      }
      paths.push({
        rank: 0, key: "nurture_trigger",
        label: "Nurture with a concrete re-entry trigger",
        action, expected_note: note,
        expected_revenue: 0.5, // fallback sentinel — always lowest, guarantees a path exists.
      });
    }

    // Rank by expected revenue (desc); renumber 1..n.
    paths.sort((a, b) => b.expected_revenue - a.expected_revenue);
    paths.forEach((p, i) => { p.rank = i + 1; });

    // Reframe the headline as the PLAY — never a bare decline.
    const topPath = paths[0];
    const pathsVerdict = topPath
      ? `${topPath.label} is the play` +
        (askAmt != null && scAsIs.max_affordable_advance < askAmt ? ` — the ${money(askAmt)} ask is unreachable as-is.` : ".")
      : scenariosVerdict;

    const metrics = {
      statements_analyzed: monthsCovered,
      months_covered: monthsCovered,
      reported_avg_monthly_revenue: reportedAvgMonthlyRevenue,
      true_avg_monthly_revenue: trueAvgMonthlyRevenue,
      revenue_quality_pct: revenueQualityPct,
      padding_total: paddingTotal,
      padding_by_category: Object.fromEntries(
        Object.entries(paddingByCategory).map(([k, v]) => [k, round2(v)]),
      ),
      // Owner-payroll ("questionable") income — the base-vs-conservative sensitivity.
      owner_payroll_treatment: ownerPayrollTreatment,
      questionable_revenue_total: questionableTotal,
      questionable_revenue_monthly: avgQuestionableMonthly,
      questionable_revenue_by_source: Object.fromEntries(
        Object.entries(questionableBySource).map(([k, v]) => [k, round2(v)]),
      ),
      conservative_avg_monthly_revenue: conservativeAvgMonthlyRevenue,
      conservative_max_affordable_advance: conservativeMaxAffordableAdvance,
      net_retained_by_month: effPerMonthNet.map(round2),
      avg_net_retained: round2(avgNetRetained),
      avg_daily_balance: avgDailyBalance,
      min_balance: minBalance,
      negative_days: negativeDays,
      nsf_total: nsfTotal,
      est_open_positions: estOpenPositions,
      existing_daily_debit: existingDailyDebit,
      debt_service_pct: debtServicePct,
      // Latest-month-anchored MCA positions (additive — older runs lack them). active =
      // MCA advances open in the newest statement month; ended = MCA funders paid off /
      // gone since; other_obligations = non-MCA fixed debts (SBA/term loans, equipment
      // leases, consumer finance) that are cash-flow context, NOT MCA stacking.
      latest_statement_month: latestMonthLabel,
      active_positions: activePositions,
      ended_positions: endedPositions,
      other_obligations: otherObligations,
      other_obligations_monthly: otherObligationsMonthly,
      // One-off / step-up hits excluded from the daily position count (Nav's lone $150;
      // Dedicated's $500/wk → $1,175.08 catch-up) — surfaced so they aren't invisible.
      position_anomalies: positionAnomalies,
      // Position intelligence blocks (all additive; older runs lack them, UI hides).
      position_timeline: positionTimeline,
      remaining_by_position: remainingByPosition,
      est_outstanding_low: outstandingLow,
      est_outstanding_mid: outstandingMid,
      est_outstanding_high: outstandingHigh,
      refi,
      stacking_velocity: velocityByMonth,
      stacking_velocity_narrative: stackingVelocityNarrative,
      overdraft_fees_total: overdraftFeesTotal,
      // Collection activity read off the statements (additive; older runs lack it and
      // the UI hides the callout). Drives the funder shortlist's collections gate —
      // Green Note et al. auto-decline on it.
      collection_activity: collectionActivity,
      normal_season_avg_monthly_revenue: normalSeasonAvgMonthlyRevenue,
      worst_month_revenue: worstMonthRevenue,
      latest_month_is_partial: latestIsPartial,
      safe_daily_debit_capacity: safeDailyDebitCapacity,
      max_affordable_advance: maxAffordableAdvance,
      amount_requested: amountRequested,
      revenue_trend: revenueTrend,
      deposit_concentration_pct: depositConcentrationPct,
      // Explicit per-month table + first-class affordability block (both additive;
      // old rows lack them and the UI hides those sections).
      per_month: perMonth,
      // Per-document extraction ledger — verifiable coverage: every source file → its
      // disposition (analyzed + month, duplicate, or error). Additive; old rows lack it.
      document_ledger: documentLedger,
      // Whether owner-supplied context was factored into the judge read (drives the
      // "Context factored in" chip). Additive; old rows are undefined → chip hidden.
      owner_context_used: ownerContext.length > 0,
      // ── DATA PROVENANCE (additive) — which months are bank-feed-verified (Plaid,
      // highest trust) vs PDF-extracted, plus every PDF-vs-feed cross-check result.
      // Drives the per-month 🏦/📄 badges and the fraud-mismatch callout in the panel.
      provenance: {
        institution: plaidInstitution,
        bank_feed_months: bankFeedMonths,
        statement_pdf_months: analyzed
          .filter((s) => s.source !== "plaid" && s.month)
          .map((s) => s.month as string),
        cross_checks: bankFeedCrossChecks,
      },
      affordability,
      // What-if scenarios (additive; older stored runs lack them and the UI hides
      // the section). Four deterministic reads on the two levers a closer asks about.
      scenarios,
      scenarios_verdict: scenariosVerdict,
      // Paths to revenue — the product. Always ≥1 actionable path. `expected_revenue`
      // is internal ranking only, dropped from what we persist/return.
      paths: paths.map(({ expected_revenue: _er, ...p }) => p),
      paths_verdict: pathsVerdict,
    };

    // ---- Flags from the admin-tunable thresholds ----
    const flags: Array<{ code: string; severity: "info" | "warn" | "critical"; message: string }> = [];

    // ── PLAID CROSS-CHECK FLAGS (fraud defense, computed above) ──
    for (const cc of bankFeedCrossChecks) {
      flags.push(cc.fraud
        ? {
            code: "bank_feed_fraud_mismatch",
            severity: "critical",
            message: `Possible doctored statement — ${cc.month}: the uploaded statement reports ${money(cc.pdf_deposits)} in deposits but the connected bank feed (Plaid, unfalsifiable) shows only ${money(cc.plaid_deposits)} — the statement is ${cc.pct_diff}% higher. Verify against the bank feed before submitting.`,
          }
        : {
            code: "bank_feed_variance",
            severity: "warn",
            message: `${cc.month}: uploaded-statement deposits ${money(cc.pdf_deposits)} differ ${cc.pct_diff}% from the bank feed's ${money(cc.plaid_deposits)} (Plaid) — likely pending/timing items, but confirm.`,
          });
    }

    // ── COLLECTION ACTIVITY FLAG (submission risk, not a decline) ──
    if (collectionActivity.detected) {
      flags.push({
        code: "collection_activity",
        severity: collectionActivity.confidence === "high" ? "critical" : "warn",
        message: `Collection activity detected — ${collectionActivity.types.join(", ")} across ` +
          `${collectionActivity.months_with_activity || 1} statement month(s). ` +
          `Funders that auto-decline on collection activity have been removed from the shortlist; ` +
          `confirm the items with the merchant before submitting.`,
      });
    }

    // ── Statement coverage vs the CALENDAR: are we current, and are we continuous? ──
    // Funders want the newest complete month and an unbroken run. A closer staring
    // at "6 statements" has no way to notice that June is missing (real case:
    // K.L. Breen). Deterministic — parsed month labels vs today's date in ET.
    // Unparseable labels drop out silently: never false-alarm on a naming quirk.
    {
      const monthIdx = new Map<number, string>(); // year*12+month → pretty label
      for (const s of analyzed) {
        const t = Date.parse(`1 ${String(s.month ?? "").trim()}`);
        if (Number.isNaN(t)) continue;
        const d = new Date(t);
        monthIdx.set(d.getUTCFullYear() * 12 + d.getUTCMonth(), String(s.month).trim());
      }
      if (monthIdx.size > 0) {
        const keys = [...monthIdx.keys()].sort((a, b) => a - b);
        const fmt = (k: number) =>
          new Date(Date.UTC(Math.floor(k / 12), k % 12, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

        // Last COMPLETE calendar month, reckoned in Eastern (the business clock).
        const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
        const lastComplete = nowET.getFullYear() * 12 + nowET.getMonth() - 1;
        const newest = keys[keys.length - 1];
        if (newest < lastComplete) {
          const behind = lastComplete - newest;
          flags.push({
            code: "statements_stale",
            severity: behind >= 2 ? "critical" : "warn",
            message: `Newest statement is ${fmt(newest)} — ${fmt(lastComplete)} is the last complete month. Missing ${behind === 1 ? fmt(lastComplete) : `the ${behind} most recent month(s)`}; funders will ask for it before an offer.`,
          });
        }

        // Continuity: holes inside the covered range.
        const missing: string[] = [];
        for (let k = keys[0]; k <= newest; k++) if (!monthIdx.has(k)) missing.push(fmt(k));
        if (missing.length > 0) {
          flags.push({
            code: "month_gap",
            severity: "warn",
            message: `Statement months are not continuous — missing ${missing.join(", ")} between ${fmt(keys[0])} and ${fmt(newest)}.`,
          });
        }
      }
    }

    if (revenueQualityPct < numOr0(settings.revenue_quality_flag_pct)) {
      const sev = revenueQualityPct < numOr0(settings.revenue_quality_flag_pct) - 20 ? "critical" : "warn";
      flags.push({
        code: "revenue_quality",
        severity: sev,
        message: `Only ${revenueQualityPct}% of reported deposits look like true sales revenue (${money(paddingTotal)} padding removed).`,
      });
    }
    const nsfCap = numOr0(settings.nsf_monthly_cap) * Math.max(1, monthsCovered);
    if (nsfTotal > nsfCap) {
      flags.push({
        code: "nsf",
        severity: "warn",
        message: `${nsfTotal} NSF/overdraft events across ${monthsCovered} month(s) — above the ${settings.nsf_monthly_cap}/mo cap.`,
      });
    }
    if (negativeDays >= numOr0(settings.negative_days_flag)) {
      flags.push({
        code: "negative_days",
        severity: "warn",
        message: `${negativeDays} negative-balance day(s) observed.`,
      });
    }
    if (debtServicePct > numOr0(settings.debt_service_flag_pct)) {
      flags.push({
        code: "debt_service",
        severity: "critical",
        message: `Existing daily debits consume ${debtServicePct}% of true revenue (over the ${settings.debt_service_flag_pct}% ceiling) — heavily stacked.`,
      });
    }
    if (avgNetRetained <= 0) {
      flags.push({ code: "no_retained_revenue", severity: "critical", message: "Net retained revenue is at or below zero after padding removal." });
    } else if (safeDailyDebitCapacity <= 0) {
      flags.push({ code: "no_capacity", severity: "critical", message: "No safe daily-debit capacity remains after existing debits — a new advance is unaffordable." });
    }
    if (revenueTrend === "down") {
      flags.push({ code: "revenue_trend", severity: "warn", message: "Real revenue is trending down across the analyzed period." });
    }
    if (depositConcentrationPct >= 40) {
      flags.push({ code: "deposit_concentration", severity: "info", message: `Largest single deposit is ${depositConcentrationPct}% of all deposits — possible customer concentration.` });
    }
    if (settings.min_avg_daily_balance != null && avgDailyBalance != null && avgDailyBalance < numOr0(settings.min_avg_daily_balance)) {
      flags.push({ code: "low_balance", severity: "warn", message: `Average daily balance ${money(avgDailyBalance)} is below the ${money(numOr0(settings.min_avg_daily_balance))} floor.` });
    }
    // Extraction gaps count only genuine FAILURES (couldn't load/parse a file) — NOT
    // duplicates removed by dedup, which are expected and harmless. Counted from the
    // per-document ledger (files, not statements) and named LOUDLY: a silently-dropped
    // statement is exactly the SILENT-ZERO failure this must never repeat.
    const failedDocs = documentLedger.filter((r) => r.status === "error");
    const failedStatements = failedDocs.length;
    if (failedStatements > 0) {
      const names = failedDocs.map((r) => r.filename).slice(0, 5).join(", ");
      flags.push({
        code: "extraction_gaps",
        severity: "warn",
        message: `${failedStatements} of ${bankDocs.length} statement file(s) could not be analyzed (${names}) — their month(s) are NOT in this coverage.`,
      });
    }
    if (dataQualityIssues.length > 0) {
      flags.push({
        code: "data_quality",
        severity: "warn",
        message: `Per-month data repaired on ${dataQualityIssues.length} field(s): ${dataQualityIssues.join("; ")}.`,
      });
    }
    if (swapNotes.length > 0) {
      flags.push({
        code: "debit_credit_swap",
        severity: "critical",
        message: `Corrected transposed debit/credit totals on ${swapNotes.length} statement(s): ${swapNotes.join("; ")}.`,
      });
    }
    if (floorNotes.length > 0) {
      flags.push({
        code: "deposit_total_corrected",
        severity: "critical",
        message: `Deposit total was below the itemized credit lines on ${floorNotes.length} statement(s) and was corrected up: ${floorNotes.join("; ")}.`,
      });
    }
    if (reconNotes.length > 0) {
      flags.push({
        code: "deposit_reconciliation",
        severity: "info",
        message: `Deposit total exceeds itemized credit lines on ${reconNotes.length} statement(s) (unlisted deposits): ${reconNotes.join("; ")}.`,
      });
    }
    // docs_not_analyzed SAFETY NET: shout ONLY about docs still typed "other" —
    // after the content-classifier preflight, "other" means genuinely unidentifiable,
    // and an unidentified file could be a statement (the SIS failure). A photo ID or
    // voided check sitting unanalyzed is CORRECT, not a warning — flagging those on
    // every deal would teach closers to ignore this flag.
    try {
      const { data: allDocTypes } = await db
        .from("customer_documents")
        .select("document_type, filename")
        .eq("customer_id", deal.customer_id);
      const unidentified = (allDocTypes ?? []).filter((d) => d.document_type === "other");
      if (unidentified.length) {
        const names = unidentified.map((d) => String(d.filename ?? "unnamed")).slice(0, 5);
        flags.push({
          code: "docs_not_analyzed",
          severity: "warn",
          message: `${unidentified.length} document(s) on file could not be identified and were NOT analyzed (${names.join(", ")}) — check whether any is a bank statement.`,
        });
      }
    } catch (e) {
      console.warn("[underwrite-deal] docs_not_analyzed check failed:", e instanceof Error ? e.message : e);
    }

    // ---- Affordability rating (capacity vs. amount requested) ----
    let affordabilityRating: "strong" | "adequate" | "tight" | "unaffordable";
    if (avgNetRetained <= 0 || safeDailyDebitCapacity <= 0) {
      affordabilityRating = "unaffordable";
    } else if (amountRequested == null || amountRequested <= 0) {
      // No requested amount — rate purely on capacity headroom vs. revenue.
      affordabilityRating = debtServicePct > numOr0(settings.debt_service_flag_pct) ? "tight" : "adequate";
    } else if (maxAffordableAdvance >= amountRequested * 1.25) {
      affordabilityRating = "strong";
    } else if (maxAffordableAdvance >= amountRequested) {
      affordabilityRating = "adequate";
    } else if (maxAffordableAdvance >= amountRequested * 0.7) {
      affordabilityRating = "tight";
    } else {
      affordabilityRating = "unaffordable";
    }

    // ---- ASSUMPTIONS: the judgment calls the underwriter made from the docs alone ----
    // So underwriting is COMPLETE before funder submission — no merchant round-trip.
    // Each: { item, assumed, basis, impact_if_wrong }. Also surfaced as flags so the
    // existing UI renders them with no frontend change.
    const assumptions: Array<{ item: string; assumed: string; basis: string; impact_if_wrong: string }> = [];

    if (hasQuestionable) {
      const topSource = Object.entries(questionableBySource).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "owner payroll";
      const counted = ownerPayrollTreatment !== "exclude";
      const item = `${money(avgQuestionableMonthly)}/mo '${topSource}' owner-payroll deposits`;
      const assumed = counted
        ? "business commission/1099 income (counted as true revenue)"
        : "personal W-2 pay (excluded from true revenue)";
      const basis = "recurring third-party ACH labeled PAYROLL paid to the owner's own name";
      const affordableBase = amountRequested != null && amountRequested > 0
        ? (maxAffordableAdvance >= amountRequested ? "affordable" : "already tight")
        : "supported";
      const affordableCons = amountRequested != null && amountRequested > 0
        ? (conservativeMaxAffordableAdvance >= amountRequested ? "still affordable" : "UNAFFORDABLE")
        : `capacity drops to ${money(conservativeMaxAffordableAdvance)}`;
      const impact = counted
        ? `if personal W-2, true revenue falls from ${money(trueAvgMonthlyRevenue)} to ~${money(conservativeAvgMonthlyRevenue)}/mo` +
          (amountRequested != null && amountRequested > 0
            ? ` — the ${money(amountRequested)} ask goes from ${affordableBase} to ${affordableCons}${affordableCons === "UNAFFORDABLE" ? " → decline" : ""}`
            : ` and max affordable advance falls to ${money(conservativeMaxAffordableAdvance)}`)
        : `if it IS business income, true revenue would be ~${money(trueAvgMonthlyRevenue + avgQuestionableMonthly)}/mo and capacity higher`;
      assumptions.push({ item, assumed, basis, impact_if_wrong: impact });

      const sev: "warn" | "info" = ownerPayrollTreatment === "flag_and_discount" ? "warn" : "info";
      flags.push({
        code: "owner_payroll_assumption",
        severity: sev,
        message: `Assumption: ${item} treated as ${assumed}. Basis: ${basis}. If wrong: ${impact}.`,
      });
    }

    if (failedStatements > 0) {
      const item = `${failedStatements} of ${bankDocs.length} statement file(s) unreadable`;
      assumptions.push({
        item,
        assumed: `underwrote on the ${monthsCovered} readable statement(s) only`,
        basis: "PDF could not be fetched or parsed",
        impact_if_wrong: "the unread month(s) could shift average revenue, NSF/negative-day counts, or reveal additional stacking",
      });
      flags.push({
        code: "partial_docs_assumption",
        severity: "info",
        message: `Assumption: underwrote on ${monthsCovered} readable statement(s); ${failedStatements} unreadable file(s) not counted.`,
      });
    }

    // ── MERCHANT PROFILE — DETERMINISTIC FACTS (no AI) ─────────────────────────
    // The cheat-sheet buckets a closer sorts by (/admin/cheat-sheet, lenders.category).
    // House rule: CODE computes the facts, the AI only classifies the paper tier and
    // explains. Everything below is derived from figures already computed above —
    // nothing is recomputed and nothing here can be overridden by the model.
    const TIERS = ["A", "B", "C", "D"] as const;
    type PaperTier = (typeof TIERS)[number];

    // Active MCA positions (latest-month anchored — never a cross-month union).
    const positionsCount = activePositions.length;
    // The most new money this merchant can SAFELY take, under either remit structure.
    const newMoneyCeiling = round2(Math.max(affBase.max_advance_daily, affBase.max_advance_weekly));

    // FICO, when the merchant record carries a range ("620-659", "700+", "below 500").
    // We take the LOW end — the conservative read. Unknown NEVER disqualifies (MCA is
    // cash-flow underwriting); it just means the tier is inferred from the statements.
    // Unknown must never act as a disqualifier (house rule: missing data is a
    // stipulation, not a decline) — numOrNull keeps an unrecorded TIB null instead of
    // reading it as "0 months". Same value as `tibMonths` above; kept as its own name
    // because the profile block reads it independently.
    const tibMonthsKnown: number | null = numOrNull(cust.time_in_business);

    const ficoLow: number | null = (() => {
      const raw = String((cust.credit_score_range as string | null | undefined) ?? "").trim();
      if (!raw) return null;
      const nums = (raw.match(/\d{3}/g) ?? []).map(Number).filter((n) => n >= 300 && n <= 900);
      return nums.length ? Math.min(...nums) : null;
    })();

    // CONSOLIDATION CANDIDATE — the Bay Finish pattern: stacked, no room for new
    // money, and a stack big enough to be worth rolling up. The play is a
    // consolidation (true payoff or reverse), not another advance.
    const littleNewMoney =
      newMoneyCeiling < COUNTER_FLOOR ||
      affordabilityRating === "unaffordable" ||
      (outstandingMid > 0 && newMoneyCeiling < outstandingMid * 0.25);
    const consolidationCandidate = positionsCount >= 2 && littleNewMoney && outstandingMid >= 10000;

    // DEBT-RELIEF CANDIDATE — distressed/near-default: unaffordable, heavily stacked,
    // cash-stressed, AND the consolidation math itself doesn't clear (or debt service
    // has passed 100% of revenue). That merchant needs a restructure, not more paper.
    const cashStressed =
      nsfTotal > nsfCap || negativeDays >= numOr0(settings.negative_days_flag) || revenueTrend === "down";
    const heavilyStacked = positionsCount >= 3 || (positionsCount >= 2 && debtServicePct > 50);
    const debtReliefCandidate =
      affordabilityRating === "unaffordable" && heavilyStacked &&
      (debtServicePct > 100 || (cashStressed && !refi.feasible));

    // SIZE BUCKET — sized on what we can actually PLACE, never on the ask. For a
    // consolidation that is the estimated payoff; otherwise the safe new-money ceiling.
    const sizeBasis = consolidationCandidate ? Math.max(newMoneyCeiling, outstandingMid) : newMoneyCeiling;
    const sizeBucket: "micro" | "small_mid" | "mid_large" | "jumbo" =
      sizeBasis >= 1_000_000 ? "jumbo"
      : sizeBasis >= 250_000 ? "mid_large"
      : sizeBasis > 25_000 ? "small_mid"
      : "micro";
    const sizeBasisLabel = consolidationCandidate
      ? `estimated consolidation payoff ${money(sizeBasis)}`
      : `safe new-money ceiling ${money(sizeBasis)}`;

    // FAST TRACK — thin file / doc-collection risk, where a light-stips fast funder
    // matters more than the last basis point.
    const coverageFlagCodes = new Set(["statements_stale", "month_gap", "docs_not_analyzed", "extraction_gaps"]);
    const fastTrack =
      monthsCovered < 3 || (tibMonthsKnown != null && tibMonthsKnown < 12) || failedStatements > 0 ||
      flags.some((f) => coverageFlagCodes.has(f.code));

    // PAPER-TIER CEILING (deterministic). The AI may classify the merchant WORSE than
    // the facts allow, never better — a merchant with 3 open positions is not A paper
    // no matter how the narrative reads. Mirrors the cheat-sheet definitions.
    let tierCapIdx = 0;
    const tierCapReasons: string[] = [];
    const raiseCap = (idx: number, why: string) => {
      if (idx > tierCapIdx) { tierCapIdx = idx; }
      if (idx >= 1) tierCapReasons.push(why);
    };
    if (positionsCount >= 3) raiseCap(3, `${positionsCount} open MCA positions`);
    else if (positionsCount === 2) raiseCap(2, "2 open MCA positions");
    else if (positionsCount === 1) raiseCap(1, "1 open MCA position");
    if (negativeDays >= numOr0(settings.negative_days_flag) || nsfTotal > nsfCap) {
      raiseCap(2, `${nsfTotal} NSF event(s) / ${negativeDays} negative day(s)`);
    } else if (nsfTotal > 0 || negativeDays > 0) {
      raiseCap(1, `${nsfTotal} NSF event(s) / ${negativeDays} negative day(s)`);
    }
    if (debtReliefCandidate || debtServicePct > 50) {
      raiseCap(3, `existing debits consume ${Math.round(debtServicePct)}% of true revenue`);
    }
    if (ficoLow != null) {
      raiseCap(ficoLow < 500 ? 3 : ficoLow < 600 ? 2 : ficoLow < 680 ? 1 : 0, `FICO ~${ficoLow}`);
    }
    if (tibMonthsKnown != null && tibMonthsKnown < 24) raiseCap(1, `${tibMonthsKnown} months in business`);
    const tierCap = TIERS[tierCapIdx];

    // Facts handed to the judge so its classification is anchored to the same numbers.
    const profileFacts = {
      positions: positionsCount,
      fico_low: ficoLow,
      time_in_business_months: tibMonthsKnown,
      true_avg_monthly_revenue: trueAvgMonthlyRevenue,
      revenue_trend: revenueTrend,
      nsf_total: nsfTotal,
      negative_days: negativeDays,
      avg_daily_balance: avgDailyBalance,
      debt_service_pct: debtServicePct,
      safe_new_money_ceiling: newMoneyCeiling,
      est_outstanding_mid: outstandingMid,
      refi_feasible: refi.feasible,
      affordability_rating: affordabilityRating,
      // Computed in code and FORCED onto the output — the model must not contradict them.
      size_bucket: sizeBucket,
      size_basis: sizeBasisLabel,
      consolidation_candidate: consolidationCandidate,
      debt_relief_candidate: debtReliefCandidate,
      fast_track: fastTrack,
      paper_tier_ceiling: tierCap,
      paper_tier_ceiling_because: tierCapReasons,
      // Computed in code. Collection activity is a WATCH-OUT and a funder-routing
      // fact — never an auto-disqualifier on our side. The funders decide.
      has_collection_activity: collectionActivity.detected,
      collection_activity_types: collectionActivity.types,
      collection_activity_note: collectionActivity.detected ? collectionActivity.note : null,
    };

    // ---- PASS C: JUDGE (Claude — narrative + risk_rating + funder-fit note) ----
    // Load active MCA funder minimums so the judge can say which paper grade / which
    // funders this true-revenue profile fits.
    // Reuse the funder boxes already loaded above (no second query).
    const funderMinimums = funderBoxes.map((b) => ({
      monthly_revenue_required: b.rev_req,
      min_credit_score: b.min_credit_score,
      approval_min: b.approval_min,
      approval_max: b.approval_max,
    }));
    // Distinct revenue floors present in the network (compact signal for the judge).
    const revenueFloors = Array.from(
      new Set(funderMinimums.map((f) => f.monthly_revenue_required).filter((x): x is number => x != null && x > 0)),
    ).sort((a, b) => a - b);

    const judgeSystem =
      "You are the senior underwriter at an ISO (Independent Sales Organization / MCA broker) writing a " +
      "SHORT internal affordability + risk read for a closer. An MCA is a purchase of future receivables, " +
      "NOT a loan — never use the word loan or lending terms. Base your read on the AFFORDABILITY metrics " +
      "(true revenue = deposits minus padding, safe daily-debit capacity, existing debt-service %, " +
      "max affordable advance) and the flags provided. Be direct and honest; do not invent numbers beyond " +
      "what is given. Consider whether this merchant's TRUE revenue clears the funder revenue floors in the " +
      "network and, roughly, what paper grade (A/B/C/D) the profile suggests (A = clean/high revenue/low " +
      "stacking; D = heavily stacked/low quality). " +
      "POSITIONS: the metrics carry 'active_positions' (the merchant's CURRENTLY-OPEN MCA advances, anchored to the " +
      "LATEST statement month — each with funder, cadence, and daily amount), 'ended_positions' (MCA advances that " +
      "were being repaid earlier but are GONE from the latest month — i.e. PAID OFF, a POSITIVE paydown signal worth " +
      "citing by name), and 'other_obligations' (non-MCA fixed debts — SBA/term loans, equipment leases, consumer " +
      "finance — that are cash-flow CONTEXT but do NOT count as MCA stacking). Base the stacking read on the ACTIVE " +
      "count and the provided debt_service_pct; NEVER sum positions across months, and NEVER call a paid-off or " +
      "non-MCA debit an open MCA position. " +
      "The metrics also carry: 'position_timeline' (every debitor with first/last-seen + status + any renewal/step-up " +
      "change event), 'position_anomalies' (one-off or stepped-up hits excluded from the daily count — mention a " +
      "material step-up), 'stacking_velocity' + 'stacking_velocity_narrative' (positions added vs retired per month — " +
      "call out REPLACEMENT stacking if new advances are replacing retired ones), per-month 'holdback_pct' (daily MCA " +
      "remittance ÷ daily deposits; >100% means he remits more than he deposits — a serious stress signal), " +
      "'overdraft_fees_total' and per-month NSF/negative-day/overdraft cash-stress, and per-month revenue-quality " +
      "split (card vs cash/check vs transfer/other — card is verifiable, funders trust it). " +
      "REFI/CONSOLIDATION: 'refi' holds the estimated outstanding balance (low/mid/high — ESTIMATES, payoff letters " +
      "required) and a consolidation payment at 12/18/24 months vs normal-season AND worst-month revenue. When " +
      "refi.feasible is true this is a REAL play — cite refi.verdict and make consolidation a recommended path. " +
      "When the latest month is partial (latest_month_is_partial), weigh 'normal_season_avg_monthly_revenue' as the " +
      "run-rate (a genuine seasonal dip), not the blended average, but say so explicitly. " +
      "DATA PROVENANCE: months are one of two kinds. BANK-FEED VERIFIED months come straight from the merchant's " +
      "CONNECTED bank via Plaid — the merchant cannot alter them, so they are the HIGHEST-trust evidence. PDF-EXTRACTED " +
      "months are read from an uploaded statement, which a merchant could in principle doctor. The metrics.provenance " +
      "block lists which months are bank-feed vs PDF and any cross-checks. Weight bank-feed months as hard evidence. " +
      "If a cross-check shows an uploaded statement reporting materially MORE deposits than the bank feed for the same " +
      "month (a bank_feed_fraud_mismatch flag), treat it as a POSSIBLE DOCTORED STATEMENT: say so plainly, lean on the " +
      "bank-feed number, and make verification the next step — do not size to the inflated PDF figure. " +
      "COLLECTION ACTIVITY: metrics.collection_activity flags debits that read as a debt being collected FROM the " +
      "merchant — collection-agency payments, wage/bank garnishments, tax levies, judgments or writs. When " +
      "detected is true this is a MATERIAL SUBMISSION RISK and you must name it in the narrative and in the risks: " +
      "several funders (Green Note Capital's own decline email says \"Debt collection activity detected\") " +
      "auto-decline on it, so the file has to be routed to desks that accept it and the merchant has to be asked " +
      "about it before submission. It is a WATCH-OUT and a routing fact, NOT a decline on our side — never turn it " +
      "into a bare 'decline'. When confidence is 'medium', say the read needs verification against the statements. " +
      "Do NOT confuse a UCC lien (ucc_corroboration — the ordinary public footprint of an existing advance) with " +
      "collection activity; they are separate signals. When detected is false, say nothing about it. " +
      "This is INTERNAL underwriting done BEFORE funder submission from the submitted docs ALONE — you must " +
      "NOT ask the merchant anything. Where a judgment call was made (see ASSUMPTIONS), STATE the key " +
      "assumption(s) in the narrative and give the SENSITIVITY: the base case (assumption holds) vs. the " +
      "conservative case (assumption is wrong), using the base and conservative numbers provided. Then still " +
      "land on ONE clear recommendation so the read is complete without a merchant round-trip. " +
      "IRON RULE — a bare 'decline' is NOT an acceptable read: the deterministic PATHS TO REVENUE provided are " +
      "the options, and your Recommendation MUST be the top path (or another listed path), phrased as the concrete " +
      "next step (counter at $X to named funders, flip to Relief and restructure, route to the micro rail, ask the " +
      "product-switch questions, or nurture until a specific trigger). Even when the ask is unreachable, there is a play. " +
      (ownerContext
        ? "OWNER CONTEXT — an OWNER CONTEXT block from the broker is provided below. Treat it as broker-supplied " +
          "context about things the statements cannot show (seasonality, a baseline the analyzed months undershoot, " +
          "expected upcoming volume, one-off events). WEIGH it in the scenarios/paths/verdict and EXPLICITLY reference " +
          "it in your Recommendation reasoning (e.g. name the seasonality or the claimed baseline). But it NEVER " +
          "overrides hard evidence: the affordability math above is computed from the actual statements and stands. If " +
          "the context claims materially higher revenue than the statements show, do NOT fabricate an approval — instead " +
          "make the concrete next step a 'verify with additional docs' path (prior-year / trailing-12-month statements, " +
          "or the seasonal high months) that would substantiate the claim before sizing to it. State plainly when the " +
          "context, if it verifies, would change the verdict. "
        : "") +
      // ── MERCHANT PROFILE (cheat-sheet classification) ──
      "MERCHANT PROFILE — you must ALSO classify this merchant into the funder cheat-sheet buckets. " +
      "PAPER TIER definitions (use these verbatim; they are the same definitions the funder cheat sheet uses):\n" +
      "  A = ~680+ FICO, 2+ years in business, healthy consistent revenue, NO existing MCA positions, clean " +
      "statements (no NSFs, good balances).\n" +
      "  B = ~600-680 FICO, decent revenue, 0-1 existing position, minor blemishes.\n" +
      "  C = ~500-600 FICO, shorter history, some NSFs / negative days, 1-2 stacked positions.\n" +
      "  D = <500 FICO, heavily stacked (multiple positions), frequent NSFs / negative days, distressed.\n" +
      "When FICO is UNKNOWN (it usually is — MCA is cash-flow underwriting and an unknown score NEVER " +
      "disqualifies), infer the tier primarily from open positions + NSFs/negative days + balance stability + " +
      "revenue consistency, and SAY SO in the reason. " +
      "A DETERMINISTIC PROFILE FACTS block is provided below. Those figures were computed in code from the " +
      "statements and are AUTHORITATIVE: positions, size_bucket, consolidation_candidate, debt_relief_candidate " +
      "and fast_track are FORCED onto the stored output — do not contradict them. 'paper_tier_ceiling' is the " +
      "BEST tier the hard facts permit; you may classify the merchant the same or WORSE, never better (a worse " +
      "call is honored). " +
      "PRODUCT SIGNALS: default to [\"mca\"]. Add \"real_estate_cre\", \"sba_loan\", \"equipment_financing\", " +
      "\"invoice_factoring\", \"line_of_credit\" or \"term_loan\" ONLY when there is a real signal in the merchant " +
      "record or use-of-funds (owned collateral, a stated equipment/property purchase, B2B receivables, an " +
      "industry that obviously implies it). Do NOT force a product in without evidence. " +
      "Do NOT name any funder — the funder shortlist is matched deterministically in code from this profile. " +
      "Return ONLY strict JSON: " +
      '{"risk_rating":"low"|"medium"|"high","narrative":string,"funder_fit_note":string,' +
      '"profile":{"paper_tier":"A"|"B"|"C"|"D","product_signals":string[],"profile_reason":string}}. ' +
      "profile.profile_reason = 1-2 plain-English sentences tying the tier to the actual numbers. " +
      "FORMAT the narrative as lightweight markdown the closer can scan in 5 seconds — NOT a wall of prose:\n" +
      "- Open with ONE short headline sentence (the bottom line), no bullet.\n" +
      "- Then labeled bullet lines, each starting with '- **Label:** ', e.g.:\n" +
      "  - **True revenue:** stated vs verified numbers + what was stripped\n" +
      "  - **Key assumption:** the judgment call made (only when one exists)\n" +
      "  - **Base case (assumption holds):** revenue, capacity, max advance → verdict\n" +
      "  - **Conservative case (assumption wrong):** same numbers → verdict\n" +
      "  - **Cash position:** balances, negative days, NSFs, active MCA positions (and note any recently paid-off ones)\n" +
      "  - **Recommendation:** the ONE clear action\n" +
      "Use **bold** for every dollar figure, multiple, and verdict word (decline, approve, counter-offer); " +
      "use <u>underline</u> ONLY for the single most critical warning in the read (at most one). " +
      "Keep 4-7 bullets total, each one line where possible. " +
      "funder_fit_note = one line (plain text, bold key numbers) on which revenue floors this clears and the likely paper grade.";

    const judgeUser =
      (ownerContext
        ? "OWNER CONTEXT (broker-supplied — weigh it, reference it in your reasoning, but it does NOT override the " +
          "statement-derived math; if it claims more than the statements show, make the play a verify-with-docs path):\n" +
          ownerContext + "\n\n"
        : "") +
      "MERCHANT: " + JSON.stringify({
        business: cust.business_name ?? null,
        industry: cust.industry ?? cust.business_type ?? null,
        state: cust.address_state ?? null,
        // numOrNull so an unrecorded field reaches the judge as null ("unknown"),
        // never as a literal 0 it would reason from ("0 months in business").
        time_in_business_months: numOrNull(cust.time_in_business),
        stated_monthly_revenue: numOrNull(cust.monthly_revenue),
        credit_score_range: cust.credit_score_range ?? null,
        use_of_funds: deal.use_of_funds ?? null,
        product: deal.deal_type,
      }) +
      "\n\nAFFORDABILITY METRICS (computed deterministically from the bank statements):\n" +
      JSON.stringify(metrics, null, 2) +
      "\n\nFLAGS:\n" + JSON.stringify(flags, null, 2) +
      "\n\nASSUMPTIONS THE UNDERWRITER MADE (state these + the sensitivity in the narrative):\n" +
      JSON.stringify(assumptions, null, 2) +
      (hasQuestionable
        ? `\n\nSENSITIVITY on owner-payroll income (treatment='${ownerPayrollTreatment}'): ` +
          `BASE CASE true revenue ${money(trueAvgMonthlyRevenue)}/mo, max affordable ${money(maxAffordableAdvance)}. ` +
          `CONSERVATIVE CASE (owner-payroll is personal, excluded): true revenue ${money(conservativeAvgMonthlyRevenue)}/mo, ` +
          `max affordable ${money(conservativeMaxAffordableAdvance)}.`
        : "") +
      "\n\nAFFORDABILITY (deterministic, DAILY vs WEEKLY structure — factor " + factorRate +
        `, ${termDailyDays} biz-days daily / ${termWeeklyWeeks} weeks weekly, payment cap ` +
        `${affordability.max_payment_pct_of_revenue}% of revenue, balance buffer ${affordability.balance_buffer_pct}%): ` +
        `max sustainable DAILY payment ${money(affBase.max_daily_payment)} → max advance ${money(affBase.max_advance_daily)}; ` +
        `max sustainable WEEKLY payment ${money(affBase.max_weekly_payment)} → max advance ${money(affBase.max_advance_weekly)}. ` +
        `Existing debits netted out: ${money(existingDailyDebit)}/day (${money(existingMonthlyDebt)}/mo). ` +
        (reqDailyPayment != null
          ? `Requested ${money(amountRequested ?? 0)} needs ${money(reqDailyPayment)}/day or ${money(reqWeeklyPayment ?? 0)}/week → ` +
            `daily ${affordableDaily ? "AFFORDABLE" : "UNAFFORDABLE"}, weekly ${affordableWeekly ? "AFFORDABLE" : "UNAFFORDABLE"}.`
          : "No requested amount on file.") +
      "\n\nPATHS TO REVENUE (deterministic, ranked — your Recommendation MUST be the top one or another listed here; " +
        "NEVER a bare decline):\n" +
        paths.map((p) => `${p.rank}. ${p.label} — ${p.action}`).join("\n") +
      "\n\nAFFORDABILITY RATING (code-derived, base case): " + affordabilityRating +
      "\n\nFUNDER NETWORK MONTHLY-REVENUE FLOORS (distinct, USD): " +
      (revenueFloors.length ? revenueFloors.map((f) => `$${f.toLocaleString("en-US")}`).join(", ") : "none on file") +
      ` (${funderMinimums.length} active MCA programs).` +
      ((bankFeedMonths.length || bankFeedCrossChecks.length)
        ? "\n\nDATA PROVENANCE — BANK-FEED-VERIFIED months (Plaid, unfalsifiable, highest trust): " +
          (bankFeedMonths.length ? bankFeedMonths.join(", ") : "none") + ". " +
          (bankFeedCrossChecks.length
            ? "PDF-vs-bank-feed cross-checks: " +
              bankFeedCrossChecks.map((c) => `${c.month} — statement ${money(c.pdf_deposits)} vs feed ${money(c.plaid_deposits)} (${c.pct_diff}%${c.fraud ? ", POSSIBLE DOCTORED STATEMENT" : ""})`).join("; ") + "."
            : "Overlapping months reconcile with the bank feed.")
        : "") +
      "\n\nDETERMINISTIC PROFILE FACTS (computed in code — authoritative; classify the paper tier at or below " +
        "paper_tier_ceiling and explain it against these numbers):\n" +
        JSON.stringify(profileFacts, null, 2) +
      "\n\nReturn the JSON now.";

    let riskRating: "low" | "medium" | "high" = "medium";
    let aiNarrative = "";
    let funderFitNote = "";
    // Set ONLY when the judge failed because the PROVIDER failed (out of credit, bad
    // key, 5xx) — a data/parse miss leaves this null and still persists (below).
    let judgeProviderError: string | null = null;
    // The judge's PROFILE half — tier + product signals + rationale. Everything else
    // on the profile is deterministic; these are validated/clamped below.
    let aiTier: PaperTier | null = null;
    let aiProductSignals: string[] = [];
    let aiProfileReason = "";
    try {
      const judgeText = await callLLM(db, {
        system: judgeSystem,
        prompt: judgeUser,
        // 1024 truncated the JSON mid-narrative on a real 3-statement deal — the
        // parse then failed and the run persisted an EMPTY narrative with a default
        // "medium" rating. Give the judge room to close its JSON (now also carrying
        // the profile block).
        maxTokens: 3072,
        temperature: 0.2,
        jsonMode: true,
        task: "underwrite_judge",
        // Owner-switchable judge model (platform_settings) — overrides the llm_settings
        // resolution so the UI control is the single source of truth for the judge model.
        model: judgeModel,
      });
      const parsed = safeParseJson(judgeText);
      if (parsed) {
        if (["low", "medium", "high"].includes(parsed.risk_rating)) riskRating = parsed.risk_rating;
        if (typeof parsed.narrative === "string") aiNarrative = parsed.narrative.trim();
        if (typeof parsed.funder_fit_note === "string") funderFitNote = parsed.funder_fit_note.trim();
        const p = (parsed.profile ?? {}) as Any;
        const t = String(p.paper_tier ?? "").trim().toUpperCase();
        if ((TIERS as readonly string[]).includes(t)) aiTier = t as PaperTier;
        if (Array.isArray(p.product_signals)) aiProductSignals = p.product_signals.map((x: unknown) => String(x));
        if (typeof p.profile_reason === "string") aiProfileReason = p.profile_reason.trim();
      }
      // A parse miss (or an empty narrative) must NOT silently ship a blank read —
      // fall back to the flag-derived rating + summary, exactly like a throw does.
      if (!aiNarrative) throw new Error("judge returned no narrative");
    } catch (e) {
      // Judge failure never sinks the run — we still persist metrics + flags. Derive
      // a fallback risk_rating from the critical/warn flag counts.
      const crit = flags.filter((f) => f.severity === "critical").length;
      const warn = flags.filter((f) => f.severity === "warn").length;
      riskRating = crit > 0 ? "high" : warn >= 2 ? "medium" : "low";
      const judgeErr = e instanceof Error ? e.message : String(e);
      if (isProviderError(judgeErr)) judgeProviderError = judgeErr;
      aiNarrative = `AI narrative unavailable (${judgeErr}). Risk derived from flags: ${crit} critical, ${warn} warnings.`;
    }
    const narrativeOut = funderFitNote ? `${aiNarrative}\n- **Funder fit:** ${funderFitNote}` : aiNarrative;

    // ── FAILED-RUN GUARD #2: the AI provider failed on the judge ────────────
    // A judge that failed on the DATA (JSON parse miss, empty narrative) still
    // persists — the metrics are deterministic and the flag-derived rating is an
    // honest read. But a PROVIDER failure means the narrative, the risk rating AND
    // the paper tier on this run are all placeholders; writing that as the newest
    // version buries the last good AI read for a reason a credit top-up fixes.
    // Nothing is written — the previous version stays the latest.
    if (judgeProviderError) {
      console.error(
        `[underwrite-deal] refusing to persist a provider-degraded run for deal ${dealId} — ${judgeProviderError}`,
      );
      return json({
        error: providerErrorMessage(judgeProviderError),
        code: "ai_provider_error",
        provider_error: judgeProviderError,
        credits_exhausted: isCreditsExhausted(judgeProviderError),
        persisted: false,
        dealId,
        // The deterministic half DID compute — returned so the caller can show what
        // was read, while making it unmistakable that nothing was saved.
        months_covered: monthsCovered,
        flags,
      }, 502);
    }

    // ── MERCHANT PROFILE + RECOMMENDED FUNDERS ─────────────────────────────────
    // The AI classified the paper tier and read the product signals; CODE decides
    // everything else and CODE picks the funders. The model is never allowed to name
    // a funder (it hallucinates them) — the shortlist is matched against the real
    // lenders.category payload that also drives /admin/cheat-sheet.

    // Tier: the WORSE of the model's call and the deterministic ceiling.
    const aiTierIdx = aiTier ? TIERS.indexOf(aiTier) : -1;
    const paperTier: PaperTier = TIERS[Math.max(aiTierIdx, tierCapIdx)] ?? tierCap;

    // Product signals: 'mca' always present; everything else must be a known product
    // AND must not be invented — an unknown label is dropped rather than guessed at.
    const KNOWN_PRODUCTS = [
      "mca", "term_loan", "line_of_credit", "sba_loan", "real_estate_cre",
      "equipment_financing", "invoice_factoring",
    ];
    // Tolerate the shorthand the prompt's bucket names use.
    const PRODUCT_ALIASES: Record<string, string> = {
      sba: "sba_loan", equipment: "equipment_financing", real_estate: "real_estate_cre",
      cre: "real_estate_cre", factoring: "invoice_factoring", loc: "line_of_credit",
    };
    const productSignals = Array.from(new Set([
      "mca",
      ...aiProductSignals
        .map((s) => s.toLowerCase().trim().replace(/\s+/g, "_"))
        .map((s) => PRODUCT_ALIASES[s] ?? s)
        .filter((s) => KNOWN_PRODUCTS.includes(s)),
    ]));

    const profileReason = aiProfileReason ||
      `${paperTier} paper — ${positionsCount} open MCA position(s), ${nsfTotal} NSF event(s), ` +
      `${negativeDays} negative day(s) on ${money(trueAvgMonthlyRevenue)}/mo true revenue` +
      (ficoLow != null ? ` at ~${ficoLow} FICO` : " (credit unknown — classified from cash flow)") + ".";

    // ---- MERCHANT SIGNALS for the granular criteria gate ----
    // lenders.category.criteria carries each funder's published box (max_positions,
    // min_tib_months, min_monthly_revenue, fico_floor, restricted_states/industries,
    // states_coverage, collections/decline free text). To gate on it we need the MERCHANT side of the
    // same fields. House rules apply on both sides: an unrecorded FUNDER criterion is
    // NO constraint, and an unknown MERCHANT value NEVER disqualifies — it surfaces as
    // "unverified" on the match so the closer knows to confirm it.
    // MERCHANT STATE — derived, not just read. customers.address_state is NULL on most
    // real deals (GHL and the intake form both let it through empty), and a missing
    // state used to make every state restriction unenforceable: the gate fell through
    // to "not recorded — unchecked" and a restricted funder was recommended clean. A
    // TX merchant was sent to True Advance (restricted_states ["TX","ND"]) that way.
    // So walk a source chain, strongest evidence first. Deterministic records beat the
    // AI's statement read; the phone area code is a last resort and is marked LOW
    // confidence — it raises a verify-flag, it never hard-excludes anyone (see the
    // restricted-states gate below).
    const statementStates = (() => {
      const tally = new Map<string, number>();
      for (const s of perStatement) {
        if (s._error) continue;
        const code = normStateCode(s.business_state);
        if (code) tally.set(code, (tally.get(code) ?? 0) + 1);
      }
      return [...tally.entries()].sort((a, b) => b[1] - a[1]);
    })();
    const stateChain: Array<{ code: string | null; source: string; confidence: "high" | "medium" | "low" }> = [
      { code: normStateCode(cust.address_state), source: "customer_record", confidence: "high" },
      { code: normStateCode(appRow?.business_state), source: "application", confidence: "high" },
      { code: stateFromZip(cust.address_zip), source: "customer_zip", confidence: "high" },
      { code: stateFromZip(appRow?.business_zip), source: "application_zip", confidence: "high" },
      { code: statementStates[0]?.[0] ?? null, source: "bank_statements", confidence: "medium" },
      { code: normStateCode(appRow?.owner_home_state), source: "application_owner_home", confidence: "medium" },
      { code: stateFromPhone(cust.phone), source: "phone_area_code", confidence: "low" },
      { code: stateFromPhone(appRow?.business_phone), source: "application_phone_area_code", confidence: "low" },
    ];
    const stateHit = stateChain.find((c) => c.code != null) ?? null;
    const merchantState: string | null = stateHit?.code ?? null;
    const merchantStateSource: string | null = stateHit?.source ?? null;
    const merchantStateConfidence: "high" | "medium" | "low" | null = stateHit?.confidence ?? null;
    // Statements disagreeing with each other (two states in the address blocks) is
    // worth surfacing rather than silently taking the mode.
    const statementStateConflict = statementStates.length > 1
      ? statementStates.map(([c, n]) => `${c}×${n}`).join(", ")
      : null;

    // SELF-HEAL the CRM record. Only from evidence we'd stand behind (never the area
    // code), only when the field is genuinely empty, never overwriting a recorded
    // value. Best-effort — a failed write must not affect the run.
    let merchantStateWriteback = false;
    if (
      merchantState && merchantStateConfidence !== "low" &&
      merchantStateSource !== "customer_record" && !String(cust.address_state ?? "").trim()
    ) {
      try {
        const { error: wbErr } = await db
          .from("customers").update({ address_state: merchantState }).eq("id", deal.customer_id);
        if (wbErr) throw new Error(wbErr.message);
        merchantStateWriteback = true;
        console.log(`[underwrite-deal] wrote back address_state=${merchantState} (${merchantStateSource}) for customer ${deal.customer_id}`);
      } catch (e) {
        console.warn("[underwrite-deal] address_state write-back failed:", e instanceof Error ? e.message : e);
      }
    }
    const merchantIndustry: string | null =
      String(cust.industry ?? cust.business_type ?? "").trim() || null;
    // Revenue tested against a funder floor is the VERIFIED figure, not the stated ask
    // — that is the number the funder will compute off the statements themselves.
    const merchantRevenue: number | null = trueAvgMonthlyRevenue > 0 ? trueAvgMonthlyRevenue : null;

    // BEST-EFFORT default / collections signal. Nothing in a bank statement literally
    // says "default", so this is the distress read the underwriter already computes.
    // Kept DELIBERATELY narrow — merely stacked-and-tight is NOT a default, and a
    // false positive here would push every hard-no-default desk off a placeable file.
    // No signal ⇒ unknown ⇒ nobody is penalized (it only ever RE-RANKS, never gates).
    const defaultBasis: string[] = [];
    if (debtReliefCandidate) defaultBasis.push("debt-relief candidate (distressed / near-default)");
    if (debtServicePct > 100) {
      defaultBasis.push(`existing debits consume ${Math.round(debtServicePct)}% of true revenue`);
    }
    // Collection activity IS observed evidence (unlike the distress proxies above),
    // so it feeds the same default/collections stance — and additionally drives the
    // hard collections gate below.
    if (collectionActivity.detected) {
      defaultBasis.push(
        `collection activity in the statements (${collectionActivity.types.join(", ")}; ` +
        `${collectionActivity.items.length} debit(s), ${collectionActivity.confidence} confidence)`,
      );
    }
    const defaultSignal = defaultBasis.length > 0;
    const merchantSignals = {
      positions: positionsCount,
      industry: merchantIndustry,
      state: merchantState,
      state_source: merchantStateSource,
      state_confidence: merchantStateConfidence,
      state_conflict: statementStateConflict,
      fico_low: ficoLow,
      time_in_business_months: tibMonthsKnown,
      true_monthly_revenue: merchantRevenue,
      default_flag: defaultSignal,
      default_basis: defaultBasis,
      collection_activity: collectionActivity.detected,
      collection_activity_types: collectionActivity.types,
      collection_activity_confidence: collectionActivity.detected ? collectionActivity.confidence : null,
    };

    // ---- Deterministic funder matching against lenders.category ----
    type CatFlags = Record<string, boolean | undefined>;
    interface LenderRow {
      id: string; company_name: string;
      min_funding_amount: number | string | null; max_funding_amount: number | string | null;
      category: Any | null;
    }
    let recommendedFunders: Array<{
      lender_id: string; company_name: string; relationship: string | null;
      consolidation_type: string | null; why_matched: string; score: number;
      /** Criteria the funder publishes but the merchant record can't answer yet. */
      unverified?: string[];
      /** Loud warning: the state question could not be answered on one side or the other. */
      state_verify?: string | null;
      /** Which side is unverified — the merchant's state, or the funder's footprint. */
      state_verify_kind?: "merchant" | "coverage" | null;
    }> = [];
    // Near-misses the owner wants to SEE: a funder that cleared the lane/paper/product
    // filter but failed one published criterion, with the gate it failed.
    let excludedFunders: Array<{
      lender_id: string; company_name: string; reason: string;
      /** Hard-excluded BECAUSE collection activity was detected in the statements. */
      collections_exclusion?: true;
      /** Still submittable, but pushed down the list by the same signal. */
      deprioritized?: true;
    }> = [];
    let funderMatchNote: string | null = null;
    try {
      const { data: liveRows } = await db
        .from("lenders")
        .select("id, company_name, min_funding_amount, max_funding_amount, category")
        .eq("status", "live_vendor");
      const live = ((liveRows ?? []) as unknown as LenderRow[]).filter((l) => l.category != null);

      // Read the category payload exactly the way /admin/cheat-sheet does, so the
      // shortlist can never drift from what the closer sees on that page.
      const catOf = (l: LenderRow): Any => (l.category ?? {}) as Any;
      const catFlagsOf = (l: LenderRow): CatFlags => (catOf(l).flags ?? {}) as CatFlags;
      const consoTypes = (l: LenderRow): string[] => {
        const t = catOf(l).consolidation?.type;
        const raw = Array.isArray(t) ? t : t == null ? [] : [t];
        return raw.map((x: unknown) => String(x).toLowerCase().trim()).filter((x) => x && x !== "none");
      };
      const isRestructure = (l: LenderRow) => consoTypes(l).some((t) => /restructure|relief|settle/.test(t));
      const isConsolidation = (l: LenderRow) =>
        !isRestructure(l) && (catFlagsOf(l).consolidation === true || consoTypes(l).length > 0);
      const isReverse = (l: LenderRow) => consoTypes(l).some((t) => /reverse|both/.test(t));
      const isPayoff = (l: LenderRow) => consoTypes(l).some((t) => /payoff|true|both/.test(t));
      const consoLabelOf = (l: LenderRow): string | null => {
        if (isRestructure(l)) return "restructure";
        const rev = isReverse(l); const pay = isPayoff(l);
        if (rev && pay) return "true_consolidation/payoff + reverse_consolidation";
        if (rev) return "reverse_consolidation";
        if (pay) return "true_consolidation/payoff";
        return isConsolidation(l) ? "consolidation" : null;
      };
      const relSet = (l: LenderRow): string[] => {
        const c = catOf(l);
        const many = ((c.relationships ?? []) as unknown[]).map((r) => String(r).toLowerCase().trim()).filter(Boolean);
        if (many.length) return many;
        const one = String(c.relationship ?? "").toLowerCase().trim();
        return one ? [one] : [];
      };
      const paperOf = (l: LenderRow): string[] =>
        ((catOf(l).paper ?? []) as unknown[]).map((p) => String(p).trim().toUpperCase());
      const productsOf = (l: LenderRow): string[] =>
        ((catOf(l).products ?? []) as unknown[]).map((p) => String(p).toLowerCase().trim());

      const takesTier = (l: LenderRow) => paperOf(l).includes(paperTier);
      const allCredit = (l: LenderRow) => paperOf(l).includes("ALL_CREDIT");

      // POOL. The consolidation / debt-relief lanes are exclusive when they apply —
      // sending a stacked merchant with no capacity to a straight new-money desk is
      // the mistake this whole profile exists to prevent.
      let pool: LenderRow[];
      let lane: "debt_relief" | "consolidation" | "standard";
      if (debtReliefCandidate) {
        lane = "debt_relief";
        pool = live.filter((l) => isRestructure(l) || isConsolidation(l));
      } else if (consolidationCandidate) {
        lane = "consolidation";
        pool = live.filter((l) => isConsolidation(l));
      } else {
        lane = "standard";
        pool = live.filter((l) => !isRestructure(l));
      }
      if (pool.length === 0) {
        lane = "standard";
        pool = live.filter((l) => !isRestructure(l));
        funderMatchNote = "No onboarded funder carries the lane this profile calls for — showing the general live network instead.";
      }

      // Hard exclusions inside the pool: a recorded paper box that excludes this tier,
      // and a recorded product menu that carries nothing this merchant needs. A funder
      // with NO recorded box is never excluded (missing data is not a disqualifier).
      const wanted = new Set(productSignals);
      const eligible = pool.filter((l) => {
        const paper = paperOf(l);
        if (paper.length > 0 && !takesTier(l) && !allCredit(l) && !isRestructure(l)) return false;
        const prods = productsOf(l);
        if (prods.length > 0 && !isRestructure(l) && !prods.some((p) => wanted.has(p))) return false;
        return true;
      });

      // ---- GRANULAR CRITERIA GATE (lenders.category.criteria) ----
      // STRUCTURED fields (max_positions, first_position_only, restricted_states,
      // restricted_industries, min_tib_months, min_monthly_revenue, fico_floor) are
      // reliable enough to HARD-EXCLUDE on. The free-text fields (collections_policy,
      // decline_signal) only ever RE-RANK — fuzzy prose must never silently kill a
      // placement.
      const critOf = (l: LenderRow): Any => (catOf(l).criteria ?? {}) as Any;
      const strList = (v: unknown): string[] =>
        Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
      // A restriction entry carrying a caveat ("Trucking (selective)", "CA (selective —
      // clean files only)", "Gas stations (weak)") means CASE-BY-CASE, not a closed
      // door: those downgrade to a soft penalty + a confirm-with-the-rep note.
      const SOFT_QUALIFIER =
        /selective|case[- ]by[- ]case|sometimes|exception|depends|scrutin|prefer|weak|rarely|with no |without/i;
      // Head of an entry = the part before any parenthetical/slash caveat.
      const headOf = (s: string) => s.split(/[(\/]/)[0].trim();
      const normPhrase = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
      // Whole-phrase, word-boundary containment in either direction ("construction"
      // matches "General construction (usually declined)"). Short strings must match
      // exactly so a 2-3 letter industry can't collide inside an unrelated word.
      const phraseHit = (entry: string, value: string): boolean => {
        const a = normPhrase(headOf(entry));
        const b = normPhrase(value);
        if (a.trim().length < 4 || b.trim().length < 4) return a === b;
        return a.includes(b) || b.includes(a);
      };
      const stateCodesIn = (entry: string): string[] => {
        const out: string[] = [];
        // Leading UPPERCASE two-letter token only, so "Canada (non-US)" is not read as CA.
        const lead = entry.match(/^\s*([A-Z]{2})\b/);
        if (lead && US_STATE_CODES.has(lead[1])) out.push(lead[1]);
        const low = entry.toLowerCase();
        for (const [name, code] of Object.entries(US_STATES)) if (low.includes(name)) out.push(code);
        return out;
      };
      // Free-text stance on prior defaults / open collections. Hard patterns come from
      // real decline emails and published cards; friendly patterns from desks whose
      // whole product IS the defaulted merchant. Every pattern is anchored to
      // default/collections language on purpose: a bare "auto-decline" is usually about
      // an INDUSTRY (FundKite's logistics/construction), and bare "settlement"/"debt
      // relief" is usually an ISO-conduct clause barring us from referring merchants
      // out — neither says anything about this merchant's default history.
      const HARD_DEFAULT_RE = new RegExp([
        String.raw`(?:0|zero|no)\s+(?:active\s+|open\s+)?defaults?`,
        String.raw`no previous or current default`,
        String.raw`recent default`,
        String.raw`already in default on`,
        String.raw`debt collection activity`,
        String.raw`auto[- ]?decline[^.]{0,80}(?:default|collection|bankrupt|lien|judgment)`,
        String.raw`(?:default|collection|bankrupt|lien|judgment)[^.]{0,80}auto[- ]?decline`,
      ].join("|"), "i");
      // "no stated position on merchants already in default" is the ABSENCE of a policy,
      // not a gate — a hard hit sitting behind one of these is discarded.
      const HARD_NEGATED_RE =
        /(?:no stated position|no published|not published|nothing (?:is )?published|silent on|no policy|unknown)[^.]{0,60}$/i;
      const FRIENDLY_DEFAULT_RE =
        /accepts?\s+default|funds?\s+default|\bZBLs?\b|tax liens?\s+acceptable|defaulted and delinquent|past defaults? eligible/i;
      // COLLECTIONS AUTO-DECLINE — the narrow subset of hard-default desks whose
      // published stance is an outright NO on collections/defaults, i.e. the ones
      // that will bounce the file on sight. Green Note's decline email ("Debt
      // collection activity detected"), United Capital Source's "No previous or
      // current Defaults", Velocity's "HARD AUTO-DECLINE ... prior default /
      // collections", Green Note's "0 ACTIVE DEFAULTS" card all land here. This
      // ONLY bites when collection activity was actually detected in the statements.
      // Narrower than HARD_DEFAULT_RE on purpose: "recent default" or "already in
      // default on positions" is a stance on DEFAULTS, not on collection activity —
      // those desks get deprioritized, not removed.
      const COLLECTIONS_AUTODECLINE_RE = new RegExp([
        String.raw`debt collection activity`,
        String.raw`(?:0|zero|no)\s+(?:active\s+|open\s+)?defaults?`,
        String.raw`no previous or current default`,
        String.raw`auto[- ]?decline[^.]{0,80}(?:default|collection|judgment|tax lien)`,
        String.raw`(?:default|collection|judgment|tax lien)[^.]{0,80}auto[- ]?decline`,
        String.raw`no\s+(?:open\s+)?collections?\b`,
      ].join("|"), "i");

      interface CritRead {
        hard: string | null;
        soft: string[];
        why: string[];
        unverified: string[];
        preferred: boolean;
        defaultStance: "hard" | "friendly" | "unknown";
        /** Verbatim published wording behind an explicit collections auto-decline. */
        collectionsAutoDecline: string | null;
        /**
         * This funder publishes state restrictions but we could not establish the
         * merchant's state well enough to check them. Never a gate (an unknown
         * merchant value never disqualifies) — it down-ranks and prints a loud
         * verify-before-submitting warning so nobody submits blind again.
         */
        stateVerify: string | null;
        /**
         * WHICH side of the state question is unverified — the MERCHANT's state, or the
         * FUNDER's coverage (criteria.states_coverage === "unknown": we could not confirm
         * they fund every state, and they publish no restricted list to check). Both
         * down-rank identically; they need different wording on the shortlist note.
         */
        stateVerifyKind: "merchant" | "coverage" | null;
      }
      const readCriteria = (l: LenderRow): CritRead => {
        const cr = critOf(l);
        const out: CritRead = {
          hard: null, soft: [], why: [], unverified: [], preferred: false, defaultStance: "unknown",
          collectionsAutoDecline: null, stateVerify: null, stateVerifyKind: null,
        };
        const fail = (why: string) => { if (!out.hard) out.hard = why; };

        // POSITIONS — the single most common reason a stacked file bounces.
        const maxPos = numOrNull(cr.max_positions);
        if (maxPos != null) {
          if (positionsCount > maxPos) fail(`merchant has ${positionsCount} position(s), max ${maxPos}`);
          else out.why.push(`takes up to ${maxPos} position(s); merchant has ${positionsCount}`);
        }
        if (cr.first_position_only === true && positionsCount > 0) {
          fail(`first position only; merchant has ${positionsCount} open position(s)`);
        }

        // STATE. Two unknowns have to be honoured at once — what state the MERCHANT is
        // in, and whether the FUNDER's footprint was ever verified — and neither may
        // resolve to a silent pass. criteria.states_coverage records the second:
        //   · "restricted" → they publish a restricted list; gate on it (below);
        //   · "all_50"     → verified to fund every state; clean regardless of merchant;
        //   · "unknown"    → we could NOT verify their footprint. An empty
        //     restricted_states on an unknown-coverage funder is absence of evidence, not
        //     evidence of absence — so it gets the same treatment as an unknown MERCHANT
        //     state: never a gate, always a down-rank plus a loud confirm-first note.
        // A recorded restriction is only enforceable against a merchant state we
        // actually trust. Three cases:
        //   · state known (high/medium confidence) → gate exactly as before;
        //   · state only INFERRED from the phone area code → too weak to exclude on
        //     (a cell number travels), so warn loudly instead;
        //   · state unknown → warn loudly. Never a silent pass: that is precisely how a
        //     TX merchant got recommended a funder that does not fund TX.
        const rs = strList(cr.restricted_states);
        const coverage = String(cr.states_coverage ?? "").trim().toLowerCase();
        if (rs.length === 0 && coverage === "all_50") {
          out.why.push("funds all 50 states (footprint verified)");
        } else if (rs.length === 0 && coverage === "unknown") {
          out.stateVerify = `⚠ state coverage unverified — confirm this funder funds ${merchantState ?? "the merchant's state"} before submitting`;
          out.stateVerifyKind = "coverage";
          out.unverified.push(
            `funder state coverage never verified${merchantState ? ` — confirm they fund ${merchantState}` : ""}`,
          );
        }
        if (rs.length > 0) {
          const restrictedList = Array.from(new Set(rs.map((e) => headOf(e)).filter(Boolean))).join(", ");
          const noFund = `does not fund ${restrictedList || "certain states"}`;
          if (merchantState && merchantStateConfidence !== "low") {
            const hit = rs.find((e) => stateCodesIn(e).includes(merchantState));
            if (!hit) out.why.push(`no state restriction for ${merchantState}`);
            else if (SOFT_QUALIFIER.test(hit)) {
              out.soft.push(`${merchantState} is case-by-case for them (${headOf(hit) || merchantState}) — confirm before submitting`);
            } else fail(`${noFund} — merchant is in ${merchantState}`);
          } else if (merchantState) {
            const hit = rs.find((e) => stateCodesIn(e).includes(merchantState));
            out.stateVerify = hit
              ? `⚠ verify merchant state before submitting — the only state signal on file is the phone area code (${merchantState}), and this funder ${noFund}`
              : `⚠ verify merchant state before submitting — merchant state is inferred from the phone area code only (${merchantState}); this funder ${noFund}`;
            out.stateVerifyKind = "merchant";
            out.unverified.push(`merchant state inferred from phone area code (${merchantState}) — state restrictions not verified`);
          } else {
            out.stateVerify = `⚠ verify merchant state before submitting — no merchant state on file, and this funder ${noFund}`;
            out.stateVerifyKind = "merchant";
            out.unverified.push("merchant state not recorded — their state restrictions unchecked");
          }
        }

        // INDUSTRY
        const ri = strList(cr.restricted_industries);
        if (ri.length > 0) {
          if (merchantIndustry) {
            const hit = ri.find((e) => phraseHit(e, merchantIndustry));
            if (!hit) out.why.push(`${merchantIndustry} is not on their restricted list`);
            else if (SOFT_QUALIFIER.test(hit)) {
              out.soft.push(`"${headOf(hit)}" is case-by-case on their restricted list — confirm before submitting`);
            } else fail(`restricted industry: ${headOf(hit)}`);
          } else out.unverified.push("merchant industry not recorded — their industry restrictions unchecked");
        }
        if (merchantIndustry && strList(cr.preferred_industries).some((e) => phraseHit(e, merchantIndustry))) {
          out.preferred = true;
          out.why.push(`${merchantIndustry} is on their preferred-industry list`);
        }

        // NUMERIC FLOORS — only bite when the MERCHANT value is actually known.
        const minTib = numOrNull(cr.min_tib_months);
        if (minTib != null && minTib > 0) {
          if (tibMonthsKnown == null) out.unverified.push(`needs ${minTib} mo in business — merchant TIB not recorded`);
          else if (tibMonthsKnown < minTib) fail(`${tibMonthsKnown} mo in business, they need ${minTib}`);
          else out.why.push(`${tibMonthsKnown} mo in business clears their ${minTib} mo floor`);
        }
        const minRev = numOrNull(cr.min_monthly_revenue);
        if (minRev != null && minRev > 0) {
          if (merchantRevenue == null) out.unverified.push(`needs ${money(minRev)}/mo — no verified revenue to check against`);
          else if (merchantRevenue < minRev) fail(`${money(merchantRevenue)}/mo true revenue, they need ${money(minRev)}`);
          else out.why.push(`${money(merchantRevenue)}/mo true revenue clears their ${money(minRev)} floor`);
        }
        const ficoFloor = numOrNull(cr.fico_floor);
        if (ficoFloor != null && ficoFloor > 0) {
          // Unknown credit NEVER disqualifies — MCA is cash-flow underwriting.
          if (ficoLow == null) out.unverified.push(`FICO floor ${ficoFloor} — merchant credit unknown (cash-flow file, not a decline)`);
          else if (ficoLow < ficoFloor) fail(`FICO ~${ficoLow} below their ${ficoFloor} floor`);
          else out.why.push(`FICO ~${ficoLow} clears their ${ficoFloor} floor`);
        }

        // DEFAULT / COLLECTIONS STANCE (soft re-rank only).
        if (isRestructure(l)) out.defaultStance = "friendly";
        else {
          const policyText = `${cr.collections_policy ?? ""} ${cr.decline_signal ?? ""}`.trim();
          if (policyText) {
            const hit = policyText.match(HARD_DEFAULT_RE);
            const negated = hit != null &&
              HARD_NEGATED_RE.test(policyText.slice(Math.max(0, (hit.index ?? 0) - 60), hit.index ?? 0));
            if (hit && !negated) out.defaultStance = "hard";
            else if (FRIENDLY_DEFAULT_RE.test(policyText)) out.defaultStance = "friendly";

            // COLLECTIONS HARD GATE. Only a funder whose stance is hard AND whose
            // wording is an outright no-collections/no-defaults rule qualifies — a
            // friendly desk is never gated, and a merely investigative one isn't
            // either. The matched phrase is quoted back so the owner can see the
            // receipt rather than trust a regex.
            // CONFLICT GUARD: some records carry BOTH stances (Cashable's packet says
            // "NO defaults on other MCA companies" on one page and "PAST DEFAULTS
            // ELIGIBLE" on another). Contradictory prose must never hard-kill a
            // placement — a conflicted desk is deprioritized and left callable.
            const conflicted = FRIENDLY_DEFAULT_RE.test(policyText);
            if (out.defaultStance === "hard" && !conflicted) {
              const cHit = policyText.match(COLLECTIONS_AUTODECLINE_RE);
              const cNegated = cHit != null &&
                HARD_NEGATED_RE.test(policyText.slice(Math.max(0, (cHit.index ?? 0) - 60), cHit.index ?? 0));
              if (cHit && !cNegated) out.collectionsAutoDecline = cHit[0].trim();
            }
          }
        }
        return out;
      };

      const reads = new Map<string, CritRead>(eligible.map((l) => [l.id, readCriteria(l)]));
      // Categorical gates (positions / state / industry) are the surprising ones a
      // closer needs to see; a revenue floor a small file simply doesn't reach is
      // obvious. Rank the categorical ones first so the cap never buries them.
      const exclRank = (reason: string) =>
        /position/.test(reason) ? 0 : /does not fund/.test(reason) ? 1 : /restricted industry/.test(reason) ? 2 : 3;

      // ── COLLECTIONS HARD EXCLUSION ──────────────────────────────────────────
      // Only fires when collection activity was actually DETECTED in the statements
      // and the funder publishes an outright collections/defaults auto-decline. This
      // exclusion is stickier than the ordinary criteria gate: it survives the
      // "everything failed, show them anyway" rescue below, because sending a
      // collections file to Green Note is exactly the outcome this exists to prevent.
      const collectionsBlocked = new Map<string, string>();
      if (collectionActivity.detected) {
        for (const l of eligible) {
          const q = reads.get(l.id)?.collectionsAutoDecline;
          if (q) {
            collectionsBlocked.set(
              l.id,
              `auto-declines on collection activity (detected in the statements) — their published stance: "${q}"`,
            );
          }
        }
      }
      const collectionsExclusions = eligible
        .filter((l) => collectionsBlocked.has(l.id))
        .map((l) => ({
          lender_id: l.id, company_name: l.company_name,
          reason: collectionsBlocked.get(l.id)!, collections_exclusion: true as const,
        }))
        .sort((a, b) => a.company_name.localeCompare(b.company_name));

      excludedFunders = [
        ...collectionsExclusions,
        ...eligible
          .filter((l) => !collectionsBlocked.has(l.id) && reads.get(l.id)?.hard)
          .map((l) => ({ lender_id: l.id, company_name: l.company_name, reason: reads.get(l.id)!.hard! }))
          .sort((a, b) => (exclRank(a.reason) - exclRank(b.reason)) || a.company_name.localeCompare(b.company_name)),
      ].slice(0, 12 + collectionsExclusions.length);

      const placeable = eligible.filter((l) => !collectionsBlocked.has(l.id));
      let gated = placeable.filter((l) => !reads.get(l.id)?.hard);
      // If the criteria gate empties the lane, ship the funders anyway with the failed
      // gate written onto the match — a shortlist that needs a rep call beats no play
      // at all, which is the one outcome this profile exists to prevent. The
      // collections-blocked desks are NOT rescued: for them the decline is certain.
      if (gated.length === 0 && placeable.length > 0) {
        for (const l of placeable) {
          const r = reads.get(l.id)!;
          if (r.hard) { r.soft.push(`FAILS their published box: ${r.hard}`); r.hard = null; }
        }
        gated = placeable;
        funderMatchNote = (funderMatchNote ? funderMatchNote + " " : "") +
          "Every live funder in this lane fails a published criterion — shown anyway with the failed gate noted; call the reps before submitting.";
      }
      if (collectionsExclusions.length) {
        funderMatchNote = (funderMatchNote ? funderMatchNote + " " : "") +
          `${collectionsExclusions.length} funder(s) removed from the shortlist because the statements show collection activity and their published policy auto-declines it: ` +
          collectionsExclusions.map((x) => x.company_name).join(", ") + ".";
      }

      // An UNRECORDED funding band must not read as a $0–$0 box and penalize every
      // funder that hasn't published one — numOrNull keeps missing as missing.
      const minOf = (l: LenderRow) => numOrNull(l.min_funding_amount);
      const maxOf = (l: LenderRow) => numOrNull(l.max_funding_amount);

      const scored = gated.map((l) => {
        const f = catFlagsOf(l);
        const c = catOf(l);
        const why: string[] = [];
        let score = 0;

        if (isRestructure(l)) {
          score += 200;
          why.push("debt-relief / restructure desk — the referral lane once even a consolidation is a stretch");
        } else if (isConsolidation(l) && (consolidationCandidate || debtReliefCandidate)) {
          score += debtReliefCandidate ? 60 : 100;
          why.push(
            `${(consoLabelOf(l) ?? "consolidation").replace(/_/g, " ")} — the play is rolling up ${positionsCount} open position(s) (~${money(outstandingMid)} est.), not new money`,
          );
          if (isReverse(l) && newMoneyCeiling < COUNTER_FLOOR) score += 6;
          if (isPayoff(l) && refi.feasible) score += 6;
        }

        if (takesTier(l)) { score += 30; why.push(`takes ${paperTier} paper`); }
        else if (allCredit(l)) { score += 20; why.push("all-credit box (no FICO floor)"); }
        else if (paperOf(l).length === 0) { score += 5; why.push("paper box not recorded — confirm with the rep"); }
        if (paperTier === "D" && f.high_risk_dpaper) { score += 12; why.push("high-risk / D-paper tolerant"); }

        if (String(c.size_tier ?? "") === sizeBucket) { score += 12; why.push(`${sizeBucket.replace("_", "–")} size tier`); }
        const lo = minOf(l); const hi = maxOf(l);
        if (sizeBasis > 0 && (lo != null || hi != null)) {
          const inRange = (lo == null || sizeBasis >= lo) && (hi == null || sizeBasis <= hi);
          const band = `${lo != null ? money(lo) : "no min"}–${hi != null ? money(hi) : "no max"}`;
          if (inRange) { score += 10; why.push(`${money(sizeBasis)} sits inside their ${band} band`); }
          else { score -= 12; why.push(`${money(sizeBasis)} is outside their ${band} band — confirm before submitting`); }
        }
        if (sizeBucket === "micro" && !consolidationCandidate && !debtReliefCandidate && f.micro) {
          score += 15; why.push("funds micro tickets");
        }

        for (const sig of productSignals) {
          if (sig === "mca") continue;
          if (productsOf(l).includes(sig)) { score += 20; why.push(`does ${sig.replace(/_/g, " ")}`); }
        }
        if (productSignals.includes("mca") && productsOf(l).includes("mca")) score += 5;

        if (fastTrack && f.fast_funding) { score += 10; why.push("fast / light-stips — right for a thin file"); }

        const rels = relSet(l);
        if (rels.includes("direct_funder")) score += 6;
        else if (rels.some((r) => /marketplace|aggregator/.test(r))) score += 1;

        // ---- granular criteria: what PASSED, what is soft, what is unverified ----
        const read = reads.get(l.id) ?? {
          hard: null, soft: [], why: [], unverified: [], preferred: false, defaultStance: "unknown" as const,
          collectionsAutoDecline: null, stateVerify: null, stateVerifyKind: null,
        };
        // Every criterion the merchant actually cleared is cited by name — the owner
        // wants to read WHY a funder is on the list, not just that it scored.
        score += Math.min(read.why.length, 6) * 4;
        why.push(...read.why);
        if (read.preferred) score += 8;
        for (const s of read.soft) { score -= 10; why.push(s); }
        // Free-text default/collections stance: re-rank only, never a gate. The
        // outright collections auto-decliners were already removed above; what is
        // left here is the softer hard-default crowd, pushed DOWN hard when actual
        // collection activity is on the statements, and the accept-defaults desks
        // pushed UP — that reordering is the whole routing play.
        if (defaultSignal) {
          if (read.defaultStance === "hard") {
            score -= collectionActivity.detected ? 150 : 80;
            why.push(collectionActivity.detected
              ? "hard default/collections gate on file AND this merchant shows collection activity in the statements — deprioritized; clear it with the rep before submitting"
              : "hard default/collections gate on file — this merchant shows a default/collections signal, expect a decline");
          } else if (read.defaultStance === "friendly") {
            score += collectionActivity.detected ? 90 : 60;
            why.push(collectionActivity.detected
              ? "accepts defaults / collections / tax liens — the right desk for a file with collection activity"
              : "accepts defaults / collections — the right desk for a distressed file");
          }
        }
        // UNVERIFIABLE STATE. Still not a gate — neither an unknown merchant value nor an
        // unverified funder footprint disqualifies — but it must never read as a clean
        // match either. Down-rank it below every funder whose box we could actually check,
        // and print the warning first so the closer sees it before the reasons this funder
        // scored at all.
        if (read.stateVerify) {
          score -= 40;
          why.unshift(read.stateVerify);
        }
        // Unknown merchant values are stipulations, not declines: shown, never scored.
        if (read.unverified.length) {
          why.push(`unverified — ${read.unverified.slice(0, 2).join("; ")}`);
        }

        return {
          lender_id: l.id,
          company_name: l.company_name,
          relationship: rels[0] ?? null,
          consolidation_type: consoLabelOf(l),
          why_matched: why.join("; "),
          score,
          unverified: read.unverified,
          state_verify: read.stateVerify,
          state_verify_kind: read.stateVerifyKind,
        };
      });

      scored.sort((a, b) => (b.score - a.score) || a.company_name.localeCompare(b.company_name));
      recommendedFunders = scored.slice(0, 5);

      // One loud line at the top of the shortlist whenever a state-restricted funder
      // made it on with the merchant's state unconfirmed. This is the note that would
      // have stopped a TX merchant going to a funder that does not fund TX.
      const needStateCheck = recommendedFunders.filter((r) => r.state_verify_kind === "merchant");
      if (needStateCheck.length) {
        funderMatchNote = (funderMatchNote ? funderMatchNote + " " : "") +
          `⚠ MERCHANT STATE ${merchantState ? `is only inferred (${merchantState}, ${merchantStateSource?.replace(/_/g, " ")})` : "is not on file"} — ` +
          `confirm it before submitting to ${needStateCheck.map((r) => r.company_name).join(", ")}: ` +
          "each of them publishes state restrictions we could not check.";
      }
      // The mirror image: the merchant's state is fine, but these funders' footprints
      // were never verified, so nothing on file says they fund it. Also not a gate —
      // a confirm-first call, printed by name.
      const needCoverageCheck = recommendedFunders.filter((r) => r.state_verify_kind === "coverage");
      if (needCoverageCheck.length) {
        funderMatchNote = (funderMatchNote ? funderMatchNote + " " : "") +
          `⚠ STATE COVERAGE UNVERIFIED for ${needCoverageCheck.map((r) => r.company_name).join(", ")} — ` +
          `nothing on file confirms they fund ${merchantState ?? "the merchant's state"}; confirm with the rep before submitting.`;
      }

      // Hard-default desks that survived the gate but got pushed off the shortlist by
      // the collection-activity signal are recorded so the owner sees WHY they aren't
      // there — a deprioritization, not an exclusion (they can still be called).
      if (collectionActivity.detected) {
        const onList = new Set(recommendedFunders.map((r) => r.lender_id));
        const deprioritized = placeable
          .filter((l) => !onList.has(l.id) && reads.get(l.id)?.defaultStance === "hard")
          .map((l) => ({
            lender_id: l.id, company_name: l.company_name,
            reason: "deprioritized — publishes a hard default/collections gate and the statements show collection activity",
            deprioritized: true as const,
          }))
          .sort((a, b) => a.company_name.localeCompare(b.company_name))
          .slice(0, 6);
        excludedFunders = [...excludedFunders, ...deprioritized];
      }
      if (recommendedFunders.length === 0) {
        funderMatchNote = (funderMatchNote ? funderMatchNote + " " : "") +
          "No live funder's recorded box matches this profile — widen the network or confirm boxes with the reps.";
      }
    } catch (e) {
      // A funder-match failure must never sink the run: the profile still persists.
      funderMatchNote = `Funder matching unavailable (${e instanceof Error ? e.message : e}).`;
      console.warn("[underwrite-deal] funder match failed:", e instanceof Error ? e.message : e);
    }

    const profile = {
      paper_tier: paperTier,
      paper_tier_ceiling: tierCap,
      paper_tier_ceiling_because: tierCapReasons,
      paper_tier_ai: aiTier,
      paper_tier_basis: ficoLow != null ? "fico_and_cashflow" : "cashflow_inferred",
      fico_low: ficoLow,
      size_bucket: sizeBucket,
      size_basis_amount: round2(sizeBasis),
      size_basis: sizeBasisLabel,
      positions: positionsCount,
      consolidation_candidate: consolidationCandidate,
      debt_relief_candidate: debtReliefCandidate,
      product_signals: productSignals,
      fast_track: fastTrack,
      // Collection activity — a funder-ROUTING fact, never a disqualifier on our
      // side. Additive; older persisted rows simply lack these keys.
      has_collection_activity: collectionActivity.detected,
      collection_activity_summary: collectionActivity.detected ? collectionActivity.note : null,
      // MERCHANT STATE + where it came from. Additive; older persisted rows lack these.
      merchant_state: merchantState,
      merchant_state_source: merchantStateSource,
      merchant_state_confidence: merchantStateConfidence,
      merchant_state_written_back: merchantStateWriteback,
      merchant_state_conflict: statementStateConflict,
      profile_reason: profileReason,
      // Deterministic shortlist off lenders.category — the deal→funder play.
      recommended_funders: recommendedFunders,
      recommended_funders_note: funderMatchNote,
      // Near-misses: funders in the right lane that failed one published criterion.
      excluded_note: excludedFunders,
      // The merchant side of the criteria gate, so the UI can show what was matched on.
      merchant_signals: merchantSignals,
    };
    // metrics is already frozen into the judge prompt above — the profile rides on the
    // PERSISTED copy (additive: older stored rows simply have no `profile` key).
    const metricsOut = { ...metrics, profile };

    // ---- Persist a new version ----
    const { data: prev } = await db
      .from("deal_underwriting")
      .select("version")
      .eq("deal_id", dealId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = (num(prev?.version) ?? 0) + 1;

    const { data: inserted, error: insErr } = await db
      .from("deal_underwriting")
      .insert({
        deal_id: dealId,
        version,
        run_mode: mode,
        docs_hash: docsHash,
        per_statement: perStatement,
        metrics: metricsOut,
        flags,
        assumptions,
        risk_rating: riskRating,
        affordability_rating: affordabilityRating,
        ai_narrative: narrativeOut,
        settings_snapshot: settings,
        // Record the models that ACTUALLY ran (resolved override), not the code defaults.
        extraction_model: extractionModel,
        judge_model: judgeModel,
        created_by: callerId,
      })
      .select("id, version, created_at")
      .maybeSingle();
    if (insErr) return json({ error: `could not save underwriting run: ${insErr.message}` }, 502);

    // ── Verified existing-MCA positions → deal (ground-truth upgrade) ──
    // The run just persisted (every empty/degraded case returned above), so the
    // bank statements gave us the merchant's ACTUAL open advances — latest-month
    // anchored `activePositions` (count = `positionsCount`, each with its funder).
    // Stamp them onto the deal, upgrading a null / UCC estimate to verified truth.
    //
    // SHARED PRECEDENCE (mirror supabase-backend's canWrite — replicated here,
    // no shared helper exists in _shared yet):
    //   manual / application = 3, bank_statements = 2, ucc = 1, null = 0.
    // The underwriter is rank 2: it MAY overwrite null / 'ucc' and refresh its own
    // 'bank_statements', but must NEVER clobber a human's 'manual' / 'application'
    // entry. The `.or(...)` below is the RACE-SAFE guard — enforced in the DB, so a
    // human write that lands between other statements and this UPDATE cannot be
    // overwritten (the WHERE simply matches zero rows). Best-effort: a failure here
    // never sinks a run that already saved its version.
    try {
      const detectedFunders = activePositions.map((p) => p.funder).filter((f) => !!f);
      const posPatch: Record<string, unknown> = {
        existing_positions: positionsCount,
        existing_positions_source: "bank_statements",
        existing_positions_synced_at: new Date().toISOString(),
      };
      // Only set funders when statements actually named some — never BLANK an
      // existing array (a prior UCC / manual funder list stays if we found none).
      if (detectedFunders.length) posPatch.existing_funders = detectedFunders;
      // Do NOT touch existing_positions_detail — that is UCC per-lien data; there is
      // no statement-derived equivalent, so leave whatever is there.
      const { error: posErr } = await db
        .from("deals")
        .update(posPatch)
        .eq("id", dealId)
        // Precedence guard: write only when the CURRENT source rank <= 2
        // (null / 'ucc' / 'bank_statements'); never over rank-3 'manual'/'application'.
        .or("existing_positions_source.is.null,existing_positions_source.in.(ucc,bank_statements)");
      if (posErr) {
        console.error(`[underwrite-deal] verified-positions write failed for deal ${dealId}: ${posErr.message}`);
      }
    } catch (e) {
      console.error(
        `[underwrite-deal] verified-positions write threw for deal ${dealId}: ` +
        String(e instanceof Error ? e.message : e),
      );
    }

    // ── Lead-score re-rank (fire-and-forget — never blocks the underwriting
    // response). Bank-statement truth just landed: the score must move NOW —
    // this is what demotes a stated-$19k/true-$10.9k merchant automatically.
    fireAndForgetScore(dealId, "underwriting");

    return json({
      ok: true,
      dealId,
      id: inserted?.id,
      version: inserted?.version ?? version,
      run_mode: mode,
      // Set when this run had to pull the merchant's documents out of GHL first.
      ingest_note: ingestNote,
      // Set when preflight content-corrected any "other"-typed docs before analysis.
      reclassified_note: reclassifiedNote,
      docs_hash: docsHash,
      risk_rating: riskRating,
      affordability_rating: affordabilityRating,
      ai_narrative: narrativeOut,
      metrics: metricsOut,
      flags,
      assumptions,
      per_statement: perStatement,
      extraction_model: extractionModel,
      judge_model: judgeModel,
      created_at: inserted?.created_at,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

// ---- helpers ----------------------------------------------------------------

function emptyStatement(filename: string, err: string, filenames?: string[]): PerStatement {
  return {
    month: null, account_last4: null, opening_balance: null, closing_balance: null,
    total_deposits: null, total_withdrawals: null, avg_daily_balance: null,
    min_balance: null, negative_days: null, nsf_count: null, overdraft_fee_total: null, deposit_count: null,
    deposits: [], padding_deposits: [], questionable_deposits: [], mca_debits: [], collection_debits: [],
    _filename: filename, _filenames: filenames ?? [filename], _error: err,
    source: "statement_pdf",
  };
}

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const capMonth = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Parse a consistent "Month YYYY" out of any string (a filename, or the AI's
// month field in whatever format it returned — "2026-03", "June 2026", "Jun 26").
function monthFromText(s: string): string | null {
  const t = (s || "").toLowerCase();
  if (!t) return null;
  const ym = t.match(/\b(20\d{2})\b/);
  const year = ym ? ym[1] : null;
  for (let i = 0; i < 12; i++) {
    if (new RegExp(`\\b${MONTH_NAMES[i]}\\b`).test(t) || new RegExp(`\\b${MONTH_ABBR[i]}\\b`).test(t)) {
      return year ? `${capMonth(MONTH_NAMES[i])} ${year}` : null;
    }
  }
  let m = t.match(/\b(20\d{2})[-/.](\d{1,2})\b/); // 2026-03
  if (m) { const mi = parseInt(m[2], 10) - 1; if (mi >= 0 && mi < 12) return `${capMonth(MONTH_NAMES[mi])} ${m[1]}`; }
  m = t.match(/\b(\d{1,2})[-/.](20\d{2})\b/); // 03/2026
  if (m) { const mi = parseInt(m[1], 10) - 1; if (mi >= 0 && mi < 12) return `${capMonth(MONTH_NAMES[mi])} ${m[2]}`; }
  return null;
}

// A statement month derived FROM A FILENAME — deliberately stricter than
// monthFromText. A human naming a statement writes the MONTH NAME ("February 2026
// Statement.pdf") — that is trustworthy and beats a mis-parsed period. A bare
// numeric date is NOT: machine-generated names embed the EMAIL/UPLOAD date, not the
// statement period (real bug: five statements all named "Merchant email 2026-07-23
// — <uuid>.pdf" every one parsed to "July 2026" from the email date, so all five
// collapsed to ONE period in dedup and four months of coverage vanished). So we
// (1) strip full calendar dates (YYYY-MM-DD / MM-DD-YYYY — those are always a
// received/upload date, never a statement label) and (2) accept ONLY an explicit
// month name/abbr from the filename. A purely numeric filename month falls through
// to the AI's read of the PDF content, which is correct by construction.
function monthFromFilename(filename: string): string | null {
  const cleaned = (filename || "").toLowerCase()
    .replace(/\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, " ")   // 2026-07-23 (email/upload date)
    .replace(/\b\d{1,2}[-/.]\d{1,2}[-/.]20\d{2}\b/g, " ");  // 07-23-2026
  const ym = cleaned.match(/\b(20\d{2})\b/);
  const year = ym ? ym[1] : null;
  for (let i = 0; i < 12; i++) {
    if (new RegExp(`\\b${MONTH_NAMES[i]}\\b`).test(cleaned) || new RegExp(`\\b${MONTH_ABBR[i]}\\b`).test(cleaned)) {
      return year ? `${capMonth(MONTH_NAMES[i])} ${year}` : null;
    }
  }
  return null;
}

// The statement's month, consistent + accurate. A month NAME in the FILENAME wins
// (merchants/closers name them "February 2026 Statement.pdf" — authoritative and
// beats a mis-parsed statement period). A numeric date in the filename is IGNORED
// (see monthFromFilename) — we then normalize the AI's read of the PDF content.
// Fixes format drift ("2026-03"), AI mis-reads (a Feb statement called "January"),
// AND the email-date collapse (every file named with the same received date).
function deriveMonth(aiMonth: unknown, filename: string): string | null {
  return monthFromFilename(filename) ?? monthFromText(String(aiMonth ?? "")) ?? (aiMonth ? String(aiMonth) : null);
}

// Normalize a debit's classification to one of the five buckets. Matches the
// model's exact values first; a fuzzy fallback maps close variants. Default 'mca'
// (conservative — an unclassified financing debit counts toward stacking).
function normDebitClass(raw: unknown): "mca" | "sba_loan" | "equipment_lease" | "consumer_finance" | "vendor_other" {
  const s = String(raw ?? "").toLowerCase().trim();
  if (s === "mca" || s === "sba_loan" || s === "equipment_lease" || s === "consumer_finance" || s === "vendor_other") {
    return s as "mca" | "sba_loan" | "equipment_lease" | "consumer_finance" | "vendor_other";
  }
  if (s.includes("sba") || s.includes("term") || (s.includes("loan") && !s.includes("mca"))) return "sba_loan";
  if (s.includes("equip") || s.includes("lease")) return "equipment_lease";
  if (s.includes("consumer") || s.includes("installment")) return "consumer_finance";
  if (s.includes("vendor") || s.includes("supplier") || s.includes("bill") || s === "other") return "vendor_other";
  return "mca";
}

// ── COLLECTION-ACTIVITY DETECTION ────────────────────────────────────────────
// WHY: several funders auto-decline on active collection activity — Green Note
// Capital's own decline email reads "Debt collection activity detected", and it
// killed a 25-year / $58K-a-month file. Catching it BEFORE we submit is the whole
// point: the owner must never unknowingly send a collections file to that desk.
//
// The primary read is the extraction model, which is already looking at every line
// of every statement (collection_debits). This keyword layer is the BACKSTOP: it
// (a) re-types and confidence-checks what the model flagged, and (b) promotes a
// genuine collection debit the model filed as an ordinary vendor debit.
//
// Everything here is deliberately conservative. A false positive costs the merchant
// a funder, so a match needs a real legal/collections read — a vendor whose NAME
// merely contains "lien", "levy" or "recovery" must not trip it.
type CollectionType = "collections" | "garnishment" | "tax_levy" | "judgment";
type CollectionConfidence = "high" | "medium" | "low";

// Named debt collectors. Distinctive enough to be a HIGH-confidence read on their
// own; short/ambiguous house names (NCB, Cavalry, Transworld) require their
// qualifier so a bank or a church can't match.
const COLLECTOR_RE = new RegExp([
  String.raw`portfolio\s+recover`,
  String.raw`midland\s+(credit|funding)`,
  String.raw`\bi\.?\s?c\.?\s*system`,
  String.raw`convergent\s+(outsourcing|healthcare|resources)`,
  String.raw`enhanced\s+recovery`,
  String.raw`\berc\s+(collection|recovery)`,
  String.raw`ncb\s+management`,
  String.raw`cavalry\s+(portfolio|spv|investment)`,
  String.raw`\blvnv\b`,
  String.raw`transworld\s+system`,
  String.raw`nationwide\s+recovery`,
  String.raw`allied\s+interstate`,
  String.raw`\balltran\b`,
  String.raw`credit\s+control\s+llc`,
  String.raw`diversified\s+consultants`,
  String.raw`radius\s+global`,
  String.raw`pioneer\s+credit\s+recovery`,
  String.raw`receivables?\s+performance`,
  String.raw`\bcbe\s+group\b`,
  String.raw`professional\s+(account|debt)\s+management`,
].join("|"), "i");

// Unmistakable legal-collection language. Word-boundary anchored throughout so
// "CLIENT" can never match \blien\b and "believe" can never match \blevy\b.
const GARNISH_RE = /\bgarnish(?:ment|ee|ed|ing)?s?\b/i;
const TAX_LEVY_RE = new RegExp([
  String.raw`\b(?:irs|federal|state|franchise\s+tax|dept\.?\s+of\s+revenue|department\s+of\s+revenue|treasury|us\s*treas|comptroller)\b[^|;]{0,40}\blev(?:y|ies|ied)\b`,
  String.raw`\blev(?:y|ies|ied)\b[^|;]{0,40}\b(?:irs|tax|treasury|revenue|comptroller)\b`,
  String.raw`\btax\s+lev(?:y|ies|ied)\b`,
  String.raw`\btax\s+lien\b`,
].join("|"), "i");
const JUDGMENT_RE = new RegExp([
  String.raw`\bjudge?ment\b`,
  String.raw`\bwrit\b`,
  String.raw`\bsheriff\b[^|;]{0,30}\b(?:levy|sale|execution|attach)`,
  String.raw`\bcourt\s+order(?:ed)?\b`,
  String.raw`\bcivil\s+(?:judgment|action|recovery)\b`,
  String.raw`\bexecution\s+of\s+judgment\b`,
  String.raw`\b(?:bank|account|wage)\s+lev(?:y|ies|ied)\b`,
].join("|"), "i");
// Explicit debt-collection language (as opposed to a bare "collection" that could
// be a waste-collection route, a card-processing "collections" batch, etc.).
const COLLECTIONS_STRONG_RE = new RegExp([
  String.raw`\bdebt\s+collect(?:ion|or)`,
  String.raw`\bcollection\s+(?:agency|agencies|bureau|dept|department)\b`,
  String.raw`\bcollections?\s+(?:payment|settlement|recovery|acct|account)\b`,
  String.raw`\baccounts?\s+receivable\s+management\b`,
  String.raw`\bcredit\s+bureau\s+collect`,
].join("|"), "i");
// Weak signals: real when corroborated, noise on their own. A BARE "levy" is
// deliberately absent — it is a common surname/brand (Levy Restaurants, Levy Bros
// Produce) and the genuine cases are all covered by TAX_LEVY_RE / JUDGMENT_RE.
const COLLECTIONS_WEAK_RE = /\bcollections?\b|\blien\b|\battachment\b|\brepossess/i;
// Descriptors that LOOK like collections but are ordinary business. These veto a
// match outright — the false-positive guard the house doctrine demands.
const COLLECTION_FALSE_FRIEND_RE = new RegExp([
  String.raw`lien\s+solutions`,          // Wolters Kluwer UCC filing service
  String.raw`\bucc\b`,                    // UCC search/filing vendors
  String.raw`lien\s+(?:search|filing|release|waiver)`,
  String.raw`waste|refuse|garbage|sanitation|trash|recycl`, // "collection" routes
  String.raw`\bdata\s+collection\b`,
  String.raw`\bcollection\s+(?:of\s+)?(?:art|agency\s+services\s+for\s+us)\b`,
  String.raw`auto\s+recovery|towing|vehicle\s+recovery|disaster\s+recovery|data\s+recovery`,
  String.raw`\blevy\s+(?:brothers|bros|restaurant|premium|foods?|produce)\b`,
  String.raw`\bjudgment\s+free\b`,
].join("|"), "i");

function normCollectionType(raw: unknown): CollectionType | null {
  const s = String(raw ?? "").toLowerCase().trim();
  if (s === "collections" || s === "garnishment" || s === "tax_levy" || s === "judgment") return s as CollectionType;
  if (s.includes("garnish")) return "garnishment";
  if (s.includes("levy") || s.includes("tax")) return "tax_levy";
  if (s.includes("judg") || s.includes("writ") || s.includes("court")) return "judgment";
  if (s.includes("collect")) return "collections";
  return null;
}

function normCollectionConfidence(raw: unknown): CollectionConfidence | null {
  const s = String(raw ?? "").toLowerCase().trim();
  return s === "high" || s === "medium" || s === "low" ? s : null;
}

/**
 * Keyword read of ONE debit descriptor. Returns null when the text does not
 * genuinely read as a collections / legal action. Never guesses from an amount or
 * a cadence — only from language.
 */
function readCollectionText(text: string): { type: CollectionType; confidence: CollectionConfidence; reason: string } | null {
  const t = (text || "").trim();
  if (!t) return null;
  if (COLLECTION_FALSE_FRIEND_RE.test(t)) return null;
  if (GARNISH_RE.test(t)) return { type: "garnishment", confidence: "high", reason: "descriptor names a garnishment" };
  if (TAX_LEVY_RE.test(t)) return { type: "tax_levy", confidence: "high", reason: "descriptor names a tax levy/lien" };
  if (JUDGMENT_RE.test(t)) return { type: "judgment", confidence: "high", reason: "descriptor names a judgment / writ / court order" };
  if (COLLECTOR_RE.test(t)) return { type: "collections", confidence: "high", reason: "paid to a known debt-collection agency" };
  if (COLLECTIONS_STRONG_RE.test(t)) return { type: "collections", confidence: "high", reason: "descriptor names debt-collection activity" };
  if (COLLECTIONS_WEAK_RE.test(t)) return { type: "collections", confidence: "low", reason: "descriptor carries collections/lien wording but is ambiguous" };
  return null;
}

// Funder GROUPING key — aggressive normalization so the same creditor collapses to
// one identity across months regardless of transaction/account ids or product-word
// noise ("Calabria Funding LLC 51647", "Calabria Funding", "Calabria Funding LLC
// (2nd debit)" → "CALABRIA"). Product words (funding/capital/lending/leasing/
// financial…) are stripped so a funder named consistently across months matches.
const FUNDER_NOISE = new Set([
  "LLC", "INC", "CO", "CORP", "COMPANY", "THE", "SCHEDULED", "REMITTANCE", "REMIT",
  "DAILY", "WEEKLY", "MONTHLY", "PAYMENT", "PYMT", "PMT", "CUSTPYMT", "ACH", "ACHPAYMENT",
  "TRANS", "DES", "INDN", "LOAN", "LOANS", "SECOND", "FIRST", "DEBIT", "RECURRING",
  "OF", "AND", "FUNDING", "FUND", "CAPITAL", "CAP", "LENDING", "LEASING",
  "FINANCIAL", "FINANC", "FINANCE", "FINANCI",
]);
function normFunder(raw: string): string {
  let s = (raw || "").toUpperCase();
  s = s.replace(/\([^)]*\)/g, " ");          // drop parentheticals
  s = s.replace(/[^A-Z0-9 ]+/g, " ");         // punctuation → space
  s = s.replace(/\b[A-Z]*\d[A-Z0-9]*\b/g, " "); // alnum ids: D002703625, 6FV75R6, LC03310839, 51647
  const toks = s.split(/\s+/).filter((t) => t && !FUNDER_NOISE.has(t));
  return toks.slice(0, 3).join(" ").trim();
}

// Funder DISPLAY name — readable, ids/noise trimmed but casing kept (for the panel).
function cleanFunderDisplay(raw: string): string {
  let s = (raw || "").replace(/\([^)]*\)/g, " ");
  s = s.replace(/[-–]\s*(daily|weekly|monthly|second|first)\b.*$/i, " ");
  s = s.replace(/\b(scheduled remittance|daily remittance|weekly remittance|custpymt|trans pmt)\b/gi, " ");
  s = s.replace(/\b[A-Z]*\d[A-Z0-9]{3,}\b/g, " "); // id tokens like D002703625, LC03310839
  s = s.replace(/\b\d{4,}\b/g, " ");                 // long number runs (phone/acct)
  s = s.replace(/\s{2,}/g, " ").trim();
  return s || (raw || "").trim();
}

function normalizeStatement(p: Any, filename: string): PerStatement {
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    month: deriveMonth(p.month, filename),
    account_last4: p.account_last4 != null ? String(p.account_last4) : null,
    business_state: normStateCode(p.business_state),
    opening_balance: num(p.opening_balance),
    closing_balance: num(p.closing_balance),
    total_deposits: num(p.total_deposits),
    total_withdrawals: num(p.total_withdrawals),
    avg_daily_balance: num(p.avg_daily_balance),
    min_balance: num(p.min_balance),
    negative_days: num(p.negative_days),
    nsf_count: num(p.nsf_count),
    overdraft_fee_total: num(p.overdraft_fee_total),
    deposit_count: num(p.deposit_count),
    deposits: arr(p.deposits),
    padding_deposits: arr(p.padding_deposits),
    questionable_deposits: arr(p.questionable_deposits),
    mca_debits: arr(p.mca_debits),
    collection_debits: arr(p.collection_debits),
    _filename: filename,
    source: "statement_pdf",
  };
}

// FNV-1a hash over raw bytes → stable short hex. Used to detect BYTE-IDENTICAL
// bank-statement uploads so the same file (even renamed) is sent to Claude once.
function hashBytes(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// Post-extraction dedup by the statement PERIOD Claude read from INSIDE each PDF
// (month + account_last4) — NOT the filename. Two files covering the same period
// for the same account collapse to one; keep the richer extraction (more line
// items), first on a tie. Error statements and periodless statements pass through
// untouched. Net effect: the same statement uploaded twice == uploaded once.
function dedupByPeriod(statements: PerStatement[]): PerStatement[] {
  const richness = (s: PerStatement) =>
    (s.deposits?.length ?? 0) + (s.padding_deposits?.length ?? 0) +
    (s.questionable_deposits?.length ?? 0) + (s.mca_debits?.length ?? 0) +
    (s.collection_debits?.length ?? 0);
  const namesOf = (s: PerStatement) => s._filenames ?? (s._filename ? [s._filename] : []);
  const byPeriod = new Map<string, number>(); // period key → index in `out`
  const out: PerStatement[] = [];
  for (const s of statements) {
    const period = (s.month ?? "").toString().trim().toLowerCase();
    if (s._error || !period) { out.push(s); continue; }
    const key = `${s.account_last4 ?? "?"}|${period}`;
    const existingIdx = byPeriod.get(key);
    if (existingIdx == null) {
      byPeriod.set(key, out.length);
      out.push(s);
    } else {
      const cur = out[existingIdx];
      // Union of every source filename either statement represents — so a folded
      // period-duplicate still appears in the per-document ledger, never silently.
      const merged = [...namesOf(cur), ...namesOf(s)];
      if (richness(s) > richness(cur)) {
        // Prefer the richer extraction; carry merged filenames + dupe_count.
        s._filenames = merged;
        s._dupe_count = (cur._dupe_count ?? 1) + (s._dupe_count ?? 1);
        out[existingIdx] = s;
      } else {
        cur._filenames = merged;
        cur._dupe_count = (cur._dupe_count ?? 1) + (s._dupe_count ?? 1);
      }
    }
  }
  return out;
}

// First-third vs last-third average of the monthly net-revenue series.
function trendOf(series: number[]): "up" | "flat" | "down" {
  if (series.length < 2) return "flat";
  const third = Math.max(1, Math.floor(series.length / 3));
  const first = series.slice(0, third);
  const last = series.slice(-third);
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const f = avg(first);
  const l = avg(last);
  if (f <= 0) return l > 0 ? "up" : "flat";
  const change = (l - f) / f;
  if (change > 0.1) return "up";
  if (change < -0.1) return "down";
  return "flat";
}

// Base64-encode bytes without blowing the call stack on large PDFs (chunked).
function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ── PLAID BANK-FEED → per-month statement synthesis ──────────────────────────
// SIGN CONVENTION (verified against the 20260728_plaid_integration migration and
// plaid-pull's /transactions/sync store): plaid_transactions.amount is POSITIVE for
// money OUT of the account (a debit/withdrawal) and NEGATIVE for money IN (a credit/
// deposit). We invert to the underwriter's convention — deposits and withdrawals are
// stored as POSITIVE magnitudes — and emit PerStatement entries in the SAME shape the
// PDF extraction produces, tagged source:'plaid'. A transaction feed carries no
// running ledger balance, so per-month balances are legitimately null.
interface PlaidTxRow {
  date: string | null;
  amount: number | null;
  name: string | null;
  merchant_name: string | null;
  account_id: string | null;
}

// Names that read like a financing remittance (MCA / loan / lease / etc.). Only a
// debit whose counterparty matches this — OR which hits at a near-daily cadence — is
// treated as a financing debit, so a monthly retail/vendor payment never becomes a
// phantom MCA position. Mirrors the intent of the position-intelligence classifier.
const FINANCING_NAME_RE =
  /\b(fund|funding|capital|advance|mca|remit|holdback|financ|lending|kapital|receivabl|ondeck|kabbage|bluevine|credibly|libertas|forward\s*financ|rapid\s*financ|fox\s*capital|kalamata|cfg\s*merchant|square\s*capital|paypal\s*working|working\s*capital|sba|eidl|term\s*loan|\bloan\b|lease|leasing|marlin|lendmark|installment)\b/i;

// NSF / overdraft / returned-item fee descriptors.
const NSF_NAME_RE =
  /\b(nsf|overdraft|insufficient|returned\s*item|od\s*fee|nsf\s*fee|uncollected\s*funds|return(ed)?\s*fee)\b/i;

const plaidTxName = (t: PlaidTxRow): string => (t.merchant_name || t.name || "").toString().trim();

// ISO date → stable "Month YYYY" label (UTC), consistent with the PDF path's labels.
function monthLabelFromDate(iso: string): string | null {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

// "March 2026" → year*12 + month (0-based), for month-set comparisons and the
// PDF-vs-feed overlap partition. Mirrors the anchoring used in the positions block.
function monthKey(label: string | null): number | null {
  const t = Date.parse(`1 ${String(label ?? "").trim()}`);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

// Classify a financing debit from its name alone (a raw bank feed has no model-
// assigned debit_class). Mirrors normDebitClass's buckets; a recurring fixed
// remittance whose name matches nothing specific defaults to 'mca' — the conservative
// house default (an unclassified financing debit counts toward stacking).
function classifyPlaidDebit(name: string): "mca" | "sba_loan" | "equipment_lease" | "consumer_finance" | "vendor_other" {
  const s = name.toLowerCase();
  if (/\bsba\b|eidl|term\s*loan|\bloan\b/.test(s)) return "sba_loan";
  if (/lease|leasing|equipment|marlin/.test(s)) return "equipment_lease";
  if (/lendmark|installment|consumer|onemain|oportun/.test(s)) return "consumer_finance";
  return "mca";
}

// Build per-month PerStatement entries from a customer's Plaid transactions.
function buildPlaidStatements(txns: PlaidTxRow[], institution: string | null): PerStatement[] {
  const rows = txns.filter((t) => t.date && Number.isFinite(Number(t.amount)));
  if (!rows.length) return [];

  // ── Recurring financing-debit detection across the WHOLE window, keyed by
  //    (normalized counterparty, rounded amount) — the SAME grouping the positions
  //    block uses. A group qualifies as a financing remittance when it hits at a
  //    near-daily cadence in some month (>=8 hits) OR its name reads like financing
  //    and it recurs (>=2 total). Everything else (retail, one-off vendor ACH) is
  //    left OUT of mca_debits so it never becomes a phantom position.
  interface Grp { name: string; amount: number; total: number; perMonth: Map<string, number> }
  const groups = new Map<string, Grp>();
  for (const t of rows) {
    const amt = Number(t.amount);
    if (!(amt > 0)) continue; // debits only (positive = money OUT)
    const name = plaidTxName(t) || "Unknown";
    const key = `${normFunder(name) || "UNKNOWN"}|${Math.round(Math.abs(amt))}`;
    const label = monthLabelFromDate(t.date!) ?? "?";
    let g = groups.get(key);
    if (!g) { g = { name, amount: Math.abs(amt), total: 0, perMonth: new Map() }; groups.set(key, g); }
    g.total += 1;
    g.perMonth.set(label, (g.perMonth.get(label) ?? 0) + 1);
  }
  const financing = new Map<string, ReturnType<typeof classifyPlaidDebit>>();
  for (const [key, g] of groups) {
    const maxMonth = Math.max(0, ...g.perMonth.values());
    const isDaily = maxMonth >= 8;
    const looksFinancing = FINANCING_NAME_RE.test(g.name);
    if (!(isDaily || (looksFinancing && g.total >= 2))) continue;
    const klass = classifyPlaidDebit(g.name);
    // A non-daily payment that reads like neither financing nor a specific debt type
    // stays out (don't invent an MCA from a plain monthly recurring purchase).
    if (klass === "mca" && !isDaily && !looksFinancing) continue;
    financing.set(key, klass);
  }

  // ── Group transactions by calendar month ──
  const byMonth = new Map<string, PlaidTxRow[]>();
  for (const t of rows) {
    const label = monthLabelFromDate(t.date!);
    if (!label) continue;
    (byMonth.get(label) ?? byMonth.set(label, []).get(label)!).push(t);
  }

  const out: PerStatement[] = [];
  for (const [label, monthRows] of byMonth) {
    const credits = monthRows.filter((t) => Number(t.amount) < 0);
    const debits = monthRows.filter((t) => Number(t.amount) > 0);
    const totalDeposits = round2(credits.reduce((a, t) => a + Math.abs(Number(t.amount)), 0));
    const totalWithdrawals = round2(debits.reduce((a, t) => a + Math.abs(Number(t.amount)), 0));

    const deposits = credits.map((t) => {
      const nm = plaidTxName(t) || "Deposit";
      const isTransfer = /transfer|zelle|venmo|cashapp|xfer|wire|p2p/i.test(nm);
      return { date: t.date ?? undefined, desc: nm, amount: round2(Math.abs(Number(t.amount))), classified_type: isTransfer ? "transfer" : "sales_revenue" };
    });

    // NSF / overdraft fees by descriptor.
    let nsf = 0; let odFees = 0;
    for (const t of debits) {
      if (NSF_NAME_RE.test(plaidTxName(t))) { nsf += 1; odFees += Math.abs(Number(t.amount)); }
    }

    // COLLECTION ACTIVITY — the bank feed carries every debit descriptor, so the
    // keyword reader runs over ALL of them here (no extraction model in this path).
    // Only unmistakable hits are kept: a Plaid merchant_name is terse and a weak
    // wording match on it would be pure noise.
    const collection_debits = debits.flatMap((t) => {
      const nm = plaidTxName(t);
      const kw = readCollectionText(nm);
      if (!kw || kw.confidence !== "high") return [];
      return [{
        date: t.date ?? undefined, desc: nm, amount: round2(Math.abs(Number(t.amount))),
        type: kw.type, confidence: "high", reason: `${kw.reason} (bank feed)`,
      }];
    });

    // Financing debits → one aggregated entry per (funder, amount) this month.
    const mcaAgg = new Map<string, { name: string; amount: number; occ: number; klass: string }>();
    for (const t of debits) {
      const amt = Math.abs(Number(t.amount));
      const name = plaidTxName(t) || "Unknown";
      const key = `${normFunder(name) || "UNKNOWN"}|${Math.round(amt)}`;
      const klass = financing.get(key);
      if (!klass) continue;
      let e = mcaAgg.get(key);
      if (!e) { e = { name, amount: amt, occ: 0, klass }; mcaAgg.set(key, e); }
      e.occ += 1;
    }
    const mca_debits = [...mcaAgg.values()].map((e) => ({
      desc: e.name, amount: round2(e.amount), occurrences: e.occ,
      cadence: e.occ >= 8 ? "daily" : e.occ >= 2 ? "weekly" : "monthly",
      funder: cleanFunderDisplay(e.name), debit_class: e.klass,
    }));

    out.push({
      month: label,
      account_last4: null,
      opening_balance: null,
      closing_balance: null,
      total_deposits: totalDeposits,
      total_withdrawals: totalWithdrawals,
      // No running ledger balance in a transaction feed — legitimately null.
      avg_daily_balance: null,
      min_balance: null,
      negative_days: 0,
      nsf_count: nsf,
      overdraft_fee_total: round2(odFees),
      deposit_count: credits.length,
      deposits,
      padding_deposits: [],
      questionable_deposits: [],
      mca_debits,
      collection_debits,
      source: "plaid",
      _filename: `Bank feed — ${institution ?? "Plaid"} (${label})`,
      _filenames: [`Bank feed (Plaid) — ${label}`],
    });
  }

  // Drop months with NO observed deposits — a Plaid pull's first/last months are
  // partial boundary slices; a $0-deposit boundary month would distort the revenue
  // average and fabricate a catastrophic month that isn't real.
  const kept = out.filter((s) => (s.deposit_count ?? 0) > 0 || numOr0(s.total_deposits) > 0);
  kept.sort((a, b) => (monthKey(a.month) ?? 0) - (monthKey(b.month) ?? 0));
  return kept;
}
