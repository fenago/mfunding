// ─────────────────────────────────────────────────────────────────────────────
// Customer-facing one-pagers — the words.
//
// Separated from the template on purpose: the copy is the part that has to be
// reviewed for compliance, and it should be readable without reading any HTML.
//
// RULES BAKED INTO THIS FILE, all of them load-bearing:
//
//  1. VOCABULARY. A line whose product is a merchant cash advance must never
//     say "loan", "borrow", "lend", "interest" or "APR" — an MCA is a purchase
//     of future receivables and calling it a loan is the single compliance
//     mistake that matters most here. `vocab: "advance"` enforces the tone;
//     `vocab: "credit"` is the one line where lending words are correct.
//  2. NO FUNDER IS NAMED, EVER. We market OUR programs. Our agreements
//     restrict merchant-facing use of funder marks and terms, and the merchant
//     has no relationship with the funder until they sign one.
//  3. NO PRICING. No factor rate, no buy rate, no "rates from". Cost triggers
//     state disclosure obligations in ten states we operate in, the real
//     number is set by underwriting anyway, and a range on a poster becomes
//     the number the merchant believes they were promised.
//  4. WHAT DISQUALIFIES THEM IS PRINTED. Every sheet carries a "this probably
//     isn't you" block. It costs a few leads and saves the ones who were going
//     to be declined a week later feeling lied to.
// ─────────────────────────────────────────────────────────────────────────────

export const BRAND = {
  company: "Momentum Funding",
  legal: "Agentic Voice Inc. d/b/a Momentum Funding",
  site: "mfunding.net",
  applyUrl: "https://mfunding.net/apply",
  phone: "(954) 737-5692",
  phoneHref: "tel:+19547375692",
};

/** Appears on every advance sheet, verbatim. */
const ADVANCE_LEGAL =
  "A merchant cash advance is the purchase of a portion of your future receivables. It is not a loan, and nothing here is an offer, an approval or a commitment to fund. " +
  "Momentum Funding is a broker, not a funder — we are paid by the funding company, never by you, and we charge no upfront fees of any kind. " +
  "Your amount, your payment, your total cost and your schedule are set by underwriting and given to you in writing before you sign anything. Any disclosure your state requires on commercial financing is provided with your offer, before you sign.";

const CREDIT_LEGAL =
  "Nothing here is an offer of credit, an approval or a commitment to lend. All amounts, rates, terms and fees are set by the lender's underwriting and are disclosed to you in writing before you sign anything. " +
  "Momentum Funding is a broker, not a lender — we are paid by the lender, never by you, and we charge no upfront fees of any kind. " +
  "Submitting an enquiry to us does not affect your credit score; a formal submission to a lender may. Any disclosure your state requires on commercial financing is provided with your offer, before you sign.";

export const SHEETS = [
  {
    slug: "momentum-micro",
    name: "Momentum Micro",
    vocab: "advance",
    eyebrow: "Small advances · fast decisions",
    headline: "You need five thousand dollars. Everyone you call wants to talk about fifty.",
    standfirst:
      "A minimum deal size can rule you out before anyone looks at your business. This program is built around the amount you actually asked for, not the amount that makes somebody else\u2019s minimum worth their while.",
    isThis: [
      "You need somewhere between $2,000 and $100,000 — the real number, not a rounded-up one",
      "You have been trading at least twelve months",
      "Your revenue is steady rather than spectacular",
      "Somebody has already told you that you are too small to bother with",
    ],
    stats: [
      { k: "How much", v: "$2,000", sub: "to $100,000" },
      { k: "What decides it", v: "Statements", sub: "your bank file, read against a set box — not a weekly credit committee" },
      { k: "What we need", v: "3", sub: "months of business bank statements" },
    ],
    steps: [
      ["Tell us the number", "One call. What you need it for, and what the business brings in."],
      ["Send three months of statements", "Photographed, downloaded or connected straight from your bank. Whichever is easiest."],
      ["Get a decision", "This program reads your statements against a set credit box. There is no committee and no weekly meeting to wait for."],
      ["Money moves", "Once you sign, the funding company sends the money to your business account. We will tell you their timing when you have the offer in front of you."],
    ],
    cost: {
      lead: "You pay us nothing. Ever.",
      body:
        "We are paid by the funding company when your deal funds. There is no application fee, no fee of any kind to us, no retainer and no charge if you decide not to go ahead. Anyone in this industry who asks you for money up front to arrange funding is not doing you a favor.",
    },
    notFor: [
      "You have been open less than twelve months — look at Momentum Gig instead if you are self-employed",
      "You need more than $100,000 — that is Momentum Working Capital",
      "You are already behind on the advances you have — call us before you take another one. That is a different conversation and we would rather have it early",
    ],
    ready: [
      "Three months of business bank statements",
      "Photo ID",
      "A voided check — or just a screenshot of your bank portal",
      "Your EIN",
    ],
    legal: ADVANCE_LEGAL,
  },

  {
    slug: "momentum-working-capital",
    name: "Momentum Working Capital",
    vocab: "advance",
    eyebrow: "Clean books · our strongest profile",
    headline: "Your books are clean. Stop being quoted like they aren't.",
    standfirst:
      "If your deposits are steady and you are not carrying a stack of other advances, this is the program built for you. It is the least expensive capital on our shelf, and what it costs you is set by underwriting and shown to you in writing before you commit to anything.",
    isThis: [
      "You have been trading six months or more",
      "You bank at least $4,000 a month",
      "Your statements do not show collections activity or a debt-settlement debit",
      "You own at least 51% of the business",
    ],
    stats: [
      { k: "How much", v: "$10,000", sub: "to $2,000,000" },
      { k: "What decides it", v: "Deposits", sub: "what lands in the account, not what you invoice" },
      { k: "What we need", v: "3", sub: "months of statements, and a signed application" },
    ],
    steps: [
      ["A real conversation about deposits", "Not revenue — deposits. What lands in the account is what gets underwritten, and knowing the number early stops you being sent down the wrong path."],
      ["Send the file", "Signed application, three months of business bank statements. Four if you have them."],
      ["We place it", "Knowing which funding company wants a business like yours is the whole job. We place it deliberately rather than scattering it."],
      ["Review the offer and decide", "You see the amount, the payment and the total cost in writing. Nothing is signed on a phone call."],
    ],
    cost: {
      lead: "You pay us nothing. Ever.",
      body:
        "We are paid by the funding company when your deal funds. No application fee, no fee of any kind to us, no retainer, no charge if you walk away. What this program costs YOU depends on your statements, and you will be shown it in writing before you commit to anything.",
    },
    notFor: [
      "You have been trading less than six months — look at Momentum Bridge",
      "There is collections activity or a debt-settlement payment in your statements — that does not mean nobody can help, but it does mean a different conversation. Call us",
      "You want a fixed end date and a monthly payment rather than a split of receivables — that is Momentum Term & Line of Credit",
    ],
    ready: [
      "A signed application",
      "Three months of business bank statements — four is better",
      "Photo ID",
      "A voided check, or a screenshot of your bank portal",
    ],
    legal: ADVANCE_LEGAL,
  },

  {
    slug: "momentum-bridge",
    name: "Momentum Bridge",
    vocab: "advance",
    eyebrow: "For the file that does not fit a tidy checklist",
    headline: "Four months in. Two positions already. An NSF last month. Somebody still funds this.",
    standfirst:
      "A thin file is not a dead file. This program exists for the business that is real and trading but does not survive a tidy checklist — and we will tell you honestly what it costs before you decide.",
    isThis: [
      "You have been trading three to eight months",
      "You bank around $5,000 a month or more",
      "You already have one or more advances running",
      "Your statements have some negative days on them and you know it",
    ],
    stats: [
      { k: "How much", v: "$5,100", sub: "to $300,000" },
      { k: "What decides it", v: "The whole file", sub: "positions and negative days included — neither one automatically stops it" },
      { k: "What we need", v: "3–4", sub: "months of statements, depending on your state" },
    ],
    steps: [
      ["Tell us the truth on the first call", "Positions, negative days, anything behind. We can work with all of it. What we cannot work with is finding it in the statements ourselves."],
      ["Send the file", "Signed application and your statements. Some states need a fourth month."],
      ["The funding company prices it", "This program costs more than our clean-books program, because the risk is genuinely higher. We show you the figure before you commit, not after."],
      ["Fund — and then let us look again", "When your statements improve you may fit a less expensive program. We will review it with you then. Nothing is promised."],
    ],
    cost: {
      lead: "You pay us nothing. Ever.",
      body:
        "We are paid by the funding company when your deal funds. No application fee, no retainer, no charge if you say no. This money costs more than our Working Capital program — that is the honest trade for funding a thinner file, and we would rather say it on a poster than in the small print.",
    },
    notFor: [
      "Your books are clean and your deposits are strong — Momentum Working Capital is built for that profile and costs less",
      "You cannot make the payments on what you already have — another advance makes that worse, not better. Call us anyway; there is more than one way to deal with that",
      "You are in Texas or North Dakota — this program is not available there. Call us and we will tell you what we can do",
    ],
    ready: [
      "A signed application",
      "Three months of statements — four in California and New York",
      "Photo ID",
      "A list of every advance you already have running",
    ],
    legal: ADVANCE_LEGAL,
  },

  {
    slug: "momentum-term-and-line-of-credit",
    name: "Momentum Term & Line of Credit",
    vocab: "credit",
    eyebrow: "Real credit · fixed end dates",
    headline: "You don't want a daily debit off your receivables. You want a loan with an end date.",
    standfirst:
      "If you have the time and the numbers to back it up, an advance may not be your best option. A term loan or a revolving line can cost considerably less, depending on your file — it just asks more of you up front.",
    isThis: [
      "You have been trading twelve months or more",
      "You do $25,000 a month or better",
      "Your credit is 575 or above",
      "You can wait days or weeks rather than needing the money this afternoon",
    ],
    stats: [
      { k: "How much", v: "$1,000", sub: "to $10,000,000, depending on the product" },
      { k: "What decides it", v: "Financials", sub: "read by a person, which is why this is not same-week money" },
      { k: "What we need", v: "4", sub: "months of statements, plus financials over $250,000" },
    ],
    steps: [
      ["Pick the shape, not just the amount", "A term loan is a fixed sum with a fixed end date. A line of credit sits there until you draw on it and you pay for what you use. They suit different problems."],
      ["Send a real file", "Signed application and four months of statements. Over $250,000, a year-to-date profit and loss and a balance sheet as well."],
      ["Underwriting takes its time", "This is real credit, so a person reads it. A term loan or a line moves fastest; equipment takes longer; SBA is measured in weeks rather than days, and we will say so on day one rather than at the end."],
      ["Terms in writing, then you decide", "Amount, rate, term, fees and payment, in a document, before anything is signed."],
    ],
    cost: {
      lead: "You pay us nothing. Ever.",
      body:
        "We are paid by the lender when your loan funds. No application fee, no broker fee charged to you, no retainer, no charge if you decline the offer. The rate and any origination fee come from the lender and are disclosed to you in writing before you sign.",
    },
    notFor: [
      "You need the money this week — real credit does not move at that speed. Ask about Momentum Working Capital",
      "You have been trading under a year, or your credit is below 575",
      "You want a personal loan or to borrow against your home — we arrange business funding only, and we will not place consumer credit",
    ],
    ready: [
      "A signed application, dated in the last 30 days",
      "Four months of business bank statements",
      "Year-to-date P&L and balance sheet if you want over $250,000",
      "Photo ID",
    ],
    legal: CREDIT_LEGAL,
  },

  {
    slug: "momentum-gig",
    name: "Momentum Gig",
    vocab: "advance",
    eyebrow: "1099 · self-employed · no EIN needed",
    headline: "Every business funding form asks for an EIN you don't have.",
    standfirst:
      "You drive, deliver, freelance, contract or create. You are a business — the forms just are not built for you. This program is, and it is the only one we have that takes a personal bank account.",
    isThis: [
      "You earn 1099 or self-employed income — not a W-2 paycheck",
      "You have three months of that income behind you",
      "You bring in about $2,500 a month and keep a few thousand in the account",
      "You have no business bank account, and that has stopped you before",
    ],
    stats: [
      { k: "How much", v: "Up to $15,000", sub: "your amount is set by underwriting" },
      { k: "What decides it", v: "Your banking", sub: "the account history itself — there is no credit score test here" },
      { k: "What we need", v: "1", sub: "photo ID — and a bank connection instead of statements" },
    ],
    steps: [
      ["Check you are in a state we serve", "We cannot serve New York, California or Oregon on this program. Everywhere else, carry on."],
      ["Open the application", "It is short, and it is built for someone without a business entity."],
      ["Connect your bank account", "A personal account is fine. The connection gives the funding company what it needs to underwrite you, so there are no statements to dig out."],
      ["Get funded", "Payments come weekly and flex with what you actually earn, which matters when your income does not arrive on the same day every week."],
    ],
    cost: {
      lead: "You pay us nothing. Ever.",
      body:
        "We are paid by the funding company, never by you. No application fee, no retainer, nothing charged for the introduction. Your cost and your payment schedule are shown to you inside the application before you accept anything.",
    },
    notFor: [
      "You are in New York, California or Oregon — we cannot serve this program there",
      "All of your income is W-2 — this program cannot help, and we will not pretend otherwise",
      "You need more than $15,000 to start with",
      "You are ruling yourself out over your credit score. This program is not built around one, so that is unlikely to be the thing that stops you. Nothing here is an approval — underwriting decides",
    ],
    ready: [
      "Your bank login — a personal account is fine",
      "Three months of 1099 or self-employed income behind you",
      "Photo ID",
      "Nothing else. There are no documents to dig out",
    ],
    legal: ADVANCE_LEGAL,
  },

  {
    slug: "momentum-debt-relief",
    name: "Momentum Debt Relief",
    vocab: "relief",
    restricted:
      "NOT FOR PUBLIC DISTRIBUTION. Debt relief is a prohibited content category for A2P 10DLC messaging and our public pages for it were deliberately pulled. This sheet is for handing to a merchant who has come to us, on a call or by email. It must not be published on mfunding.net, linked from the site, or sent by SMS.",
    eyebrow: "When another advance is not the answer",
    headline: "The daily debits are eating the business. Another advance may not be the answer.",
    standfirst:
      "If you are being bled by payments on advances you already have, stacking another one on top can make the pressure worse rather than better. There is a different conversation to have, and being behind does not disqualify you from it — it is the reason to call.",
    isThis: [
      "You have $50,000 or more of existing advances running",
      "Daily or weekly debits are taking money you need for payroll and stock",
      "You have already been declined for more funding, or you know you would be",
      "You are behind, or about to be",
    ],
    stats: [
      { k: "Existing debt", v: "$50,000", sub: "or more, across your current advances" },
      { k: "What changes", v: "The terms", sub: "of what you already owe — not a new advance" },
      { k: "What we need", v: "A list", sub: "of what you owe and to whom, and your statements" },
    ],
    steps: [
      ["Tell us everything you owe", "Every advance, every balance, every daily or weekly debit. We cannot help with the half you leave out."],
      ["We look at whether this is workable", "Sometimes the answer is that it is not, and you deserve to hear that quickly rather than be strung along."],
      ["Your obligations get renegotiated", "This is not new money. Nobody lends you anything. What changes is the terms of what is already there. Sometimes that is workable when new funding is not — whether it is in your case depends on your numbers and on what your existing funding companies agree to."],
      ["You get a payment you can actually make", "That is the aim. It is not a promise, and anyone who promises you an outcome here is selling you something."],
    ],
    // The only sheet where "you pay us nothing, ever" would be FALSE. A
    // programme of this kind has a cost and it is borne by the merchant out
    // of the restructuring. The figure is NOT printed here: our own records
    // disagree about it (the partner agreement and the partner's principal
    // state different numbers), and a disputed number on a merchant-facing
    // sheet is worse than no number. It is disclosed in writing before they
    // agree to anything, which is the honest and the compliant answer.
    cost: {
      lead: "Nothing to find out. A cost if you go ahead.",
      body:
        "Looking at your situation costs you nothing, and we charge nothing to tell you whether it can be helped — including when the answer is that it cannot. Unlike our funding programs, this one does have a cost to you if you enter it, and it comes out of the restructuring rather than out of your pocket up front. You get that cost in full, in writing, before you agree to anything. If anyone asks you for money up front to make debt go away, walk away from them.",
    },
    notFor: [
      "You are current on your payments and simply want cheaper money — that is Momentum Working Capital",
      "You owe less than $50,000 across everything",
      "You are looking for someone to make the debt disappear. That is not what this is, and nobody can do it",
    ],
    ready: [
      "Every advance you have, with the balance on each",
      "Three months of business bank statements",
      "The funding agreements themselves, if you still have them",
      "Photo ID",
    ],
    legal:
      "This is not a loan and not an advance. No new money is provided and nothing is lent to you. Momentum Funding does not provide legal, tax, accounting or credit-repair advice, and nothing here is a guarantee of any particular outcome — results depend on your circumstances and on what your existing funding companies agree to. " +
      "We charge no upfront fee. Any cost is disclosed to you in writing before you enter into anything. Renegotiating obligations may affect your ability to obtain funding in future, and you should take independent advice if you are unsure.",
  },
];
