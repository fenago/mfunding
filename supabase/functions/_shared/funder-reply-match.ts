// funder-reply-match — decide WHICH merchant/deal an inbound funder email is
// about, so a reply attaches to the correct submission.
//
// THE BUG THIS PREVENTS: both reply paths (poll-funder-replies pull + ghl-webhook
// push) used to stamp a funder's inbound email onto that funder's NEWEST open
// submission, verifying only the FUNDER's identity (sender domain / linked
// contact) — never WHICH merchant the email was about. Result: a Green Note
// decline about "Brideau Insurance Inc" landed on the Colorful Garden Center deal
// simply because that was Green Note's newest open submission, and a Green Note
// marketing nudge ("we still haven't gotten any submissions") was logged as a
// funder reply. This module verifies DEAL IDENTITY before attaching.
//
// Decision order (strongest signal first):
//   1. deal number  (MF-YYYY-NNNN) our submission carries in the subject
//   2. business name of one of the funder's OPEN submissions
//   3. a DIFFERENT business/deal named → never attach (route or park)
//   4. no merchant signal → generic-blast? park/skip; else sole open sub is safe;
//      multiple open subs → ambiguous, park for review (never guess).

export interface SubCandidate {
  submissionId: string;
  dealId: string;
  dealNumber: string | null;
  businessName: string | null;
}

export type Resolution =
  | { kind: "match"; sub: SubCandidate; via: "deal_number" | "business_name" | "sole_pending" }
  | { kind: "wrong_deal_number"; dealNumber: string } // names a deal # not in this funder's open set
  | { kind: "wrong_merchant"; merchant: string }      // names a different business than ours
  | { kind: "ambiguous" }                             // >1 open sub, nothing to distinguish
  | { kind: "general" }                               // marketing/nudge — about no file
  | { kind: "none" };                                 // funder has no open submission

// Legal suffixes / filler dropped when comparing business names.
const LEGAL_SUFFIX =
  /\b(inc|incorporated|llc|corp|corporation|co|company|ltd|limited|pllc|lp|llp|group|holdings|enterprises|the)\b/gi;

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(LEGAL_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Light normalize (keep it a phrase) — for generic-marker substring tests.
function soft(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Distinctive tokens of a business name (drop short noise words).
function tokens(name: string): string[] {
  return normalizeName(name).split(" ").filter((t) => t.length >= 3);
}

export const DEAL_NUMBER_RE = /\bMF-\d{4}-\d{4}\b/gi;

export function extractDealNumbers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(DEAL_NUMBER_RE)) out.add(m[0].toUpperCase());
  return [...out];
}

// Does the (aggressively normalized) reply text clearly name this business? All
// distinctive tokens must be present as whole words, order-independent. A lone
// short/generic token is rejected so "garden" alone can't match "Colorful Garden".
export function mentionsBusiness(normText: string, businessName: string): boolean {
  const toks = tokens(businessName);
  if (toks.length === 0) return false;
  if (toks.length === 1 && toks[0].length < 4) return false;
  return toks.every((t) => new RegExp(`\\b${escapeRe(t)}\\b`).test(normText));
}

// Marketing / nudge markers — a blast about no specific file. Deliberately
// specific so a terse genuine reply ("Declined. Recent default. Thanks") never
// trips it.
const GENERIC_MARKERS = [
  "havent gotten any submissions", "have not gotten any submissions",
  "lets start funding", "start sending", "send us your deals",
  "send us some deals", "start submitting", "happy funding",
  "lets get started", "check out our", "new program", "new promo",
  "webinar", "unsubscribe", "view this email in your browser",
  "no longer wish to receive", "touching base here",
];

export function looksGeneric(text: string): boolean {
  const s = soft(text);
  return GENERIC_MARKERS.some((m) => s.includes(m));
}

// A "<Capitalized Name> Inc/LLC/Corp…" mentioned in the raw text that is NOT one
// of our open submissions and NOT us/the funder — i.e. a different merchant.
const BIZ_RE =
  /([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,4})\s+(Inc|Incorporated|LLC|Corp|Corporation|Company|Ltd|Limited|PLLC|LP|LLP)\b/g;
const OWN_NAMES = ["agentic voice", "momentum funding", "mfunding"];

function detectForeignMerchant(raw: string, subs: SubCandidate[], lenderName?: string): string | null {
  const own = [...OWN_NAMES, normalizeName(lenderName ?? "")].filter(Boolean);
  for (const m of raw.matchAll(BIZ_RE)) {
    const full = `${m[1]} ${m[2]}`.replace(/\s+/g, " ").trim();
    const fn = normalizeName(full);
    if (!fn) continue;
    if (own.some((o) => o && (fn === o || fn.includes(o) || o.includes(fn)))) continue; // us or the funder
    if (subs.some((s) => s.businessName && mentionsBusiness(fn, s.businessName))) continue; // one of ours
    return full;
  }
  return null;
}

export function resolveReplyTarget(opts: {
  subject?: string | null;
  body?: string | null;
  subs: SubCandidate[];
  lenderName?: string | null;
}): Resolution {
  const raw = `${opts.subject ?? ""}\n${opts.body ?? ""}`;
  const norm = normalizeName(raw);

  // 1) Deal number — the strongest, exact key.
  const dealNums = extractDealNumbers(raw);
  for (const dn of dealNums) {
    const hit = opts.subs.find((s) => (s.dealNumber ?? "").toUpperCase() === dn);
    if (hit) return { kind: "match", sub: hit, via: "deal_number" };
  }
  if (dealNums.length) return { kind: "wrong_deal_number", dealNumber: dealNums[0] };

  // 2) Business name of one of the funder's OPEN submissions.
  const named = opts.subs.filter((s) => s.businessName && mentionsBusiness(norm, s.businessName));
  if (named.length === 1) return { kind: "match", sub: named[0], via: "business_name" };
  if (named.length > 1) return { kind: "ambiguous" };

  // 3) A DIFFERENT business named → never attach to one of ours.
  const foreign = detectForeignMerchant(raw, opts.subs, opts.lenderName ?? undefined);
  if (foreign) return { kind: "wrong_merchant", merchant: foreign };

  // 4) No merchant / deal signal at all.
  if (looksGeneric(raw)) return { kind: "general" };
  if (opts.subs.length === 1) return { kind: "match", sub: opts.subs[0], via: "sole_pending" };
  if (opts.subs.length === 0) return { kind: "none" };
  return { kind: "ambiguous" }; // several open subs, terse reply — a human must place it
}
