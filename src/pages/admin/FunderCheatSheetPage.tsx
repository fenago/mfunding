import { useEffect, useMemo, useRef, useState } from "react";
import supabase from "@/supabase";
import {
  type ContactFields,
  type DocState,
  type ProfileRow,
  type ProfileState,
  type ProgramRow,
  type ProgramState,
  fmtMoney,
  loadDocs,
  loadPrograms,
  loadProfiles,
  mergeDocs,
  mergePrograms,
  mergeProfiles,
  num,
  progKey,
} from "@/lib/funderDisclosure";
import { FunderContactBlock } from "@/components/admin/funder/FunderContactBlock";
import { LinkLine, Quoted } from "@/components/admin/funder/parts";
import { FunderProgramBox } from "@/components/admin/funder/FunderProgramBox";
import { FunderDisclosureStyles } from "@/components/admin/funder/styles";
import {
  type ProductId as CanonicalProduct,
  PRODUCT_SOURCE_COLUMNS,
  hasProduct,
} from "@/lib/lenderProducts";
import {
  type FunderCriteria,
  acceptsPositions,
  collectionsLabel,
  collectionsTone,
  criteriaOf,
  fmtFico,
  fmtRev,
  fmtTib,
  listOf,
  positionStance,
} from "@/lib/funderCriteria";

// ─────────────────────────────────────────────────────────────────────────────
// Funder Deal-Matching Cheat Sheet
//
// A faithful in-app port of the cheat-sheet the owner signed off on. The design
// (navy/mint/gold tokens, semantic A/B/C/D paper colors, callouts, sticky filter
// bar, card grid) is reproduced 1:1 — the ONLY change is that the live-funder
// grid is sourced from the database instead of a hard-coded array, so it can
// never drift from the funder catalog.
//
// Theming: the artifact keyed off prefers-color-scheme / [data-theme]. The app
// drives dark mode with a `dark` class on <html> (see lib/theme-context), so the
// dark token block is scoped to `.dark .fcs` instead. Same colors, app's switch.
// ─────────────────────────────────────────────────────────────────────────────


// ── Data shape (lenders.category jsonb — every field optional by design) ──────
type PaperTier = "A" | "B" | "C" | "D" | "all_credit";
type LenderCategory = {
  relationship?: string | null;
  // Some funders are worked in more than one mode — Giggle funds off its own
  // book but the broker channel is a pure referral, ROK is a marketplace we
  // refer to. Those rows carry the full set here; older rows only have the
  // singular `relationship`. Always read both through relSet().
  relationships?: string[] | null;
  size_tier?: string | null;
  paper?: PaperTier[] | null;
  // `type` is a string on most rows but an ARRAY where a funder does both
  // structures (Funderial) — always read it through consoTypes().
  consolidation?: { type?: string | string[] | null; confidence?: string | null; note?: string | null } | null;
  flags?: {
    sba?: boolean;
    real_estate?: boolean;
    micro?: boolean;
    first_position_only?: boolean;
    high_risk_dpaper?: boolean;
    fast_funding?: boolean;
    consolidation?: boolean;
    equipment?: boolean;
    factoring?: boolean;
  } | null;
  // Product list maintained by a different process than `lender_types` — read
  // BOTH, always through productsOf() in @/lib/lenderProducts.
  products?: string[] | null;
  known_for?: string | null;
  deal_fit?: string | null;
  // Underwriting box extracted from the funder's own packets / decline emails.
  // Absent on most rows — read it only through the @/lib/funderCriteria helpers.
  criteria?: FunderCriteria | null;
};

type LenderRow = ContactFields & {
  id: string;
  company_name: string;
  min_funding_amount: number | string | null;
  max_funding_amount: number | string | null;
  category: LenderCategory | null;
};

const cat = (l: LenderRow): LenderCategory => l.category ?? {};
const flags = (l: LenderRow) => cat(l).flags ?? {};

const consoTypes = (l: LenderRow): string[] => {
  const t = cat(l).consolidation?.type;
  const raw = Array.isArray(t) ? t : t == null ? [] : [t];
  return raw.map((x) => String(x).toLowerCase().trim()).filter((x) => x !== "" && x !== "none");
};
// Debt-relief restructure is NOT a consolidation advance — it gets its own lane,
// and must never show up in the Consolidation bucket.
const isRestructure = (l: LenderRow) => consoTypes(l).some((t) => /restructure|relief|settle/.test(t));
const isConsolidation = (l: LenderRow) =>
  !isRestructure(l) && (flags(l).consolidation === true || consoTypes(l).length > 0);
const isReverse = (l: LenderRow) => consoTypes(l).some((t) => /reverse|both/.test(t));
const isPayoff = (l: LenderRow) => consoTypes(l).some((t) => /payoff|true|both/.test(t));

const consoLabel = (l: LenderRow) => {
  const rev = isReverse(l);
  const payoff = isPayoff(l);
  if (rev && payoff) return "Both — true + reverse";
  if (rev) return "Reverse consolidation";
  if (payoff) return "True payoff consolidation";
  return "Consolidation";
};

const REL_LABEL: Record<string, string> = {
  direct_funder: "Direct funder",
  marketplace_aggregator: "Marketplace",
  referral_affiliate: "Referral",
  white_label: "White-label",
};

// The full relationship set: the `relationships` array when the row has one,
// otherwise the singular `relationship`. Everything downstream reads this, so a
// funder we work as BOTH a direct funder and a referral partner lands in both
// places instead of only the first one.
const relSet = (l: LenderRow): string[] => {
  const c = cat(l);
  const many = (c.relationships ?? []).map((r) => String(r).toLowerCase().trim()).filter(Boolean);
  if (many.length > 0) return many;
  const one = (c.relationship ?? "").toLowerCase().trim();
  return one ? [one] : [];
};
const isReferralPartner = (l: LenderRow) => relSet(l).some((r) => /referral|affiliate/.test(r));
const isMarketplace = (l: LenderRow) => relSet(l).some((r) => /marketplace|aggregator/.test(r));
// The "Referral / marketplace" bucket: anything we refer out rather than submit
// a package to — referral partners AND marketplaces.
const isReferralModel = (l: LenderRow) =>
  isReferralPartner(l) || isMarketplace(l) || relSet(l).some((r) => r === "white_label");

const relLabel = (l: LenderRow) => {
  const set = relSet(l);
  if (set.length === 0) return "Funder";
  const label = (r: string) => REL_LABEL[r] ?? r.replace(/_/g, " ");
  // Worked as a referral on top of what they actually are — lead with the
  // relationship the closer acts on, then how the funder itself operates.
  if (isReferralPartner(l) && set.length > 1) {
    const other = set.find((r) => !/referral|affiliate/.test(r));
    return other ? `Active referral · ${label(other).toLowerCase()}` : "Active referral";
  }
  return label(set[0]);
};

const SIZE_TIER_LABEL: Record<string, string> = {
  micro: "Micro",
  small: "Small",
  small_mid: "Small–mid",
  mid_large: "Mid–large",
  jumbo: "Jumbo",
};

const sizeRange = (l: LenderRow): string => {
  const lo = fmtMoney(num(l.min_funding_amount));
  const hi = fmtMoney(num(l.max_funding_amount));
  if (lo && hi) return `${lo}–${hi}`;
  if (hi) return `up to ${hi}`;
  if (lo) return `${lo}+`;
  return SIZE_TIER_LABEL[cat(l).size_tier ?? ""] ?? "—";
};

const paperChips = (l: LenderRow): string[] =>
  (cat(l).paper ?? []).filter((p): p is "A" | "B" | "C" | "D" => p === "A" || p === "B" || p === "C" || p === "D");

// ── Buckets — derived from the category payload, so the filters can never drift
// from the catalog. Debt relief and Consolidation are mutually exclusive.
type BucketId = "consol" | "debtrelief" | "micro" | "realestate" | "sba" | "direct" | "referral" | "fast";
const bucketsOf = (l: LenderRow): BucketId[] => {
  const f = flags(l);
  const b: BucketId[] = [];
  if (isConsolidation(l)) b.push("consol");
  if (isRestructure(l)) b.push("debtrelief");
  if (f.micro) b.push("micro");
  if (f.real_estate) b.push("realestate");
  if (f.sba) b.push("sba");
  if (isReferralModel(l)) b.push("referral");
  else b.push("direct");
  if (f.fast_funding) b.push("fast");
  return b;
};

const tagsOf = (l: LenderRow): string[] => {
  const f = flags(l);
  const t: string[] = [];
  if (isRestructure(l)) t.push("Debt relief");
  if (isConsolidation(l)) t.push(consoLabel(l).replace(/ consolidation$/i, " consol."));
  if (isReferralPartner(l)) t.push("Referral");
  if (isMarketplace(l)) t.push("Marketplace");
  if (relSet(l).includes("white_label")) t.push("White-label");
  if (f.sba) t.push("SBA");
  if (f.real_estate) t.push("Real estate");
  if (f.micro) t.push("Micro");
  if (f.fast_funding) t.push("Fast");
  if ((cat(l).paper ?? []).includes("all_credit")) t.push("All-credit");
  if (f.high_risk_dpaper) t.push("High-risk OK");
  return t;
};

const tagClass = (t: string) => {
  const l = t.toLowerCase();
  if (l.includes("debt relief")) return "tag dr";
  if (l.includes("consol")) return "tag consol";
  if (l.includes("referral") || l.includes("marketplace") || l.includes("white-label")) return "tag ref";
  if (l.includes("real estate")) return "tag re";
  return "tag";
};

// Curated reading order from the sheet the owner approved — widest/first-stop
// funders, then the consolidation lane, then the high-risk desks, then the
// marketplaces. Anything new in the catalog falls in after, alphabetically, so
// the page keeps working as funders are added.
const ORDER = [
  "cobalt",
  "nationwide",
  "relfi",
  "gokapital",
  "bizcap",
  "fundkite",
  "uplyft",
  "highland hill",
  "diesel",
  "green note",
  "funderial",
  "value capital",
  "the lcf",
  "cashable",
  "velocity",
  "capital express",
  "instafunders",
  "lendini",
  "instagreen",
  "true advance",
  "corfin",
  "fantastic",
  "reliant",
  "elite funders",
  "1 west",
  "united capital source",
  "guidant",
];
const orderRank = (name: string) => {
  const n = name.toLowerCase();
  const i = ORDER.findIndex((frag) => n.startsWith(frag));
  return i === -1 ? ORDER.length : i;
};

const PAPER_FILTERS = ["all", "A", "B", "C", "D"] as const;
const BUCKET_FILTERS: { v: "all" | BucketId; label: string }[] = [
  { v: "all", label: "All" },
  { v: "consol", label: "Consolidation" },
  { v: "debtrelief", label: "Debt relief" },
  { v: "micro", label: "Micro ($5–25K)" },
  { v: "realestate", label: "Real estate" },
  { v: "sba", label: "SBA" },
  { v: "direct", label: "Direct funder" },
  { v: "referral", label: "Referral / marketplace" },
  { v: "fast", label: "Fast / light stips" },
];

// Max positions — the closer's first question on a stacked merchant. "2+" means
// the funder's published ceiling is at least a 2nd position (or they publish no
// cap at all); a funder whose box we haven't recorded never counts as a yes.
type PosFilter = "all" | "2" | "3" | "4" | "deep";
const POSITION_FILTERS: { v: PosFilter; label: string }[] = [
  { v: "all", label: "All" },
  { v: "2", label: "Accepts 2+" },
  { v: "3", label: "3+" },
  { v: "4", label: "4+" },
  { v: "deep", label: "Deep / no cap" },
];
const matchesPositions = (l: LenderRow, f: PosFilter): boolean => {
  if (f === "all") return true;
  if (f === "deep") return positionStance(l).deep;
  return acceptsPositions(l, Number(f));
};

// ── Product tabs ─────────────────────────────────────────────────────────────
// MCA is the working product and keeps the whole original page. The four credit
// products get their own tab, sourced from lenders.lender_types.
//
// TWO THINGS ARE DELIBERATE HERE AND MUST STAY THAT WAY:
//  1. `lender_programs` now holds recorded credit boxes for a SMALL number of
//     funders on these products (United Capital Source and GoKapital, loaded
//     2026-09-30 from their signed ISO packets). Most funders have none. A
//     funder with no row for this product has criteria we have NOT recorded —
//     say that in words. Never render a blank cell that could read as "no
//     requirement", and never fall back to `category.criteria`: that box was
//     extracted from MCA packets and decline emails, so showing it under a loan
//     heading relabels an MCA box as a term-loan box. The distinction matters
//     MORE now that recorded and unrecorded funders sit on the same tab, not
//     less.
//  2. Vocabulary. An MCA is a purchase of future receivables and is never a
//     loan. Term loans, lines of credit, SBA and equipment financing ARE credit,
//     so they use ordinary lending language. Neither vocabulary leaks.
type ProductId = "mca" | "term_loan" | "line_of_credit" | "sba" | "equipment";
const PRODUCT_TABS: { v: ProductId; label: string }[] = [
  { v: "mca", label: "MCA" },
  { v: "term_loan", label: "Term Loan" },
  { v: "line_of_credit", label: "Line of Credit" },
  { v: "sba", label: "SBA" },
  { v: "equipment", label: "Equipment" },
];
// Tab id → the canonical product spelling used by `category->'products'`,
// `deals.products_interested` and `lender_programs.product_type`. The tab ids
// are this page's own shorthand; every lookup crosses through here.
const TAB_PRODUCT: Record<ProductId, CanonicalProduct> = {
  mca: "mca",
  term_loan: "term_loan",
  line_of_credit: "line_of_credit",
  sba: "sba_loan",
  equipment: "equipment_financing",
};

type ReqRow = { k: string; v: string; strong?: boolean };
type ProductSpec = {
  label: string;
  blurb: string;
  // General industry guidance — orientation for a phone call. NOT any named
  // funder's credit box; a processor must never quote it as one.
  requirements: ReqRow[] | null;
  checklist: string | null;
};

const PRODUCT_SPEC: Record<Exclude<ProductId, "mca">, ProductSpec> = {
  term_loan: {
    label: "Term loan",
    blurb:
      "A fixed amount of credit repaid on a set schedule. Slower than an advance and priced on credit quality, so it wants a cleaner file: real time in business, a real credit score, and financial statements.",
    requirements: [
      { k: "Time in business", v: "2+ years" },
      { k: "Credit", v: "650+" },
      { k: "Bank statements", v: "3–6 months" },
      { k: "Business tax returns", v: "1–2 years" },
      { k: "Personal tax returns", v: "Sometimes — lender by lender" },
      { k: "P&L + balance sheet", v: "Year-to-date plus prior year" },
      { k: "Business debt schedule", v: "Yes" },
      { k: "Personal financial statement", v: "Sometimes — lender by lender" },
      { k: "Collateral documentation", v: "Sometimes — if anything is pledged" },
      { k: "Time to close", v: "1–2 weeks", strong: true },
    ],
    checklist: `To put together your term loan offers, please send over:

• Last 3–6 months of business bank statements (every page, PDF)
• Business tax returns — the last 1–2 years, complete
• Year-to-date P&L and balance sheet, plus last year's
• Business debt schedule — who you owe, the balance, and the monthly payment
• Driver's license and a voided business check
• Personal tax returns (last 2 years) if the lender asks for them

Send whatever you have now — we can start the file and add the rest as it comes in.`,
  },
  line_of_credit: {
    label: "Line of credit",
    blurb:
      "Revolving credit the merchant draws on and repays as needed — pay interest only on what's drawn. Easier to qualify for than a term loan, lighter on paperwork, and the right answer when the need is recurring rather than one big purchase.",
    requirements: [
      { k: "Time in business", v: "1–2 years" },
      { k: "Credit", v: "600+" },
      { k: "Bank statements", v: "3–6 months" },
      { k: "Business tax returns", v: "Sometimes — lender by lender" },
      { k: "Personal tax returns", v: "Not typically required" },
      { k: "P&L + balance sheet", v: "Sometimes — lender by lender" },
      { k: "Business debt schedule", v: "Yes" },
      { k: "Personal financial statement", v: "Not typically required" },
      { k: "Collateral documentation", v: "Not typically required" },
      { k: "Time to close", v: "1–2 weeks", strong: true },
    ],
    checklist: `To get your line of credit approved, please send over:

• Last 3–6 months of business bank statements (every page, PDF)
• Business debt schedule — who you owe, the balance, and the monthly payment
• Year-to-date P&L and balance sheet if you have them
• Most recent business tax return, if the lender asks for it
• Driver's license and a voided business check

Send whatever you have now — we can start the file and add the rest as it comes in.`,
  },
  sba: {
    label: "SBA loan",
    blurb:
      "The cheapest money on the shelf and the longest road to it — 30 to 90 days, with a document list that is an order of magnitude longer than anything else here. Worth starting only when the merchant can wait and the file is clean.",
    requirements: [
      { k: "Time in business", v: "2+ years" },
      { k: "Credit", v: "680+" },
      { k: "Bank statements", v: "3–6 months" },
      { k: "Business tax returns", v: "3 years", strong: true },
      { k: "Personal tax returns", v: "3 years — every 20%+ owner", strong: true },
      { k: "P&L + balance sheet", v: "Yes — YTD plus prior year-ends" },
      { k: "Business debt schedule", v: "Yes" },
      { k: "Personal financial statement", v: "Yes — SBA Form 413", strong: true },
      { k: "Use of proceeds", v: "Itemized, by dollar amount", strong: true },
      { k: "Collateral documentation", v: "Usually" },
      { k: "Time to close", v: "30–90 days", strong: true },
    ],
    checklist: `An SBA loan is the cheapest money available, and it takes 30–90 days. The sooner these come back, the sooner the clock starts:

• Last 3–6 months of business bank statements (every page, PDF)
• Business tax returns — last 3 years, complete with all schedules
• Personal tax returns — last 3 years, for every owner with 20% or more
• Year-to-date P&L and balance sheet, plus the last 2 year-ends
• Business debt schedule — who you owe, the balance, and the monthly payment
• Personal financial statement — SBA Form 413 (we'll send you the form)
• Itemized use of proceeds — exactly what the money is for, by dollar amount
• Business licenses, entity documents, and your lease if you rent
• Collateral documentation if you're pledging property or equipment
• Driver's license and a voided business check

Send whatever you have now — we can start the file and add the rest as it comes in.`,
  },
  equipment: {
    // Nothing recorded and nothing invented. The requirements table the owner
    // signed off on covers term / LOC / SBA only; equipment gets an explicit
    // "not recorded yet" instead of a plausible-looking guess.
    label: "Equipment financing",
    blurb:
      "Credit secured by the equipment itself. We have funders who route equipment deals today, but no requirement set has been recorded for this product yet.",
    requirements: null,
    checklist: null,
  },
};

const STATUS_LABEL: Record<string, string> = {
  live_vendor: "Live vendor",
  application_submitted: "ISO app submitted",
  potential: "Prospect",
  inactive: "Inactive",
};

// Apply-once marketplaces — one application routed to many lenders. This is the
// fastest path to a first submission on any of these products today, so it sits
// at the top of the tab rather than inside a funder row.
const MARKETPLACES: {
  name: string;
  // The link a MERCHANT may be sent. Present ONLY when the URL carries an
  // identifier that ties the application back to us. A partner with no such
  // link gets `null` and says so — a plausible-looking marketing URL in this
  // slot is a commission leak, because everything on this callout reads as
  // "safe to send".
  merchantLink: string | null;
  // Where WE work the relationship. Never sent to a merchant.
  ourPortal?: string;
  products: Exclude<ProductId, "mca">[];
  lines: { k: string; v: string }[];
}[] = [
  {
    name: "1 West",
    merchantLink: "https://apply.1west.com/?iso=a10PZ00000socCfYAI",
    products: ["term_loan", "line_of_credit", "sba", "equipment"],
    lines: [
      { k: "Relationship", v: "Signed referral agreement. We refer, 1 West runs it through its lender network." },
      {
        k: "How we get paid",
        v: "The ISO code a10PZ00000socCfYAI is baked into the link and identifies Momentum Funding. Send the merchant THAT link, never 1west.com.",
      },
      {
        k: "The other route",
        v: "Or package it yourself: application + last 4 months of business bank statements to partnersubs@1west.com.",
      },
      { k: "Compensation", v: "50% of 1 West compensation, new and renewal. Never charge the merchant a fee." },
    ],
  },
  {
    name: "ROK Financial",
    // ROK has NO attributed merchant link. rok.biz/partner-multistep-apply is
    // the page where a BROKER signs up, carries no identifier, and was being
    // shown here as a merchant apply link — a merchant who used it was a
    // walk-in and the 20% was gone. Per the signed referral agreement
    // (DocuSign 7/6/2026) attribution comes from submitting through our
    // affiliate account, and the referral locks for 21 calendar days.
    merchantLink: null,
    ourPortal: "https://rok.mypartner.io",
    products: ["term_loan", "line_of_credit", "sba", "equipment"],
    lines: [
      {
        k: "⚠ No merchant link",
        v: "ROK has no referral URL that identifies us. A merchant who applies on rok.biz by themselves is a walk-in and we are paid nothing. Do not send a merchant to ROK's website.",
      },
      {
        k: "How to submit",
        v: "Executed ROK application + 3 months of business bank statements, submitted through OUR affiliate account at rok.mypartner.io (username sales@send.mfunding.net). The referral then locks for 21 calendar days.",
      },
      { k: "Contact", v: "Tony Cimino — tonyc@rok.biz, (833) 376-5249." },
      {
        k: "Relationship",
        v: "Referral. ROK runs the full application and underwriting and funds through its own sources. 20% of ROK upfront revenue; never charge the merchant a fee.",
      },
      { k: "Careful", v: "Non-circumvention applies once ROK funds a client." },
    ],
  },
];

type ProductLenderRow = ContactFields & {
  id: string;
  company_name: string;
  status: string | null;
  lender_types: string[] | null;
  category: LenderCategory | null;
  min_funding_amount: number | string | null;
  max_funding_amount: number | string | null;
};
type ProductData = {
  state: "idle" | "loading" | "ready" | "error";
  rows: ProductLenderRow[];
  error: string | null;
};

const PROD_SIZE = (l: ProductLenderRow) => {
  const lo = fmtMoney(num(l.min_funding_amount));
  const hi = fmtMoney(num(l.max_funding_amount));
  if (lo && hi) return `${lo}–${hi}`;
  if (hi) return `up to ${hi}`;
  if (lo) return `${lo}+`;
  return null;
};

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      // Clipboard blocked (insecure context / permission). Don't lie about it —
      // and never pop a dialog. The text is already on screen to select by hand.
      setCopied(false);
    }
  };
  return (
    <div className="checkbox">
      <div className="chead">
        <span className="t">{label}</span>
        <span className="s">paste straight into an email or text to the merchant</span>
        <button type="button" className="copy" onClick={copy}>
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <pre>{text}</pre>
    </div>
  );
}

// One funder on a credit-product tab. The whole point of this card is the
// submission path and an honest statement about what we do NOT know.
function ProductFunderRow({
  l,
  product,
  profile,
  profilesReadable,
  docs,
  program,
  programsReadable,
}: {
  l: ProductLenderRow;
  product: Exclude<ProductId, "mca">;
  profile: ProfileRow | undefined;
  profilesReadable: boolean;
  docs: DocState;
  program: ProgramRow | undefined;
  programsReadable: boolean;
}) {
  const [who, setWho] = useState(false);
  const [open, setOpen] = useState(false);
  const spec = PRODUCT_SPEC[product];
  const live = l.status === "live_vendor";
  const active = profile?.active === true;
  const path = profile?.method === "portal" ? profile.portal_url : (profile?.to_email ?? null);
  const canSubmit = live && active && !!path;
  const size = PROD_SIZE(l);
  const stips = (profile?.required_stips ?? []).filter(Boolean);

  return (
    <article className="frow">
      <div className="fhead">
        <span className="fnm">{l.company_name}</span>
        <span className="box">
          {!profilesReadable ? (
            <span className="bchip hard">submission path unreadable</span>
          ) : canSubmit ? (
            <span className="bchip open">submit today ✓</span>
          ) : live && active ? (
            <span className="bchip warn">live — no submission path on file</span>
          ) : (
            <span className="bchip off">not activated · {STATUS_LABEL[l.status ?? ""] ?? l.status ?? "unknown"}</span>
          )}
        </span>
      </div>

      {!profilesReadable ? (
        <div className="path">
          <b>How we submit:</b> could not be read — see the banner above. Do not read this as "no path on file."
        </div>
      ) : path ? (
        <div className="path">
          <b>How we submit:</b>{" "}
          {profile?.method === "portal" ? (
            <>
              portal —{" "}
              <a href={path} target="_blank" rel="noreferrer">
                {path}
              </a>
            </>
          ) : (
            <>email — {path}</>
          )}
        </div>
      ) : (
        <div className="path">
          <b>How we submit:</b> no submission address or portal recorded on this funder's profile yet.
        </div>
      )}

      {size && <div className="size mono">Catalog funding range {size} — recorded for the funder overall, not for {spec.label.toLowerCase()}</div>}

      {program ? (
        <FunderProgramBox p={program} productLabel={spec.label} />
      ) : !programsReadable ? (
        <div className="nocrit">
          Whether we hold {l.company_name}'s {spec.label.toLowerCase()} box is UNKNOWN — the recorded-criteria table
          could not be read by your account. Not "nothing recorded": ask Ops.
        </div>
      ) : (
        <div className="nocrit">
          We have not recorded {l.company_name}'s {spec.label.toLowerCase()} criteria yet — nothing here is a published
          credit box. Confirm time in business, credit and documents with the rep before you quote anything to a
          merchant.
        </div>
      )}

      <button type="button" className="more" onClick={() => setWho((w) => !w)} aria-expanded={who}>
        {who ? "Hide contacts & links ↑" : "Who to call · submission links ↓"}
      </button>
      {who && <FunderContactBlock l={l} profile={profile} profilesReadable={profilesReadable} docs={docs} />}

      {(stips.length > 0 || profile?.special_instructions) && (
        <>
          <button type="button" className="more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Hide what's on file ↑" : "What's on file for this funder ↓"}
          </button>
          {open && (
            <div className="detail">
              {stips.length > 0 && (
                <div className="drow">
                  <b>Submission packet on file:</b> {stips.join(" · ").replace(/_/g, " ")}{" "}
                  <span style={{ color: "var(--ink-faint)" }}>
                    — recorded for this funder's submissions generally, not for {spec.label.toLowerCase()}
                  </span>
                </div>
              )}
              <Quoted label="Funder submission notes" text={profile?.special_instructions} />
            </div>
          )}
        </>
      )}
    </article>
  );
}

function ProductTabView({
  product,
  data,
  profiles,
  docs,
  programs,
  onRetry,
}: {
  product: Exclude<ProductId, "mca">;
  data: ProductData;
  profiles: ProfileState;
  docs: DocState;
  programs: ProgramState;
  onRetry: () => void;
}) {
  const spec = PRODUCT_SPEC[product];
  const markets = MARKETPLACES.filter((m) => m.products.includes(product));
  const matching = useMemo(
    () =>
      data.rows
        .filter((r) => hasProduct(r, TAB_PRODUCT[product]))
        .slice()
        .sort((a, b) => {
          const rank = (l: ProductLenderRow) => (l.status === "live_vendor" ? 0 : 1);
          const d = rank(a) - rank(b);
          return d !== 0 ? d : a.company_name.localeCompare(b.company_name);
        }),
    [data.rows, product],
  );
  const liveOnes = matching.filter((l) => l.status === "live_vendor");
  const restOnes = matching.filter((l) => l.status !== "live_vendor");

  return (
    <>
      <p className="vocab">
        A <b>{spec.label.toLowerCase()}</b> is credit, so ordinary lending language is correct here. That vocabulary
        stops at this tab: an MCA is a purchase of future receivables and is never called a loan.
      </p>

      {/* APPLY ONCE — fastest path to a first submission */}
      {markets.length > 0 && (
        <section aria-labelledby={`mkt-${product}`}>
          <div className="callout">
            <div className="band">
              <h2 id={`mkt-${product}`}>⚡ Apply once — the fastest submission you can make today</h2>
              <p>
                These partners take <b>one application</b> and route it across their whole lender network for term
                loans, lines of credit, SBA and equipment. If the merchant is on the phone now, this is the move — no
                funder shortlist required.
              </p>
            </div>
            {markets.map((m) => (
              <div className="mkt" key={m.name}>
                <div className="mnm">{m.name}</div>
                {m.merchantLink ? (
                  <LinkLine label="Send the merchant" url={m.merchantLink} />
                ) : (
                  <div className="credhold">
                    <b>No merchant-facing link for {m.name}.</b> Nothing on their site identifies us, so a merchant who
                    applies there is a walk-in and we are paid nothing. Submit through our own account instead — see
                    below.
                  </div>
                )}
                {m.ourPortal && <LinkLine label="We log in at" url={m.ourPortal} />}
                {m.lines.map((ln) => (
                  <div className="mln" key={ln.k}>
                    <b>{ln.k}:</b> {ln.v}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* WHAT THE PRODUCT NEEDS */}
      <section aria-labelledby={`req-${product}`}>
        <div className="sec-head">
          <h2 id={`req-${product}`}>What a {spec.label.toLowerCase()} needs</h2>
          <span className="note">before you name a funder</span>
        </div>
        <p className="reqnote">{spec.blurb}</p>
        {spec.requirements ? (
          <>
            <span className="guide">General industry guidance — not any funder's credit box</span>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Requirement</th>
                    <th>What it takes</th>
                  </tr>
                </thead>
                <tbody>
                  {spec.requirements.map((r) => (
                    <tr key={r.k}>
                      <td>{r.k}</td>
                      <td>{r.strong ? <b>{r.v}</b> : r.v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rule">
              <b>Use this to orient a phone call, never to quote a funder.</b> These are the typical industry numbers
              for the product — no funder on this page has agreed to them. The moment you name a funder, the only
              numbers that count are the ones that funder's rep gives you.
            </div>
          </>
        ) : (
          <div className="rule">
            <b>We have not recorded a requirement set for {spec.label.toLowerCase()} yet.</b> That is a gap in our
            notes, not a product without requirements — an equipment deal absolutely has a credit box. Route it through
            an apply-once partner above, or ask the funder's rep and get it written down.
          </div>
        )}
      </section>

      {/* MERCHANT CHECKLIST */}
      {spec.checklist && (
        <section aria-labelledby={`chk-${product}`}>
          <div className="sec-head">
            <h2 id={`chk-${product}`}>Send the merchant this list</h2>
            <span className="note">plain language, copy and paste</span>
          </div>
          <CopyBlock label={`${spec.label} — merchant document checklist`} text={spec.checklist} />
        </section>
      )}

      {/* WHO DOES IT */}
      <section aria-labelledby={`fnd-${product}`}>
        <div className="sec-head">
          <h2 id={`fnd-${product}`}>Who does {spec.label.toLowerCase()}s</h2>
          <span className="note">
            {data.state === "ready" ? `${matching.length} in the catalog · ${liveOnes.length} live` : "from the funder catalog"}
          </span>
        </div>

        {data.error && <div className="err">{data.error}</div>}
        {profiles.error && (
          <div className={profiles.severity === "error" ? "err" : "warn"}>{profiles.error}</div>
        )}

        {data.state === "loading" && <div className="loadnote">Reading the funder catalog…</div>}
        {data.state === "error" && (
          <div className="loadnote">
            Nothing is listed below because the read failed — <b>not</b> because no funder does this product.{" "}
            <button type="button" className="docopen" onClick={onRetry}>
              try again
            </button>
          </div>
        )}

        {data.state === "ready" && matching.length === 0 && (
          <div className="empty">
            No funder in the catalog is tagged for {spec.label.toLowerCase()} yet. That is a tagging gap in the catalog
            — the apply-once partners above still route this product today.
          </div>
        )}

        {data.state === "ready" && liveOnes.length > 0 && (
          <>
            <div className="grouphead">Live vendors</div>
            <div className="frows">
              {liveOnes.map((l) => (
                <ProductFunderRow
                  key={l.id}
                  l={l}
                  product={product}
                  profile={profiles.map[l.id]}
                  profilesReadable={profiles.readable}
                  docs={docs}
                  program={programs.byKey[progKey(l.id, TAB_PRODUCT[product])]}
                  programsReadable={programs.readable}
                />
              ))}
            </div>
          </>
        )}

        {data.state === "ready" && restOnes.length > 0 && (
          <>
            <div className="grouphead">In the network — not activated for submissions</div>
            <div className="frows">
              {restOnes.map((l) => (
                <ProductFunderRow
                  key={l.id}
                  l={l}
                  product={product}
                  profile={profiles.map[l.id]}
                  profilesReadable={profiles.readable}
                  docs={docs}
                  program={programs.byKey[progKey(l.id, TAB_PRODUCT[product])]}
                  programsReadable={programs.readable}
                />
              ))}
            </div>
          </>
        )}
      </section>

      <footer>
        Funders on this tab are the <b>union</b> of <b>lenders.lender_types</b> and{" "}
        <b>category.products</b> in the funder catalog — two columns that disagree in both directions, so reading
        either alone hides funders · a funder showing a <b>recorded {spec.label.toLowerCase()} box</b> has one loaded
        from their own packet; <b>most funders have none</b>, and those rows say so rather than leaving a blank that
        reads as "no requirement" · every criteria line that is NOT in a recorded box is general industry guidance,
        and the requirement table above is orientation for a phone call, <b>never a quote to a merchant</b> · a link
        with no identifier does not pay us — check the chip before sending one · internal working tool, not a
        merchant-facing document.
      </footer>
    </>
  );
}

export default function FunderCheatSheetPage() {
  const [lenders, setLenders] = useState<LenderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paper, setPaper] = useState<(typeof PAPER_FILTERS)[number]>("all");
  const [bucket, setBucket] = useState<"all" | BucketId>("all");
  const [positions, setPositions] = useState<PosFilter>("all");
  const [tab, setTab] = useState<ProductId>("mca");
  const [prod, setProd] = useState<ProductData>({ state: "idle", rows: [], error: null });
  // Submission recipes — the "where the deal goes" half of every contact block.
  // Shared by the MCA cards and the credit tabs; merged as each tab loads.
  const [profiles, setProfiles] = useState<ProfileState>({
    map: {},
    readable: true,
    error: null,
    severity: "limited",
  });
  // Rate sheets / packets already captured per funder.
  const [docs, setDocs] = useState<DocState>({ byLender: {}, readable: true });
  // Recorded credit boxes, used by the credit tabs.
  const [programs, setPrograms] = useState<ProgramState>({ byKey: {}, readable: true });
  // "Has the shared credit-tab load been started / finished" — a ref, NOT the
  // rendered state, so that setting the state can never re-enter the effect.
  const creditLoad = useRef<"idle" | "running" | "done">("idle");
  // Only a page teardown abandons an in-flight read. Changing tabs must not.
  const alive = useRef(true);
  // The only way back out of a failed load, without reloading the page. The
  // tick is what re-runs the effect: `prod.state` is deliberately NOT a
  // dependency (that was the hang), so resetting the state alone would sit
  // there doing nothing.
  const [retryTick, setRetryTick] = useState(0);
  const retryCredit = () => {
    creditLoad.current = "idle";
    setProd({ state: "idle", rows: [], error: null });
    setRetryTick((t) => t + 1);
  };
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  // Same three-outcome rule as the credit tabs: this must end in loaded, empty
  // or failed. `setLoading(false)` lives in the finally so no branch — including
  // a thrown rejection, which is NOT the `{ error }` shape — can leave the MCA
  // tab spinning forever.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
      const { data, error: err } = await supabase
        .from("lenders")
        .select(
          "id, company_name, min_funding_amount, max_funding_amount, category, primary_contact_name, primary_contact_email, primary_contact_phone, contacts, submission_email, submission_portal_url, submission_notes, website, notes",
        )
        .eq("status", "live_vendor");
      if (cancelled) return;
      if (err) {
        setError(`Could not load the live funder list — ${err.message}`);
        return;
      }
      const rows = ((data ?? []) as LenderRow[]).slice().sort((a, b) => {
        const ra = orderRank(a.company_name);
        const rb = orderRank(b.company_name);
        if (ra !== rb) return ra - rb;
        return a.company_name.localeCompare(b.company_name);
      });
      setLenders(rows);
      setLoading(false);
      const ids = rows.map((r) => r.id);
      const [res, dres, pres] = await Promise.all([loadProfiles(ids), loadDocs(ids), loadPrograms(ids)]);
      if (cancelled) return;
      setProfiles((prev) => mergeProfiles(prev, res));
      setDocs((prev) => mergeDocs(prev, dres));
      setPrograms((prev) => mergePrograms(prev, pres));
      } catch (e) {
        if (cancelled) return;
        setError(
          `Could not load the live funder list — ${e instanceof Error ? e.message : String(e)}. This is a READ FAILURE, not an empty network.`,
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Credit-product tabs load on first use, so the MCA tab's first paint is
  // exactly what it was. A failed read is reported loudly and NEVER collapses
  // into an empty list.
  //
  // THREE OUTCOMES, ALWAYS — loaded, empty or failed. "Reading the funder
  // catalog…" must be able to end, and there are two ways to strand it:
  //
  //  1. A THROWN rejection. A dropped connection or a CORS failure does not
  //     come back as `{ error }`, it throws, and an uncaught throw kills the
  //     async body with the loading flag still set. Hence the try/catch.
  //
  //  2. A CANCELLED load — which is what actually broke this, and it broke it
  //     on the FIRST click, not on some race. `prod.state` was in the dep array
  //     AND set by the effect, so `setProd(loading)` re-ran the effect, React
  //     ran the previous cleanup, the cleanup set `cancelled = true`, and the
  //     fetch it had just started threw its own result away. The `!== "idle"`
  //     guard then blocked every retry. The tabs never loaded at all, for
  //     anyone, and grepping the deployed bundle for my own strings proved only
  //     that the code shipped — never that it ran.
  //
  // So: the effect depends on `tab` alone, "have we started" is a ref rather
  // than the rendered state, and the load is abandoned only when the PAGE goes
  // away — not when the user changes tab, because `prod.rows` is shared by all
  // four credit tabs and there is nothing tab-specific to cancel. A failure
  // resets the ref so the next visit (or the Try again button) retries.
  useEffect(() => {
    if (tab === "mca" || creditLoad.current !== "idle") return;
    creditLoad.current = "running";
    const cancelled = () => !alive.current;
    setProd((p) => ({ ...p, state: "loading" }));
    (async () => {
      try {
      const { data, error: err } = await supabase
        .from("lenders")
        .select(
          `id, company_name, status, min_funding_amount, max_funding_amount, ${PRODUCT_SOURCE_COLUMNS}, primary_contact_name, primary_contact_email, primary_contact_phone, contacts, submission_email, submission_portal_url, submission_notes, website, notes`,
        )
        .neq("status", "rejected");
      if (cancelled()) return;
      if (err) {
        creditLoad.current = "idle"; // a failure must be retryable
        setProd({
          state: "error",
          rows: [],
          error: `Could not read the funder catalog for the product tabs — ${err.message}. This is a READ FAILURE, not an empty network.`,
        });
        return;
      }
      const rows = (data ?? []) as ProductLenderRow[];
      creditLoad.current = "done";
      setProd({ state: "ready", rows, error: null });
      const ids = rows.map((r) => r.id);
      const [res, dres, pres] = await Promise.all([loadProfiles(ids), loadDocs(ids), loadPrograms(ids)]);
      if (cancelled()) return;
      setProfiles((prev) => mergeProfiles(prev, res));
      setDocs((prev) => mergeDocs(prev, dres));
      setPrograms((prev) => mergePrograms(prev, pres));
      } catch (e) {
        if (cancelled()) return;
        // Never leave the tab in "Reading…" — say what happened instead.
        setProd((prev) =>
          prev.state === "ready"
            ? prev
            : {
                state: "error",
                rows: [],
                error: `Could not read the funder catalog for the product tabs — ${
                  e instanceof Error ? e.message : String(e)
                }. This is a READ FAILURE, not an empty network.`,
              },
        );
      }
    })();
    // NO CLEANUP ON PURPOSE. Changing tab must not abandon this read: the rows
    // are shared by all four credit tabs, so there is nothing tab-specific to
    // cancel, and cancelling is precisely what stranded the spinner before.
    // Page teardown is handled by `alive`.
  }, [tab, retryTick]);

  const decorated = useMemo(
    () =>
      lenders.map((l) => ({
        l,
        papers: paperChips(l),
        buckets: bucketsOf(l),
        tags: tagsOf(l),
      })),
    [lenders],
  );

  const shown = useMemo(
    () =>
      decorated.filter(
        (d) =>
          (paper === "all" || d.papers.includes(paper)) &&
          (bucket === "all" || d.buckets.includes(bucket)) &&
          matchesPositions(d.l, positions),
      ),
    [decorated, paper, bucket, positions],
  );

  const consolidators = useMemo(() => lenders.filter(isConsolidation), [lenders]);
  const debtRelief = useMemo(() => lenders.filter(isRestructure), [lenders]);

  return (
    <div className="fcs">
      <FunderDisclosureStyles />
      <div className="wrap">
        <header>
          <div className="brandrow">
            <span className="logo" aria-hidden="true" />
            <span className="brandname">Momentum Funding</span>
          </div>
          <p className="eyebrow" style={{ marginTop: 14 }}>
            Internal · Deal-Matching Reference
          </p>
          <h1>Funder Cheat Sheet</h1>
          {tab === "mca" ? (
            <p>
              Match the deal to the funder. Read the merchant's <b>paper grade</b>, check whether they're{" "}
              <b>stacked</b> (needs consolidation), then filter to the right shortlist. Covers the funders you work
              today — your <b>{loading ? "…" : `${lenders.length}`} live vendors</b> plus{" "}
              <b>active referral partners</b>.
            </p>
          ) : (
            <p>
              The merchant doesn't want an advance. Here's who does{" "}
              <b>{PRODUCT_SPEC[tab as Exclude<ProductId, "mca">].label.toLowerCase()}s</b>, what the product needs, and
              the fastest way to get a submission out today.
            </p>
          )}
        </header>

        <div className="tabs" role="tablist" aria-label="Funding product">
          {PRODUCT_TABS.map((t) => (
            <button
              key={t.v}
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === t.v}
              onClick={() => setTab(t.v)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab !== "mca" && (
          <ProductTabView
            product={tab as Exclude<ProductId, "mca">}
            data={prod}
            profiles={profiles}
            docs={docs}
            programs={programs}
            onRetry={retryCredit}
          />
        )}

        {tab === "mca" && (
          <>
        {error && <div className="err">{error}</div>}
        {profiles.error && (
          <div className={profiles.severity === "error" ? "err" : "warn"}>{profiles.error}</div>
        )}

        {/* PAPER EDUCATION */}
        <section aria-labelledby="paper-h">
          <div className="sec-head">
            <h2 id="paper-h">What A / B / C / D paper means</h2>
            <span className="note">the single biggest driver of who to send it to</span>
          </div>
          <p style={{ margin: "0 0 14px", color: "var(--ink-soft)", fontSize: 14, maxWidth: "82ch" }}>
            “Paper” = the credit quality / risk grade of the <em>merchant</em> — it determines who will fund them, at
            what cost, and on what terms.
          </p>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Merchant profile</th>
                  <th>Typical terms</th>
                  <th>Who funds it</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <span className="tier tierA">
                      <span className="dot" />A paper
                    </span>
                  </td>
                  <td>
                    Strong: ~680+ FICO, 2+ yrs in business, healthy consistent revenue, <b>no existing MCAs</b>, clean
                    statements (no NSFs, good balances)
                  </td>
                  <td>Low factor (~1.10–1.25), longer terms (12–18mo), often weekly/monthly</td>
                  <td>Bank-like / prime funders (Kapitus, BriteCap, IOU, Vox, Nationwide)</td>
                </tr>
                <tr>
                  <td>
                    <span className="tier tierB">
                      <span className="dot" />B paper
                    </span>
                  </td>
                  <td>
                    Good-not-perfect: ~600–680 FICO, decent revenue, <b>0–1 existing position</b>, minor blemishes
                  </td>
                  <td>Factor ~1.25–1.35, terms ~6–12mo</td>
                  <td>Most mainstream MCA funders</td>
                </tr>
                <tr>
                  <td>
                    <span className="tier tierC">
                      <span className="dot" />C paper
                    </span>
                  </td>
                  <td>
                    Subprime: ~500–600 FICO, shorter history, some NSFs/negative days, <b>1–2 stacked positions</b>
                  </td>
                  <td>Factor ~1.35–1.45, terms ~3–6mo, daily payments</td>
                  <td>High-risk MCA shops</td>
                </tr>
                <tr>
                  <td>
                    <span className="tier tierD">
                      <span className="dot" />D paper
                    </span>
                  </td>
                  <td>
                    Bottom tier: &lt;500 FICO, <b>heavily stacked</b> (multiple positions), frequent NSFs/negative days,
                    distressed
                  </td>
                  <td>Factor ~1.45–1.49+, short terms (2–4mo), daily debits, smaller amounts</td>
                  <td>Last-resort funders who'll stack onto already-stacked merchants</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="rule">
            <b>Rule of thumb:</b> the further toward D, the worse the credit, the higher the cost, the shorter the term
            — but the more willing the funder is to touch a stacked or blemished merchant. Sending an{" "}
            <b>A-paper merchant to a D-paper funder overprices them</b> (you'll lose the deal to a competitor); sending
            a <b>D-paper merchant to an A-paper funder gets an instant decline.</b>
          </div>
        </section>

        {/* CONSOLIDATION */}
        <section aria-labelledby="con-h">
          <div className="callout">
            <div className="band">
              <h2 id="con-h">🔗 Consolidation &amp; Reverse-Consolidation — the stacked-book lifeline</h2>
              <p>
                A distinct product for over-stacked merchants (we saw it live with <b>Bay Finish</b> — stacked on CFG +
                SBFS, couldn't afford a new advance). <b>True consolidation / payoff</b> pays the existing positions off
                into one. <b>Reverse consolidation</b> deposits money to cover the existing daily debits while the
                merchant makes one smaller payment over a longer term. When a lead is too stacked to fund, this is where
                it goes instead of being written off.
              </p>
            </div>
            <div className="clist">
              {consolidators.map((l) => (
                <div className="citem" key={l.id}>
                  <div className="nm">{l.company_name}</div>
                  <div className="ty">{consoLabel(l)}</div>
                  <div className="ds">{cat(l).known_for ?? cat(l).deal_fit}</div>
                </div>
              ))}
              {!loading && consolidators.length === 0 && (
                <div className="citem">
                  <div className="ds">No live funder is flagged for consolidation right now.</div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* DEBT RELIEF */}
        <section aria-labelledby="dr-h">
          <div className="callout gold">
            <div className="band">
              <h2 id="dr-h">🛟 Debt Relief — the distressed-merchant exit</h2>
              <p>
                A different product from consolidation: not a new advance, a <b>workout</b>. For the merchant too
                stacked to fund at all — near or in default — this is where the file goes instead of being written off.
              </p>
            </div>
            <div className="clist">
              {debtRelief.map((l) => (
                <div className="citem gold" key={l.id}>
                  <div className="nm">{l.company_name}</div>
                  <div className="ty">Debt-relief / restructure · {relLabel(l).toLowerCase()}</div>
                  <div className="ds">{cat(l).deal_fit ?? cat(l).known_for}</div>
                </div>
              ))}
              {!loading && debtRelief.length === 0 && (
                <div className="citem">
                  <div className="ds">No live debt-relief partner on the roster right now.</div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* LIVE FUNDERS + FILTERS */}
        <section aria-labelledby="live-h">
          <div className="sec-head">
            <h2 id="live-h">Live funders</h2>
            <span className="note">filter to the shortlist for the deal in front of you</span>
          </div>
          <div className="controls">
            <div className="fgroup">
              <span className="flabel">Paper</span>
              {PAPER_FILTERS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="pill"
                  aria-pressed={paper === p}
                  onClick={() => setPaper(p)}
                >
                  {p === "all" ? "All" : p}
                </button>
              ))}
            </div>
            <div className="fgroup">
              <span className="flabel">Positions</span>
              {POSITION_FILTERS.map((p) => (
                <button
                  key={p.v}
                  type="button"
                  className="pill"
                  aria-pressed={positions === p.v}
                  onClick={() => setPositions(p.v)}
                >
                  {p.label}
                </button>
              ))}
              {positions !== "all" && (
                <span className="fhint">
                  Only funders with a published position box count — anyone whose ceiling we haven't recorded is hidden.
                </span>
              )}
            </div>
            <div className="fgroup">
              <span className="flabel">Bucket</span>
              {BUCKET_FILTERS.map((b) => (
                <button
                  key={b.v}
                  type="button"
                  className="pill"
                  aria-pressed={bucket === b.v}
                  onClick={() => setBucket(b.v)}
                >
                  {b.label}
                </button>
              ))}
              <span className="count">
                {loading ? "loading…" : `${shown.length} of ${decorated.length} live funders`}
              </span>
            </div>
          </div>

          <div className="fcs-cardgrid">
            {shown.map(({ l, papers, tags }) => (
              <FunderCard
                key={l.id}
                l={l}
                papers={papers}
                tags={tags}
                profile={profiles.map[l.id]}
                profilesReadable={profiles.readable}
                docs={docs}
              />
            ))}
          </div>
          {!loading && shown.length === 0 && (
            <div className="empty">No live funder matches that combination — widen the filters.</div>
          )}
        </section>

        {/* PIPELINE */}
        <section aria-labelledby="pipe-h">
          <div className="sec-head">
            <h2 id="pipe-h">Pipeline — activate these to fill the gaps</h2>
            <span className="note">applied / potential, not live yet</span>
          </div>
          <div className="pipe">
            <div className="pbox">
              <h3>🎯 Direct-submit micro ($500–$25K)</h3>
              <div className="sub">
                Giggle already covers referral micro (live). These would add micro you keep in-house / direct-submit.
              </div>
              <ul>
                <li>
                  <b>Fundo</b> — $500–$10K, no credit check, no personal guarantee (gig/1099).
                </li>
                <li>
                  <b>Bitty Advance</b> — $2K+, small-ticket fast MCA, 500 FICO / all-credit.
                </li>
                <li>
                  <b>Cresthill Capital</b> — micro-ticket, will sit behind 1st–3rd positions.
                </li>
                <li>
                  <b>CapitaWize · Cedar Advance</b> — small Miami boutiques, same-day small tickets.
                </li>
              </ul>
            </div>
            <div className="pbox">
              <h3>🔗 More consolidation</h3>
              <div className="sub">Extra stacked-book capacity in the pipeline.</div>
              <ul>
                <li>
                  <b>Genuine Funding</b> — deep D-paper positions well beyond 3rd + reverse consolidations.
                </li>
                <li>
                  <b>Berkman Financial</b> — same-day $10K–$2M; will consolidate existing balances.
                </li>
                <li>
                  <b>Fenix Capital Funding</b> — strong 2nd/3rd positions + balance consolidations.
                </li>
              </ul>
            </div>
            <div className="pbox">
              <h3>⭐ Prime A/B to activate</h3>
              <div className="sub">Clean-file coverage you're light on when live.</div>
              <ul>
                <li>
                  <b>Kapitus · BriteCap · IOU · Vox</b> — mainstream A/B-paper funders.
                </li>
                <li>
                  <b>Fora Financial · Rapid Finance · Credibly</b> — big shelves, MCA→SBA.
                </li>
                <li>
                  <b>Libertas Funding</b> — jumbo $100K–$10M for your largest clean files.
                </li>
              </ul>
            </div>
          </div>
        </section>

        <footer>
          Live-funder data reads straight from the funder catalog (lenders marked <b>live vendor</b>), so this page
          updates as the network changes · position caps, floors and restrictions come from each funder's own packets
          and rate sheets; <b>decline signals are quoted from real decline emails</b> · a blank field means the funder
          never published it, not that there's no limit · buckets are directional — always confirm the current credit
          box and any consolidation product with the funder's rep · this is an internal working tool, not a
          merchant-facing document.
        </footer>
          </>
        )}
      </div>
    </div>
  );
}

// ── Live-funder card ─────────────────────────────────────────────────────────
// Compact face = name, paper, size, and the two criteria the closer screens on
// first: how deep a stack the funder takes, and whether defaults/collections are
// a hard stop. Everything else folds away (reference content folds; the box the
// closer acts on stays visible).
function FunderCard({
  l,
  papers,
  tags,
  profile,
  profilesReadable,
  docs,
}: {
  l: LenderRow;
  papers: string[];
  tags: string[];
  profile: ProfileRow | undefined;
  profilesReadable: boolean;
  docs: DocState;
}) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState(false);
  const c = criteriaOf(l);
  const pos = positionStance(l);
  const ctone = collectionsTone(l);
  const clabel = collectionsLabel(ctone);

  const industries = listOf(c.restricted_industries);
  const states = listOf(c.restricted_states);
  const floors: { k: string; v: string }[] = [];
  const tib = fmtTib(c.min_tib_months);
  const rev = fmtRev(c.min_monthly_revenue);
  const fico = fmtFico(c.fico_floor);
  if (tib) floors.push({ k: "Time in biz", v: tib });
  if (rev) floors.push({ k: "Revenue", v: rev });
  if (fico) floors.push({ k: "FICO", v: fico });
  if (c.max_nsf_monthly != null) floors.push({ k: "NSF / mo", v: `max ${c.max_nsf_monthly}` });

  const hasDetail =
    floors.length > 0 ||
    industries.length > 0 ||
    states.length > 0 ||
    !!c.negative_days_policy ||
    !!c.funding_speed ||
    !!c.factor_range ||
    !!c.positions_note ||
    !!c.collections_policy ||
    !!c.decline_signal;

  return (
    <article className="card">
      <div className="top">
        <div>
          <div className="nm">{l.company_name}</div>
          <div className="rel">{relLabel(l)}</div>
        </div>
        <div className="papers">
          {papers.map((p) => (
            <span className={`pchip p${p}`} key={p}>
              {p}
            </span>
          ))}
        </div>
      </div>
      <div className="size mono">{sizeRange(l)}</div>

      {(pos.tone !== "na" || clabel) && (
        <div className="box">
          {pos.tone !== "na" && (
            <span
              className={`bchip pos${pos.tone === "deep" ? " deep" : pos.tone === "cap" ? "" : " unk"}`}
              title={c.positions_note ?? undefined}
            >
              {pos.label}
            </span>
          )}
          {clabel && (
            <span className={`bchip ${ctone}`} title={c.collections_policy ?? c.decline_signal ?? undefined}>
              {ctone === "hard" ? "🔴" : "🟢"} {clabel}
            </span>
          )}
        </div>
      )}

      {cat(l).known_for && <div className="known">{cat(l).known_for}</div>}
      {cat(l).deal_fit && <div className="fit">{cat(l).deal_fit}</div>}

      {hasDetail && (
        <button type="button" className="more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Hide the box ↑" : "The full box ↓"}
        </button>
      )}

      {open && hasDetail && (
        <div className="detail">
          {floors.length > 0 && (
            <div className="dgrid">
              {floors.map((f) => (
                <div className="dcell" key={f.k}>
                  <div className="k">{f.k}</div>
                  <div className="v">{f.v}</div>
                </div>
              ))}
            </div>
          )}
          {c.positions_note && (
            <div className="drow">
              <b>Positions:</b> {c.positions_note}
            </div>
          )}
          {c.negative_days_policy && (
            <div className="drow">
              <b>Negative days:</b> {c.negative_days_policy}
            </div>
          )}
          {c.collections_policy && (
            <div className="drow">
              <b>Collections / defaults:</b> {c.collections_policy}
            </div>
          )}
          {industries.length > 0 && (
            <div className="drow">
              <b>Restricted industries:</b> {industries.join(" · ")}
            </div>
          )}
          {states.length > 0 && (
            <div className="drow">
              <b>Restricted states:</b> {states.join(" · ")}
            </div>
          )}
          {(c.funding_speed || c.factor_range) && (
            <div className="drow">
              {c.funding_speed && (
                <>
                  <b>Speed:</b> {c.funding_speed}
                </>
              )}
              {c.funding_speed && c.factor_range && " · "}
              {c.factor_range && (
                <>
                  <b>Factor:</b> {c.factor_range}
                </>
              )}
            </div>
          )}
          {c.decline_signal && (
            <div className="quote">
              <span className="k">Decline signal — from a real decline email</span>
              {c.decline_signal}
            </div>
          )}
        </div>
      )}

      <button type="button" className="more" onClick={() => setWho((w) => !w)} aria-expanded={who}>
        {who ? "Hide contacts & links ↑" : "Who to call · submission links ↓"}
      </button>
      {who && <FunderContactBlock l={l} profile={profile} profilesReadable={profilesReadable} docs={docs} />}

      <div className="tags">
        {tags.map((t) => (
          <span className={tagClass(t)} key={t}>
            {t}
          </span>
        ))}
      </div>
    </article>
  );
}
