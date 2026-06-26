# MFunding.com — Complete Claude Code Context
## Everything Claude Code Needs to Know About This Business
### Last Updated: March 2026

---

## WHAT THIS IS

This document summarizes the complete strategic planning conversation for MFunding, LLC — a Merchant Cash Advance (MCA) brokerage business. It was developed across an extensive Claude.ai session covering market strategy, lead acquisition, Google Ads campaigns, sales funnel design, follow-up automation sequences, CRM architecture (GoHighLevel SaaS Pro), financial modeling, staffing plans, legal agreements, and Sub-ISO partner program design.

**Use this as the master context file when working on any MFunding project in Claude Code.** All referenced documents are in the same package.

---

## BUSINESS IDENTITY

- **Company:** MFunding, LLC (Florida LLC)
- **Website:** mfunding.com
- **Business model:** ISO (Independent Sales Organization) that brokers business funding products — primarily Merchant Cash Advances (initial focus), with expansion into term loans, SBA loans, lines of credit, and equipment financing
- **What we do:** Connect small businesses needing capital with funders and lenders who provide working capital, advances, loans, and credit lines
- **What we DON'T do:** We do NOT fund deals with our own money. We are the broker.
- **Critical legal distinction:** MCAs are NOT loans. They are purchases of future receivables. When discussing MCA products, all code, marketing materials, landing pages, emails, and SMS must use "advance," "working capital," or "purchase of future receivables" — never "loan." However, when discussing actual loan products (term loans, SBA, equipment financing), standard lending terminology is correct.

### Multi-Product Strategy

MFunding offers multiple business funding products including MCA, term loans, lines of credit, SBA loans, and equipment financing. The initial go-to-market focus is MCA because it has the fastest close times (24–48 hours vs. weeks for SBA), highest approval rates for imperfect credit, and the most established broker commission structure. All operational documents are built around MCA workflows but apply to other products with minor adjustments. The critical compliance distinction: **MCA products must NEVER be called "loans"** (they are purchases of future receivables). **Actual loan products use standard lending terminology.** Closers and all automated communications must know which product is being discussed and use appropriate language for that product. The pipeline, CRM, follow-up sequences, and financial model are product-agnostic — an MCA and a term loan flow through the same 9-stage funnel. The differences are: which funders receive the submission, what stips/docs are required, and what compliance disclosures apply.

---

## INDUSTRY HIERARCHY

```
Funder (has capital, underwrites, funds deals)
  → pays commission (points) to →
ISO / Broker (MFunding — finds merchants, packages deals, submits to funders)
  → may pay split to →
Sub-ISO (smaller broker submitting deals through MFunding's funder network)
  → or may pay split to →
MCA Closer (1099 independent contractor sales rep working under MFunding)
```

---

## CORE ECONOMICS

| Item | Value |
|------|-------|
| Average deal size | $50,000 |
| Commission on new deals | 8 points (8% of funded amount) = $4,000 |
| Commission on renewals | 6 points = $3,000 |
| Closer split (company leads) | 50% → closer gets $2,000, MFunding keeps $2,000 |
| Closer split (self-generated leads) | 70% → closer gets $2,800, MFunding keeps $1,200 |
| Renewal specialist split | 35% → specialist gets $1,050, MFunding keeps $1,950 |
| Sub-ISO override | MFunding keeps 2 points ($1,000), Sub-ISO keeps 6 points ($3,000) |
| Renewal rate | ~45-60% of merchants seek additional capital within 6 months |

---

## TECHNOLOGY STACK

| Component | Technology | Monthly Cost | Purpose |
|-----------|-----------|-------------|---------|
| **CRM / Automation** | GoHighLevel SaaS Pro | $497/mo | Lead management, pipelines, SMS/email automation, AI Employee, landing pages, phone system, Sub-ISO white-label portal |
| **Main Website** | React | Hosting cost | mfunding.com — brand hub, SEO content, trust/credibility |
| **Campaign Landing Pages** | GHL page builder | Included | funding.mfunding.com/[city] — per-city pages with auto-CRM integration |
| **Bank Verification** | Plaid API | ~$200/mo | Instant 3–6 month bank transaction history — replaces manual bank statement collection |
| **Application Portal** | React + Plaid Link | Dev cost | apply.mfunding.com — custom portal for instant bank verification |
| **Phone System** | GHL built-in (LeadConnector) | Usage-based | Call tracking, recording, local numbers per market city |
| **Sub-ISO Portal** | GHL SaaS Mode sub-accounts | Included in SaaS Pro | White-labeled business platform for Sub-ISO partners |

### Architecture

```
mfunding.com (React)                     GHL (Landing Pages + CRM + Sub-ISO Portal)
─────────────────────                     ──────────────────────────────────────────
Main brand website                        Campaign pages (per city)
  └─ About / Trust / SEO                    └─ funding.mfunding.com/indianapolis
  └─ Blog / Educational content              └─ funding.mfunding.com/phoenix
  └─ "Apply Now" → redirects to GHL          └─ funding.mfunding.com/columbus
                                              └─ funding.mfunding.com/financiamiento (Spanish)
apply.mfunding.com (React + Plaid)        Sub-ISO white-label portals
  └─ Merchant connects bank via Plaid        └─ Each Sub-ISO gets own GHL sub-account
  └─ 60-second bank verification             └─ Own landing pages, pipeline, CRM, automations
  └─ 3-6 months transaction data             └─ Deal submissions flow to MFunding for processing
```

**Key design decision:** ALL campaign landing pages are on GHL (not React). Reason: GHL form submissions automatically trigger CRM entry, tagging, workflows, and follow-up sequences — zero integration work needed.

---

## TARGET MARKETS (Validated 2026 Data)

| Market | Budget Allocation | Priority | Rationale |
|--------|------------------|----------|-----------|
| Indianapolis, IN | 20% | 1 | #5 best state for business, massive construction/infrastructure boom, low ISO saturation |
| Phoenix/Scottsdale, AZ | 20% | 1 | Job growth exceeding national average, tech sector expansion, huge Hispanic business population |
| Columbus/Cincinnati, OH | 20% | 1 | #4 best state, hospital and airport mega-projects |
| Washington DC/NoVA | 15% | 2 | Data center boom ($178M YOY Loudoun County), federal layoff wave creating new business owners |
| Sacramento, CA | 10% | 2 | State capital, government contractor demand, higher avg business revenue = bigger deals |
| South Florida (home base) | 15% | 3 | Down 36% in new business formations YOY — still viable for referral partnerships but don't over-invest |

**Critical insight:** Florida declined 36% in new business formations from Jan 2025 to Jan 2026. This validates investing 85% of resources into out-of-state growth markets where CPCs are 40–70% lower and business owners receive fewer broker calls.

---

## CUSTOMER ACQUISITION CHANNELS (Priority Order)

### 1. Live Transfer Leads (PRIMARY — Startup Phase)
- Cost: $50–$100 per transfer
- Close rate: 5–12% (varies by market and vendor quality)
- Top vendors: Master MCA, Lead Tycoons ($55-85), Synergy Direct ($60-90), MCA Leads Pro ($75-100), Exclusive Leads ($60-75)
- Qualification specs: 6+ months in business, $15K+ monthly revenue, owner on call, TCPA compliant, exclusive transfers only

### 2. Google Ads (Geo-Targeted — 5 Campaigns)
- Total budget: $185/day ($5,550/month)
- Campaign 1: Growth Markets (Indy, Columbus, Phoenix, Sacramento) — $60/day
- Campaign 2: Texas (Dallas, Houston) — $40/day
- Campaign 3: Spanish-Language (Phoenix, Houston, Dallas, Sacramento, Miami) — $30/day
- Campaign 4: D.C./Startup Focus — $30/day
- Campaign 5: South Florida Local — $25/day
- All landing pages on GHL at funding.mfunding.com/[city]

### 3. Aged MCA Leads — $0.50–$5 per lead, nurture via GHL automation
### 4. UCC Filing Data — target businesses with existing MCAs (60% want more capital)
### 5. Referral Partnerships — CPAs, bookkeepers, commercial RE agents, equipment vendors ($100 gift card per funded referral)
### 6. Content/SEO — city-specific pages, long-term organic play
### 7. Sub-ISO Partners — other brokers submit deals through MFunding's funder network (Year 2+)

### Funder Network Note
The funder tiers (A/B/C/D paper) in the Brokerage Playbook are MCA-specific. As MFunding expands into other products, the funder network will grow to include: SBA lenders (longer timeline, lower rates, bigger commissions), term loan providers, equipment financing companies, and line-of-credit providers. Each product type has different underwriting criteria, stip requirements, and commission structures. The pipeline and CRM handle all product types identically — the difference is which funder receives the submission.

---

## THE SALES FUNNEL — 9 STAGES

```
New Lead → Contacted → Qualifying → Application Sent → Docs Collected → Submitted to Funder → Offer Received → Offer Presented → Funded → Renewal Eligible
```

### Stage-by-Stage Metrics

| Stage | What Happens | Conversion Target | Key Metric |
|-------|-------------|-------------------|------------|
| 1. Lead Acquisition | Lead enters system | — | CPL $50–$75 blended |
| 2. Initial Contact | First conversation | 65%+ contact rate | Speed to contact < 60 sec (transfers), < 5 min (web) |
| 3. Qualification | BANT-F qualification | 55–65% of contacted | Revenue, time in biz, amount needed, industry |
| 4. Application Sent | App completed (ideally on first call) | 65–75% of qualified | Time to submit < 24 hours |
| 5. Docs Collected ⚠️ | Bank statements via Plaid or manual | 50–60% of apps | **#1 LEAK IN FUNNEL** — Plaid = 60 seconds vs. days for manual |
| 6. Submitted to Funder | Package sent to 3–5 funders | 55–65% approval rate | Track per-funder approval rates |
| 7. Offer Presented | Best offers shown to merchant | 70–80% acceptance | Always present 2+ offers |
| 8. Funded | Money deposited | 85–90% of accepted | Commission paid 5 biz days after funder pays |
| 9. Renewal Eligible | 40–60% paydown point | 45% take renewal | Auto-trigger at 40%, 60%, 75%, 100% paydown |

### The Golden Ratio
**Cost per funded deal < $1,500 AND average commission > $4,000 = profitable business.**

### Overall Close Rate Targets
- Month 1–3: 8% (learning, building funder relationships)
- Month 6: 10–12% (team improving, better funder matches)
- Month 12+: 12–14% (mature operations, renewal pipeline flowing)

---

## FOLLOW-UP SEQUENCES (Built as GHL Workflows)

### Sequence A: Stips/Docs Collection (14 days) — HIGHEST PRIORITY
- Day 0: Immediate SMS with Plaid link + photo/email alternatives
- Day 0 +2hr: Second SMS with secure upload link
- Day 1 AM: Call + SMS if no answer ("funder reviewing files today")
- Day 2: SMS with three easy methods listed
- Day 4: Call + voicemail drop + SMS
- Day 7: Urgency SMS ("pre-approval expiring")
- Day 10: Email (different channel)
- Day 14: Breakup SMS ("closing your file") → 10–15% re-engage from this message alone
- → Move to 30-day nurture

### Sequence B: No Answer / Never Reached (7 days)
- Day 0: Intro SMS → Day 0 +2hr: Call #2 → Day 1: SMS + email → Day 2: Call #3 + voicemail → Day 4: SMS → Day 7: Breakup SMS
- → Move to 60-day nurture

### Sequence C: Soft No / "Not Right Now" (90 days → quarterly forever)
- Day 0: Acknowledge respectfully → Day 30: Check-in → Day 45: Value content email → Day 60: "New programs" SMS → Day 75: Case study email → Day 90: Final check-in → Quarterly pings ongoing

### Sequence D: Offer Declined (45 days)
- Day 0: Call to understand objection → Resubmit to different funders → Day 1–3: Present new options → Day 7: One more option → Day 14: Breakup → Day 45: Re-engagement

### Sequence E: Funded Client → Renewal Pipeline
- Day 1: Congrats + Google review request + referral ask ($100 gift card)
- 40% paydown: "You may qualify for additional capital"
- 60% paydown: Call + SMS with renewal offer
- 75% paydown: "Best time to renew — most favorable terms"
- 100% paydown: Direct call for next round

### Sequence F: Mass Reactivation (monthly blast to dead leads)
- Rotate 3 message templates monthly
- Expected: 3–5% re-engagement rate → 15–25 fresh conversations per month on 500 dead leads at $0 cost

---

## GHL SETUP — PHASED IMPLEMENTATION

### Phase 1: Own Operations (Months 1–3)
- Agency account with funding.mfunding.com domain
- "MFunding Operations" sub-account
- 9-stage MCA Deal Pipeline
- Custom fields: Monthly Revenue, Time in Business, Industry, Lead Source, Target Market, Funding Amount
- City landing pages (clone from Indianapolis template)
- Auto-response workflow (instant SMS + email)
- Follow-up sequences (all 6 sequences above)
- AI Employee for 24/7 pre-qualification
- Local phone numbers per market
- Google Ads conversion tracking integration
- Reporting dashboard: lead source ROI, pipeline velocity, cost per funded deal

### Phase 2: Team Scaling (Months 4–9)
- Closer accounts with round-robin lead assignment
- VA account with limited permissions (doc collection, submissions)
- Sales manager account with full visibility
- Closer performance dashboards

### Phase 3: Sub-ISO White-Label Portal (Month 9+)
- MCA Brokerage Snapshot (pre-built template with everything)
- SaaS Mode activation with Stripe billing
- Sub-ISO pricing tiers: Starter $99/mo, Growth $149/mo, Pro $199/mo
- Sub-ISO recruitment funnel/landing page
- Usage rebilling with markup (SMS $0.0079 → $0.02, calls $0.014 → $0.03)
- Deal submission notification workflow (Sub-ISO moves to "Submit" → MFunding VA gets notified)

---

## FINANCIAL MODEL SUMMARY

### Phase-by-Phase Revenue

| Phase | Months | Team | Leads/Mo | Deals/Mo | Gross Rev/Mo | Net to Owner/Mo |
|-------|--------|------|----------|----------|-------------|----------------|
| 1: Solo | 1–3 | Just you | 35–70 | 3–7 | $11K–$28K | $8K–$20K |
| 2: +Closer 1 | 4–6 | You + 1 closer | 100 | 10–11 | $40K–$44K | $15K–$20K |
| 3: +VA +Closer 2 | 7–9 | You + 2 closers + VA | 140–150 | 15–20 | $62K–$84K | $23K–$33K |
| 4: +Sales Mgr | 10–12 | Full team | 180–200 | 22–28 | $90K–$115K | $28K–$38K |
| 5: Mature | 13–24 | 4–5 closers + 2 VAs + mgr + renewals | 200–300 | 28–48 | $110K–$190K | $35K–$65K |

### Annual Totals
- **Year 1 gross:** ~$680K → **Year 1 net to owner:** ~$305K
- **Year 2 gross:** ~$1.6M–$2.0M → **Year 2 net to owner:** ~$500K–$750K (before Sub-ISO override)

### Sub-ISO Additional Revenue (Year 2+)
- 5 Sub-ISOs × 4 deals/mo × $1,000 override = $20,000/month (nearly pure margin)
- 10 Sub-ISOs × 4 deals/mo × $1,000 override = $40,000/month
- Plus platform fees: $99–$199/mo per Sub-ISO = $990–$1,990/month recurring

### Break-Even
- Fixed costs: ~$1,247/month (GHL $497, Plaid $200, phone $150, hosting $50, insurance $200, misc $150)
- Break-even on fixed costs: 1 deal/month
- Break-even on ALL costs (including leads): 3 deals/month

### Hiring Triggers (Golden Rule: Never hire ahead of lead supply)
1. **YOU solo** → Day 1. Close all deals yourself. Prove unit economics.
2. **Closer #1** → When funding 5+ deals/month AND losing leads due to capacity
3. **VA** → When you + closer spend 30%+ time on admin/doc chasing
4. **Closer #2** → Lead flow >100/month AND Closer #1 at capacity
5. **Sales Manager** → 3+ closers AND you need off the sales floor
6. **Renewals Specialist** → Funded book >50 merchants AND 6+ months history
7. **Marketing** → Year 2, want to reduce CPL and internalize lead gen
8. **Sub-ISO Partners** → Strong funder relationships + GHL SaaS infra ready

---

## LEGAL DOCUMENTS IN PACKAGE

### 1. Independent Contractor Commission Agreement (v2_MCA_Commission_Agreement.docx)
- For 1099 MCA closers working under MFunding
- **⚠️ SCOPE FIX NEEDED:** Section 2 currently says "merchant cash advance (MCA) brokerage sales services." This should be updated to: **"business funding brokerage services including but not limited to merchant cash advances, term loans, lines of credit, equipment financing, SBA loans, and related commercial financing products"** — otherwise the non-compete and non-circumvention clauses may not cover non-MCA products.
- Schedule A: Fill-in rates for company-lead commission (rec: 40–50%), self-gen commission (rec: 60–70%), renewal commission (rec: 30–40%), optional draw against commission (rec: $2,500/mo for 90 days)
- Covers: scope of services, payment terms (5 biz days after funder pays), clawback provision, independent contractor status, non-solicitation (12 months), non-circumvention (12 months), confidentiality, TCPA/regulatory compliance, MCA-as-receivables-not-loans language
- Dispute resolution: binding arbitration in Miami-Dade County, FL

### 2. Sub-ISO Partner Agreement (v2_Sub_ISO_Partner_Agreement.docx)
- For Sub-ISO partners submitting deals through MFunding's funder network
- **⚠️ SCOPE FIX NEEDED:** Same as Commission Agreement — broaden scope language from MCA-only to all business funding products to ensure non-circumvention covers term loans, SBA, etc.
- Schedule A: MFunding override (rec: 2 points), monthly platform fee ($99–$199), SMS/phone usage rebilling
- Covers: funder access, GHL platform provision, deal submission workflow, independent contractor status, non-circumvention (18 months — longer than closer agreement), funder exclusivity, liquidated damages ($25K or 12 months commissions for circumvention breach), insurance requirement (E&O or GL minimum $500K), compliance obligations
- Auto-renewing 12-month terms with 60-day notice for non-renewal
- Platform access revoked within 48 hours of termination

### 3. GHL Platform Strategy (v2_GHL_Platform_Strategy.docx)
- Phased implementation plan for GoHighLevel SaaS Pro
- Phase 1 (Months 1–3): Own operations — pipeline, landing pages, workflows, AI Employee, phone, reporting
- Phase 2 (Months 4–6): Team scaling — closer accounts, VA permissions, round-robin assignment
- Phase 3 (Month 9+): Sub-ISO white-label — Snapshot template, SaaS Mode, Stripe billing, recruitment funnel, usage rebilling
- Complete feature map for MCA brokerage use
- Cost structure breakdown (all usage-based costs)
- Implementation checklist by month

### 4. Financial Model (v2_MCA_Brokerage_Financial_Model.xlsx)
- 9-tab workbook: Assumptions, Monthly P&L (12 months), Scenario Comparison (Conservative/Most Likely/Optimistic), Market Allocation, Break-Even Analysis, Scaling P&L (24 months with staffing phases), Compensation Guide, Hiring Roadmap, Sub-ISO Economics
- All formulas reference Assumptions tab — change one input, entire model updates
- Key input variables: lead costs, conversion rates, deal size, points, close rates, staff costs
- Includes ramp-up multiplier for realistic Month 1–12 projections

---

## DOCUMENTS PRODUCED IN THIS CONVERSATION

| Document | What It Contains |
|----------|-----------------|
| **V2_MFunding_Brokerage_Playbook.md** | Live transfer vendor list (with pricing), funder tiers (A/B/C/D paper), funder sourcing strategy, Google Ads keyword strategy, referral partnership plan, tech stack overview, compliance requirements, 90-day launch plan |
| **V2_MFunding_Campaign_Strategy.md** | 5 Google Ads campaigns with full keyword lists, ad copy (15 headlines + 4 descriptions), Spanish-language campaign, negative keywords list, live transfer hot market targeting (Priority 1/2/3), vendor qualification specs, financial projections by phase, weekly operations checklist, scaling decision tree |
| **V2_MFunding_Landing_Page.html** | Production-ready HTML landing page for mfunding.com. Navy/green/gold design, hero with lead form (name, business, phone, email, revenue, time in biz, amount needed), 3-step process, product grid, testimonials from target markets, FAQ section, CTA. Form handler ready for GHL webhook integration. |
| **V2_MFunding_Funnel_FollowUp_CRM.md** | Complete 9-stage funnel definition with metrics/targets/red flags at every stage, master metrics dashboard (12 KPIs), 6 complete follow-up sequences with word-for-word SMS/call/email scripts, GHL SaaS Pro setup guide with week-by-week priorities, daily operations workflow |
| **V2_Sales_Funnel_Diagram.mermaid** | Visual flowchart: lead acquisition → qualification → conversion → funding → recovery loop for dead leads |
| **V2_Follow_Up_Decision_Tree.mermaid** | Visual decision tree: 5 branches for why leads go cold, each leading to its own sequence |
| **V2_Funnel_Metrics_Waterfall.mermaid** | Visual waterfall: 175 leads → 123 contacted → 68 qualified → 44 apps → 22 stips → 12 offers → 9 accepted → 8 funded = $36K revenue |

---

## KEY TERMINOLOGY

| Term | Definition |
|------|-----------|
| **ISO** | Independent Sales Organization — brokerage that originates MCA deals |
| **Sub-ISO** | Smaller broker submitting deals through a larger ISO's funder network |
| **Funder** | Company that provides the actual capital |
| **MCA** | Merchant Cash Advance — purchase of future receivables, NOT a loan |
| **Points** | Commission percentage. 8 points on $50K = $4,000 |
| **Factor rate** | Multiplier on advance amount. 1.3 factor on $50K = $65K total payback |
| **Retrieval rate** | Daily/weekly % of sales debited from merchant's account |
| **Stips** | Stipulations — supporting documents needed (bank statements, ID, etc.) |
| **Stacking** | When a merchant takes multiple MCAs simultaneously |
| **UCC filing** | Public record filed when MCA is issued. Used to find merchants with existing MCAs |
| **Live transfer** | Pre-qualified lead connected live via phone to your closer |
| **Aged lead** | Older lead data (30+ days) sold at discount |
| **Snapshot** | GHL template with pre-built pipelines, workflows, landing pages, automations |
| **Sub-account** | Separate GHL workspace provisioned under your agency account |
| **SaaS Mode** | GHL feature for reselling the platform under your brand with automated billing |
| **Override** | Commission points kept by the ISO on Sub-ISO deals (typically 2 points) |
| **Draw** | Recoverable advance against future commissions during ramp-up |
| **Plaid Link** | Drop-in UI component for instant bank account verification |
| **LeadConnector** | GHL's built-in phone/SMS provider (Twilio-based) |
| **AI Employee** | GHL's conversational AI for chat and SMS pre-qualification |

---

## COMPLIANCE REMINDERS FOR ALL CODE/CONTENT

1. **MCAs are NOT loans.** When the product is an MCA, never use the word "loan" in marketing, landing pages, or SMS. Use "funding," "capital," "advance," or "working capital." However, when the product IS an actual loan (term loan, SBA, equipment financing, line of credit), standard lending terminology is correct and expected.
2. **Product-aware language:** Any automated communication (SMS sequences, emails, landing pages) that could apply to multiple product types should use neutral terms like "funding," "capital," or "business financing." Product-specific language applies only when the specific product is known.
3. **State disclosure laws** apply in NY, CA, VA, UT, FL, CT, GA, KS, TX, MO. Disclosure requirements differ between MCA products and loan products. Any application flow must include the correct disclosures for the product type.
4. **No upfront fees** — MFunding is compensated by funders/lenders, never by merchants.
5. **"No credit impact" from initial application** — only from formal funder/lender submission.

---

## WHAT TO BUILD NEXT (Prioritized)

1. **React application portal (apply.mfunding.com)** with Plaid Link integration — this is the competitive advantage that replaces manual bank statement collection. Should be designed to handle multiple product types (MCA, term loans, LOC, SBA, equipment financing) with product-specific stip requirements and disclosure flows. Start with MCA flow, add others as funder relationships expand.
2. **GHL Snapshot template** — pre-built MCA brokerage workflows for Sub-ISO deployment
3. **City-specific landing pages** on GHL — clone from template, update city name/tag/URL
4. **Spanish-language landing page** at funding.mfunding.com/financiamiento
5. **React main site (mfunding.com)** — brand hub, SEO content, "Apply Now" redirect to GHL
6. **Sub-ISO recruitment funnel** on GHL with Stripe payment integration
7. **Reporting dashboard** — custom analytics beyond GHL built-in (cost per funded deal by market/source)

---

*This context document should be loaded at the start of every Claude Code session involving MFunding development. It provides the complete business logic, terminology, architecture, and strategic rationale needed to make informed implementation decisions.*
