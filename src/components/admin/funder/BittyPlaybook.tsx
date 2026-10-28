// ─────────────────────────────────────────────────────────────────────────────
// Bitty Advance — funder playbook
//
// Bitty is the micro rail: small files, fast automatic decisions, commission
// paid the day the file funds. This tab exists so a closer can qualify a
// merchant on the phone and walk a collection checklist without opening a PDF.
//
// EVERY figure below is traceable to one of three documents we hold, named in
// the footer. Where our database record and a document disagree, BOTH are shown
// — the document is the primary source and the record is somebody's summary of
// one, but silently picking a winner is how a closer ends up quoting a number
// the funder never agreed to. Nothing here is invented, and the two places the
// documents are silent say so in words.
// ─────────────────────────────────────────────────────────────────────────────
import { Alert, type CheckItem, Checklist, IndustryFinder, Quote, Rows, Sec } from "./playbook";
import { BittySpreadCalc } from "./BittySpreadCalc";

const TIERS = [
  { n: "Premier", cls: "t1", factor: "1.39", term: "69 wks", comm: "12%", fico: "675+", rev: "$15K/mo" },
  { n: "Preferred", cls: "t1", factor: "1.45", term: "60 wks", comm: "12%", fico: "650+", rev: "$15K/mo" },
  { n: "Select", cls: "t2", factor: "1.49", term: "56 wks", comm: "12%", fico: "625+", rev: "$15K/mo" },
  { n: "Standard", cls: "t2", factor: "1.52", term: "54 wks", comm: "12%", fico: "600+", rev: "$5K/mo" },
  { n: "Essential", cls: "t3", factor: "1.55", term: "52 wks", comm: "12%", fico: "550+", rev: "$5K/mo" },
  { n: "Access", cls: "t4", factor: "1.59", term: "50 wks", comm: "8%", fico: "500+", rev: "$5K/mo" },
];

const PREFERRED = [
  "Advertising", "Agriculture, Forestry, Fishing", "Ambulance", "Architectural / Engineering",
  "Assisted Facility", "Auto Repair", "Barber Shops", "Beauty Salons", "Car Rental", "Car Wash",
  "Child Day Care", "Computer Systems Design", "Cosmetics / Hair Ext. / Supply", "CPA Office / Accountant",
  "Dentist", "Doctor / Physician / Specialist", "Drinking Alcohol", "Driving School",
  "Drycleaner / Laundry", "Employment / Staffing", "Fitness Center", "Florist", "Food Truck",
  "Furniture / Home Retail", "Gas Station", "Graphic Design", "Grocery / Food / Bev. Retail",
  "Home Health Care", "Insurance", "Interior Design", "Janitorial", "Lab / Imaging", "Landscaping",
  "Lawyer", "Manufacturing", "Mental Health", "Mortgage Broker", "Nail Salon",
  "Oil / Gas Support Activities", "Other Information", "Other Legal Services", "Pest", "Pet Care",
  "Photography", "Real Estate Lessor", "Restaurant - Full-service", "Restaurant - Limited-service",
  "Septic Tank", "Spa / Tattoo / Wax", "Sports / Hobby / Music Retail", "Sports / Recreation Instruction",
  "Telecommunications", "Tobacco / Vape", "Trade Show / Convention", "Travel Agency / Arrangement",
  "Tutoring", "Veterinary",
];

const STANDARD = [
  "Accommodation", "Appliance Repair", "Auto Body Shop", "Auto Parts / Tires", "Boat / Marine",
  "Catering", "Chiropractor", "Clothing / Shoes / Acc. Retail", "Construction - Carpentry",
  "Construction - Electrician", "Construction - Flooring", "Construction - Gen. Remodeler",
  "Construction - New Home Builder", "Construction - Other Unclass.", "Construction - Painting",
  "Construction - Plumbing / HVAC", "Construction - Roofing", "Construction - Site Prep / Excav.",
  "Consulting - Management", "Drywall", "Electronics / Appliance Retail", "Fine Arts School",
  "Funeral Home", "General Merchandise Retail", "Health / Personal Care Retail", "Investment Advisor",
  "Jewelry", "Marketing", "Medical Transport (non-emerg.)", "Movie / Music", "Moving", "Notary",
  "Online Seller", "Other Arts / Entertain. / Rec.", "Other Education", "Other Finance",
  "Other Misc. Retail", "Other Personal Services", "Other Prof / Sci / Tech Services",
  "Other Services - Bldgs / Dwellings", "Public Administration", "Real Estate Agent / Broker",
  "Real Estate / Other Activities", "Rental Center / Consumer / Gen.", "Security Guard / Investigation",
  "Security Systems", "Solar", "Taxi / Limo / Shuttle", "Towing / Roadside", "Trucking",
  "T-shirt / Printing", "Wholesale",
];

const PROHIBITED = [
  "Auto Dealer / New, Used", "Bail Bonds", "Cannabis", "Crypto", "Debt Collections", "Gambling",
  "Guns", "Health Supplements", "Money Service Businesses", "Not-for-profit", "Pawn Shops",
  "Psychic Services", "Religious / Grantmaking / Civic", "Sexual Content",
];

const CHECK: CheckItem[] = [
  // ── 1. kill it on the call ──
  {
    id: "b-tib",
    group: "Qualify on the call — before you collect anything",
    label: "Time in business is 12 months or more",
    hard: true,
    why: (
      <>
        Under 6 months is an <b>automatic decline</b>. But every tier that actually prices says{" "}
        <b>12+ months</b> — so 6–11 months is a no-man's-land their guide does not quote. If the merchant is in it,
        call Partner Support before you promise anything.
      </>
    ),
  },
  {
    id: "b-fico",
    group: "Qualify on the call — before you collect anything",
    label: "Owner FICO is 500 or better, and there is no open bankruptcy",
    hard: true,
    why: <>Below 500, or an open bankruptcy, is an automatic decline. 500–549 can only reach the Access tier, where our commission drops to 8%.</>,
  },
  {
    id: "b-rev",
    group: "Qualify on the call — before you collect anything",
    label: "Monthly revenue is at least $5,000",
    hard: true,
    why: <>$5K/mo reaches Standard, Essential and Access. You need <b>$15K/mo</b> to reach Select, Preferred or Premier — the better factors.</>,
  },
  {
    id: "b-ind",
    group: "Qualify on the call — before you collect anything",
    label: "Industry is not on the 14-item prohibited list",
    hard: true,
    why: <>Use the industry lookup in section 5. Prohibited means do not submit at all.</>,
  },
  {
    id: "b-neg",
    group: "Qualify on the call — before you collect anything",
    label: "Fewer than 19 negative days across the last 3 months",
    hard: true,
    why: <>19+ negative days in the prior 3 months is an automatic decline. You will not know this for certain until you read the statements — ask the merchant first, then verify.</>,
  },

  // ── 2. the application ──
  {
    id: "b-app",
    group: "The application",
    label: "Signed merchant application — legal name, DBA, EIN, entity type, state of incorporation",
    hard: true,
    why: <>Bitty's decision is automatic, and their own overview ties decision speed to <b>application accuracy</b>. A sloppy app is a slow app.</>,
  },
  {
    id: "b-amt",
    group: "The application",
    label: "Amount requested is between $2,000 and $100,000",
    hard: true,
    why: (
      <>
        The October 2026 guide caps <b>new business funding at $100,000</b>. Our record still carries $250,000 from
        their sell sheet — see the conflict flagged in section 2. Quote $100K until somebody at Bitty confirms the
        higher number in writing.
      </>
    ),
  },
  {
    id: "b-use",
    group: "The application",
    label: "Use of funds",
    why: <>Not called out as a stip, but it is what you will use to position the renewal later.</>,
  },

  // ── 3. bank ──
  {
    id: "b-chk",
    group: "Bank and financials",
    label: "Business checking account — required on every single file",
    hard: true,
    why: <>Their guide lists this first under “What We Need”. A personal account does not substitute.</>,
  },
  {
    id: "b-stmt",
    group: "Bank and financials",
    label: "Bank statements (count not stated — collect 3 months and be ready for 4)",
    hard: true,
    why: (
      <>
        Neither the underwriting guide nor the referral agreement names a statement count. Their negative-day rule
        looks back <b>3 months</b>, so three is the floor. This is a real gap in what we hold — worth one question
        to Partner Support.
      </>
    ),
  },
  {
    id: "b-plaid",
    group: "Bank and financials",
    label: "Merchant is ready to link the bank by Plaid at approval",
    why: <>Their overview puts a Plaid link on every approval as standard. Warn the merchant on the first call so it does not stall the 5-day funding window.</>,
  },

  // ── 4. the business is real ──
  {
    id: "b-sos",
    group: "Prove the business is real and clean",
    label: "Secretary of State registration is active and in good standing",
    hard: true,
    why: <>Named explicitly under “What We Need”. Check it yourself — a lapsed registration is a silent decline.</>,
  },
  {
    id: "b-loc",
    group: "Prove the business is real and clean",
    label: "Business location or website — home-based merchants must show an online presence",
    hard: true,
    why: <>A home-based merchant with no website, no listing and no social presence fails this. Find the online footprint before you submit, or fix it with them.</>,
  },
  {
    id: "b-ucc",
    group: "Prove the business is real and clean",
    label: "Clean funding history — no unresolved cash-advance UCCs, no business funding judgments",
    hard: true,
    why: <>“Unresolved” is the operative word. An open UCC from a paid-off advance needs a termination or a payoff letter, and that takes days — start it early.</>,
  },

  // ── 5. owner ──
  {
    id: "b-own",
    group: "Owner",
    label: "Owner name, DOB, SSN, home address, ownership %",
    hard: true,
    why: <>Standard for the credit pull their application authorizes. Keep it on the signed app — never in a note field or an email body.</>,
  },
  {
    id: "b-id",
    group: "Owner",
    label: "Owner's mobile number is correct and they will answer a text right after signing",
    hard: true,
    why: (
      <>
        <b>Do not chase a photo ID for Bitty.</b> Their overview: identification links text to the merchant's cell
        right after signing, so ID verification is automatic — but it dies if the number on the application is
        wrong. Confirm the cell, not the ID.
      </>
    ),
  },

  // ── 6. our own gates ──
  {
    id: "b-cap",
    group: "Before you hit submit — our gates, not theirs",
    label: "You know the sell rate you intend to quote, and it is inside Bitty's rate cap",
    hard: true,
    why: (
      <>
        <b>This is how we get paid.</b> Our commission is the spread between Bitty's buy rate and your sell rate
        (section 3). Submit without a sell rate in mind and you can close a funded deal for nothing.
      </>
    ),
  },
  {
    id: "b-5day",
    group: "Before you hit submit — our gates, not theirs",
    label: "The merchant can sign within 5 days of approval",
    hard: true,
    why: <>After five days another agent who closes it takes the commission. Do not submit a merchant who is about to go on vacation.</>,
  },
  {
    id: "b-dupe",
    group: "Before you hit submit — our gates, not theirs",
    label: "Nobody else has this merchant in to Bitty already",
    why: <>On a duplicate, the commission goes to whoever's application is reviewed, completed and approved first — not whoever submitted first.</>,
  },
];

export function BittyPlaybook() {
  return (
    <>
      <div className="fp-head">
        <div>
          <h2>Bitty Advance</h2>
          <p className="fp-role">
            Our <b>micro rail</b>. Small files, an automatic credit decision, and commission paid the same day the
            merchant funds. Built for the $2K–$100K deal that a $50K-minimum funder will not look at.
          </p>
          <div className="fp-idchips">
            <span className="fp-idchip">MCA only</span>
            <span className="fp-idchip">$2K – $100K</span>
            <span className="fp-idchip">12 mo TIB</span>
            <span className="fp-idchip">500 FICO floor</span>
            <span className="fp-idchip">Paid day of funding</span>
          </div>
        </div>
      </div>

      {/* ── 1. status ── */}
      <Sec n={1} title="Where this relationship actually stands" sub="read this before you quote anybody">
        <Alert tone="stop" title="Nothing in this packet is executed by either party">
          <p>
            The Bitty Referral Agreement v6 dated 10/27/2026 carries <b>EL</b> initials on pages 3–11 only, and{" "}
            <b>Bitty's initials slot is blank on all eleven</b>. On the execution block at page 12, our side has
            “Agentic Voice Inc.”, “Dr. Ernesto Lee” and the date <b>typed</b> — but{" "}
            <b>both signature lines are blank</b>, and Bitty's entire column is empty. They have not countersigned
            or even typed their name.
          </p>
          <p>
            Behind it, the <b>ACH authorization (p.13) is wholly unfilled</b> — no bank, no account number, no
            routing — and the <b>ISO application (p.14) is wholly unfilled</b>: no legal name, EIN, entity type,
            address, deal volumes or owner block. Verified by rendering the pages, not by reading extracted text.
          </p>
          <p>
            So there is <b>no Bitty relationship in force</b>. Every rate and commission figure on this tab is a{" "}
            <b>published offer, not a contractual entitlement</b> — their own sell sheet says terms are “subject to
            change and to a fully executed ISO agreement.”
          </p>
        </Alert>
        <Alert tone="warn" title="Two numbers we hold disagree with the October guide">
          <p>
            <b>Maximum funding.</b> Our funder record says <b>$250,000</b>, taken from their Partner Funding
            Overview. The October 2026 guide says <b>“New Business Funding: $2,000-$100,000”</b>. These may both be
            true — $100K new, more on renewal — but nothing we hold says so. Quote <b>$100,000</b>.
          </p>
          <p>
            <b>Time in business.</b> Our record says <b>6 months</b>. That matches only their auto-decline floor.
            Every tier that carries a price says <b>12+ months</b>.
          </p>
        </Alert>
      </Sec>

      {/* ── 2. the box ── */}
      <Sec n={2} title="The six pricing tiers" sub="factors are starting rates · terms are maximums">
        <div className="fp-panel">
          <div className="fp-tiers">
            {TIERS.map((t) => (
              <div className={`fp-tier ${t.cls}`} key={t.n}>
                <div className="fp-tname">
                  <span className="fp-stripe" />
                  {t.n}
                </div>
                <dl>
                  <dt>Factor</dt>
                  <dd>{t.factor}</dd>
                  <dt>Max term</dt>
                  <dd>{t.term}</dd>
                  <dt>Credit</dt>
                  <dd>{t.fico}</dd>
                  <dt>Revenue</dt>
                  <dd>{t.rev}</dd>
                  <dt>Commission</dt>
                  <dd className="fp-hi">{t.comm}</dd>
                </dl>
              </div>
            ))}
          </div>
        </div>
        <div className="fp-foot">
          Every tier requires <b>12+ months in business</b>. The commission column is <b>12% on five of six tiers
          and 8% on Access</b> — so the weakest credit is also the one that pays us least. Their note, verbatim:{" "}
          <i>“Terms are maximums. Factors are starting rates. Final offers vary by qualification.”</i>
        </div>
      </Sec>

      {/* ── 3. how we get paid ── */}
      <Sec n={3} title="How Bitty actually pays us" sub="this is not a flat 12 points — read it once, properly">
        <Alert tone="info" title="Commission is a spread you have to set, not a rate you receive">
          <p>
            The Compensation Schedule does not pay points. It pays the difference between the factor Bitty will
            accept and the factor you sell the merchant:
          </p>
          <Quote
            text="Bitty will pay ISO an amount equal to the Funded Amount of the Purchase Agreement multiplied by the Compensation Base Rate."
            cite="Compensation Schedule §4"
          />
          <Quote
            text="&quot;Compensation Base Rate&quot; means the amount by which the Sell Rate exceeds the Buy Rate."
            cite="Compensation Schedule §1(g)"
          />
          <p style={{ marginTop: 8 }}>
            Bitty names a <b>buy rate</b> and a <b>rate cap</b> on each approval. You set the sell rate underneath
            the cap. The <b>12%</b> on the tier grid is that cap — the most you can make — <b>not</b> a commission
            you are owed. Sell at the buy rate and you earn <b>nothing</b> on a funded deal.
          </p>
        </Alert>

        <div style={{ marginTop: 12 }}>
          <BittySpreadCalc />
        </div>

        <div className="fp-panel" style={{ marginTop: 12 }}>
          <div className="fp-math">
            <div className="fp-mcell">
              <div className="fp-mk2">$15,000 at the cap</div>
              <div className="fp-mv">$1,800</div>
              <div className="fp-mn">12% — a typical small Bitty file</div>
            </div>
            <div className="fp-mcell">
              <div className="fp-mk2">$50,000 at the cap</div>
              <div className="fp-mv">$6,000</div>
              <div className="fp-mn">12% — beats our 8-point house model by $2,000</div>
            </div>
            <div className="fp-mcell">
              <div className="fp-mk2">$100,000 at the cap</div>
              <div className="fp-mv">$12,000</div>
              <div className="fp-mn">12% — their stated new-business ceiling</div>
            </div>
            <div className="fp-mcell">
              <div className="fp-mk2">Access tier, $15,000</div>
              <div className="fp-mv">$1,200</div>
              <div className="fp-mn">8% — weakest credit pays us least</div>
            </div>
          </div>
        </div>

        <Rows
          items={[
            {
              k: "When we're paid",
              v: (
                <>
                  <b>The same day Bitty advances the funded amount.</b> This is the best payment timing in our
                  network — most funders run 5 to 30 days.
                  <Quote
                    text="All Compensation (including Renewal Compensation) will be paid to ISO on the same day that Bitty advances the Funded Amount to the Merchant."
                    cite="Compensation Schedule §7"
                  />
                </>
              ),
            },
            {
              k: "Clawback",
              v: (
                <>
                  <b>Everything comes back</b> if, before the merchant has repaid <b>20% of the RTR</b>, they
                  default, go insolvent or bankrupt — <b>or a single scheduled debit is returned or rejected</b>.
                  <Quote
                    text="ISO shall immediately repay any and all Compensation received in respect of a referred Merchant if any of the following shall occur before Merchant has paid 20% of the RTR: … (c) any scheduled debit of a Merchant's account designated for a payment pursuant to the Purchase Agreement is returned or rejected by Merchant's bank."
                    cite="Referral Agreement §6(e)"
                  />
                  As written, <b>one bounced ACH in the first fifth of the term costs us the whole commission.</b>{" "}
                  That is the single most expensive sentence in the agreement and it is worth negotiating before
                  signing.
                </>
              ),
            },
            {
              k: "They can take it back directly",
              v: (
                <>
                  Bitty may <b>set off</b> anything we owe against anything they hold for us (§11(c)), and the
                  packet includes an <b>ACH authorization</b> letting Bitty or MCA Servicing debit our business
                  account. That form is currently <b>blank</b> — nothing is signed and no account number has been
                  given.
                </>
              ),
            },
            {
              k: "Renewals",
              v: (
                <>
                  Same spread formula, and the window is <b>generous</b>: any time from the original purchase
                  agreement until <b>10 calendar days after the merchant finishes paying</b>. Automatic, unless we
                  are on Inactive Status.
                </>
              ),
            },
            {
              k: "The 5-day funding window",
              v: (
                <>
                  <b>Five days</b> from approval for the merchant to sign, or a different agent who closes it takes
                  the commission (§6(d)). Short, and it is the clock your collection checklist is really racing.
                </>
              ),
            },
            {
              k: "Volume commitment",
              v: (
                <>
                  <b>No number appears in the agreement.</b> Inactive Status is defined as failing “performance
                  standards established by Bitty from time to time” <b>and having been notified</b> — notice is
                  required before our renewal rights can be suspended. Separately, §13(b) lists “inactive or
                  nonexistent funding” as cause for termination.
                  <br />
                  Their sell sheet claims <b>2 funded files a month</b>. That figure is <b>not in this contract</b>.
                </>
              ),
            },
            {
              k: "Exclusivity",
              v: (
                <>
                  <b>None, in either direction.</b> Bitty may market directly to any merchant and take applications
                  from them (§4), and keeps ownership of the merchant relationship without needing our consent
                  (§7). We keep renewal compensation — that is the protection, and it is the only one.
                </>
              ),
            },
            {
              k: "They can change the deal",
              v: (
                <>
                  Bitty can amend the guidelines, the pricing and the compensation unilaterally, and submitting a
                  file after a change is deemed acceptance of it. <b>The agreement contradicts itself on whether
                  we get told:</b> §17 says amendment is “by written notice to ISO”, while §6(c) says Bitty may
                  amend compensation <b>“without prior notice to or consent from ISO.”</b> Worth resolving in
                  writing — it decides whether our commission can move without us hearing about it.
                </>
              ),
            },
            {
              k: "Governing law",
              v: <>Florida courts, prevailing party recovers fees. <b>No non-circumvention and no non-solicit period anywhere in the 15 pages</b> — searched for all of them. Unusual, and in our favour.</>,
            },
          ]}
        />
      </Sec>

      {/* ── 4. gates ── */}
      <Sec n={4} title="Qualify or kill it on the first call" sub="four of these are automatic declines">
        <div className="fp-two">
          <div className="fp-gate pass">
            <h4>They require this on every file</h4>
            <ul>
              <li>
                <span className="fp-mk">✓</span>
                <span>
                  <b>Business checking account</b>
                  <span className="fp-why">Required on every file. A personal account does not substitute.</span>
                </span>
              </li>
              <li>
                <span className="fp-mk">✓</span>
                <span>
                  <b>Business location or website</b>
                  <span className="fp-why">Home-based applicants must show an online business presence.</span>
                </span>
              </li>
              <li>
                <span className="fp-mk">✓</span>
                <span>
                  <b>Clean funding history</b>
                  <span className="fp-why">No unresolved cash-advance UCCs or business funding judgments.</span>
                </span>
              </li>
              <li>
                <span className="fp-mk">✓</span>
                <span>
                  <b>Secretary of State active and in good standing</b>
                  <span className="fp-why">Check it yourself. A lapsed registration is a silent decline.</span>
                </span>
              </li>
            </ul>
          </div>

          <div className="fp-gate fail">
            <h4>Automatic decline — do not submit</h4>
            <ul>
              <li>
                <span className="fp-mk">✕</span>
                <span>
                  <b>Under 6 months in business</b>
                  <span className="fp-why">And no priced tier goes below 12 months.</span>
                </span>
              </li>
              <li>
                <span className="fp-mk">✕</span>
                <span>
                  <b>Open bankruptcy, or FICO below 500</b>
                  <span className="fp-why">Either one on its own.</span>
                </span>
              </li>
              <li>
                <span className="fp-mk">✕</span>
                <span>
                  <b>19+ negative days in the prior 3 months</b>
                  <span className="fp-why">Count them in the statements before you submit, not after.</span>
                </span>
              </li>
              <li>
                <span className="fp-mk">✕</span>
                <span>
                  <b>Any of the 14 prohibited industries</b>
                  <span className="fp-why">Check the lookup below.</span>
                </span>
              </li>
            </ul>
          </div>
        </div>
      </Sec>

      {/* ── 5. industries ── */}
      <Sec n={5} title="Will they take this industry?" sub="their October 2026 list, searchable">
        <IndustryFinder
          book={{ preferred: PREFERRED, standard: STANDARD, prohibited: PROHIBITED }}
          note="Start typing to check an industry against Bitty's published list before you promise the merchant anything."
        />
        <div className="fp-foot">
          <b>Their guide miscounts its own lists — these are complete.</b> The badge over the preferred column says
          “59 industries” but only <b>{PREFERRED.length}</b> are printed on the page; the standard badge says “53”
          and only <b>{STANDARD.length}</b> are printed. Verified twice, against both the extracted text and a
          170-dpi render of page 2 — nothing was lost on our side, Bitty's headline numbers are simply wrong.
          Prohibited is correct at all <b>14</b>. Every industry above is one they actually printed.
        </div>
      </Sec>

      {/* ── 6. checklist ── */}
      <Sec n={6} title="Submission checklist" sub="walk it top to bottom · ticks are saved in this browser only">
        <Checklist storageKey="mf.playbook.bitty.v1" items={CHECK} />
      </Sec>

      {/* ── 7. how it goes out ── */}
      <Sec n={7} title="How the file physically goes out">
        <Rows
          items={[
            {
              k: "Channel",
              v: (
                <>
                  Partner portal at <b>broker.bittyadvance.com</b>. Their overview offers an API as fastest but
                  marks <b>manual entry</b> as preferred, with an automated email submission as a fallback.
                </>
              ),
            },
            {
              k: "Submission inbox",
              v: <span className="fp-miss">We hold no submission email address for Bitty — portal only. Worth asking for one as a fallback.</span>,
            },
            {
              k: "Partner support",
              v: (
                <>
                  <b>partners@bittyadvance.com</b> — the notice address in the agreement. Our named rep is Rosmery
                  Quiroz.
                </>
              ),
            },
            {
              k: "Decision",
              v: <>Automatic approve/decline. Their overview ties the speed directly to application accuracy and the completeness of the bank data — so a clean submission is literally a faster one.</>,
            },
            {
              k: "Submission recipe",
              v: <span className="fp-miss">Our stored submission profile for Bitty is still INACTIVE — the app will not auto-assemble a Bitty package yet. Submissions are manual until somebody turns it on.</span>,
            },
            {
              k: "Early payoff",
              v: <>Merchant-side discount: <b>30% off at 30 days, 20% off at 60 days.</b> This is a renewal argument, not a footnote — a merchant who pays early and saves real money is the merchant who takes the next advance.</>,
            },
          ]}
        />
      </Sec>

      <div className="fp-foot">
        <b>Sources.</b> Bitty Underwriting Guide, October 2026, v10 (2 pp) · Bitty Referral Agreement v6 Full,
        10/27/2026 (15 pp, unexecuted) · Bitty Partner Funding Overview (3 pp). All three are on the Bitty funder
        record. Where this tab and our database disagree, the disagreement is shown rather than resolved — the
        documents are primary, the record is a summary of them. Nothing on this page is a quote to a merchant.
      </div>
    </>
  );
}
