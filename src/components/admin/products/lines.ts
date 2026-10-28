// ─────────────────────────────────────────────────────────────────────────────
// The Momentum product lines — data, not markup
//
// Every product line is DATA so that each one renders through the same shell
// and the "mapping back" is uniform: for every funder slot you can see the
// lender row it points at, the documents the figures came from, whether we
// can submit today, what we get paid, what state the paper is in, and — the
// part that matters most — what we DO NOT know.
//
// Three rules this file obeys:
//
//  1. `gaps` is never empty where a gap exists. A product sheet that lists
//     only what we hold reads as complete, and a closer then quotes a figure
//     we never had. Missing credit-box fields are printed as missing.
//  2. `agreement` records the real state. A dozen funders here turned out to
//     be signed on our side only, so "we have an agreement" is not a state —
//     `executed` | `one_sided` | `unverified` | `none` is.
//  3. Vocabulary is declared per line. An MCA is a purchase of future
//     receivables and the word "loan" must never attach to it; term loans and
//     lines of credit are credit and use ordinary lending language.
// ─────────────────────────────────────────────────────────────────────────────

export type AgreementState = "executed" | "one_sided" | "unverified" | "none";

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
  /** Credit box — what they will look at. */
  box: { k: string; v: string; missing?: boolean }[];
  /** What the merchant pays. */
  pricing: { k: string; v: string }[];
  pay: { headline: string; basis: string; timing: string };
  agreement: { state: AgreementState; note: string };
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
  hard?: boolean;
};

export type ProductLine = {
  id: string;
  tab: string;
  name: string;
  /** advance = purchase of receivables (never "loan"); credit = real lending. */
  vocab: "advance" | "credit" | "both";
  range: string;
  tagline: string;
  whoFor: string;
  /** Shown as a banner when the line cannot be fully worked yet. */
  warning?: { tone: "stop" | "warn"; title: string; body: string };
  primary: FunderSlot;
  secondary: FunderSlot;
  checklist: LineCheck[];
  /** Bitty is the only funder whose price we set, so only it gets a calculator. */
  calculator?: boolean;
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
  warning: {
    tone: "stop",
    title: "This line cannot be worked at the primary today",
    body:
      "Bitty's referral agreement is unexecuted by BOTH parties and its submission recipe is switched off. Until that changes every Micro file goes to True Advance, which means a $2,000–$200,000 range and a 5-position cap instead of Bitty's box.",
  },
  primary: {
    role: "Primary",
    name: "Bitty Advance",
    lenderId: "46bcc237-2837-4316-8afc-6939542411e6",
    liveToday: false,
    liveNote: "Agreement unexecuted and submission profile INACTIVE. Cannot submit.",
    routes: [
      { kind: "portal", value: "broker.bittyadvance.com", note: "Manual entry marked preferred; API fastest; auto-email fallback" },
    ],
    box: [
      { k: "Funding", v: "$2,000 – $100,000" },
      { k: "Time in business", v: "12 months on every priced tier (6 is only the auto-decline floor)" },
      { k: "Credit", v: "500 floor · 675 for best pricing" },
      { k: "Revenue", v: "$5,000/mo · $15,000/mo for the top three tiers" },
      { k: "Negative days", v: "19+ in prior 3 months is an auto-decline" },
      { k: "Max positions", v: "not recorded", missing: true },
      { k: "Excluded states", v: "not recorded", missing: true },
      { k: "Excluded industries", v: "14 prohibited, published in full" },
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
    agreement: {
      state: "none",
      note: "Referral Agreement v6 dated 10/27/2026 is initialled on pages 3–11 and signed by NOBODY. Bitty's entire column is blank; the ACH form and ISO application behind it are unfilled.",
    },
    track: "Zero submissions. We have never sent Bitty a file.",
    evidence: [
      "Bitty Underwriting Guide 10-2026.pdf (v10, 2pp) — tiers, auto-declines, industries",
      "Bitty Referral Agreement v6 Full 2026.pdf (15pp, unexecuted) — compensation, clawback, funding window",
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
    lenderId: "",
    liveToday: true,
    liveNote: "Live vendor, submission recipe ACTIVE. Can submit today.",
    routes: [
      { kind: "email", value: "submissions@trueadvancefunding.com" },
      { kind: "portal", value: "https://apply.trueadvancefunding.com" },
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
    agreement: {
      state: "unverified",
      note: "Execution page has typed names on BOTH sides but the only signature mark is ours, on the Personal Guaranty. The other copy on file has blank By: lines, and the signing certificate we hold covers a DIFFERENT document (the Application). Treat as unverified, not counter-signed.",
    },
    track: "2 submissions (7/3 and 8/10/2026), both declined.",
    evidence: [
      "True Advance underwriting guidelines — “Funding $2k-$200k”, p.1",
      "lender_programs (mca) — positions, excluded states, term, buy/sell",
      "lenders.commission_structure — the 10→12 point language, verbatim",
    ],
    gaps: [
      "Counter-signature unverified — the highest-value check on this line",
      "NSF and negative-day limits unrecorded",
      "Excluded industries unrecorded",
    ],
    contacts: [{ name: "John Callandrillo", title: "gave a direct cell line" }],
  },
  calculator: true,
  checklist: [
    { id: "m-tib", group: "Qualify on the call", label: "12+ months in business", hard: true, why: "Both funders require 12 months. Under 6 is an automatic decline at Bitty." },
    { id: "m-fico", group: "Qualify on the call", label: "FICO 500+, no open bankruptcy", hard: true, why: "500 is the floor at both. Below 550 at Bitty means the Access tier and 8% to us instead of 12%." },
    { id: "m-rev", group: "Qualify on the call", label: "Revenue — $5,000/mo for Bitty, $10,000/mo for True Advance", hard: true, why: "True Advance needs double. Check which funder the file is actually going to." },
    { id: "m-state", group: "Qualify on the call", label: "Merchant is NOT in Texas or North Dakota", hard: true, why: "True Advance excludes both. With Bitty offline, those two states have no Micro rail at all." },
    { id: "m-pos", group: "Qualify on the call", label: "5 or fewer open positions", hard: true, why: "True Advance caps at 5. Bitty's position limit is unrecorded — ask before you promise." },
    { id: "m-ind", group: "Qualify on the call", label: "Industry is not on Bitty's 14-item prohibited list", hard: true, why: "Check the Bitty tab's industry lookup. True Advance's exclusions are unrecorded." },
    { id: "m-neg", group: "Qualify on the call", label: "Under 19 negative days across the last 3 months", hard: true, why: "Automatic decline at Bitty. Verify in the statements, not just by asking." },
    { id: "m-app", group: "Collect", label: "Signed application — legal name, DBA, EIN, entity type, state", hard: true, why: "Bitty's decision is automatic and keyed to application accuracy. A sloppy app is a slow one." },
    { id: "m-stmt", group: "Collect", label: "3 months of business bank statements", hard: true, why: "3 is True Advance's stated requirement. Bitty names no count anywhere — have a 4th ready." },
    { id: "m-chk", group: "Collect", label: "Business checking account confirmed", hard: true, why: "Bitty requires it on every file. A personal account does not substitute." },
    { id: "m-sos", group: "Collect", label: "Secretary of State active and in good standing", hard: true, why: "Named explicitly by Bitty. Check it yourself — a lapsed registration is a silent decline." },
    { id: "m-web", group: "Collect", label: "Business location or website — home-based needs an online presence", hard: true, why: "A Bitty requirement. Find the online footprint before you submit." },
    { id: "m-ucc", group: "Collect", label: "No unresolved cash-advance UCCs or funding judgments", hard: true, why: "“Unresolved” is the operative word — a paid-off advance still needs a termination letter, and that takes days." },
    { id: "m-own", group: "Collect", label: "Owner name, DOB, SSN, home address, ownership %", hard: true },
    { id: "m-cell", group: "Collect", label: "Owner's mobile is correct and they will answer a text after signing", why: "Bitty auto-texts an ID verification link after signing. Do not chase a photo ID; confirm the cell." },
    { id: "m-price", group: "Before you submit", label: "You know the sell rate you intend to quote", hard: true, why: "At Bitty the spread IS the commission. Submit without a sell rate in mind and a funded deal can pay us nothing." },
    { id: "m-5day", group: "Before you submit", label: "Merchant can sign within 5 days of approval", hard: true, why: "Bitty's funding window. After five days another agent who closes it takes the commission." },
  ],
  openQuestions: [
    "Get the Bitty agreement executed — nobody has signed it, so nothing on this line is contractual.",
    "Verify True Advance's counter-signature; the certificate we hold covers a different document.",
    "Ask Bitty how many months of statements they actually want.",
    "Ask both funders their maximum position count.",
  ],
};

// ── 2 ── MCA ─────────────────────────────────────────────────────────────────
const MCA: ProductLine = {
  id: "mca",
  tab: "MCA",
  name: "Momentum Working Capital",
  vocab: "advance",
  range: "$10,000 – $300,000",
  tagline: "The core advance. A direct funder first, a marketplace behind it.",
  whoFor:
    "The standard merchant: trading at least 3–6 months, $4,000/mo and up, who needs working capital in days rather than weeks.",
  warning: {
    tone: "warn",
    title: "Order of submission matters more on this line than any other",
    body:
      "1 West shops a file across 45–50 partners at once. Once they have, those partners have all seen it — their own decline on a clean $127K/mo merchant read “ineligible due to recent decline.” Send to LCF FIRST. Nobody has confirmed whether LCF sits inside 1 West's partner network, and if it does, leading with 1 West burns your best funder.",
  },
  primary: {
    role: "Primary",
    name: "The LCF Group / Reliant Funding",
    lenderId: "60cba11b-bf10-435d-b041-9feb3aa894bb",
    liveToday: true,
    liveNote: "Live vendor, recipe ACTIVE on both entities. Can submit today.",
    routes: [
      { kind: "email", value: "submissions@thelcfgroup.com", note: "LCF entity — $25K minimum, 3mo TIB" },
      { kind: "email", value: "submissions@reliantfunding.com", note: "Reliant entity — $10K minimum, 6mo TIB, 6–10 pts recorded" },
    ],
    box: [
      { k: "Funding", v: "$10,000 – $300,000 (Reliant) · $25,000 – $300,000 (LCF)" },
      { k: "Time in business", v: "6 months (Reliant) · 3 months (LCF)" },
      { k: "Revenue", v: "$4,000/mo (Reliant) — the LOWEST floor in our whole network · $6,000/mo (LCF)" },
      { k: "Statements", v: "3 months, plus a signed application" },
      { k: "Credit", v: "NO FICO FLOOR RECORDED on either entity", missing: true },
      { k: "Max positions", v: "not recorded — critical gap for an MCA line", missing: true },
      { k: "NSF / negative days", v: "not recorded", missing: true },
      { k: "Excluded states / industries", v: "not recorded", missing: true },
    ],
    pricing: [
      { k: "Factor", v: "from 1.20 (Reliant)" },
      { k: "Term", v: "2 – 24 months daily or weekly (Reliant) · ~30 – 120 fixed daily payments (LCF)" },
      { k: "Fees", v: "Origination approx 3–10% deducted — INFERRED from observed deals, not published" },
      { k: "Speed", v: "80% approved in under 2 hours; approval in as little as 30 minutes; same-day funding available" },
    ],
    pay: {
      headline: "6 – 10 points",
      basis: "A spread — contract factor rate minus the quoted buy rate, on the funded amount — plus a volume bonus at LCF's discretion. Recorded on the Reliant row; the LCF row has no commission recorded at all.",
      timing: "CONTRADICTORY INSIDE ONE SIGNED DOCUMENT — Schedule A says ACH within 5 business days of funding, section 2 says 30 business days after LCF receives the executed Merchant Agreement, and Schedule A states the Agreement prevails.",
    },
    agreement: {
      state: "one_sided",
      note: "ISO Agent Sales Agreement signed by Dr. Ernesto Lee 7/2/2026. The LCF Group, Inc. column — By, Name, Title, Date — is entirely blank, and the DocuSign certificate lists exactly one signer, with Kurt Maimaron and Lisnet Rodriguez as Carbon Copy only.",
    },
    track:
      "2 submissions, 2 replies, ZERO declines ever — and the only approval we have ever received: MF-2026-0196 Titan Event Consultants, $30,000, approved in 5 hours 25 minutes on 2026-09-11. No contract was requested and the deal is now in nurture.",
    evidence: [
      "LCF ISO Agent Sales Agreement (signed our side only) — commission spread, clawback, non-interference",
      "lender_programs rows for both entities — ranges, TIB, revenue, term, speed",
      "funder_replies on MF-2026-0196 — the approval and five chase emails, verbatim",
    ],
    gaps: [
      "NO FICO floor on either entity",
      "NO max position count — you cannot safely price a stacked merchant",
      "Which entity papers a given deal: LCF or Reliant? Two inboxes, two boxes, two commission states",
      "Commission timing contradicts itself inside the signed agreement",
      "Origination fee is inferred from observed deals, never published to us",
      "Counter-signature missing",
    ],
    contacts: [
      { name: "Kajal Das Gupta", title: "Partner Relationship Manager", email: "kgupta@thelcfgroup.com", phone: "888-499-2939 x312" },
      { name: "Kurt Maimaron", email: "kmaimaron@thelcfgroup.com", phone: "866-604-4519" },
      { name: "Curt", title: "cell / text", phone: "363-777-4328" },
    ],
  },
  secondary: {
    role: "Secondary",
    name: "1 West",
    lenderId: "e5e606c8-55dd-4490-9030-69214179a88b",
    liveToday: true,
    liveNote: "Live vendor, recipe ACTIVE, delivery proven (5 sends, 5 replies). Can submit today.",
    routes: [
      { kind: "email", value: "partnersubs@1west.com", note: "Brokered route — application + LAST 4 MONTHS of statements" },
      { kind: "selfserve", value: "https://apply.1west.com/?iso=a10PZ00000socCfYAI", note: "Send this to the merchant directly — our ISO code is embedded in the link" },
    ],
    box: [
      { k: "Funding", v: "$2,500 – $2,000,000 short-term" },
      { k: "Time in business", v: "3 months absolute floor · 1 year for the ABLE marketplace" },
      { k: "Credit", v: "0 published on the Starter band · 550 ABLE minimum — treat both as soft" },
      { k: "Revenue", v: "$10,000/mo FAQ floor · $100,000 annual gross for ABLE" },
      { k: "Bank balance", v: "$500 → $5,000 average daily, by band" },
      { k: "Statements", v: "4 months on the brokered route (their FAQ says 3 — send 4)" },
      { k: "States", v: "UNKNOWN — no state list exists in any document or on their site", missing: true },
      { k: "Max positions", v: "not recorded", missing: true },
    ],
    pricing: [
      { k: "Short-term", v: "3 – 24 months, daily or weekly, funds in 24–72 hours" },
      { k: "Decision", v: "24 hours or less" },
    ],
    pay: {
      headline: "25% of 1 West's compensation — contested",
      basis: "A share of THEIR revenue, which we never see, so our commission on a 1 West file is unpredictable by construction. The signed 07/24/2026 copy says 25% new and 25% renewal with no broker-vs-refer split; the earlier copy says 50%/50%; our own record claims broker 50% / refer 25%.",
      timing: "Within 30 calendar days of 1 West receiving its compensation.",
    },
    agreement: {
      state: "one_sided",
      note: "Both copies signed by Dr. Ernesto Lee only; Kunal Bhasin's block is blank on both, and the PandaDoc certificate lists a single signer. NO clawback clause and NO non-circumvention clause in either — a genuine advantage.",
    },
    track: "5 submissions, 5 declines, zero funded. Three came back on one day marked “Declined from Ondeck.”",
    evidence: [
      "1 West Product Overview.pdf — ABLE minimum and preferred qualifications",
      "1 West PowerPoint Presentation.pdf (15pp) — the four Funding Program bands",
      "ISO Application With W9_ACH.pdf, signed 07/24/2026 — the 25% language, verbatim",
      "Partner-welcome email 2026-07-25 — both submission routes, 4-month statement rule",
    ],
    gaps: [
      "Commission is 25% or 50% depending which document you read — unresolved",
      "State coverage genuinely unknown; it is whatever the matched partner covers",
      "No portal login exists — the credential row is empty",
      "Our MCA program row claims 1 month TIB, which no document supports. Ignore it.",
    ],
    contacts: [
      { name: "Michael Bernier", title: "VP Business Development", email: "mike@1west.com", phone: "(516) 272-2110" },
      { name: "Ria Khan", title: "Funding Specialist", email: "ria.khan@1west.com", phone: "(956) 818-8335" },
    ],
  },
  checklist: [
    { id: "w-shopped", group: "Ask FIRST", label: "You have asked who else already has this merchant's file", hard: true, why: "The highest-value question on this line. If 1 West has shopped them, their whole partner pool has seen it." },
    { id: "w-which", group: "Ask FIRST", label: "You know whether this is an LCF file or a Reliant file", hard: true, why: "Different inbox, different minimum ($25K vs $10K), different TIB (3mo vs 6mo), different recorded commission." },
    { id: "w-tib", group: "Qualify", label: "3 months trading for LCF, 6 for Reliant", hard: true },
    { id: "w-rev", group: "Qualify", label: "Revenue clears $4,000/mo (Reliant) or $6,000/mo (LCF)", hard: true, why: "Reliant's $4,000 floor is the lowest we have anywhere — this is the line for a thin-revenue merchant." },
    { id: "w-fico", group: "Qualify", label: "Ask the owner's FICO and record it", hard: true, why: "We hold NO FICO floor for either entity. You are flying blind until someone asks Kajal." },
    { id: "w-pos", group: "Qualify", label: "Count the open positions and ask before promising", hard: true, why: "LCF's maximum is unrecorded. Do not tell a stacked merchant they qualify." },
    { id: "w-app", group: "Collect", label: "Signed application", hard: true },
    { id: "w-stmt", group: "Collect", label: "Bank statements — 3 months for LCF, 4 months for 1 West", hard: true, why: "Different counts. Collect 4 and you satisfy both." },
    { id: "w-own", group: "Collect", label: "Owner details including SSN", hard: true, why: "LCF asked for exactly this 51 minutes into the Titan file, instead of declining." },
    { id: "w-consent", group: "Before you submit", label: "If routing to 1 West, the merchant consents to onward sharing", hard: true, why: "Required by our referral agreement, and not boilerplate — the file goes to dozens of third parties." },
    { id: "w-respond", group: "AFTER you submit", label: "Somebody owns the reply and will act on an approval the same day", hard: true, why: "LCF approved a file in 5h25m and chased us five times over four days. Nobody requested the contract. Do not repeat it." },
  ],
  openQuestions: [
    "Is LCF inside 1 West's partner network? Decides submission order on every file.",
    "LCF's FICO floor and maximum position count — both unrecorded.",
    "Which entity papers the deal, LCF or Reliant?",
    "Commission timing: 5 business days or 30? The signed agreement says both.",
    "1 West: 25% or 50%? One email to Michael Bernier settles it.",
  ],
};

// ── 3 ── TERM & LINE OF CREDIT ───────────────────────────────────────────────
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
    title: "Both funders are live — and neither has counter-signed anything",
    body:
      "You can submit to UCS and GoKapital today; both recipes are active. But UCS's ISO agreement is signed on our side only, and GoKapital has no ISO agreement on file at all. That affects getting PAID, not getting a file in. Also note UCS's line-of-credit commission is 1–3% ON THE INITIAL DRAW ONLY — there is no residual on later draws.",
  },
  primary: {
    role: "Primary",
    name: "United Capital Source",
    lenderId: "f73a9f64-d776-47a4-a0ac-b0a25a559faa",
    liveToday: true,
    liveNote: "Live vendor, recipe ACTIVE. Can submit today.",
    routes: [{ kind: "email", value: "isosubmissions@unitedcapitalsource.com" }],
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
    agreement: {
      state: "one_sided",
      note: "Signed by Dr. Ernesto Lee; the United Capital Source line above “Jared Weitz / Chief Executive Officer” is BLANK. Carries an ACTIVE-STATUS quota of two merchants a month that “receive cash advances” — which on its face may not count term-loan volume — plus a 30-day referral fuse and 24-month non-interference.",
    },
    track: "1 submission ever — an MCA, MF-2026-0013 Brideau Insurance, declined 2026-07-09. Zero term files have ever been sent.",
    evidence: [
      "UCS ISO Compensation.pdf, Schedule A Rev 04-2018 — the per-product commission grid",
      "UCS ISO Agreement (signed our side only) — quota, referral fuse, non-interference",
      "lender_programs — five product rows: term, LOC, MCA, SBA, equipment",
    ],
    gaps: [
      "Counter-signature missing — this is the blocker for the whole line",
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
    lenderId: "",
    liveToday: true,
    liveNote: "Live vendor, recipe ACTIVE, five product rows. Can submit today.",
    routes: [{ kind: "email", value: "deals@gokapital.com" }],
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
    agreement: {
      state: "none",
      note: "NO ISO agreement exists on file. All eight documents filed under “agreement” are brochures and forms. Its apparent cleanliness is ignorance, not safety.",
    },
    track: "1 submission (July 2026). It reached a decision, which is more than most.",
    evidence: [
      "GoKapital Broker Referral Agreement, Exhibit A — the published commission grid",
      "lender_programs — five product rows with full credit boxes",
    ],
    gaps: [
      "No ISO agreement of any kind on file",
      "Commission payment timing unrecorded",
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
    "Get Jared Weitz's counter-signature on the UCS agreement.",
    "Ask UCS whether term-loan volume counts toward ACTIVE status, or only cash advances.",
    "Ask UCS whether the 30-day referral fuse applies to term files.",
    "Get any ISO agreement at all from GoKapital.",
    "Read UCS's and GoKapital's brand clauses before printing anything Momentum-branded.",
  ],
};

export const LINES: ProductLine[] = [MICRO, MCA, TERM];
