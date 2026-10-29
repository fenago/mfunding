// ─────────────────────────────────────────────────────────────────────────────
// Momentum Funding — the product shelf
//
// Five products, two funders, nothing we cannot actually place today. Each
// product is bound to ONE funder and inherits that funder's real credit box,
// because a product line that is not tied to a funder is a brochure: it
// promises things nobody has agreed to fund.
//
// The page is built around one economic fact that should drive every routing
// decision on it — we can PRICE a Bitty deal and we cannot price a 1 West
// deal. Bitty pays us the spread we set, the day the merchant funds. 1 West
// pays a percentage of a number we never see, thirty days after they collect
// it. So Bitty goes first on everything Bitty can take, and 1 West covers
// what Bitty structurally cannot.
//
// VOCABULARY IS LOAD-BEARING HERE and the two must never leak into each
// other. An MCA is a purchase of future receivables and is NEVER called a
// loan — not in a product name, not in a pitch line, not in a stray adjective.
// The term loan and the line of credit ARE credit and use ordinary lending
// words. Each card carries its kind as a chip so the distinction survives
// somebody skimming.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReactNode } from "react";
import { Alert, Rows, Sec } from "./playbook";
import { BittySpreadCalc } from "./BittySpreadCalc";

type Kind = "adv" | "loan" | "spec";

type Product = {
  id: string;
  name: string;
  kind: Kind;
  kindLabel: string;
  range: string;
  via: string;
  box: { k: string; v: string }[];
  terms: { k: string; v: ReactNode }[];
  pitch: ReactNode;
};

const PRODUCTS: Product[] = [
  {
    id: "micro",
    name: "Momentum Micro",
    kind: "adv",
    kindLabel: "Advance · purchase of receivables",
    range: "$2K – $100K",
    via: "Bitty Advance",
    box: [
      { k: "Time in business", v: "12 months" },
      { k: "Credit", v: "500 floor · 675 for best pricing" },
      { k: "Revenue", v: "$5,000/mo · $15,000 for best pricing" },
      { k: "Decision", v: "Automatic" },
    ],
    terms: [
      { k: "Cost to merchant", v: <>Factor <b>1.39 – 1.59</b> over <b>50 – 69 weeks</b>, by tier</> },
      {
        k: "What we earn",
        v: (
          <>
            The spread between Bitty's buy rate and the rate we sell —{" "}
            <b>up to 12% of the funded amount</b> (8% on the weakest tier), <b>paid the day it funds</b>.
          </>
        ),
      },
      { k: "Hard stops", v: <>Under 6 months · open bankruptcy or FICO under 500 · 19+ negative days in 3 months · 14 prohibited industries</> },
    ],
    pitch: (
      <>
        <b>This is the house product.</b> It is the only thing on this shelf whose margin we control and the only one
        that pays the same day. Every merchant who fits it should see it first — including merchants who could also
        qualify for something larger.
      </>
    ),
  },
  {
    id: "wc",
    name: "Momentum Working Capital",
    kind: "adv",
    kindLabel: "Advance · purchase of receivables",
    range: "$100K – $2M",
    via: "1 West (ABLE network)",
    box: [
      { k: "Time in business", v: "1 year typical · 3 months absolute floor" },
      { k: "Credit", v: "550 published · treat as soft" },
      { k: "Revenue", v: "$100K annual gross · $10,000/mo" },
      { k: "Decision", v: "24 hours or less" },
    ],
    terms: [
      { k: "Cost to merchant", v: <>3 – 24 month term, daily or weekly. Funds in <b>24–72 hours</b>.</> },
      {
        k: "What we earn",
        v: (
          <>
            A share of <b>1 West's</b> compensation, which we never see —{" "}
            <b>25% per the signed agreement</b>, 50% per our record. Paid within 30 days of 1 West being paid.
          </>
        ),
      },
      { k: "Hard stops", v: <>Startups are referred out, not funded. A merchant already shopped elsewhere comes back "ineligible due to recent decline".</> },
    ],
    pitch: (
      <>
        Where Bitty's ceiling ends. Do not reach for this under $100K just because the merchant is strong —{" "}
        <b>the same deal is worth several times more to us through Bitty</b>, and it funds faster.
      </>
    ),
  },
  {
    id: "term",
    name: "Momentum Term Loan",
    kind: "loan",
    kindLabel: "Loan · fixed term",
    range: "$5K – $1.5M",
    via: "1 West (ABLE network)",
    box: [
      { k: "Time in business", v: "1 year minimum · 2 years for standard pricing" },
      { k: "Credit", v: "550 minimum · 650 standard · 700+ preferred" },
      { k: "Revenue", v: "$100K AGR minimum · $250K standard · $500K+ preferred" },
      { k: "Bank balance", v: "$1,000 average daily · $2,500 standard" },
    ],
    terms: [
      {
        k: "Cost to borrower",
        v: (
          <>
            Repayment up to <b>24 months</b>, daily or weekly. Priced from <b>14 cents on the dollar</b> with a{" "}
            <b>2.5–5% origination fee</b>. No prepayment penalty.
          </>
        ),
      },
      {
        k: "What we earn",
        v: <>Same 25%-of-their-compensation share as every 1 West product, within 30 days of them collecting.</>,
      },
      { k: "Honest caveat", v: <>Priced as cents-on-the-dollar, not an APR. It is a fixed-term business loan, but it is not bank pricing — set the borrower's expectation on the first call.</> },
    ],
    pitch: (
      <>
        <b>Our one term product, and it is deliberately one.</b> A borrower who wants a loan rather than an advance
        gets this — longer runway, fixed end date, no daily split off receivables.
      </>
    ),
  },
  {
    id: "loc",
    name: "Momentum Line of Credit",
    kind: "loan",
    kindLabel: "Revolving credit",
    range: "$10K – $250K",
    via: "1 West (ABLE network)",
    box: [
      { k: "Time in business", v: "2 years for standard terms" },
      { k: "Credit", v: "650 standard" },
      { k: "Revenue", v: "$250K annual gross" },
      { k: "Bank balance", v: "$2,500 average daily" },
    ],
    terms: [
      { k: "Cost to borrower", v: <>Weekly or monthly payments, up to 24 months. From <b>7 cents on the dollar</b>, <b>2–4% draw fee</b>.</> },
      { k: "What we earn", v: <>The same 1 West share. Note a draw-based product may generate compensation more than once.</> },
      { k: "Range conflict", v: <>Their product sheet says $10K–$250K, their deck says $5K–$500K. Quote the narrower one.</> },
    ],
    pitch: (
      <>
        The right answer for a merchant with <b>lumpy, recurring</b> needs who keeps asking for another advance.
        Cheapest money on the shelf per dollar drawn.
      </>
    ),
  },
  {
    id: "spec",
    name: "Momentum Specialty",
    kind: "spec",
    kindLabel: "Referral lane · not a core product",
    range: "$5K – $10M",
    via: "1 West (ABLE network)",
    box: [
      { k: "SBA", v: "$25K – $10M · 3–4 weeks" },
      { k: "Equipment", v: "$5K – $2M" },
      { k: "Invoice / AR", v: "$5K – $10M" },
      { k: "Asset-based", v: "$3K – $10M" },
    ],
    terms: [
      { k: "What this is", v: <>One bucket, on purpose. We hold no direct relationship and no track record in any of these — we are passing the merchant to 1 West's network and taking a referral share.</> },
      { k: "What we earn", v: <>The same 1 West share, and SBA takes weeks, so the cash is slow twice over.</> },
      { k: "Do not", v: <>Do not build a campaign on these or put them on a landing page as if we underwrite them. Quote ranges, never terms.</> },
    ],
    pitch: (
      <>
        Deliberately <b>one lane and not four products</b>. It exists so a closer has an honest answer for a
        merchant who needs something we do not do, instead of losing the relationship.
      </>
    ),
  },
];

export function ProductShelf() {
  return (
    <>
      <div className="fp-head">
        <div>
          <h2>The Momentum product shelf</h2>
          <p className="fp-role">
            <b>Five products. Two funders. Nothing we cannot place today.</b> Every product below is bound to one
            funder and inherits that funder's real credit box — so what a closer promises is what somebody has
            actually agreed to fund.
          </p>
          <div className="fp-idchips">
            <span className="fp-idchip">2 advance products</span>
            <span className="fp-idchip">2 credit products</span>
            <span className="fp-idchip">1 referral lane</span>
            <span className="fp-idchip">$2K – $10M</span>
          </div>
        </div>
      </div>

      {/* ── 1. the economics that drive routing ── */}
      <Sec n={1} title="The one number that decides where a deal goes" sub="read this before the product cards">
        <Alert tone="good" title="We can price a Bitty deal. We cannot price a 1 West deal.">
          <p>
            <b>Bitty</b> pays us the spread between their buy rate and the rate we set — up to 12% of the funded
            amount — <b>the day the merchant funds</b>. We choose it, and we know it before we submit.
          </p>
          <p>
            <b>1 West</b> pays a percentage of <b>1 West's own compensation</b>, which never appears on anything we
            see, <b>within 30 days of them collecting it</b>. We cannot forecast it, and the percentage itself is
            contested — the signed agreement says 25%, our record says 50%.
          </p>
        </Alert>

        <div className="fp-panel" style={{ marginTop: 12 }}>
          <div className="fp-math">
            <div className="fp-mcell">
              <div className="fp-mk2">$50K through Bitty</div>
              <div className="fp-mv">$6,000</div>
              <div className="fp-mn">12% spread at the cap · same day</div>
            </div>
            <div className="fp-mcell">
              <div className="fp-mk2">$50K through 1 West</div>
              <div className="fp-mv">~$1,000</div>
              <div className="fp-mn">25% of their comp, IF they earn 8 pts · ~30 days</div>
            </div>
            <div className="fp-mcell">
              <div className="fp-mk2">Our house model</div>
              <div className="fp-mv">$4,000</div>
              <div className="fp-mn">8 points on $50K direct</div>
            </div>
          </div>
        </div>
        <div className="fp-foot">
          The middle figure is an <b>illustration, not a quote</b> — 8 points is an assumption about 1 West's own
          take, because we have never seen it. That is exactly the problem. But the direction is not in doubt: on a
          deal both funders could do, <b>Bitty is worth several times more to us and pays weeks sooner</b>. That is
          the whole routing rule, and everything below follows from it.
        </div>
      </Sec>

      {/* ── 2. price it ── */}
      <Sec
        n={2}
        title="Price a Micro deal"
        sub="the only product on this shelf whose margin we choose"
      >
        <BittySpreadCalc />
      </Sec>

      {/* ── 3. the shelf ── */}
      <Sec n={3} title="The five products" sub="each one bound to a single funder">
        {PRODUCTS.map((p) => (
          <div className={`fp-pcard ${p.kind}`} key={p.id}>
            <div className="fp-ptop">
              <div>
                <span className="fp-pname">{p.name}</span>
                <span className="fp-pkind">{p.kindLabel}</span>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="fp-prange">{p.range}</div>
                <div className="fp-pvia">via {p.via}</div>
              </div>
            </div>

            <div className="fp-pgrid">
              {p.box.map((b) => (
                <div className="fp-pline" key={b.k}>
                  <span className="fp-plk">{b.k}</span>
                  {b.v}
                </div>
              ))}
            </div>

            {p.terms.map((t) => (
              <div className="fp-pline" key={t.k}>
                <span className="fp-plk">{t.k}</span>
                {t.v}
              </div>
            ))}

            <div className="fp-pitch">{p.pitch}</div>
          </div>
        ))}
      </Sec>

      {/* ── 3. routing ── */}
      <Sec n={4} title="Which product — the ladder" sub="work it in order, stop at the first yes">
        <div className="fp-panel fp-ladder">
          <div className="fp-rung">
            <span className="fp-rnum" />
            <span>
              <span className="fp-rq">Do they want an advance of $100,000 or less, with 12+ months trading?</span>
              <span className="fp-ra">
                <b>Momentum Micro, through Bitty.</b> Always try here first. Best margin, we set it ourselves, and
                it pays the day it funds.
              </span>
            </span>
          </div>
          <div className="fp-rung">
            <span className="fp-rnum" />
            <span>
              <span className="fp-rq">Over $100,000, or Bitty has already declined it?</span>
              <span className="fp-ra">
                <b>Momentum Working Capital, through 1 West.</b> Ask who else has the file first — see rung 6.
              </span>
            </span>
          </div>
          <div className="fp-rung">
            <span className="fp-rnum" />
            <span>
              <span className="fp-rq">Do they want a loan rather than an advance, and can they wait?</span>
              <span className="fp-ra">
                <b>Momentum Term Loan, through 1 West.</b> Fixed end date, up to 24 months. Needs 1 year trading and
                550 credit at the floor.
              </span>
            </span>
          </div>
          <div className="fp-rung">
            <span className="fp-rnum" />
            <span>
              <span className="fp-rq">Is the need lumpy or recurring rather than one lump sum?</span>
              <span className="fp-ra">
                <b>Momentum Line of Credit, through 1 West.</b> Needs 2 years and 650. Cheapest per dollar drawn —
                and it stops the merchant coming back for a fourth advance.
              </span>
            </span>
          </div>
          <div className="fp-rung">
            <span className="fp-rnum" />
            <span>
              <span className="fp-rq">SBA, equipment, receivables or asset-based?</span>
              <span className="fp-ra">
                <b>Momentum Specialty, through 1 West.</b> Quote the range only. SBA takes 3–4 weeks — say so on the
                first call.
              </span>
            </span>
          </div>
          <div className="fp-rung">
            <span className="fp-rnum" />
            <span>
              <span className="fp-rq">Before ANY 1 West submission — who else already has this file?</span>
              <span className="fp-ra">
                1 West routes to 45–50+ partners at once. A merchant shopped last month comes back{" "}
                <b>"ineligible due to recent decline"</b> and you have burned the whole pool on a file nobody
                underwrote. Ask the merchant. Every time.
              </span>
            </span>
          </div>
          <div className="fp-rung stopr">
            <span className="fp-rnum" />
            <span>
              <span className="fp-rq">Under 3 months trading, a prohibited industry, or an open bankruptcy?</span>
              <span className="fp-ra">
                <b>We have nothing.</b> Say so plainly and put them in nurture with a date. Do not submit to burn a
                look.
              </span>
            </span>
          </div>
        </div>
      </Sec>

      {/* ── 4. language ── */}
      <Sec n={5} title="How each product is allowed to be described" sub="this is a compliance rule, not a style preference">
        <div className="fp-two">
          <div className="fp-gate pass">
            <h4>Micro & Working Capital — never say "loan"</h4>
            <ul>
              <li>
                <span className="fp-mk">✓</span>
                <span>
                  <b>advance · funding · working capital · purchase of future receivables</b>
                  <span className="fp-why">These are purchases of future receivables. They are not loans and must never be called one.</span>
                </span>
              </li>
              <li>
                <span className="fp-mk">✕</span>
                <span>
                  <b>loan · borrow · lend · interest rate · APR · repay</b>
                  <span className="fp-why">Not in ads, SMS, email, scripts or a landing page. Use factor rate, remittance, purchased amount.</span>
                </span>
              </li>
            </ul>
          </div>
          <div className="fp-gate pass">
            <h4>Term Loan & Line of Credit — lending words are correct</h4>
            <ul>
              <li>
                <span className="fp-mk">✓</span>
                <span>
                  <b>loan · borrower · credit · term · draw · origination fee</b>
                  <span className="fp-why">These genuinely are credit products. Ordinary lending language is right and expected.</span>
                </span>
              </li>
              <li>
                <span className="fp-mk">✕</span>
                <span>
                  <b>Do not quote an APR we have not been given</b>
                  <span className="fp-why">1 West prices these in cents on the dollar. Converting that to an APR yourself is inventing a number.</span>
                </span>
              </li>
            </ul>
          </div>
        </div>
        <div className="fp-foot">
          Anything that could apply to several products at once — a landing page, a nurture sequence, an SMS before
          the product is known — uses the neutral set: <b>funding, capital, business financing</b>. State disclosure
          rules differ between advances and loans, so the product has to be known before the disclosure is chosen.
        </div>
      </Sec>

      {/* ── 5. the edges ── */}
      <Sec n={6} title="What this shelf does NOT cover" sub="say it out loud so nobody sells it">
        <Rows
          items={[
            {
              k: "Commercial real estate",
              v: (
                <span className="fp-miss">
                  The public site runs <b>/real-estate</b> pages, and the only rail behind them is 1 West's network
                  — no direct funder, no track record, no recorded terms. Either treat CRE as Specialty and quote
                  nothing, or take the pages down.
                </span>
              ),
            },
            {
              k: "Consolidation / stacked merchants",
              v: <span className="fp-miss">Neither funder is recorded as a consolidator. A merchant with several open positions has no product here today.</span>,
            },
            {
              k: "Startups under 3 months",
              v: <>1 West refers them out rather than funding them, and Bitty auto-declines under 6. No product, and no reason to collect statements.</>,
            },
            {
              k: "Anything over $10M",
              v: <>Off the shelf entirely.</>,
            },
            {
              k: "A direct term-loan relationship",
              v: (
                <>
                  Momentum Term Loan rides 1 West because they are the only term rail we can submit to today. The
                  better-paying alternative — United Capital Source at 10 points on net — has never taken a term
                  file from us, and its activity clause may count only cash advances. Revisit once that is
                  answered.
                </>
              ),
            },
          ]}
        />
      </Sec>

      <div className="fp-foot">
        <b>Sources.</b> Every figure traces to a funder document on the Bitty or 1 West record — Bitty's October
        2026 underwriting guide and Referral Agreement v6, 1 West's Product Overview, partner deck and signed ISO
        applications. The two funder tabs carry the verbatim quotes and the conflicts. Nothing here is a quote to a
        merchant.
      </div>
    </>
  );
}
