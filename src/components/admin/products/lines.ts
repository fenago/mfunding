// ─────────────────────────────────────────────────────────────────────────────
// The Momentum product lines — data, not markup
//
// Every product line is DATA so that each one renders through the same shell
// and the "mapping back" is uniform: for every funder slot you can see the
// lender row it points at, the documents the figures came from, whether we
// can submit today, what we get paid, and — the part that matters most —
// what we DO NOT know.
//
// Two rules this file obeys:
//
//  1. `gaps` is never empty where a gap exists. A product sheet that lists
//     only what we hold reads as complete, and a closer then quotes a figure
//     we never had. Missing credit-box fields are printed as missing.
//  2. Vocabulary is declared per line. An MCA is a purchase of future
//     receivables and the word "loan" must never attach to it; term loans and
//     lines of credit are credit and use ordinary lending language.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A portal we log into, as opposed to a route a file goes out on.
 * `unverified` means the URL came from a scrape of the funder's own site and
 * nobody here has opened it — it is shown, and labelled, rather than hidden,
 * because a closer who cannot find a login assumes none exists.
 */
import { BITTY_PROHIBITED } from "@/components/admin/funder/bittyIndustries";

export type PortalRef = {
  url: string;
  label: string;
  note?: string;
  unverified?: boolean;
};

export type SubmitRoute = {
  kind: "email" | "portal" | "selfserve";
  value: string;
  note?: string;
};

export type FunderSlot = {
  role: "Primary" | "Secondary";
  name: string;
  lenderId: string;
  /** Can a closer physically send a file today? */
  liveToday: boolean;
  liveNote: string;
  routes: SubmitRoute[];
  /** Broker/ISO portals we log into. Empty array where there is genuinely none. */
  portal: PortalRef[];
  /** Required when `portal` is empty — says so in words rather than rendering nothing. */
  portalNote?: string;
  /** Credit box — what they will look at. */
  box: { k: string; v: string; missing?: boolean }[];
  /** What the merchant pays. Same missing-field treatment as the credit box. */
  pricing: { k: string; v: string; missing?: boolean }[];
  pay: { headline: string; basis: string; timing: string };
  /** Submission history, stated plainly including zeros. */
  track: string;
  /** Which documents/records these figures came from — the mapping back. */
  evidence: string[];
  /** What we do NOT know. Never leave empty when something is unknown. */
  gaps: string[];
  contacts: { name: string; title?: string; email?: string; phone?: string }[];
};

export type LineCheck = {
  id: string;
  group: string;
  label: string;
  why?: string;
  /**
   * A check that needs a tool gets the tool, not a reference to one. `sos`
   * renders the state picker so a closer confirming a registration never
   * leaves the call to go and find the right state's register.
   */
  tool?: "sos";
  /**
   * The actual items, when the check is "is it on the list". Naming a list and
   * its length without printing it makes the closer go and find it somewhere
   * else, which on a live call means guessing. If a check turns on a list, the
   * list goes here and renders underneath it.
   */
  list?: string[];
  hard?: boolean;
};

export type ProductLine = {
  id: string;
  tab: string;
  name: string;
  /**
   * advance = purchase of receivables (never "loan"); credit = real lending;
   * relief = neither — nothing is borrowed and nothing is purchased, so both
   * vocabularies are wrong and saying either one misdescribes the product.
   */
  vocab: "advance" | "credit" | "both" | "relief";
  range: string;
  tagline: string;
  whoFor: string;
  /** Shown as a banner when the line cannot be fully worked yet. */
  warning?: { tone: "stop" | "warn"; title: string; body: string };
  primary: FunderSlot;
  /** Absent where no second funder genuinely exists. Never invent one. */
  secondary?: FunderSlot;
  /** Required when `secondary` is absent — says WHY, in words. */
  noSecondary?: string;
  checklist: LineCheck[];
  /**
   * Which pricing tool this line needs. Two funders let US set the margin —
   * Bitty and Lendini — and those two get a spread calculator. The clean
   * working-capital lane gets a points-and-merchant-cost calculator instead,
   * because there the funder sets the price and we take points off it.
   */
  calculator?: "bitty" | "lendini" | "wc";
  /**
   * A funder of genuine last resort, kept structurally separate from
   * `secondary` because the ordering is a RULE, not a preference. 1 West
   * shops a file across 45-50 lenders at once; going there first can burn
   * the market before a direct funder ever sees the file.
   */
  lastResort?: FunderSlot;
  openQuestions: string[];
};

// ── 1 ── MICRO ───────────────────────────────────────────────────────────────
const MICRO: ProductLine = {
  id: "micro",
  tab: "Micro",
  name: "Momentum Micro",
  vocab: "advance",
  range: "$2,000 – $100,000",
  tagline: "Small advances, fast automatic decisions, the files nobody else wants.",
  whoFor:
    "A merchant who needs $2K–$100K and would be ignored by a funder with a $50,000 minimum. Thin revenue is fine; 12 months trading is not negotiable at the primary.",
  primary: {
    role: "Primary",
    name: "Bitty Advance",
    lenderId: "46bcc237-2837-4316-8afc-6939542411e6",
    liveToday: true,
    liveNote:
      "Live. Submission recipe ACTIVE and the broker-portal login is on file — open the portal and key the file in. Nobody has sent Bitty a deal yet, so you would be the first.",
    routes: [
      { kind: "portal", value: "broker.bittyadvance.com", note: "Manual entry marked preferred; API fastest; auto-email fallback" },
    ],
    portal: [
      {
        url: "https://broker.bittyadvance.com/",
        label: "Bitty broker portal",
        note: "The submission route as well as the login. Manual entry is the method they mark preferred. Credentials are below — reveal them here rather than asking around for them.",
      },
    ],
    box: [
      { k: "Funding", v: "$2,000 – $100,000" },
      { k: "Time in business", v: "12 months on every priced tier (6 is only the auto-decline floor)" },
      { k: "Credit", v: "500 floor · 675 for best pricing" },
      { k: "Revenue", v: "$5,000/mo · $15,000/mo for the top three tiers" },
      { k: "Negative days", v: "19+ in prior 3 months is an auto-decline" },
      { k: "Max positions", v: "not recorded", missing: true },
      { k: "Excluded states", v: "not recorded", missing: true },
      { k: "Excluded industries", v: `${BITTY_PROHIBITED.length} prohibited — all of them printed on the industry check below` },
    ],
    pricing: [
      { k: "Factor", v: "1.39 – 1.59 starting, by tier" },
      { k: "Term", v: "50 – 69 weeks maximum, by tier" },
      { k: "Early payoff", v: "30% off at 30 days, 20% off at 60 days" },
    ],
    pay: {
      headline: "Up to 12% (8% on Access)",
      basis: "A SPREAD we set — Funded Amount × (Sell Rate − Buy Rate). Bitty names the buy rate and a cap per approval. The 12% is the cap, not a rate we are owed.",
      timing: "The same day Bitty advances the funds — best in the network.",
    },
    track: "Zero submissions. We have never sent Bitty a file.",
    evidence: [
      "Bitty Underwriting Guide 10-2026.pdf (v10, 2pp) — tiers, auto-declines, industries",
      "Bitty Referral Agreement v6 Full 2026.pdf (15pp) — compensation, clawback, funding window",
      "Bitty Partner Funding Overview.pdf (3pp) — payout timing, Plaid, early-payoff discount",
    ],
    gaps: [
      "Bank statement count is named in NO document — collect 3, be ready for 4",
      "No submission email; portal only",
      "Max positions and excluded states unrecorded",
      "Record says max $250,000; the October guide says $100,000 — unresolved",
    ],
    contacts: [
      { name: "Rosmery Quiroz", title: "Partner Support", email: "rosmery@bitty.com" },
      { name: "Partner Support", email: "partners@bittyadvance.com" },
    ],
  },
  secondary: {
    role: "Secondary",
    name: "True Advance Funding",
    lenderId: "ba3d03cc-6342-433d-a919-fb48cb009265",
    liveToday: true,
    liveNote: "Live vendor, submission recipe ACTIVE. Can submit today.",
    routes: [
      {
        kind: "email",
        value: "submissions@trueadvancefunding.com",
        note: "THE route. Delivery proven — 2 sends, 2 replies",
      },
      {
        kind: "portal",
        value: "https://apply.trueadvancefunding.com",
        note:
          "⚠ DO NOT SEND A MERCHANT HERE. Bare host, no ISO code, no query string — anyone who applies through it is untracked and we are paid nothing. Whether it is even merchant-facing is unrecorded",
      },
    ],
    portal: [
      {
        url: "https://portal.trueadvance.biz",
        label: "ISO login portal",
        note: "Scraped from their own site and recorded as the ISO login. Nobody here has opened it, so try it before you rely on it.",
        unverified: true,
      },
      {
        url: "https://new.trueadvance.biz/iso",
        label: "ISO / partner application",
        note: "Four-step onboarding form, not a login.",
        unverified: true,
      },
    ],
    box: [
      { k: "Funding", v: "$2,000 – $200,000 — the only other funder reaching $2,000" },
      { k: "Time in business", v: "12 months" },
      { k: "Credit", v: "500" },
      { k: "Revenue", v: "$10,000/mo" },
      { k: "Max positions", v: "5" },
      { k: "Excluded states", v: "TEXAS and NORTH DAKOTA — do not submit" },
      { k: "Statements", v: "3 months" },
      { k: "Excluded industries", v: "not recorded", missing: true },
    ],
    pricing: [
      { k: "Buy rate", v: "from 1.40" },
      { k: "Sell rate", v: "1.40 – 1.50" },
      { k: "Term", v: "2 – 11 months, weekly or daily" },
    ],
    pay: {
      headline: "10 points, rising to 12",
      basis: "“Start 10 pts (up to 12 after a few clean, non-defaulting deals).” A floor that rises — the only one of its kind in the network.",
      timing: "Within 5 business days, no invoice needed. BUT +30 business days while the agreement is under 60 days old, or in any month they fund fewer than 3 of our deals.",
    },
    track: "2 submissions (7/3 and 8/10/2026), both declined.",
    evidence: [
      "True Advance underwriting guidelines — “Funding $2k-$200k”, p.1",
      "lender_programs (mca) — positions, excluded states, term, buy/sell",
      "lenders.commission_structure — the 10→12 point language, verbatim",
    ],
    gaps: [
      "NSF and negative-day limits unrecorded",
      "Excluded industries unrecorded",
    ],
    contacts: [{ name: "John Callandrillo", title: "gave a direct cell line" }],
  },
  calculator: "bitty",
  checklist: [
    { id: "m-tib", group: "Qualify on the call", label: "12+ months in business", hard: true, why: "Both funders require 12 months. Under 6 is an automatic decline at Bitty." },
    { id: "m-fico", group: "Qualify on the call", label: "FICO 500+, no open bankruptcy", hard: true, why: "500 is the floor at both. Below 550 at Bitty means the Access tier and 8% to us instead of 12%." },
    { id: "m-rev", group: "Qualify on the call", label: "Revenue — $5,000/mo for Bitty, $10,000/mo for True Advance", hard: true, why: "True Advance needs double. Check which funder the file is actually going to." },
    { id: "m-state", group: "Qualify on the call", label: "Merchant is NOT in Texas or North Dakota", hard: true, why: "True Advance excludes both, so a Texas or North Dakota file has to go to Bitty — whose own excluded states are unrecorded. Ask before you promise." },
    { id: "m-pos", group: "Qualify on the call", label: "5 or fewer open positions", hard: true, why: "True Advance caps at 5. Bitty's position limit is unrecorded — ask before you promise." },
    {
      id: "m-ind",
      group: "Qualify on the call",
      label: "Industry is not one Bitty prohibits",
      hard: true,
      why: "Prohibited means do not submit at all, at any price — these are the whole list, not a sample. Anything not here is fine by Bitty; the preferred/standard split only moves the tier. True Advance publishes no exclusions at all, so for a file going there you have to ask.",
      list: BITTY_PROHIBITED,
    },
    { id: "m-neg", group: "Qualify on the call", label: "Under 19 negative days across the last 3 months", hard: true, why: "Automatic decline at Bitty. Verify in the statements, not just by asking." },
    { id: "m-app", group: "Collect", label: "Signed application — legal name, DBA, EIN, entity type, state", hard: true, why: "Bitty's decision is automatic and keyed to application accuracy. A sloppy app is a slow one." },
    { id: "m-stmt", group: "Collect", label: "3 months of business bank statements", hard: true, why: "3 is True Advance's stated requirement. Bitty names no count anywhere — have a 4th ready." },
    { id: "m-chk", group: "Collect", label: "Business checking account confirmed", hard: true, why: "Bitty requires it on every file. A personal account does not substitute." },
    { id: "m-sos", group: "Collect", label: "Secretary of State active and in good standing", hard: true, tool: "sos", why: "Named explicitly by Bitty as a requirement on every file. Check it yourself rather than asking the merchant — a lapsed registration is a silent decline, and the owner is often the last to know. Pick the state below and the register opens in a tab." },
    { id: "m-web", group: "Collect", label: "Business location or website — home-based needs an online presence", hard: true, why: "A Bitty requirement. Find the online footprint before you submit." },
    { id: "m-ucc", group: "Collect", label: "No unresolved cash-advance UCCs or funding judgments", hard: true, why: "“Unresolved” is the operative word — a paid-off advance still needs a termination letter, and that takes days." },
    { id: "m-own", group: "Collect", label: "Owner name, DOB, SSN, home address, ownership %", hard: true },
    { id: "m-cell", group: "Collect", label: "Owner's mobile is correct and they will answer a text after signing", why: "Bitty auto-texts an ID verification link after signing. Do not chase a photo ID; confirm the cell." },
    {
      id: "m-price",
      group: "Before you submit",
      label: "You have priced the file in the Bitty calculator above",
      hard: true,
      why: "Bitty is the only funder here that pays no commission percentage. They quote US a BUY rate on the approval; we quote the MERCHANT a SELL rate above it; the gap between the two is the entirety of what we earn — one factor point is 1% of the funded amount. Nobody is expected to do that in their head: open the calculator at the top of this tab, pick the tier and the amount, and the sell-rate dropdown shows you the dollars beside every legal rate. Submit without having done it and a funded deal can pay us nothing.",
    },
    { id: "m-5day", group: "Before you submit", label: "Merchant can sign within 5 days of approval", hard: true, why: "Bitty's funding window. After five days another agent who closes it takes the commission." },
  ],
  openQuestions: [
    "Ask Bitty how many months of statements they actually want.",
    "Ask both funders their maximum position count.",
    "Ask Bitty which states they will not fund — ours is the only Micro route into Texas and North Dakota.",
    "Confirm the broker-portal login works on first use and stamp the date on the credential.",
  ],
};

// 1 West sits at the END of both MCA lines, and the same card is used on each
// so they cannot drift apart. It is a function rather than a shared object
// because each line renders its own copy and nothing should be able to mutate
// a slot another line is showing.
function LAST_RESORT_1WEST(): FunderSlot {
  return {
    role: "Secondary",
    name: "1 West — last resort, and that is a rule",
    lenderId: "e5e606c8-55dd-4490-9030-69214179a88b",
    liveToday: true,
    liveNote:
      "Live vendor, recipe ACTIVE, delivery proven — 5 sends, 5 replies. Our agreement with them carries NO clawback and NO non-circumvention clause, which is a genuine advantage over every other funder on this shelf. Go here AFTER the direct funders, never before.",
    routes: [
      { kind: "email", value: "partnersubs@1west.com", note: "Brokered route — application + 4 months of statements. Yasemin's team works ISO files" },
      { kind: "selfserve", value: "https://apply.1west.com/?iso=a10PZ00000socCfYAI", note: "Referral route. Our ISO code is inside the link — a retyped or shortened link pays us nothing" },
    ],
    portal: [
      {
        url: "https://apply.1west.com/accounts/login/",
        label: "Account log-in",
        note: "From their own contact page. Not yet opened by anyone here. Our submission profile points at www.1west.com, which is the marketing site — ignore it.",
        unverified: true,
      },
    ],
    box: [
      { k: "Funding", v: "$5,000 – $1,000,000 — confirmed by their VP of Business Development on a call 2026-10-23" },
      { k: "Time in business", v: "6 months per the VP, though most of their network lenders want a year" },
      { k: "Credit", v: "550" },
      { k: "Revenue", v: "Must exceed $10,000 EVERY month — their VP's wording, not an average" },
      { k: "States", v: "No restricted states" },
      { k: "Statements", v: "4 months on the brokered route" },
      { k: "What they also broker", v: "Term loan, line of credit, SBA and equipment — all confirmed on the same call. NOT invoice factoring, which our record wrongly claimed" },
      { k: "Max positions", v: "not recorded", missing: true },
    ],
    pricing: [
      { k: "Shape", v: "A marketplace, not a funder. They run the file across 45–50 partner lenders on the ABLE engine; the matched lender's own pricing governs" },
      { k: "Decision", v: "24 hours or less" },
      { k: "Published envelope", v: "Their partner guide prices short-term at 12–99% APR, long-term 8–19%, LOC 12–72%, equipment 7–15%, SBA 8–12%. Those are the ranges ACROSS their lender network, not a box 1 West underwrites to" },
    ],
    pay: {
      headline: "50% brokered · 25% referred",
      basis:
        "A share of 1 WEST'S compensation, not points on the funded amount. Broker it ourselves — take the application, chase the stips, work the file — and we get 50%. Hand the merchant the self-serve link and let 1 West do the work, and we get 25%. Owner's ruling, settled. Either way it is a share of a number we never see, so a 1 West file cannot be forecast the way a direct one can.",
      timing: "Within 30 calendar days of 1 West receiving its own compensation.",
    },
    track:
      "5 submissions, 5 declines, zero funded. Three came back on a single day, and one of them read “Declined from Ondeck.” — a partner's answer printed as their own.",
    evidence: [
      "Processor worksheet 2026-10-27 — confirmed on a call with Michael Bernier, VP of Business Development, 2026-10-23",
      "1 West Partner Guide (filed 2026-10-30) — 8 products with APR ranges and a qualification band",
      "ISO Application With W9_ACH.pdf, 07/24/2026 — the referral-rate language",
      "funder_replies — the five declines, verbatim",
    ],
    gaps: [
      "🚨 THE LOCKOUT. A decline here can mean their whole 45–50 lender pool declined, not one funder. Ask the merchant who already has their file, and prefer direct funders first — this is why 1 West is last",
      "We are paid a share of 1 West's compensation and we do not know what 1 West's compensation IS. Nobody has asked",
      "Their partner guide lists a PERSONAL LOAN and a HOME EQUITY LINE among eight products, with no consumer-lending caveat of any kind. We are a commercial broker. Do not place either, and do not mention them, until somebody establishes whether the partner channel is even allowed to",
      "Four different time-in-business floors now exist across our records and their documents — 1, 3, 6 months and a year. The VP said 6",
    ],
    contacts: [
      { name: "Michael Bernier", title: "VP Business Development — confirmed the box on a call 2026-10-23", email: "mike@1west.com", phone: "(516) 272-2110" },
      { name: "Yasemin & team", title: "ISO inquiries and submissions", email: "partnersubs@1west.com" },
      { name: "Ria Khan", title: "Funding Specialist", email: "ria.khan@1west.com", phone: "(956) 818-8335" },
    ],
  };
}

// ── 2 ── WORKING CAPITAL (clean paper) ───────────────────────────────────────
// The MCA shelf splits here. One line for a merchant whose bank statement
// stands up, one for a merchant whose does not — and the dividing line is the
// STATEMENT, not the credit score. Across these four funders FICO barely
// separates anything (550 / 500 / none), while revenue and time in business
// separate them completely: $20,000/mo and a year at Green Note against
// $4,000-$6,000 and three to six months on the other side.
const WORKING_CAPITAL: ProductLine = {
  id: "wc",
  tab: "Working Capital",
  name: "Momentum Working Capital",
  vocab: "advance",
  range: "$10,000 – $2,000,000",
  tagline: "The merchant whose bank statement stands up. The cheapest money we have.",
  whoFor:
    "A trading business with real deposits — six months or more, $4,000/mo at the floor and $20,000/mo to reach the best pricing. If the statements are clean and the owner is not drowning in positions, the file belongs here and nowhere else. This is where a merchant gets a 1.20 factor instead of a 1.50 one.",
  primary: {
    role: "Primary",
    name: "Reliant Funding",
    lenderId: "9e82cb23-5bb0-4a19-980b-28bb67431151",
    liveToday: true,
    liveNote:
      "Live vendor, submission recipe ACTIVE. Can submit today. Reliant is the PRIME arm of The LCF Group — same parent since 2023 — so a file that turns out not to be clean does not get lost, it moves across to LCF on the Bridge line.",
    routes: [
      {
        kind: "email",
        value: "submissions@reliantfunding.com",
        note: "The route. Their own ISO instruction is to copy lrodriguez@reliantfunding.com and gverma@reliantfunding.com on every file",
      },
    ],
    portal: [],
    portalNote: "No broker portal and no login. Everything with Reliant goes by email.",
    box: [
      { k: "Funding", v: "$10,000 – $300,000" },
      { k: "Time in business", v: "6 months" },
      { k: "Revenue", v: "$4,000/mo — the LOWEST revenue floor anywhere in our network ($48,000/yr)" },
      { k: "Credit", v: "No minimum FICO required — their own published position, not a gap in our record" },
      { k: "Collateral", v: "None, and no personal guarantee" },
      { k: "States", v: "All 50" },
      { k: "Statements", v: "3 months, plus a completed application" },
      { k: "Max positions", v: "not recorded — ask before you promise a stacked merchant anything", missing: true },
      { k: "NSF / negative days", v: "not recorded", missing: true },
      { k: "Excluded industries", v: "not recorded", missing: true },
    ],
    pricing: [
      { k: "Factor", v: "from 1.20 — the cheapest paper on any line in this book" },
      { k: "Term", v: "2 – 24 months, daily or weekly" },
      { k: "Early payoff", v: "Prepayment discount available, and it is real — their material says it can take the effective rate down substantially" },
      { k: "Fees", v: "Origination fee varies by customer and advance size — never published to us", missing: true },
      { k: "Speed", v: "Approval in as little as 30 minutes; same-day funding available" },
    ],
    pay: {
      headline: "6 – 10 points",
      basis:
        "Points on the funded amount, recorded as a 6–10 range on the Reliant row. Where a given file lands in that range is not documented anywhere we hold — nobody has asked whether it is volume-driven, file-driven or negotiable.",
      timing:
        "⚠ The signed LCF ISO agreement contradicts itself: Schedule A says ACH within 5 business days of funding, section 2 says 30 business days after LCF receives the executed Merchant Agreement, and Schedule A states the Agreement prevails. Unresolved.",
    },
    track:
      "ZERO submissions. Reliant has never been sent a file, although its sister entity LCF has — and LCF produced the only approval in our entire history.",
    evidence: [
      "lender_programs (mca) — $10K–$300K, 6mo TIB, $4,000/mo, factor from 1.20, 2–24 months, 6–10 points",
      "lenders.commission_notes — the 6%–10% range, verbatim",
      "LCF ISO Agent Sales Agreement — the commission and timing clauses, and the contradiction between them",
    ],
    gaps: [
      "Our submission recipe for Reliant has NO required stips and NO special instructions recorded — the profile is active but empty. It is the thinnest recipe of any live funder on this shelf",
      "Max positions, NSF tolerance and excluded industries are all unrecorded",
      "Where a file lands inside the 6–10 point range, and what moves it",
      "The origination fee the merchant pays is never published — you cannot tell them the real cost",
    ],
    contacts: [
      { name: "Lisnet Rodriguez", title: "ISO — copy on every file", email: "lrodriguez@reliantfunding.com" },
      { name: "G. Verma", title: "ISO — copy on every file", email: "gverma@reliantfunding.com" },
    ],
  },
  secondary: {
    role: "Secondary",
    name: "Green Note Capital",
    lenderId: "75e0c40a-0ab7-40ab-a576-a527a3b1938f",
    liveToday: true,
    liveNote:
      "Live vendor, recipe ACTIVE. Dean Simms is the single most responsive ISO manager in the network and the only funder in live conversation with us this month. Confirmed on a call 2026-10-23.",
    routes: [
      {
        kind: "email",
        value: "underwriting@greennotecapitalpartners.com",
        note: "The route. CC Dean Simms — he works the file personally",
      },
    ],
    portal: [],
    portalNote: "No broker portal and no login. Email only, and DocuSign for contracts.",
    box: [
      { k: "Funding", v: "$10,000 – $2,000,000 — no stated maximum beyond this; the biggest ceiling on the shelf" },
      { k: "Time in business", v: "12 months" },
      { k: "Revenue", v: "$20,000/mo in deposits — the HIGHEST floor of any funder on this line. This is the gate" },
      { k: "Credit", v: "550" },
      { k: "NSFs", v: "Maximum 5" },
      { k: "Ownership", v: "51% owner equity required" },
      { k: "Tradelines", v: "4 open, 0 active defaults" },
      { k: "Max positions", v: "NONE — they will stack, and they cross-collateralise" },
      { k: "States", v: "All 50" },
      { k: "Statements", v: "3 months" },
    ],
    pricing: [
      { k: "Buy rate", v: "1.3% buy rate (~1.30 factor) — the second-cheapest money on this shelf after Reliant" },
      { k: "Term", v: "Up to 12 months" },
      { k: "Payments", v: "Daily or weekly" },
      { k: "Speed", v: "~2-hour approvals, same-day funding" },
      { k: "Early payoff", v: "Discount available; syndication offered" },
    ],
    pay: {
      headline: "UNKNOWN — we have no commission figure for Green Note at all",
      basis:
        "Both the rate and the structure are empty on their record. Not a range, not a note — nothing. We cannot tell a closer what a Green Note deal pays, and we cannot build the margin side of the calculator until Dean gives us a rate card. He answers, so this is one email.",
      timing: "Also unrecorded.",
    },
    track:
      "ZERO submissions. Never sent a file, despite being the only funder in live conversation with us in October.",
    evidence: [
      "lender_programs (mca) — the full credit box, buy rate, term, speed and stip list",
      "funder_submission_profiles — the recipe, the light-stip list and the collections rule",
      "Processor worksheet 2026-10-27 — confirmed on a call with Dean Simms (ISO Manager) on 2026-10-23: MCA only, no debt restructuring or reverse consolidation, 550 FICO, 12mo TIB, $20K–$25K/mo for most industries, $10K–$2M, all states",
      "Dean Simms email 2026-09-30 on MF-2026-0166 — the collections rule, verbatim",
    ],
    gaps: [
      "🚨 NO COMMISSION DATA OF ANY KIND. Ask Dean — it is one line in an email and it unblocks the calculator",
      "They confirmed MCA ONLY — no debt restructuring and no reverse consolidation, so a drowning merchant is not a Green Note file",
    ],
    contacts: [
      { name: "Dean Simms", title: "ISO Manager — responsive, works files personally", email: "dean@greennotecapitalpartners.com", phone: "(347) 477-6127 cell" },
      { name: "Dean Simms — direct line", phone: "(312) 819-4083" },
    ],
  },
  lastResort: LAST_RESORT_1WEST(),
  calculator: "wc",
  checklist: [
    { id: "c-shopped", group: "Ask FIRST", label: "You have asked who else already has this merchant's file", hard: true, why: "The highest-value question on any MCA call. If a marketplace has shopped them, dozens of funders have already seen the file and a fresh submission comes back as “ineligible due to recent decline”." },
    { id: "c-which", group: "Ask FIRST", label: "You know which funder this file is for before you collect anything", hard: true, why: "Reliant takes $4,000/mo and 6 months. Green Note needs $20,000/mo and 12 months. That is a five-fold difference in the revenue gate — ask the deposits question early and you will not waste an hour collecting for the wrong funder." },
    { id: "c-dep", group: "Qualify on the call", label: "Average monthly DEPOSITS, not revenue — and you have a number", hard: true, why: "Deposits are what gets underwritten. A merchant who says “we do $30,000 a month” and banks $12,000 of it is a Reliant file, not a Green Note one." },
    { id: "c-tib", group: "Qualify on the call", label: "6+ months for Reliant · 12+ months for Green Note", hard: true },
    { id: "c-fico", group: "Qualify on the call", label: "FICO — 550 for Green Note; Reliant has no stated minimum", hard: true, why: "Reliant publishes no FICO floor, which is a real position of theirs and not a gap in our record. Green Note's 550 is firm." },
    { id: "c-nsf", group: "Qualify on the call", label: "For Green Note — 5 NSFs or fewer, 51% ownership, no active defaults", hard: true, why: "Count the NSFs in the statements yourself. Six is a decline and the merchant will not volunteer it." },
    { id: "c-coll", group: "Qualify on the call", label: "NO collections activity and NO debt-settlement servicer debit in the statements", hard: true, why: "Green Note hard-declines these. Dean Simms, 2026-09-30, verbatim: “we dont fund when ram payments is in there as that is collections.” Look for RAM Payment / RAM PMT, Global Holdings / GLOBAL GHLLC.COM and similar escrow processors. If you find one, this is not a dead file — it is a Momentum Debt Relief file. Move it, do not nurture it." },
    { id: "c-ind", group: "Qualify on the call", label: "Industry is not on Green Note's prohibited list", hard: true, why: "Prohibited at Green Note: Credit Repair, Check Cashing, ACH Processors, Bail Bonds, Auctions, Notary, Casinos, Non-Profits, Ticket Brokers, Adult Entertainment. Their preferred list is worth knowing too — Medical, Auto Repair, Laboratory, Pharmacy, IT Services, Pet Care, Restaurants, Laundromat, Marketing, Plumbing, Retail, Electricians, E-Commerce, Manufacturing, Funeral Home. Reliant publishes no exclusions at all, so you have to ask." },
    { id: "c-app", group: "Collect", label: "Signed application", hard: true },
    { id: "c-stmt", group: "Collect", label: "3 months of business bank statements", hard: true, why: "Three satisfies both funders. Collect a fourth anyway — it costs the merchant nothing and 1 West needs four if the file ends up there." },
    { id: "c-id", group: "Collect", label: "For Green Note — photo ID and a voided check", hard: true, why: "Part of their light-stip list. Reliant does not ask for either." },
    { id: "c-sos", group: "Collect", label: "Secretary of State active and in good standing", hard: true, tool: "sos", why: "Check it yourself rather than asking the merchant — a lapsed registration is a silent decline and the owner is usually the last to know. Pick the state and the register opens in a tab. Read the STATUS field: active is not the same as in good standing." },
    { id: "c-pos", group: "Before you submit", label: "You have counted the open positions and know where they are going", hard: true, why: "Green Note will stack and has no position limit, which is unusual and useful. Reliant's limit is unrecorded — ask, do not assume it is the same." },
    { id: "c-price", group: "Before you submit", label: "You have priced it in the calculator above", hard: true, why: "Reliant pays 6–10 points on the funded amount. Green Note's commission is unknown to us entirely, so you cannot forecast that one at all — say so internally rather than guessing." },
    { id: "c-respond", group: "AFTER you submit", label: "Somebody owns the reply and will act on an approval the same day", hard: true, why: "The sister entity LCF approved a file in 5 hours 25 minutes and then chased us five times over four days. Nobody requested the contract and the deal died. That is the only approval this company has ever had." },
  ],
  openQuestions: [
    "🚨 Ask Dean Simms what Green Note pays an ISO. We have no commission figure of any kind for them, so the margin half of this line is unknowable and the calculator cannot show it.",
    "Reliant's recipe has no stips and no instructions recorded — the thinnest of any live funder. Ask Lisnet Rodriguez what they actually want in a package.",
    "Where does a file land inside Reliant's 6–10 points, and what moves it?",
    "Reliant's max positions, NSF tolerance and excluded industries are all unrecorded.",
    "Commission timing on the LCF/Reliant paper: 5 business days or 30? The signed agreement says both, in two different places.",
  ],
};

// ── 3 ── BRIDGE (thin file, distressed, or declined elsewhere) ───────────────
const BRIDGE: ProductLine = {
  id: "bridge",
  tab: "Bridge",
  name: "Momentum Bridge",
  vocab: "advance",
  range: "$5,100 – $300,000",
  tagline: "Thin revenue, short history, imperfect statements. The file the clean lane turns down.",
  whoFor:
    "A merchant trading three to eight months, or banking $5,000–$6,000 a month, or carrying positions and NSFs that put them outside Working Capital. Nothing here is a consolation prize — this lane pays us roughly double the clean one, and Lendini is the only funder besides Bitty where WE set the price.",
  warning: {
    tone: "stop",
    title: "California files through Lendini need a licence we may not hold",
    body:
      "Lendini's own partner guidelines state that for California submissions the ISO must be a CA DFPI-licensed broker under the California Financing Law. Nobody has confirmed whether Momentum holds that licence. Until somebody does, do not submit a California merchant to Lendini — send it to LCF, who fund all states. This is not a preference and it is not Lendini being difficult; brokering without a required state licence is the kind of problem that outlives the deal.",
  },
  primary: {
    role: "Primary",
    name: "Lendini / Funding Metrics",
    lenderId: "4009c261-a881-4142-982a-6c36997edc37",
    liveToday: true,
    liveNote:
      "Live vendor, recipe ACTIVE, delivery proven — they underwrote and answered MF-2026-0166 on 2026-08-12. Confirmed on a call with Account Manager Mia Stephenson 2026-10-23.",
    routes: [
      {
        kind: "email",
        value: "submissions@lendini.com",
        note: "CC MIA STEPHENSON on every single file — both the signed ISO agreement and their setup email require it, and we were not doing it because nobody had captured her address until the 10/23 call",
      },
      {
        kind: "portal",
        value: "https://partners.lendini.com",
        note: "Partner portal. Desk hours 9am–8pm EST, Monday to Friday",
      },
    ],
    portal: [
      {
        url: "https://partners.lendini.com",
        label: "Lendini partner portal",
        note: "Listed in their partner guidelines. Nobody here has logged in, so try it before you rely on it.",
        unverified: true,
      },
    ],
    box: [
      { k: "Funding", v: "$5,100 – $300,000" },
      { k: "Time in business", v: "8 months at Lendini · 5 months through Quick Fix Capital, their sister brand" },
      { k: "Revenue", v: "$5,100/mo" },
      { k: "Credit", v: "500" },
      { k: "Excluded states", v: "TEXAS and NORTH DAKOTA — no longer funded. Send those to LCF" },
      { k: "Statements", v: "3 months PLUS month-to-date for most states · 4 MONTHS for CALIFORNIA and NEW YORK" },
      { k: "Industry caps", v: "Construction: 2yr TIB, no 1st positions, $50k cap · Roofing: 5yr · Restaurants under 3.5yr: $20k cap · Florida: 3.5yr · Hair/Skin/Nails: $30k cap" },
      { k: "Excluded industries", v: "The longest prohibited list we hold anywhere — roughly 70 categories. Check it before you collect, not after" },
      { k: "Max positions", v: "not recorded, except that Construction takes no 1st positions", missing: true },
    ],
    pricing: [
      { k: "Speed", v: "Offers in as few as 3 hours; ~9 of 10 applications pre-approved within hours; funding 24–48 hours after approval" },
      { k: "Payments", v: "Daily Monday–Friday, or weekly ACH" },
      { k: "Factor", v: "Not published by Lendini and not recorded by us — it arrives on the approval and the commission lives inside it", missing: true },
    ],
    pay: {
      headline: "Up to 15 points — and WE set it",
      basis:
        "The highest commission in the network, and the second funder after Bitty whose margin is ours to choose. The points are BUILT INTO THE FACTOR RATE, which means they shrink the moment you down-sell the rate to win the deal. Full document submission earns up to 15; a referral-only lead earns a negotiated referral fee instead. ⚠ This figure is sourced to a third-party lender review, not to a Lendini document — treat it as the working number and get it confirmed.",
      timing:
        "Paid within 24 hours of origination, by ACH or cheque — the fastest in the book. BUT: 100% of the commission is clawed back if the merchant defaults within 30 days of funding, returned only once Lendini has received 90% of the RTR, and only if the account was cured inside a 48-hour window.",
    },
    track:
      "1 submission. MF-2026-0166 went out 2026-08-12 at 13:38 UTC and came back with a per-file ineligibility reply at 14:19 — 41 minutes. They answer.",
    evidence: [
      "Processor worksheet 2026-10-27 — confirmed on a call with Mia Stephenson 2026-10-23: the box, the restricted states, the full industry list, the caps and the statement rule",
      "lender_programs (mca) — commission structure, clawback, CA licensing requirement, portal and desk hours",
      "funder_submission_profiles — the recipe and the cc requirement",
      "Lendini ISO submission guide (lendini_mailchimpsites.pdf) — filed on the funder record 2026-10-30",
    ],
    gaps: [
      "The 15 points comes from a third-party review, not from Lendini. Get it in writing from Mia",
      "No buy-rate or factor range is published anywhere, so the calculator works in points rather than rates",
      "🚨 Whether Momentum holds the CA DFPI broker licence Lendini requires for California files",
      "Max position count, except that Construction takes no first positions",
    ],
    contacts: [
      { name: "Mia Stephenson", title: "Account Manager — cc on EVERY submission; handles approvals and denials", email: "mia.stephenson@lendini.com", phone: "(484) 842-4005" },
      { name: "Orange Team", title: "Lendini desk", phone: "(215) 965-1071" },
      { name: "Carly Padilla", title: "Funding Metrics — earlier contact", email: "carly.padilla@fundingmetrics.com", phone: "267-569-7035" },
    ],
  },
  secondary: {
    role: "Secondary",
    name: "The LCF Group",
    lenderId: "60cba11b-bf10-435d-b041-9feb3aa894bb",
    liveToday: true,
    liveNote:
      "Live vendor, recipe ACTIVE. LCF is the catcher for this whole line: it funds all states, all industries and all risk factors, which is precisely the set Lendini refuses.",
    routes: [
      {
        kind: "email",
        value: "submissions@thelcfgroup.com",
        note: "CC kmaimaron@thelcfgroup.com and prm@thelcfgroup.com",
      },
    ],
    portal: [],
    portalNote:
      "No broker portal and no login. The one approval we have ever had put the offer behind a “View Offers” link inside their reply — that is a per-deal link in an email, not an account, and nobody opened it.",
    box: [
      { k: "Funding", v: "$25,000 – $300,000 — note the FLOOR is five times Lendini's. A $6,000/mo merchant may not support the minimum advance" },
      { k: "Time in business", v: "3 months — the shortest on any line" },
      { k: "Revenue", v: "$6,000/mo" },
      { k: "Credit", v: "No minimum FICO required" },
      { k: "States", v: "ALL — including Texas and North Dakota, which Lendini will not fund" },
      { k: "Industries", v: "ALL. Their own description: funds all states, industries and risk factors" },
      { k: "Statements", v: "3 months, plus a completed application" },
      { k: "Max positions", v: "not recorded — the one gap that matters most on a stacked file", missing: true },
      { k: "NSF / negative days", v: "not recorded", missing: true },
    ],
    pricing: [
      { k: "Term", v: "Short — approximately 30 to 120 fixed daily payments" },
      { k: "Payments", v: "Fixed daily" },
      { k: "Fees", v: "Origination approximately 3–10% deducted from the advance — INFERRED from observed deal shapes, never published to us", missing: true },
      { k: "Speed", v: "80% approved in under 2 hours; approval in as little as 30 minutes; same-day funding possible" },
    ],
    pay: {
      headline: "UNKNOWN — no commission recorded on the LCF entity",
      basis:
        "The LCF row carries no commission rate and no structure. The 6–10 points we hold belongs to Reliant, their prime arm, and should not be assumed to apply here. Ask prm@thelcfgroup.com.",
      timing:
        "⚠ The signed ISO agreement contradicts itself — Schedule A says ACH within 5 business days of funding, section 2 says 30 business days after LCF receives the executed Merchant Agreement, and Schedule A states the Agreement prevails.",
    },
    track:
      "2 submissions, 2 replies, ZERO declines ever — and the only approval in this company's history: MF-2026-0196, Titan Event Consultants, $30,000, approved in 5 hours 25 minutes on 2026-09-11. No contract was requested and the deal went to nurture.",
    evidence: [
      "lender_programs (mca) — the box, the term shape, the speed and the subprime positioning",
      "LCF ISO Agent Sales Agreement — commission spread, clawback, non-interference, and the timing contradiction",
      "funder_replies on MF-2026-0196 — the approval and five chase emails, verbatim",
    ],
    gaps: [
      "🚨 NO COMMISSION RECORDED. Do not borrow Reliant's 6–10 points for an LCF file",
      "Max position count and NSF tolerance — both unrecorded, on the funder most likely to see a stacked merchant",
      "The origination fee the merchant pays is inferred from deal shapes, never published",
      "Their 24-month non-interference clause is live and it collides with the Debt Relief line — see that tab",
    ],
    contacts: [
      { name: "Kajal Das Gupta", title: "Partner Relationship Manager", email: "kgupta@thelcfgroup.com", phone: "888-499-2939 x312" },
      { name: "Kurt Maimaron", email: "kmaimaron@thelcfgroup.com", phone: "866-604-4519" },
      { name: "Partner desk", email: "prm@thelcfgroup.com" },
    ],
  },
  lastResort: LAST_RESORT_1WEST(),
  calculator: "lendini",
  checklist: [
    { id: "b-shopped", group: "Ask FIRST", label: "You have asked who else already has this merchant's file", hard: true, why: "A merchant on this line has usually been shopped already. If a marketplace has had it, dozens of funders have seen it and a fresh submission comes back as “ineligible due to recent decline”." },
    { id: "b-ca", group: "Ask FIRST", label: "The merchant is NOT in California — or you have confirmed our DFPI licence", hard: true, why: "Lendini requires the ISO to be a CA DFPI-licensed broker under the California Financing Law for California files. Nobody has confirmed we hold it. A California merchant goes to LCF until somebody does." },
    { id: "b-state", group: "Ask FIRST", label: "If the merchant is in TEXAS or NORTH DAKOTA, this is an LCF file", hard: true, why: "Lendini no longer funds either state. LCF funds all fifty, so the file is not lost — it just goes to the other inbox. Do not submit it to Lendini and wait." },
    { id: "b-tib", group: "Qualify on the call", label: "8+ months for Lendini (5 via Quick Fix) · 3+ months for LCF", hard: true, why: "LCF's 3 months is the shortest trading history any funder on this shelf will take." },
    { id: "b-rev", group: "Qualify on the call", label: "$5,100/mo for Lendini · $6,000/mo for LCF", hard: true },
    { id: "b-size", group: "Qualify on the call", label: "You have checked the advance size against the right floor", hard: true, why: "Lendini starts at $5,100 and LCF starts at $25,000. A thin merchant who needs $8,000 has exactly one option here, and it is not LCF." },
    { id: "b-fico", group: "Qualify on the call", label: "FICO 500+ for Lendini · LCF has no minimum", hard: true },
    { id: "b-ind", group: "Qualify on the call", label: "Industry is not on Lendini's prohibited list, and not under one of their caps", hard: true, why: "Lendini's exclusion list runs to roughly 70 categories — the longest we hold — and the caps bite hard: Construction needs 2 years, takes no first positions and caps at $50k; Roofing needs 5 years; a Restaurant under 3.5 years caps at $20k; Florida merchants need 3.5 years; Hair, Skin and Nails caps at $30k. California is restricted for sole proprietorships and import/export/wholesale. Anything Lendini throws out, LCF will look at — they fund all industries." },
    { id: "b-app", group: "Collect", label: "Signed application", hard: true },
    { id: "b-stmt", group: "Collect", label: "Statements — 3 months plus MONTH-TO-DATE for Lendini; 4 months if California or New York", hard: true, why: "The month-to-date statement is the one people forget and it holds the file up. LCF wants 3 months and no MTD." },
    { id: "b-sos", group: "Collect", label: "Secretary of State active and in good standing", hard: true, tool: "sos", why: "On a thin file this matters more, not less — a 3-month-old business may not have finished registering. Pick the state and the register opens in a tab. Read the STATUS field: active is not the same as in good standing." },
    { id: "b-one", group: "Before you submit", label: "For Lendini — ONE email, labelled PDFs, summary at the top, reference number in the subject", hard: true, why: "Their written partner guideline. Split the package across emails and it sits in a queue. If it is a rush, put the deadline in the email." },
    { id: "b-cc", group: "Before you submit", label: "Mia Stephenson is CC'd on the Lendini submission", hard: true, why: "Required by the signed ISO agreement and their setup email. We were not doing it for months because nobody had captured her address — she gave it on the 10/23 call." },
    { id: "b-price", group: "Before you submit", label: "You know the points you intend to take", hard: true, why: "At Lendini the commission is built into the factor rate, so it shrinks the moment you cut the rate to win the deal. Up to 15 points — the most any funder pays us — but only if you price it deliberately. Use the calculator above." },
    { id: "b-30", group: "AFTER you submit", label: "You understand the 30-day clawback before you spend the commission", hard: true, why: "Lendini pays within 24 hours of origination, which is the fastest in the book — and takes 100% of it back if the merchant defaults inside 30 days. It is returned once Lendini receives 90% of the RTR, and only if the account was cured within a 48-hour window. Fast money with a string on it." },
  ],
  openQuestions: [
    "🚨 Does Momentum hold a California DFPI broker licence? Lendini requires one for CA files and nobody has checked. This blocks a whole state.",
    "Get Lendini's 15-point commission confirmed in writing by Mia Stephenson — our figure comes from a third-party review, not from Lendini.",
    "Ask prm@thelcfgroup.com what LCF pays. The row is empty, and Reliant's 6–10 points must not be assumed to apply.",
    "Lendini's and LCF's maximum position counts — unrecorded on the two funders most likely to see a stacked merchant.",
    "Does Lendini publish a buy-rate or factor range to ISOs? Without one the calculator has to work in points rather than rates.",
    "Commission timing on the LCF paper: 5 business days or 30? The signed agreement says both.",
  ],
};

// ── 4 ── TERM & LINE OF CREDIT ───────────────────────────────────────────────
const TERM: ProductLine = {
  id: "term",
  tab: "Term & LOC",
  name: "Momentum Term & Line of Credit",
  vocab: "credit",
  range: "$1,000 – $10,000,000",
  tagline: "Real credit, for the borrower who does not want an advance.",
  whoFor:
    "A stronger borrower with time: 12+ months trading, $25,000/mo, 575+ credit. They want a fixed end date or a revolving facility, not a daily split off receivables.",
  warning: {
    tone: "warn",
    title: "Both funders are live — watch how the line of credit pays",
    body:
      "You can submit to UCS and GoKapital today; both recipes are active. Note that UCS's line-of-credit commission is 1–3% ON THE INITIAL DRAW ONLY — there is no residual on later draws, so a revolving facility pays us once no matter how often the borrower redraws.",
  },
  primary: {
    role: "Primary",
    name: "United Capital Source",
    lenderId: "f73a9f64-d776-47a4-a0ac-b0a25a559faa",
    liveToday: true,
    liveNote: "Live vendor, recipe ACTIVE. Can submit today.",
    routes: [{ kind: "email", value: "isosubmissions@unitedcapitalsource.com" }],
    portal: [],
    portalNote: "No portal recorded on the funder record and none found. Submissions go to the ISO inbox by email.",
    box: [
      { k: "Term loan", v: "$5,000 – $10,000,000 · 3 months to 10 years · daily, weekly or monthly" },
      { k: "Line of credit", v: "$1,000 – $1,000,000 · up to 36 months · weekly or monthly" },
      { k: "Also", v: "SBA $50K–$5M (675 FICO, 5yr TIB) · Equipment to $10M (575 FICO, 3mo TIB)" },
      { k: "Time in business", v: "12 months (term and LOC)" },
      { k: "Credit", v: "575" },
      { k: "Revenue", v: "$25,000/mo · $300,000/yr" },
      { k: "Statements", v: "4 months" },
      { k: "Max positions / NSF", v: "not recorded", missing: true },
      { k: "Excluded states / industries", v: "not recorded", missing: true },
    ],
    pricing: [
      { k: "Term loan", v: "From 1–4% per month" },
      { k: "Line of credit", v: "From 1% per month, interest-only available" },
      { k: "Speed", v: "1–3 business days to decision" },
    ],
    pay: {
      headline: "Term up to 10% · LOC 1–3%",
      basis:
        "Per the UCS ISO Compensation schedule: MCA up to 10% by rate sold, business term loan up to 10%, line of credit 1–3% ON THE INITIAL DRAW ONLY, SBA 50 basis points, equipment up to 10%. Paid on NET funded, not gross.",
      timing: "Contradictory — the compensation schedule says 5 business days, the agreement says 30. Unresolved.",
    },
    track: "1 submission ever — an MCA, MF-2026-0013 Brideau Insurance, declined 2026-07-09. Zero term files have ever been sent.",
    evidence: [
      "UCS ISO Compensation.pdf, Schedule A Rev 04-2018 — the per-product commission grid",
      "UCS ISO Agreement — an ACTIVE-status quota of two merchants a month that “receive cash advances”, a 30-day referral fuse, 24-month non-interference",
      "lender_programs — five product rows: term, LOC, MCA, SBA, equipment",
    ],
    gaps: [
      "Does term-loan volume count toward ACTIVE status, or only cash advances?",
      "Does the 30-day referral fuse apply to term files, where underwriting legitimately runs longer?",
      "Commission timing: 5 or 30 business days?",
      "Their brand clause is UNREAD — relevant before anything Momentum-branded is printed",
      "The term desk is entirely unproven: no term file has ever been submitted",
    ],
    contacts: [{ name: "Colleen Spizuoco", email: "colleens@goucs.com", phone: "646-448-1711" }],
  },
  secondary: {
    role: "Secondary",
    name: "GoKapital",
    lenderId: "e5516b47-9167-4236-895c-0a108f0f7352",
    liveToday: true,
    liveNote: "Live vendor, recipe ACTIVE, five product rows. Can submit today.",
    routes: [{ kind: "email", value: "deals@gokapital.com" }],
    portal: [],
    portalNote:
      "No portal login. Submissions go to the deals inbox by email. Note our funder record says “Your affiliate link for online applications can be found here: Ernesto Lee” — the words survived the paste and the URL did not, so a GoKapital affiliate link may exist and we do not hold it. Worth one email.",
    box: [
      { k: "Term loan", v: "$10,000 – $350,000 · 1–5 years · monthly · 660 FICO · 24 months TIB · $250,000/yr" },
      { k: "Line of credit", v: "$5,000 – $350,000 · 12–36 months per draw · weekly · 650 FICO · 36 months TIB · $15,000/mo · $5,000 average daily balance" },
      { k: "Also", v: "MCA $20K–$5M (6% to us) · Equipment $20K–$5M (4%) · SBA $30K–$5M (1%)" },
      { k: "Statements", v: "3 months for term, 4 for LOC, 6 for MCA and equipment, 12 for SBA" },
      { k: "Max positions / NSF", v: "not recorded", missing: true },
      { k: "Excluded states / industries", v: "not recorded", missing: true },
    ],
    pricing: [
      { k: "Term loan", v: "6% – 25%" },
      { k: "Line of credit", v: "Draw fee 1.99–2.99%, from under 1% per month simple" },
      { k: "Speed", v: "Term: 24h to approve, 1–2 weeks to fund · LOC: same-day decision, next business day" },
    ],
    pay: {
      headline: "Term 2.5% · LOC 2.5% · MCA 6%",
      basis:
        "Published broker grid (Broker Referral Agreement, Exhibit A), broker tier / affiliate tier: MCA and revenue-based 6% / 2%; business term loan 2.5% / 0.5% on net funded; equipment leasing 4% / 1%; SBA 1%.",
      timing: "Not recorded.",
    },
    track: "1 submission (July 2026). It reached a decision, which is more than most.",
    evidence: [
      "GoKapital Broker Referral Agreement, Exhibit A — the published commission grid",
      "lender_programs — five product rows with full credit boxes",
    ],
    gaps: [
      "Commission payment timing unrecorded",
      "A GoKapital affiliate link for online applications is referred to on our record but the URL itself was lost — we may be leaving self-serve volume untracked",
      "Term pays a QUARTER of UCS — route term files to UCS unless UCS declines",
    ],
    contacts: [],
  },
  checklist: [
    { id: "t-product", group: "Qualify", label: "You know whether this is a term loan or a line of credit", hard: true, why: "Different boxes and very different commission. A LOC at UCS pays 1–3% on the initial draw ONLY." },
    { id: "t-tib", group: "Qualify", label: "12 months for UCS · 24 for a GoKapital term loan · 36 for a GoKapital LOC", hard: true, why: "GoKapital's time-in-business bars are far higher. Check before you route." },
    { id: "t-fico", group: "Qualify", label: "575 for UCS · 660 GoKapital term · 650 GoKapital LOC", hard: true },
    { id: "t-rev", group: "Qualify", label: "$25,000/mo for UCS · $250,000/yr GoKapital term · $15,000/mo GoKapital LOC", hard: true },
    { id: "t-adb", group: "Qualify", label: "For a GoKapital line of credit, $5,000 average daily balance", hard: true },
    { id: "t-time", group: "Qualify", label: "The borrower understands this is NOT same-day money", hard: true, why: "Term funds in 1–2 weeks at GoKapital. SBA runs 30–60 days. Set that expectation on call one." },
    { id: "t-app", group: "Collect", label: "Signed application", hard: true },
    { id: "t-stmt", group: "Collect", label: "4 months of statements — covers UCS and every GoKapital product except SBA", hard: true },
    { id: "t-fin", group: "Collect", label: "YTD P&L and balance sheet for anything over $250,000", why: "Standard for real credit, and the reason term files take longer than advances." },
    { id: "t-fuse", group: "Before you submit", label: "If routing to UCS, you know the 30-day referral fuse is running", hard: true, why: "If the merchant does not sign a Merchant Agreement within 30 days of referral, UCS owes us nothing. Term underwriting routinely runs past that." },
    { id: "t-lang", group: "Before you submit", label: "You are using LENDING language, not advance language", hard: true, why: "These are real credit products. Loan, borrower, term, draw, origination fee are all correct here — and must never be used on the Micro or MCA lines." },
  ],
  openQuestions: [
    "Ask UCS whether term-loan volume counts toward ACTIVE status, or only cash advances.",
    "Ask UCS whether the 30-day referral fuse applies to term files.",
    "Read UCS's and GoKapital's brand clauses before printing anything Momentum-branded.",
  ],
};

// ── 5 ── GIG ─────────────────────────────────────────────────────────────────
// The only line whose funder we have never spoken to. It is here because the
// link works and the borrower is one no other line can serve — not because
// the relationship is real. Everything unknown about it is printed.
const GIG: ProductLine = {
  id: "gig",
  tab: "Gig",
  name: "Momentum Gig",
  vocab: "advance",
  range: "up to $15,000 new · $20,000 repeat",
  tagline: "The self-employed borrower every other line turns away.",
  whoFor:
    "A 1099 contractor, sole proprietor, rideshare or delivery driver, or creator with 3 months of self-employed income. No FICO requirement and a PERSONAL bank account is accepted — this is the only line that can say either of those.",
  warning: {
    tone: "warn",
    title: "This line works, but we do not know what it pays",
    body:
      "Giggle's referral link is live and attribution is verified. But we hold NO commission rate, NO named contact, and we have never exchanged a single email with them. Zero files have gone through. Treat this as a tested link with unknown economics, not a funder relationship — and get a rate in writing before you build a campaign on it.",
  },
  primary: {
    role: "Primary",
    name: "Giggle Finance",
    lenderId: "7f0397ba-6367-43de-8c77-113c016a9477",
    liveToday: true,
    liveNote: "Live vendor. Referral link works today — but it is the ONLY route; nothing is packaged or submitted.",
    routes: [
      {
        kind: "selfserve",
        value: "https://flash.gigglefinance.com/frontend/home?flash_channel_id=679&flash_campaign_id=128&plid=146720",
        note: "SEND THIS ONE. Our record flags it as the link to give a merchant",
      },
      {
        kind: "selfserve",
        value: "https://partners.gigglefinance.com/agentic-voice-inc/ernesto-lee",
        note: "Softer co-branded intro page; its “Let’s Get Funded” button forwards to the link above",
      },
    ],
    portal: [
      {
        url: "https://partners.gigglefinance.com/agentic-voice-inc/ernesto-lee",
        label: "Our co-branded partner page",
        note: "A page about us, not an account. There is no Giggle login — nothing is ever submitted, so there is nothing to log in and look at.",
      },
    ],
    box: [
      { k: "Funding", v: "Up to $15,000 new · $20,000 on a repeat. Minimum NOT published" },
      { k: "Time in business", v: "3 months of 1099 or business income" },
      { k: "Credit", v: "NO FICO REQUIREMENT — “credit score is not a factor”; they judge banking history" },
      { k: "Revenue", v: "$2,500/mo · $3,000+ sitting in the account · 4+ deposits last month" },
      { k: "Account type", v: "PERSONAL bank accounts accepted — unique on this shelf" },
      { k: "Who does NOT qualify", v: "W-2-only earners" },
      { k: "Excluded states", v: "NEW YORK, CALIFORNIA and OREGON — do not send" },
      { k: "Documents", v: "None. Online application plus a bank-account connection" },
    ],
    pricing: [
      { k: "Shape", v: "Revenue-based advance, weekly payments that adjust with fluctuating income" },
      { k: "Speed", v: "Funded in minutes" },
      { k: "Factor / cost / term", v: "NOT RECORDED — we have never captured what this costs the borrower" },
    ],
    pay: {
      headline: "UNKNOWN",
      basis:
        "Our record says only “commission on funded deals plus ongoing renewal commission, tracked to plid=146720 — no rate published.” No points, no percentage, no structure has ever been recorded.",
      timing: "Not recorded.",
    },
    track:
      "Zero submissions, zero referrals recorded, and NO email from Giggle has ever been received. The only entry is an internal research note from 2026-07-29.",
    evidence: [
      "lenders.commission_notes — the referral link and the attribution warning, verbatim",
      "gigglefinance.com terms / FAQ / who-qualifies / partnerships, read 2026-08-11 (first-party, confidence high)",
    ],
    gaps: [
      "What they pay us — entirely unrecorded. The single blocking question",
      "Cost to the borrower: factor, fees and term all unrecorded, so we cannot explain the product honestly",
      "Minimum funding amount not published",
      "No named contact and no email ever exchanged — nothing that fixes a commission rate",
      "Our own record disagrees with itself on the URL: the funder record and the submission profile both hold the short gigglefinance.com/?plid=146720 form, which is NOT the full flash link above that the same record says to send",
    ],
    contacts: [],
  },
  noSecondary:
    "Confirmed twice, the second time by searching the credit BOXES rather than the vocabulary, because the first sweep had only keyword-matched. Of 125 lenders, 39 match something gig-adjacent and 36 of those are noise — “revenue-based” is boilerplate on 31 MCA records, “lyft” is a substring of “Uplyft”, and Capital Express’s 1099/independent-contractor/personal-account hits all describe OUR ISO relationship, not any merchant. Three lenders genuinely touch this borrower. FUNDERIAL was the one candidate the box search surfaced that keywords missed, and it does NOT belong here: a 500 FICO floor, four months of statements, no personal-account language anywhere, and a decline citing “Zelle/Cash Deposits”. It is a low-minimum business funder, not a gig funder. FUNDO holds the lowest box we have anywhere — $500–$10,000, 3 months, $1,500/mo — but our partner application has been DEAD FOR 90 DAYS: emailed support@fundo.com on 2026-07-29, and the only thing back was a Zendesk ticket-closed survey on 2026-08-12, which is not an approval. Their portal is post-approval only, so there is no way in until they let us in. Chasing (866) 393-8636 is the single action that would give this line a second funder. DAVID ALLEN CAPITAL has a literal gig product but our record says AVOID — an MLM-style agent-recruiting marketplace where agents earn 3–4% against our 8 points, never contacted. UPLYFT matched only on a stray substring and is a $5K–$5M workhorse, not a gig funder. Until Fundo answers, Giggle is a single point of failure for this entire line.",
  checklist: [
    { id: "g-type", group: "Qualify", label: "They earn 1099 or self-employed income — NOT W-2 only", hard: true, why: "A W-2-only earner does not qualify, full stop. This is the first question." },
    { id: "g-state", group: "Qualify", label: "They are NOT in New York, California or Oregon", hard: true, why: "Excluded, corroborated twice. Note this removes Sacramento — one of our six target markets — from this line entirely." },
    { id: "g-tib", group: "Qualify", label: "3 months of 1099 or business income", hard: true },
    { id: "g-rev", group: "Qualify", label: "$2,500/mo income, $3,000+ in the account, 4+ deposits last month", hard: true, why: "The balance and deposit-count tests are as real as the income test — they underwrite the bank connection, not a statement." },
    { id: "g-amt", group: "Qualify", label: "They need $15,000 or less", hard: true, why: "$15,000 new, $20,000 only on a repeat. Above that, this is the wrong line." },
    { id: "g-credit", group: "Qualify", label: "You have NOT asked about their credit score", why: "Credit is not a factor here. Asking creates an objection the funder does not have." },
    { id: "g-bank", group: "Set expectations", label: "They can connect a bank account on the spot", hard: true, why: "There are no bank statements to collect. The bank connection IS the underwriting, and it funds in minutes." },
    { id: "g-link", group: "Send it", label: "You sent the FULL flash.gigglefinance.com link with every parameter intact", hard: true, why: "Attribution is the plid=146720 parameter and nothing else. A shortener, a link preview or a merchant retyping it silently costs us the commission — and the application still works, which is what makes it easy to miss." },
    { id: "g-nocopy", group: "Send it", label: "You did NOT shorten, retype or paste it into a tool that rewrites links", hard: true, why: "Same reason. Send it in a channel that preserves query strings exactly." },
    { id: "g-log", group: "After", label: "You logged the referral against the deal yourself", hard: true, why: "Nothing comes back from Giggle — no email, no portal notification, no submission record. If you do not log it, there is no trace it happened." },
  ],
  openQuestions: [
    "What do they actually pay us, and when? Nothing is recorded, so every Gig referral today is unpriced.",
    "Get a named contact. We have never spoken to a human at Giggle.",
    "What does this cost the borrower? We cannot describe the product honestly without the factor and term.",
    "Fix the URL inconsistency: the record's own “send this one” link differs from the two fields the app surfaces.",
    "Chase Fundo on (866) 393-8636 — our partner application has sat dead for 90 days and they are the only possible second funder for this line.",
  ],
};

// ── 6 ── DEBT RELIEF ─────────────────────────────────────────────────────────
// The only line on this page where we are not placing capital. The merchant is
// already stacked and cannot take another advance; the product is getting the
// advances they ALREADY have renegotiated, or refinanced out with bank money.
//
// Two things make this line different from every other one here, and both are
// written onto the page rather than left to be learned:
//
//  1. It is WHITE-LABEL. The merchant is never told the partner's name. "VCF"
//     is an internal code and nothing else — it is in our pipeline stage labels
//     by mistake, not by design.
//  2. It must not be marketed publicly on this brand. Debt relief is a
//     PROHIBITED content category for A2P 10DLC, the public pages were pulled
//     for exactly that reason, and our SMS registration has been refused
//     repeatedly. Working a file is fine. Advertising the line is not.
const RELIEF: ProductLine = {
  id: "relief",
  tab: "Debt Relief",
  name: "Momentum Debt Relief",
  vocab: "relief",
  range: "$50,000+ of existing debt",
  tagline: "For the merchant who is already stacked and cannot take another advance.",
  whoFor:
    "A merchant being bled by daily or weekly debits on advances they already have. Being BEHIND is a qualifier here, not a disqualifier — this is the one line in the book that wants the file everybody else declines. It is also where a declined MCA merchant goes instead of into nurture.",
  warning: {
    tone: "stop",
    title: "Do not advertise this line on the Momentum brand",
    body:
      "Debt relief is a PROHIBITED content category for A2P 10DLC — not restricted, prohibited. The public /debt-relief page and the relief calculators were deliberately unrouted for that reason, and our SMS registration has been refused more than once. Working a file that comes to us is fine. Putting this product on mfunding.net, or texting a merchant about it, risks the registration the whole company needs. If this line is ever marketed, it needs its own domain and its own brand.",
  },
  primary: {
    role: "Primary",
    name: "MCA Debt Restructuring",
    lenderId: "ea733ace-66de-4804-8ed8-eb6da259a2d2",
    liveToday: true,
    liveNote:
      "Live vendor, onboarded, named contact who emailed us directly. Partner program is open to us.",
    routes: [
      {
        kind: "email",
        value: "partnerprogram@valuecapitalfunding.com",
        note: "The partner desk. Same address as our named contact",
      },
    ],
    portal: [],
    portalNote:
      "No portal and no login. The URL on the funder record is their public marketing page, not a submission portal — do not treat it as one.",
    box: [
      { k: "Qualifier", v: "$50,000+ of MCA and other high-cost business debt, combined. Confirmed by their principal on 2026-10-21 as the only hard number" },
      { k: "Business", v: "Must be US-based. Her words" },
      { k: "Credit", v: "No minimum FICO — confirmed on the call, not just published" },
      { k: "Collateral", v: "None" },
      { k: "Already behind?", v: "A QUALIFIER, not a disqualifier. Current-but-struggling, behind, and in default all qualify" },
      { k: "Minimum positions", v: "None. Her example was 3 advances totalling $50,000+, but the count is not the test — the combined balance is" },
      { k: "Maximum debt", v: "None stated. She was asked and gave no ceiling" },
      { k: "Approval", v: "They claim 90%+ approved, reviewed in 1–2 hours — their figure, not ours" },
      { k: "Revenue floor", v: "still not published by them and not recorded by us", missing: true },
      { k: "Time in business", v: "still not published by them and not recorded by us", missing: true },
      { k: "Excluded states", v: "still not published by them and not recorded by us", missing: true },
    ],
    pricing: [
      { k: "Shape", v: "Attorney-led renegotiation of the advances the merchant ALREADY has, with their current funders" },
      { k: "New borrowing", v: "None. Nothing is added to the balance sheet" },
      { k: "Upfront cost", v: "None. Published on their ISO page and confirmed by their principal on the 10/21 call: “No upfront costs or fees. Program fees are included in the merchant’s payments”" },
      { k: "How the fee is paid", v: "VCF’s own words: “built into your new lower weekly payment, inclusive of our fee from day one, and fully disclosed in a written, no-obligation proposal.” Pay-as-you-go, no enrolment fee. Do NOT describe it as free" },
      { k: "What VCF charges", v: "They publish no fee schedule on purpose — “every business we help is different”", missing: true },
    ],
    pay: {
      headline: "⚠ DISPUTED — the agreement says 7% to us, their principal says 3%",
      basis:
        "Two sources, and they do not agree. THE SIGNED AGREEMENT, §3 p.2: “For any Debt Restructuring/Debt Settlement cases successfully closed, Referral will receive a fee of seven percent (7%) of the amount of debt being restructured.” Flat 7%, no tier, no Schedule A, and no split — unlike the bank program in the very next sentence, which does state a 50/50. THEIR PRINCIPAL, Ferne Kornfeld, on a call with our processor on 2026-10-21: total compensation is 6% of the enrolled debt, split 50/50, so we receive 3% — her own example was $100,000 enrolled paying us $3,000. On a $150,000 book that is $10,500 by the paper and $4,500 by the phone call. Nobody here has resolved it, so do not promise a closer either number. The executed agreement is the governing instrument; the call is more recent and came from a principal, not a rep.",
      timing:
        "The agreement is SILENT — §3 says only “successfully closed”. Ferne Kornfeld answered it on the 10/21 call: paid MONTHLY, around the 15th, calculated on the payments the merchant actually cleared the previous month. So it arrives as a trickle across the life of the program and stops if the merchant drops out. That is her word, not a term of the contract. The “12–24 months” in our playbook and economics page was written by us; it matches her shape but no document.",
    },
    track:
      "ZERO. Not one deal has ever carried deal_type = vcf, nothing has ever been submitted to them, and nothing has ever been funded or serviced — despite a built pipeline, an intake function, a call playbook and a unit-economics calculator all standing ready. Every number on this card is what we were told or what they publish. None of it is something we have seen happen.",
    evidence: [
      "lenders.description — the onboarding email from Ferne Kornfeld, verbatim",
      "Partner Agreement (PA_-_W9_-_Revised.pdf) §3, p.2 — the compensation clause, quoted above verbatim. Five pages, no Schedule A, no rate table",
      "VCF ISO partner page (go.valuecapitalfunding.com) — attorney-led, $50K qualifier, no FICO, no collateral, no upfront fees",
      "valuecapitalfunding.com/pricing-and-fees/, modified 2026-08-27 — how the merchant pays, and their refusal to publish a schedule",
      "lenders.category — our 2026-08-11 web extraction, which already flags not_a_funder: true",
      "Processor funder worksheet, 2026-10-27 — a confirmed call with Ferne Kornfeld (Principal) on 2026-10-21 covering compensation, payment timing, qualification and the merchant document list. Everything on this card marked “confirmed on the call” comes from it, including the 6% / 50-50 figure",
    ],
    gaps: [
      "🚨 WHAT WE ARE ACTUALLY PAID. The signed agreement says 7% to us with no split; their principal said 6% total split 50/50, so 3% to us. That is more than double, and it is unresolved. Promise a closer nothing until Ferne confirms in writing which one governs",
      "What VCF itself charges the merchant — they deliberately publish no fee schedule, so we cannot sanity-check our 7% against their take",
      "Our lender_programs row for VCF is entirely null and marked inactive, so nothing in the app can match a merchant to this product automatically",
      "Positions, revenue floor, time in business and excluded states are all unpublished by them",
      "Whether a restructuring touches a funder we have a non-interference clause with — UCS carries 24 months and LCF carries one too. This is a lawyer question, not a closer question",
    ],
    contacts: [
      { name: "Ferne Kornfeld", title: "Principal — spoke with us 2026-10-21", email: "fernek@valuecapitalfunding.com", phone: "561-288-4510 office" },
      { name: "Ferne Kornfeld — text", phone: "561-486-9731" },
      { name: "Partner desk — submissions", email: "partnerprogram@valuecapitalfunding.com" },
      { name: "Partner desk — toll free", phone: "800-944-6280" },
    ],
  },
  secondary: {
    role: "Secondary",
    name: "Bank Term Loan & Line of Credit",
    lenderId: "ea733ace-66de-4804-8ed8-eb6da259a2d2",
    liveToday: true,
    liveNote:
      "Same partner, same desk, different program. Try this one FIRST when the merchant is still current on their payments — that is VCF's own triage rule.",
    routes: [
      { kind: "email", value: "partnerprogram@valuecapitalfunding.com", note: "Same desk — say which program you want" },
    ],
    portal: [],
    portalNote: "No portal and no login.",
    box: [
      { k: "⚠ Two of their own pages disagree", v: "Their merchant site and their ISO partner page state DIFFERENT boxes today. Both are below. Quote the ISO column — the merchant column will pre-qualify people their desk then turns down", missing: true },
      { k: "Credit", v: "640+ on all three bureaus — both pages agree" },
      { k: "Time in business", v: "ISO page 2+ years · merchant site says 1 year" },
      { k: "Revenue", v: "ISO page $250,000/yr · merchant site says $100,000/yr. Positive net income on both" },
      { k: "Amount", v: "ISO page: minimum $100,000, no maximum stated · merchant site: up to $350,000" },
      { k: "States", v: "All 50 — both pages agree, and neither names an excluded state" },
      { k: "Ownership", v: "51%+ US-citizen owned" },
      { k: "Excluded industries", v: "Transportation, logistics and cannabis. Both pages agree" },
    ],
    pricing: [
      { k: "Shape", v: "A 3–10 year bank or bank-style term loan whose purpose is to pay the MCA lenders off directly. Their words: not SBA, not an MCA" },
      { k: "Rate", v: "ISO page 15–22% APR · merchant site says 13–22%" },
      { k: "Term", v: "3 – 10 years" },
      { k: "Speed", v: "ISO page: decision 1–3 days, close 2–3 weeks · merchant site: pre-approval 3–4 days, funds 10–14 days" },
      { k: "Merchant’s fee", v: "A one-time success fee in points on a sliding scale by loan size, invoiced AFTER funding and usually paid from the proceeds. Their words: “not rolled into the loan balance, and never charged upfront.” The percentage is not published" },
    ],
    pay: {
      headline: "~2% net to us",
      basis:
        "Partner Agreement §3: “For the FDIC Bank Financing Program, funded transactions will pay 50% of the comp paid to VCF to the Referral.” So our half floats with whatever VCF earns — we do not set it and we do not see it. The ~2% net comes from the up-to-4% total on their ISO partner page, which §3 cites by link.",
      timing: "Not stated in the agreement.",
    },
    track: "ZERO, same as the restructuring program. No file has ever been sent.",
    evidence: [
      "VCF ISO bank-term-loan page (go.valuecapitalfunding.com/isobanktermloans) — the ISO column above",
      "valuecapitalfunding.com/mca-debt-refinancing/, modified 2026-09-04 — the merchant column above",
      "Partner Agreement (PA_-_W9_-_Revised.pdf) §3, p.2 — the 50/50 on this program, verbatim",
    ],
    gaps: [
      "Their two public pages contradict each other on four fields. Nobody has asked them which is current",
      "Which bank actually lends. “FDIC” describes a bank's deposit insurance, NOT this loan — never call it an FDIC-insured loan",
      "Commission timing unrecorded",
    ],
    contacts: [
      { name: "Ferne Kornfeld", email: "partnerprogram@valuecapitalfunding.com", phone: "561-288-4510" },
    ],
  },
  checklist: [
    { id: "r-white", group: "Before you open your mouth", label: "You will NOT name the partner to the merchant", hard: true, why: "This line is white-label. The merchant buys Momentum Debt Relief. “VCF” is an internal code — it appears in our own pipeline stage labels by mistake, so do not read your screen aloud." },
    { id: "r-nosms", group: "Before you open your mouth", label: "You are calling, not texting", hard: true, why: "Debt relief is a prohibited A2P 10DLC category. A text about this line risks the SMS registration the whole company is waiting on. No exceptions, no templates." },
    { id: "r-noclaim", group: "Before you open your mouth", label: "You will not quote a savings percentage or a dollar figure", hard: true, why: "The “50–75%” in the old call script and the playbook has NO substantiation behind it — our own disclosure file still has the source as an empty placeholder. Say payments may be reduced and that a specialist reviews their actual numbers first." },
    { id: "r-nolawyer", group: "Before you open your mouth", label: "You have said we are not a law firm and you are not giving legal advice", hard: true, why: "The program is attorney-led on their side. We are the referral. Blur that and you are practising law." },
    { id: "r-debt", group: "Qualify", label: "$50,000 or more of combined MCA and high-cost business debt", hard: true, why: "The one hard qualifier. Under it, this line does not apply." },
    { id: "r-which", group: "Qualify", label: "You know whether they are CURRENT or BEHIND on payments", hard: true, why: "It picks the program. Current → try the bank refinance first. Behind, stacked, or already declined → restructuring. That is VCF's own triage rule." },
    { id: "r-640", group: "Qualify", label: "For the bank refinance only — 640+ FICO, 2+ years trading, $250,000/yr, positive net income", hard: true, why: "Use the ISO-page figures. Their merchant site publishes a softer box that their own desk does not honour." },
    { id: "r-risk", group: "Qualify", label: "You have told them the risks, not just the upside", hard: true, why: "Renegotiating can mean collections activity, a breach claim from a funder, exposure under a personal guaranty, and possible tax on any amount reduced. A merchant who hears only the upside may stop paying on their own, and that is the worst outcome on this line." },
    { id: "r-stop", group: "Qualify", label: "You have NOT told them to stop paying anybody", hard: true },
    { id: "r-pos", group: "Collect", label: "Every open position: funder, balance, payment amount, frequency", hard: true, why: "The positions analysis is the whole file. A missing position is a plan that falls apart in week two." },
    { id: "r-stmt", group: "Collect", label: "Bank statements showing the debits", hard: true },
    { id: "r-agr", group: "Collect", label: "The merchant's existing advance agreements", hard: true, why: "The renegotiation is against those contracts. Without them the attorney is guessing." },
    { id: "r-conflict", group: "Before you submit", label: "You have checked whether any position is held by a funder WE placed", hard: true, why: "We are an MCA broker helping unwind MCAs. If one of those positions is with UCS or LCF we may have a non-interference clause of our own in the way. Escalate — do not decide this on a call." },
    { id: "r-app", group: "Collect", label: "The one-page application", hard: true, why: "Their principal named exactly four things on the 10/21 call: a one-page application, the merchant's MCA contracts, a couple of bank statements, and the position detail. That is the whole file — it is a short one." },
    { id: "r-attorney", group: "Before you submit", label: "The merchant knows an attorney will speak with them before they enrol", hard: true, why: "It is a step in VCF's own process, not a courtesy — their assigned attorney talks to the merchant before anything is signed, and the merchant is shown the program details, the fees and the payment structure first. Say it on the call: it is the most reassuring true thing about this program." },
    { id: "r-expect", group: "Before you submit", label: "You have quoted NOBODY a commission figure on this line", hard: true, why: "What we earn is in dispute — the signed agreement says 7% of the restructured debt to us, their principal said on 10/21 that it is 6% total split 50/50, so 3%. Both are on this card. Until it is settled in writing, quote neither to a closer and never to a merchant. What IS settled is the shape: paid monthly, around the 15th, on what the merchant actually cleared the month before — so if they drop out, our money stops." },
  ],
  openQuestions: [
    "🚨 FIRST. Get Ferne Kornfeld to confirm our compensation in writing. The executed Partner Agreement §3 says 7% of the restructured debt to us with no split; she told our processor on 2026-10-21 that it is 6% total split 50/50, so 3%. Until that is settled, the economics of this entire line are unknown to within a factor of two.",
    "Fill in the lender_programs row — every field is null and it is marked inactive, so no merchant can be matched to this product by the app.",
    "Ask VCF which of their two published boxes is current — their merchant site and their ISO page disagree on time in business, revenue, maximum amount and APR.",
    "Counsel question, one sentence: does helping a merchant renegotiate an advance held by a funder we have a non-interference clause with (UCS, 24 months; LCF) breach that clause?",
    "Which bank actually makes the term loan?",
    "Kill the “50–75% payment reduction” claim in playbooks.ts and the call scripts, or get written substantiation from VCF for it.",
    "Our funder record classifies VCF as an MCA funder. They fund nothing — fix funding_products and lender_types so nothing routes them a deal they cannot take.",
  ],
};

export const LINES: ProductLine[] = [MICRO, WORKING_CAPITAL, BRIDGE, TERM, GIG, RELIEF];
