# Lender Submission Requirements — Research Findings

**Researched:** 2026-07-02 · **Method:** Firecrawl web search/scrape of each funder's own ISO / Partner / Broker pages, cross-checked against FunderIntel, deBanked-adjacent sources, and third-party lender reviews (UnitedCapitalSource, WSJ).
**Scope:** DATA RESEARCH ONLY — no emails, signups, or form submissions were made. Writes were limited to NULL/empty columns on the `lenders` table (via `COALESCE`, never overwriting existing values) plus this file.

## What "submission_email" means here
An address was written to `lenders.submission_email` **only** when it appears verbatim on the funder's own site/ISO agreement as the deal-submission (or ISO) inbox. Anything softer (general `info@`/`customerservice@`, or a contact whose role is business development rather than a submission queue) was left OUT of `submission_email` and instead described in `submission_notes`, prefixed **UNVERIFIED** where appropriate. A wrong submission email is worse than none.

## Session totals (whole table, after writes)
- Lenders with a submission email: **22 / 62**
- Lenders with a submission portal/ISO-application URL: **37 / 62**
- Lenders with at least one underwriting criterion filled: **14 / 62**
- New verified submission emails added this session: **7** (Rapid Finance, National Funding, CFG Merchant Solutions, Lendini, Marlin/PEAC, Greenbox Capital, True Advance Funding)

---

## Findings by lender (only lenders touched this session)

| Lender | Submission email (written?) | Portal / ISO page | Key criteria found | Source | Confidence |
|---|---|---|---|---|---|
| **Rapid Finance** | `brokerpartners@rapidfinance.com` ✅ | rapidfinance.com/partner-programs/business-finance-brokers | Term/LOC/MCA suite | own broker page | HIGH |
| **National Funding** | `businessdevelopment@nationalfunding.com` ✅ | nationalfunding.com/partners (+ Impact affiliate) | $10K–$500K | own partners page | MED-HIGH |
| **CFG Merchant Solutions** | `KChristianson@CFGMS.com` ✅ | cfgmerchantsolutions.com/partnerships-v2 | Direct MCA funder | own ISO application page | MED-HIGH |
| **Lendini** | `submissions@lendini.com` ✅ (CC acct mgr) | partners.lendini.com | Signed app + bank stmts + MTD; parent Funding Metrics | lendini.com/process | HIGH |
| **Marlin Capital (PEAC Solutions)** | `brokerprograms@peacsolutions.com` ✅ | peacsolutions.com/contact | Equipment financing; (888) 479-9111 | PEAC contact page | MED-HIGH |
| **Greenbox Capital** | `info@greenboxcapital.com` ✅ | greenboxcapital.com/iso-application | Up to $250K; ISO comm up to 19%; long restricted-industry list; funds Canada | own ISO program page | HIGH |
| **True Advance Funding** | `submissions@trueadvancefunding.com` ✅ | apply.trueadvancefunding.com | B–D paper; Pearl River NY; 551-341-0901 | their ISO-Funder Agreement PDF | HIGH |
| **Kapitus** | portal-based (no email) | iso.kapitus.com (signup: /sales-partner-program) | Min ISO: 1yr, $500K/mo vol, insurance, website, US-based | own sales-partner page | HIGH |
| **Credibly** | portal-based (`customerservice@credibly.com` = support, UNVERIFIED for subs) | credibly.com/partner/funding-partner | MCA $5K–$600K & WC loan $25K–$600K, min FICO 550 | own partner page | HIGH |
| **OnDeck** | `partners@ondeck.com` (pre-existing) | ondeck.com/partner | 625+ FICO, $100K+ annual rev, 1+ yr | own partner/quals pages | HIGH |
| **Fora Financial** | `info@forafinancial.com` (pre-existing) | forafinancial.com/partner-with-us | ~6 mo, ~$240K/yr (~$20K/mo), 570 FICO, up to $1.5M | own partner page + reviews | HIGH |
| **Libertas Funding** | `sales@libertasfunding.com` (pre-existing) | — | RBF $500K–$10M (as low as $100K) | libertasfunding.com | MED |
| **Idea Financial** | UNVERIFIED (`info@ideafinancial.com` general) | partner.ideafinancial.com (apply: /iso-partners-application) | Term loans + LOC | own partnerships page | MED |
| **Reliance Financial** | none (ISO partner form) | reliancef.com (contact.html) | RBF ~$500–$4M; **actively recruiting ISOs** | reliancef.com + UCS review | MED |
| **Merchant Marketplace** | portal-based | iso.merchantmarketplace.com | MCA, high ISO commissions | own ISO portal | MED |
| **CapFront** | portal-based | capfront.net/partner | **Aggregator** → OneTeam, Channel, Credibly, OnDeck, Idea, BlueVine… | own partner pages | MED |
| **BlueVine** | referral/partner | bluevine.com/partner | LOC ≤$250K, term ≤$500K | own partner page | MED |
| **Intrepid Finance** | platform onboarding | intrepidfinance.io | Platform: lenders+brokers+biz; term/LOC | intrepidfinance.io | MED |
| **Fundbox** | referral lead-form | fundbox.com/partners | LOC/term; affiliate model | own partners page | MED |
| **Biz2Credit** | referral/affiliate | biz2credit.com/partners/affiliate-program | Referral-fee model | own affiliate page | MED |
| **altLINE (SoBanCo)** | referral program | altline.sobanco.com/referral-partners/brokers | Invoice factoring | own referral page | MED-HIGH |
| **Beacon Funding** | partner network | beaconfunding.com/partner-with-beacon-funding-… | Equipment financing | own partner page | MED |
| **TimePayment** | portal-based | timepayment.com/brokers (InfoHub Dealer Portal) | Equipment leasing | own broker page | MED-HIGH |
| **SmartBiz** | partner network | smartbizbank.com/partners | SBA + term; Refer-A-Friend $500 | own partners page | MED-HIGH |
| **Benetrends** | broker program | benetrends.com/partner-portal/benetrends-broker-partner | ROBS/401k + SBA franchise funding | own partner page | MED |
| **RTS Financial** | agent/referral | rtsinc.com/resources/referral-program | Freight/invoice factoring (trucking) | own referral page | MED |
| **Mantis Funding** | UNVERIFIED (BD contact a.pata@) | mantisfunding.com/iso-partners (ISO agr via Salesforce) | Direct MCA funder | own ISO page + prior outreach | MED |
| **Pearl Capital** | gated (ISO onboarding) | pearlcapital.com | MCA, any FICO; 1-800-888-9959 | pearlcapital.com | LOW |
| **Mulligan Funding** | gated (assigned after onboarding) | mulliganfunding.com/partners/iso | Direct funder, working capital | own ISO page | LOW |
| **Liquidibee** | gated | liquidibee.com | Direct funder, same-day agent payouts | LinkedIn/IG | LOW-MED |
| **CAN Capital** | gated / unknown | myportal.cancapital.com | Loans (WebBank), equipment, LOC; /partners = 404 | cancapital.com | LOW |
| **501 Advance** | not captured | (FunderIntel listing) | RBF/MCA, A–C paper; (888) 860-6970 | FunderIntel + UCS + IG | MED |
| **Stafford Business Funding** | not found | (FunderIntel listing) | Direct MCA, C–D paper | FunderIntel + Yelp | LOW |
| **Viking Funding** | not found | (FunderIntel listing) | MCA, B–D paper | FunderIntel | LOW |
| **Currency Capital** | not found | — | Equipment finance marketplace | search | LOW |
| **Funding Circle** | referral (US) | fundingcircle.com | SBA + term; UK has Introducer API | fundingcircle.com | LOW-MED |
| **SmartMCA** | not found | — | — | search (none) | NONE-found |
| **Genuine Funding** | not found | — | — | search (none) | NONE-found |
| **Lionsford** | not found | — | — | search (none) | NONE-found |
| **EquityMax** | pre-qualify form | equitymax.com/prequalify-now | RE hard money, no TIB min | equitymax.com | MED |

### Corrections / surprises (flagged in `submission_notes`, verify before acting)
- **LendPathway** — the DB row is tagged as an MCA/working-capital prospect, but **lendpathway.com is a bank-statement/underwriting analytics SaaS** (turns statement data into an underwriting breakdown with MCA position detection). It is a **tool, not a funder**. Do not submit deals here.
- **Nexi Partner Program** — `nexi.com` is **Nexi S.p.A., a European payments/merchant-services company**, not a US small-business funder. Almost certainly a mis-categorized row; verify the intended entity.
- **Funder Intel** — an **industry intel + funder-matching directory**, not a funder. Use for research/matching only.
- **Lendio** — a **loan marketplace/aggregator**, not a direct funder (and arguably a competitor). Broker fit is via their affiliate program, not deal submission.
- **Arcadia Servicing** (`arcadiafunding.com`) — a similarly named funder **"Arcadia Advance Group"** (`arcadiaadvancegroup.com`) submits at `submissions@ArcadiaAdvanceGroup.com` / 877-737-2275. **These may be different companies** — the email was NOT written to `submission_email`; confirm identity first.
- **CapFront** — an **aggregator**, not a single funder; DB domain is `capfront.com` but the live site is `capfront.net`.
- **Marlin Capital** — rebranded to **PEAC Solutions** (financing by Marlin Leasing Corp).
- **Reliance Financial** — DB `website` still points at the FunderIntel listing; the real site is **reliancef.com**. It is the warmest lead here ("Brokers Wanted").

---

## "Needs ISO onboarding" list (submission details gated until you're an approved partner)
For these, no public deal-submission email/portal exists; the address or portal is issued only after the ISO application is approved. Apply, then capture the real submission channel:

- **Kapitus** — apply at kapitus.com/sales-partner-program → deals via iso.kapitus.com portal (meets: 1yr, $500K/mo volume, insurance).
- **Credibly** — apply at credibly.com/partner/funding-partner → onboarding call → partner portal.
- **Pearl Capital** — sign up at pearlcapital.com (ISO fintech tools issued after onboarding).
- **Mulligan Funding** — mulliganfunding.com/partners/iso (submission channel assigned post-onboarding).
- **Reliance Financial** — ISO partner form at reliancef.com.
- **Merchant Marketplace** — signup at iso.merchantmarketplace.com.
- **Mantis Funding** — ISO agreement via Salesforce (mantisfunding.my.salesforce-sites.com/ISOAgreement); confirm submission inbox with Anthony Pata.
- **Idea Financial** — apply at ideafinancial.com/iso-partners-application → partner.ideafinancial.com.
- **CapFront** — ISO program signup at capfront.net/partner.
- **Liquidibee** — onboard via liquidibee.com / LinkedIn.
- **Intrepid Finance** — join platform at intrepidfinance.io.
- **National Funding** — partner onboarding via Impact affiliate platform.
- **BlueVine / Fundbox / Biz2Credit / SmartBiz / Benetrends / altLINE / Beacon / TimePayment / RTS** — referral/partner/affiliate programs (submit via their portal/lead-form after enrolling).

## Left intentionally untouched
- **Financing Solutions** — internal "hard no" (only ~$75K LOC to non-profits, $500 payout). Not researched further.
- Already fully populated (not modified): CapitaWize, Corfin Group, FAC Solutions, Fantastic Funding, Funderial, GoKapital, Instafunders, MCashAdvance, Reliant Funding (LCF), United Capital Source, Value Capital Funding, Guidant Financial, Capstone Corporate Funding, 1st Commercial Credit.

---
*All facts above were sourced from the funders' own public pages or reputable third-party listings as of 2026-07-02. Confidence labels reflect how directly the funder's own site stated the submission channel. Anything marked UNVERIFIED / LOW should be confirmed by direct outreach before submitting live deals.*
