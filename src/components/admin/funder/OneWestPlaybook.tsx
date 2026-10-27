// ─────────────────────────────────────────────────────────────────────────────
// 1 West — funder playbook
//
// 1 West is the breadth hub: one application routed across 45–50+ partner
// funders through their ABLE engine, covering products we have no direct
// coverage for (SBA, CRE, AR, equipment).
//
// The thing this tab has to get across, above every number on it, is that
// 1 West IS NOT A FUNDER. They are a marketplace — legally JayDee Ventures,
// LLC d/b/a 1WEST Finance. Three consequences fall out of that and all three
// are on this page: their "credit box" is three different published floors
// that must never be collapsed into one; a decline from them is a decline
// from a POOL, not from a desk; and the state coverage is whatever the
// partner who takes the file covers, which is nowhere written down.
//
// Three documents on file give three different commission numbers. This tab
// shows all three rather than picking, because the one our closers have been
// working from is the one the signed copy contradicts.
// ─────────────────────────────────────────────────────────────────────────────
import { Alert, type CheckItem, Checklist, Quote, Rows, Sec } from "./playbook";

const BANDS = [
  { tib: "3 months", cls: "t4", fico: "0", min: "$3,000", max: "$50,000", adb: "$500", prog: "2–4 mo" },
  { tib: "1 year", cls: "t3", fico: "500", min: "$5,000", max: "$300,000", adb: "$1,000", prog: "4–9 mo" },
  { tib: "2 years", cls: "t2", fico: "600", min: "$10,000", max: "$500,000", adb: "$2,000", prog: "6–8 mo" },
  { tib: "3 years", cls: "t1", fico: "650", min: "$10,000", max: "$500,000", adb: "$5,000", prog: "10–15 mo" },
];

const PRODUCTS: { n: string; amt: string; detail: string }[] = [
  { n: "Short-term financing", amt: "$2,500 – $2,000,000", detail: "Funds in 24–72 hours · 3–24 month term · daily or weekly" },
  { n: "Term loan", amt: "$5,000 – $1,500,000", detail: "Up to 24 months · from 14 cents on the dollar · 2.5–5% origination" },
  { n: "Line of credit", amt: "$10,000 – $250,000", detail: "Revolving · weekly or monthly · from 7 cents on the dollar · 2–4% draw fee" },
  { n: "Medium-term", amt: "$25,000 – $1,000,000", detail: "Funds in 3–7 days" },
  { n: "SBA", amt: "$25,000 – $10,000,000", detail: "3–4 weeks — the slow lane, plan the merchant's expectations" },
  { n: "Equipment financing", amt: "$5,000 – $2,000,000", detail: "" },
  { n: "Invoice / AR financing", amt: "$5,000 – $10,000,000", detail: "" },
  { n: "Asset-based", amt: "$3,000 – $10,000,000", detail: "" },
  { n: "Medical", amt: "$5,000 – $1,000,000", detail: "" },
  { n: "Premier Plus", amt: "$25K–$500K unsecured · $500K–$5M secured", detail: "Rates from 8.99% APR" },
];

const CHECK: CheckItem[] = [
  {
    id: "w-shopped",
    group: "Ask this FIRST — it is the question that kills 1 West files",
    label: "You have asked the merchant who else already has their file",
    hard: true,
    why: (
      <>
        <b>This is the single most valuable question on the page.</b> 1 West routes to 45–50+ partners. If someone
        shopped this merchant last month, 1 West comes back “ineligible due to recent decline” and you have burned
        a submission on a file they never underwrote. It has already happened to a merchant doing $127,740/mo with
        zero open positions.
      </>
    ),
  },
  {
    id: "w-direct",
    group: "Ask this FIRST — it is the question that kills 1 West files",
    label: "You have confirmed no direct funder of ours is a better first stop",
    hard: true,
    why: <>Going to 1 West first draws on their whole partner pool at once. Spend a direct funder's look before you spend the marketplace's.</>,
  },
  {
    id: "w-startup",
    group: "Ask this FIRST — it is the question that kills 1 West files",
    label: "The business is not a startup, and has at least 3 months of trading history",
    hard: true,
    why: <>Their published FAQ floor is 3 months in business and <b>$10,000/mo revenue</b>, and says startups are referred out, not funded. Below 1 year you are confined to the Starter band — max $50,000.</>,
  },

  {
    id: "w-app",
    group: "The application",
    label: "Completed 1 West application — legal name, DBA, EIN, entity type, address",
    hard: true,
  },
  {
    id: "w-product",
    group: "The application",
    label: "You know which PRODUCT you are asking for",
    hard: true,
    why: <>They run ten. An unspecified “working capital” request gets routed to the short-term desk by default, which is the most expensive money on their shelf and may not be what the merchant needs.</>,
  },
  {
    id: "w-amt",
    group: "The application",
    label: "Amount requested fits the band the merchant's time in business allows",
    hard: true,
    why: <>Check the band grid in section 3. A 10-month-old business asking $200,000 is a decline before anyone reads the statements.</>,
  },

  {
    id: "w-stmt",
    group: "Bank and financials",
    label: "Last 4 months of business bank statements",
    hard: true,
    why: (
      <>
        <b>Four, not three.</b> Their partner-welcome email specifies the last 4 months for the brokered path,
        while their public FAQ says 3. Send four — the extra month is free and a short file bounces.
      </>
    ),
  },
  {
    id: "w-adb",
    group: "Bank and financials",
    label: "Average daily balance clears the band you are targeting",
    hard: true,
    why: <>$500 Starter · $1,000 at 1 year · $2,000 at 2 years · $5,000 at 3 years. ADB is a published requirement here, which is unusual — most funders only imply it.</>,
  },
  {
    id: "w-rev",
    group: "Bank and financials",
    label: "Revenue clears $10,000/mo (FAQ floor) — or $100,000 annual gross for the ABLE marketplace",
    hard: true,
    why: <>Two different published floors for two different routes. Know which one you are relying on.</>,
  },
  {
    id: "w-fico",
    group: "Owner",
    label: "Owner FICO — and do not trust the published 0 floor",
    hard: true,
    why: (
      <>
        The deck prints a FICO floor of <b>0</b> on the Starter band, and the ABLE minimum is <b>550</b>. We have a
        real decline from them reading simply <b>“Declined Reasons- Credit score.”</b> The published floor does not
        bind.
      </>
    ),
  },
  {
    id: "w-owner",
    group: "Owner",
    label: "Owner name, DOB, SSN, home address, ownership %",
    hard: true,
  },
  {
    id: "w-consent",
    group: "Before you hit submit — our gates, not theirs",
    label: "The merchant has consented to their information being shared onward",
    hard: true,
    why: (
      <>
        Our signed referral agreement requires it, and it is not boilerplate here: 1 West will pass this file to
        dozens of third-party funders. The merchant should know that.
      </>
    ),
  },
  {
    id: "w-route",
    group: "Before you hit submit — our gates, not theirs",
    label: "You are using the BROKERED route, not the self-serve link",
    hard: true,
    why: (
      <>
        Email the package to <b>partnersubs@1west.com</b>. Our record says brokering pays double what the self-serve
        link pays — though see the commission conflict in section 1 before you quote anyone a number.
      </>
    ),
  },
  {
    id: "w-nofee",
    group: "Before you hit submit — our gates, not theirs",
    label: "No fee of any kind has been charged to the merchant",
    hard: true,
    why: <>Expressly prohibited by our referral agreement with them, and by our own compliance rule. We are paid by the funder, never by the merchant.</>,
  },
];

export function OneWestPlaybook() {
  return (
    <>
      <div className="fp-head">
        <div>
          <h2>1 West</h2>
          <p className="fp-role">
            Our <b>breadth hub</b>. One application routed across 45–50+ partner funders through their ABLE engine —
            the way we reach SBA, CRE, equipment and receivables financing without holding a direct relationship for
            each.
          </p>
          <div className="fp-idchips">
            <span className="fp-idchip">Marketplace, not a funder</span>
            <span className="fp-idchip">10 products</span>
            <span className="fp-idchip">3 mo TIB floor</span>
            <span className="fp-idchip">4 months of statements</span>
            <span className="fp-idchip">Decision in 24 hrs</span>
          </div>
        </div>
      </div>

      {/* ── 1. what they are + the conflicts ── */}
      <Sec n={1} title="What you are actually submitting to" sub="get this wrong and the rest of the page misleads you">
        <Alert tone="info" title="1 West is a marketplace. They do not underwrite and they do not fund.">
          <p>
            Legal entity <b>JayDee Ventures, LLC d/b/a 1WEST Finance</b>. They take one application and route it
            across their partner network. Three things follow, and every one of them matters on a live file:
          </p>
          <p>
            • <b>A decline is a decline from a pool</b>, not from a desk. Three of our five files came back the same
            day marked “Declined from OnDeck.” They surface the partner's answer as their own.
          </p>
          <p>
            • <b>State coverage is unknown.</b> Their materials say “nationwide” and “a vast national lender
            network” and name no states anywhere — not on the site, not in any of the four documents we hold, not in
            the signed agreement. Coverage is whatever the partner who takes the file covers. Treat it as unknown,
            never as unrestricted.
          </p>
          <p>
            • <b>Their published floors do not bind</b>, because the partner's floors are the real ones.
          </p>
        </Alert>

        <Alert tone="stop" title="Three documents give three different commission numbers — and the signed one is the worst">
          <p>
            <b>What our record tells closers today:</b> brokering a deal pays <b>50%</b> of 1 West's compensation,
            the self-serve referral link pays <b>25%</b>.
          </p>
          <p>
            <b>What the later, signed copy says</b> — ISO Application With W9/ACH, executed by Dr. Ernesto Lee on
            07/24/2026:
          </p>
          <Quote
            text="Within thirty (30) calendar days of 1WEST (or its affiliate) receiving compensation in regards to a Referred Customer, 1WEST shall pay to Client an amount equal to: (i) 25% of the said compensation for each new business financing a Partner Referral receives and 25% for each renewal…"
            cite="ISO Application With W9_ACH.pdf, §3 — signed 07/24/2026"
          />
          <p>
            <b>25% flat, new and renewal, with no broker-versus-refer split at all.</b> The earlier{" "}
            <i>ISO Application V1</i> from 07/06/2026 says 50%/50%. So the figure our team has been working from is
            contradicted by the more recent signed document, and the brokering premium that justifies chasing stips
            ourselves may not exist.
          </p>
          <p>
            <b>Neither 1 West copy is counter-signed</b> — Kunal Bhasin's signature and date are blank on both. This
            needs one email to Michael Bernier before anybody quotes a split to a closer.
          </p>
        </Alert>

        <Alert tone="warn" title="And remember what the percentage is OF">
          <p>
            25% or 50%, it is a share of <b>1 West's own compensation</b> — not points on the funded amount. We do
            not see their side of the deal, so we cannot predict our own commission on a 1 West file the way we can
            on a direct one. That is the real cost of breadth.
          </p>
        </Alert>
      </Sec>

      {/* ── 2. track record ── */}
      <Sec n={2} title="Our track record with them" sub="five files, and you should know how they went">
        <div className="fp-panel">
          <div className="fp-math">
            <div className="fp-mcell">
              <div className="fp-mk2">Files sent</div>
              <div className="fp-mv">5</div>
              <div className="fp-mn">Aug 11 – Sep 30, 2026</div>
            </div>
            <div className="fp-mcell">
              <div className="fp-mk2">Declined</div>
              <div className="fp-mv">5</div>
              <div className="fp-mn">Every one of them</div>
            </div>
            <div className="fp-mcell">
              <div className="fp-mk2">Approved</div>
              <div className="fp-mv">0</div>
              <div className="fp-mn">No offer has ever come back</div>
            </div>
            <div className="fp-mcell">
              <div className="fp-mk2">Funded</div>
              <div className="fp-mv">0</div>
              <div className="fp-mn">No commission has ever been earned</div>
            </div>
          </div>
        </div>
        <Alert tone="warn" title="Read the five declines, not just the count">
          <p>
            <b>Aug 11, three files in one day</b> — America's Everyday Gourmet, Bay Finish Construction, High
            Performnce GC — all three came back “Declined from OnDeck,” no reason given. Three files, one partner's
            answer, same day.
          </p>
          <p>
            <b>Sep 11, Titan Event Consultants</b> — “Declined Reasons- Credit score.”
          </p>
          <p>
            <b>Sep 30, EZ Lawn Synthetic Turf</b> — “Ineligible due to recent decline.” This merchant was doing{" "}
            <b>$127,740/mo bank-verified with zero open positions</b>. Nothing was wrong with the file. Somebody
            else had simply shopped them first.
          </p>
          <p>
            Delivery itself is proven — all five sends to <b>partnersubs@1west.com</b> drew a reply. The channel
            works. The results have not.
          </p>
        </Alert>
      </Sec>

      {/* ── 3. the three boxes ── */}
      <Sec n={3} title="The credit box is three different boxes" sub="never collapse them into one">
        <div className="fp-sechead" style={{ marginTop: 4 }}>
          <span className="fp-sub">
            <b>A. Funding Program bands</b> — from their partner deck. Short-term advance money, graded by time in
            business.
          </span>
        </div>
        <div className="fp-panel">
          <div className="fp-tiers">
            {BANDS.map((b) => (
              <div className={`fp-tier ${b.cls}`} key={b.tib}>
                <div className="fp-tname">
                  <span className="fp-stripe" />
                  {b.tib} in business
                </div>
                <dl>
                  <dt>Min FICO</dt>
                  <dd>{b.fico}</dd>
                  <dt>Advance</dt>
                  <dd>
                    {b.min}–{b.max}
                  </dd>
                  <dt>Avg daily bal</dt>
                  <dd className="fp-hi">{b.adb}</dd>
                  <dt>Program</dt>
                  <dd>{b.prog}</dd>
                </dl>
              </div>
            ))}
          </div>
        </div>

        <div className="fp-sechead" style={{ marginTop: 18 }}>
          <span className="fp-sub">
            <b>B. ABLE marketplace qualifications</b> — a different document, different numbers, for the broader
            product set.
          </span>
        </div>
        <Rows
          items={[
            {
              k: "Minimum borrower",
              v: <>$100,000 annual gross revenue · <b>1 year</b> in business · <b>550</b> FICO · $1,000 average daily balance</>,
            },
            {
              k: "Middle band",
              v: <>$250,000+ AGR · 2 years · 650 FICO · $2,500 ADB — the standard term loan and line of credit</>,
            },
            {
              k: "Preferred borrower",
              v: <>$500,000+ AGR · <b>5+ years</b> · <b>700+</b> FICO · $5,000+ ADB — best pricing on their shelf</>,
            },
            {
              k: "Published FAQ floor",
              v: <>3 months in business · $10,000/mo revenue · 3 most recent bank statements · <b>startups are referred out, not funded</b></>,
            },
            {
              k: "Where they disagree",
              v: (
                <>
                  The deck's absolute floor is <b>3 months TIB and no FICO minimum</b>; the ABLE sheet's is{" "}
                  <b>1 year and 550</b>. Both are published, neither is wrong — they describe{" "}
                  <b>different routes through the same company</b>. Quote the one that matches the product you are
                  asking for, and say which.
                </>
              ),
            },
          ]}
        />
      </Sec>

      {/* ── 4. products ── */}
      <Sec n={4} title="What you can ask them for" sub="ten products — this is the reason we use them">
        <div className="fp-panel">
          <div className="fp-rows">
            {PRODUCTS.map((p) => (
              <PRow key={p.n} n={p.n} amt={p.amt} detail={p.detail} />
            ))}
          </div>
        </div>
        <div className="fp-foot">
          One conflict worth knowing: the Product Overview puts the line of credit at <b>$10K–$250K</b> while the
          partner deck quotes <b>$5K–$500K</b>. Use the narrower figure on a call. <b>No prepayment penalty</b> is
          stated across their material.
        </div>
      </Sec>

      {/* ── 5. how it goes out ── */}
      <Sec n={5} title="How the file physically goes out" sub="two routes, and they pay differently">
        <Rows
          items={[
            {
              k: "Route 1 — broker",
              v: (
                <>
                  Collect the application plus the <b>last 4 months</b> of business bank statements and email them
                  to <b>partnersubs@1west.com</b>. Ria Khan's team processes it. <b>This is the default.</b>
                  <Quote
                    text="You can collect an application from the client along with their last 4 months of business bank statements and email those items over to partnersubs@1west.com for my team to process."
                    cite="1 West partner-welcome email, 2026-07-25"
                  />
                </>
              ),
            },
            {
              k: "Route 2 — self-serve",
              v: (
                <>
                  Send the merchant our ISO-coded link and they apply and upload statements themselves:{" "}
                  <b>apply.1west.com/?iso=a10PZ00000socCfYAI</b>. The fallback for a file we cannot work ourselves.
                  Our record says it pays half what brokering pays — see section 1.
                </>
              ),
            },
            {
              k: "Delivery is proven",
              v: <>5 of 5 sends to partnersubs@1west.com drew a reply. The address works; it was last assessed 2026-10-01 and should be re-checked if it ever changes.</>,
            },
            {
              k: "Decision speed",
              v: <>Approval in 24 hours or less. Short-term funds in 24–72 hours; medium-term 3–7 days; <b>SBA 3–4 weeks</b>.</>,
            },
            {
              k: "Relationship contact",
              v: (
                <>
                  <b>Michael Bernier</b>, VP of Business Development — mike@1west.com · (516) 272-2110. Also replies
                  from mike@1westfinance.com.
                </>
              ),
            },
            {
              k: "Submissions contact",
              v: <><b>Ria Khan</b>, Funding Specialist — ria.khan@1west.com · (956) 818-8335. Intake replies also come from Payton Bailey and Pankaj Pandey on the ISO Relations team.</>,
            },
            {
              k: "Address",
              v: <>33 S Wood Ave, Iselin NJ 08830</>,
            },
            {
              k: "Terms we're bound by",
              v: (
                <>
                  Non-exclusive both ways. <b>New York</b> governing law and <b>New York arbitration</b> — note the
                  difference from Bitty's Florida courts. No authority to bind them, no use of their brand without
                  written consent, and <b>we may not charge the merchant a fee</b>.
                </>
              ),
            },
          ]}
        />
      </Sec>

      {/* ── 6. checklist ── */}
      <Sec n={6} title="Submission checklist" sub="walk it top to bottom · ticks are saved in this browser only">
        <Checklist storageKey="mf.playbook.onewest.v1" items={CHECK} />
      </Sec>

      <div className="fp-foot">
        <b>Sources.</b> 1 West PowerPoint Presentation (partner deck, 15 pp) · 1 West Product Overview (ABLE
        qualifications) · ISO Application V1, 07/06/2026 · ISO Application With W9/ACH, signed 07/24/2026 — all four
        on the 1 West funder record · partner-welcome email 07/25/2026 · five real decline replies, Aug–Sep 2026 ·
        1west.com FAQ and partner pages. Where the documents disagree with each other or with our record, both are
        shown rather than resolved. Nothing on this page is a quote to a merchant.
      </div>
    </>
  );
}

function PRow({ n, amt, detail }: { n: string; amt: string; detail: string }) {
  return (
    <>
      <div className="fp-rk">{n}</div>
      <div className="fp-rv">
        <b>{amt}</b>
        {detail ? <> — {detail}</> : null}
      </div>
    </>
  );
}
