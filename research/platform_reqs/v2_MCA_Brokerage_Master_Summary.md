# MFunding.com — MCA Brokerage Business: Complete Operating Plan
## Master Summary Document for Claude Code
### Version 2.0 | March 2026

---

## 1. BUSINESS OVERVIEW

**Company:** MFunding, LLC (mfunding.com)
**Business Model:** Merchant Cash Advance (MCA) brokerage — we are an ISO (Independent Sales Organization) that connects small businesses needing working capital with funders who provide merchant cash advances.

**What is an ISO?**
An ISO (Independent Sales Organization) sits between the merchant (small business needing cash) and the funder (company providing capital). The ISO originates deals by finding merchants, qualifying them, collecting documentation, and submitting applications to funders. When a deal funds, the ISO earns commission points from the funder. MFunding is an ISO. We do NOT fund deals with our own money. We are the broker.

**What is an MCA?**
A Merchant Cash Advance is NOT a loan — it is a purchase of a percentage of the merchant's future receivables at a discount. The merchant remits a daily or weekly retrieval (ACH debit or card sales percentage) until the purchased amount plus fees is satisfied. This distinction is legally important for compliance and sales conversations.

**Industry hierarchy:**
```
Funder (has capital, underwrites, funds deals)
  → pays commission to →
ISO / Broker (MFunding — finds merchants, packages deals, submits to funders)
  → may pay split to →
Sub-ISO or Sales Rep (smaller broker or closer working under our umbrella)
```

---

## 2. MCA INDUSTRY ECONOMICS

- **Market size:** $30B+ annual U.S. funding volume, projected $65B globally by 2033
- **Typical MCA structure:** $10K–$250K advances, 3–18 month payback via daily/weekly ACH or card sales percentage
- **Broker commission:** 5–12 points (percentage of funded amount), typically 6–10 points
- **Renewal opportunity:** ~60% of MCA clients seek additional capital within 6 months
- **Application requirements:** 3–6 months bank statements, minimum $15K–$20K monthly revenue, 6+ months in business
- **Average deal size for modeling:** $50,000
- **Average commission points:** 8 points on new deals, 6 points on renewals

---

## 3. TARGET MARKETS (Validated for 2026)

Based on 2026 business formation data and growth indicators:

| Market | Allocation | Rationale |
|--------|-----------|-----------|
| Indianapolis, IN | 20% | #5 best state for business, major construction/infrastructure |
| Phoenix/Scottsdale, AZ | 20% | Job growth exceeding national average, tech sector expansion |
| Columbus/Cincinnati, OH | 20% | #4 best state, hospital and airport mega-projects |
| Washington DC/Northern Virginia | 15% | Data center boom ($178M YOY growth Loudoun County) |
| Sacramento, CA | 10% | State capital, government contractor demand |
| South Florida (home base) | 15% | Down 36% in new business formations YOY, but still viable |

**Critical context:** Florida declined 36% in new business formations from Jan 2025 to Jan 2026 after leading the nation in 2025. This validates the strategy of investing 85% of resources into out-of-state growth markets.

---

## 4. CUSTOMER ACQUISITION STRATEGY (Prioritized by ROI)

### 4.1 Live Transfer Leads (PRIMARY — Startup Phase)
- **Cost:** $50–$100 per lead
- **Close rate:** 20%+ when paired with fast underwriting
- **Mechanism:** Third-party providers pre-qualify merchants and connect them live to your closer via phone transfer
- **Top providers:** Master MCA, MCA Leads Pro, Lead Tycoons
- **Why primary:** Highest intent, immediate connection, best for proving model before scaling

### 4.2 Google Ads (Geo-Targeted)
- **Cost per lead:** $30–$80 for qualified prospects
- **Budget:** Start $50–$100/day split across target metros
- **Keywords:** "instant MCA funding approval", "business funding [city]", "merchant cash advance [city]"
- **Strategy:** Group by industry (food trucks, retail, e-commerce) for ad relevance. City-specific landing pages hosted on GHL.

### 4.3 Aged MCA Leads
- **Cost:** $0.50–$5 per lead
- **Conversion:** 10–30% with proper nurturing via GHL automation sequences
- **Use case:** Volume outreach, market testing, pipeline building

### 4.4 UCC Filing Data
- **Strategy:** Target businesses with existing MCAs (found via UCC filings)
- **Rationale:** 60% of MCA clients seek more capital within 6 months ("stacking strategy")
- **Best for:** Renewals specialist to work

### 4.5 Facebook/Instagram Retargeting
- **Approach:** Pixel-based retargeting for mfunding.com visitors
- **Content:** Short video testimonials (HeyGen for AI video production)
- **Messaging:** "Even with credit challenges, get funding fast"

### 4.6 Content + SEO (Long-Term)
- **Strategy:** City-specific landing pages: "Business Funding in Indianapolis"
- **Content types:** MCA vs bank loans comparisons, funding guides, industry-specific articles
- **Timeline:** 3–6 months to build organic traffic
- **Hosted on:** GHL website builder or mfunding.com React site

### 4.7 Broker Networks & Referrals
- **Partners:** Accountants, bookkeepers, business formation attorneys, financial advisors
- **Incentive:** $100 gift card per funded referral
- **Also:** Accept overflow leads from other brokers (sub-ISO model)

---

## 5. TECHNOLOGY STACK ARCHITECTURE

### 5.1 Core Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| CRM / Automation | GoHighLevel SaaS Pro ($497/mo) | Lead management, pipelines, SMS/email sequences, AI Employee, landing pages, white-label sub-accounts for sub-ISOs |
| Main Website | React (mfunding.com) | Brand hub, SEO content, trust/credibility |
| Campaign Landing Pages | GHL (funding.mfunding.com) | Per-city landing pages with GHL forms that auto-trigger CRM workflows |
| Bank Verification | Plaid API ($200/mo) | Instant access to 3–6 months transaction history — replaces manual bank statement collection |
| Application Portal | React + Plaid Link (apply.mfunding.com) | Custom portal where merchants connect bank accounts for instant verification |
| Phone System | GHL built-in or OpenPhone | Call tracking, recording, local numbers per market |
| Sub-ISO Portal | GHL SaaS Mode sub-accounts | White-labeled portal where sub-ISOs manage their own leads, landing pages, and pipeline |

### 5.2 Architecture: React Site + GHL Integration

```
mfunding.com (React)                    GHL (Landing Pages + CRM + Sub-ISO Portal)
─────────────────────                    ──────────────────────────────────────────
Main brand website                       Campaign pages (per city)
  └─ About / Trust / SEO                   └─ funding.mfunding.com/indianapolis
  └─ Blog / Educational content             └─ funding.mfunding.com/phoenix
  └─ "Apply Now" → redirects to GHL         └─ funding.mfunding.com/columbus
                                             └─ GHL forms capture leads
                                             └─ Auto SMS/email sequences
                                             └─ Pipeline tracking
                                             └─ AI Employee handles inbound
                                           Sub-ISO white-label portals
                                             └─ Each sub-ISO gets own GHL sub-account
                                             └─ Branded under MFunding or their brand
                                             └─ Own landing pages, pipeline, CRM
                                             └─ Deal submissions flow to MFunding
```

**Key design decision:** Use GHL for ALL campaign landing pages (not React site). Reason: GHL form submissions automatically trigger CRM entry, tagging, workflows, and follow-up sequences. Building this in React requires complex webhook/API integration.

**Subdomain approach:** Point `funding.mfunding.com` at GHL-hosted pages. User never knows they left the main site. React site serves as brand hub, SEO content, and general "Apply Now" redirects to GHL funnel.

### 5.3 Plaid Integration Details

**Where Plaid fits in the application flow:**
1. Lead comes in (live transfer or Google Ads) → GHL landing page
2. Qualification call (basic info collected in GHL CRM)
3. **APPLICATION STEP ← Plaid goes here**
   - Merchant connects bank via Plaid Link (drop-in UI component)
   - Instant access to 3–6 months transaction history
   - No more "email me your bank statements as PDFs"
   - Pre-qualify before submitting to funders
4. Submit to funder network with Plaid data
5. Funder underwrites and sends offers
6. Deal funds, broker earns commission

**Benefits for broker:**
- **Speed:** Real-time data vs 2–3 day wait for manual documents
- **Conversion:** Live transfers at $50–$100/lead require fast action; Plaid gets bank data in 60 seconds
- **Pre-qualification:** Verify reported income matches actual deposits before submitting to funders
- **Approval rates:** Better quality submissions improve funder relationships

**Implementation options:**
- Build custom application portal in React with Plaid Link integration (preferred for control)
- Use purpose-built MCA platforms (LendSaaS, TurnKey Lender) with Plaid already integrated

---

## 6. GOHIGHLEVEL PLATFORM STRATEGY (SaaS Pro Plan — $497/mo)

### 6.1 Why GHL SaaS Pro for MCA Brokerage

The SaaS Pro plan is critical because it unlocks TWO strategic capabilities:
1. **Running MFunding's own brokerage operations** (CRM, automation, landing pages, AI)
2. **White-labeling sub-accounts for sub-ISOs** (each sub-ISO gets their own branded portal to run their entire business through your platform)

### 6.2 GHL Features Map for MCA Brokerage

**PHASE 1 — Your Own Operations (Month 1–3):**

| GHL Feature | How MFunding Uses It |
|-------------|---------------------|
| **CRM / Contacts** | Central database of all merchant leads. Auto-tagged by source (live transfer, Google Ads, aged lead, UCC) and market (Indianapolis, Phoenix, etc.) |
| **Pipelines** | Visual deal tracker: New → Contacted → Qualifying → Application Sent → Docs Collected → Submitted to Funder → Offer Received → Offer Presented → Funded → Renewal Eligible |
| **Landing Pages / Funnels** | One landing page per target city. Each has a GHL form that captures: business name, owner name, phone, email, monthly revenue, time in business, funding amount needed |
| **Workflows (Automations)** | Auto-response (immediate text + email on form submission). Follow-up sequences (days 1, 3, 5, 7, 14 if no response). Lead assignment to closers. Pipeline stage change notifications. Renewal reminders at 5 months post-funding |
| **AI Employee (Conversational AI)** | Handles inbound texts and web chat. Pre-qualifies merchants with scripted questions. Books calls with closers. Responds 24/7 when team is offline |
| **Phone System** | Local phone numbers per market city (builds trust). Call recording for training. SMS/MMS capability. Missed call text-back automation |
| **Calendar / Booking** | Merchants can book consultation calls directly. Closers manage their availability. Reduces no-shows with automated reminders |
| **Email Marketing** | Nurture sequences for aged leads. Educational content drips. Monthly newsletter to funded merchants (renewal strategy) |
| **Reporting / Analytics** | Lead source ROI tracking. Pipeline conversion rates. Revenue per closer. Cost per funded deal by market |
| **Reputation Management** | Request Google reviews from funded merchants. Build trust signals for SEO and landing page social proof |
| **Social Media Planner** | Schedule posts across platforms. Not a primary channel but supports brand presence |

**PHASE 2 — Sub-ISO White-Label (Month 9+):**

| GHL Feature | How Sub-ISOs Use It |
|-------------|---------------------|
| **SaaS Mode** | Each sub-ISO gets their own GHL sub-account, automatically provisioned when they sign up |
| **White-Label Branding** | Sub-ISO sees MFunding branding (or optionally their own branding) when they log in. No GHL branding visible |
| **Sub-ISO Landing Pages** | Each sub-ISO can build their own landing pages within their sub-account for their own marketing |
| **Sub-ISO CRM** | Sub-ISO manages their own leads and pipeline. When they move a deal to "Submit to Funder" stage, it triggers notification to MFunding for processing |
| **Sub-ISO Automations** | Pre-built "Snapshot" (GHL template) gives sub-ISOs ready-made workflows: auto-responses, follow-ups, pipeline stages — all configured for MCA brokerage |
| **Stripe Rebilling** | Sub-ISOs can be charged a monthly platform fee ($99–$199/mo) for access, creating additional recurring revenue for MFunding |
| **Usage Billing** | SMS, email, and phone usage can be rebilled to sub-ISOs with markup |

### 6.3 GHL Setup Priority (Don't Get Overwhelmed)

**Week 1 — Foundation (must-haves only):**
1. Set up MFunding agency account with custom domain
2. Create ONE pipeline with stages: New → Contacted → Qualifying → Application Sent → Docs Collected → Submitted → Offer Received → Funded
3. Build ONE landing page template for first city (Indianapolis)
4. Create basic auto-response workflow: instant SMS + email on form submission
5. Set up phone number for first market

**Week 2 — Automation:**
1. Build follow-up sequence workflow (days 1, 3, 5, 7, 14)
2. Set up lead source tagging (different tags for live transfers vs Google Ads vs aged leads)
3. Clone Indianapolis landing page for Phoenix (second market)
4. Configure AI Employee for basic pre-qualification chat

**Week 3 — Scaling:**
1. Add remaining city landing pages (Columbus, DC, Sacramento, South Florida)
2. Set up closer assignment workflow (round-robin or by market)
3. Create renewal tracking workflow (trigger at 5 months post-funding)
4. Build internal notifications (Slack or email when deals hit key pipeline stages)

**Month 2–3 — Optimization:**
1. Add Google Ads integration for conversion tracking
2. Set up reporting dashboards (lead source ROI, pipeline velocity, closer performance)
3. Build content/SEO landing pages on main React site
4. Refine AI Employee scripts based on real conversations

**Month 6+ — Sub-ISO Infrastructure:**
1. Activate SaaS Mode
2. Build "MCA Brokerage Snapshot" — pre-configured template with all pipelines, workflows, landing page templates, and automations
3. Create sub-ISO onboarding funnel (sign-up page → Stripe payment → auto-provisioned sub-account with snapshot)
4. Configure Stripe rebilling for usage markup
5. Build sub-ISO training materials and documentation

### 6.4 GHL Snapshot Strategy for Sub-ISOs

A "Snapshot" in GHL is a pre-built template that includes pipelines, workflows, landing pages, email templates, and automations. When a sub-ISO signs up, the Snapshot is automatically deployed to their sub-account — giving them a fully operational MCA brokerage platform on day one.

**MFunding MCA Snapshot includes:**
- Pipeline: New → Contacted → Qualifying → Application → Docs → Submitted → Offer → Funded → Renewal
- Auto-response workflows (SMS + email)
- Follow-up nurture sequences (7-touch over 14 days)
- Landing page templates (customizable per city/market)
- Email templates (application link, funding congratulations, renewal outreach)
- AI Employee pre-qualification script for MCA
- Calendar booking page for consultations
- Reporting dashboard template

**This is the key value proposition for sub-ISOs:** They don't just get access to your funder network — they get a complete, operational business platform. They can build their own landing pages, run their own marketing, manage their own pipeline, and have automated follow-ups running 24/7. This makes your sub-ISO program stickier than competitors who just offer funder access.

### 6.5 GHL Cost Structure

| Item | Cost | Notes |
|------|------|-------|
| SaaS Pro Plan | $497/month | Includes unlimited sub-accounts, SaaS mode, white-label |
| SMS (outbound) | $0.0079/segment | Usage-based, rebillable to sub-ISOs with markup |
| Phone (local number) | $1.15/month each | One per market city = ~$7/month |
| Phone (inbound calls) | $0.0085/minute | Usage-based |
| Phone (outbound calls) | $0.014/minute | Usage-based |
| Email sending | $0.675/1,000 emails | Very low cost |
| AI Employee | Usage-based | Per conversation/message |
| White-label mobile app | Additional fee + $99/yr Apple | Optional for sub-ISOs |

**Rebilling opportunity:** With SaaS Mode, you can mark up all usage costs to sub-ISOs. If your cost for SMS is $0.0079/segment, you can rebill at $0.015 or $0.02/segment. This creates margin on every message a sub-ISO sends.

---

## 7. LEAD-TO-FUNDED AUTOMATION WORKFLOW

Complete automated flow in GoHighLevel:

```
LEAD ENTRY → GHL CRM
  │  Auto-tagged by source (live transfer / Google Ads / aged / UCC / sub-ISO)
  │  Auto-tagged by market (Indianapolis / Phoenix / Columbus / DC / Sacramento / SoFla)
  │
  ├─ IMMEDIATE AUTO-RESPONSE (within 60 seconds)
  │    Text: "Thanks for your interest in business funding! A funding advisor will call you within 5 minutes."
  │    Email: Value content + what to expect
  │
  ├─ LEAD ASSIGNMENT
  │    Round-robin to available closers (or market-based assignment)
  │    Internal notification to closer via SMS/Slack
  │
  ├─ FOLLOW-UP SEQUENCE (if no contact after initial attempt)
  │    Day 1: Second call attempt + text
  │    Day 3: Email with funding success story + call
  │    Day 5: Text with urgency ("Funding programs have limited availability this month")
  │    Day 7: Call + voicemail drop
  │    Day 14: Final attempt email + text
  │
  ├─ QUALIFICATION CALL (human closer or AI Employee)
  │    Collect: Monthly revenue, time in business, funding amount needed, use of funds
  │    CRM updated with qualification data
  │    Pipeline moved to: Qualifying → Application Sent
  │
  ├─ APPLICATION LINK SENT
  │    apply.mfunding.com (React portal with Plaid Link integration)
  │    Merchant connects bank account via Plaid
  │    3–6 months transaction data captured instantly
  │
  ├─ PRE-QUALIFICATION
  │    Automated scoring based on Plaid data (avg daily balance, deposit patterns, NSFs)
  │    Pipeline moved to: Docs Collected → Submitted to Funder
  │
  ├─ SUBMIT TO FUNDERS
  │    VA packages application + Plaid data
  │    Submits to 3–5 funders simultaneously for competing offers
  │
  ├─ OFFERS RECEIVED
  │    Closer presents best offer(s) to merchant
  │    Pipeline moved to: Offer Received → Offer Presented
  │
  ├─ DEAL FUNDS
  │    Commission paid by funder to MFunding
  │    Closer commission calculated and paid (per agreement)
  │    Pipeline moved to: Funded
  │    Auto-trigger: Google review request to merchant
  │
  └─ RENEWAL TRACKING
       5-month post-funding: Auto-text to merchant ("How's business? Might be time for additional capital")
       6-month: Renewals specialist outreach
       Pipeline moved to: Renewal Eligible
       If renewal funds: 6 points commission, 35% to renewals specialist
```

---

## 8. FINANCIAL MODEL SUMMARY (Most Likely Scenario)

### 8.1 Core Assumptions
- **Average deal size:** $50,000
- **Commission points (new):** 8 points = $4,000 per funded deal
- **Commission points (renewal):** 6 points = $3,000 per funded deal
- **Lead cost (blended avg):** $70/lead
- **Lead-to-fund conversion rate:** 8% (Month 1) → 14% (Month 24) as team improves
- **Renewal rate:** 45% of merchants seek additional capital at 6 months
- **Closer commission split:** 50% on company leads, 70% on self-generated
- **VA cost:** $1,200/month (offshore)
- **Sales manager:** $3,500/month base + 7% override on all team deals
- **Renewals specialist:** 35% of renewal commissions (commission-only)

### 8.2 Scaling Timeline & Financial Trajectory

| Phase | Months | Team | Leads/Mo | Deals Funded/Mo | Gross Revenue/Mo | Your Net/Mo |
|-------|--------|------|----------|-----------------|------------------|-------------|
| 1: Solo | 1–3 | Just you | 35–70 | 3–7 | $11K–$28K | $8K–$20K |
| 2: +Closer 1 | 4–6 | You + 1 closer | 100 | 10–11 | $40K–$44K | $15K–$20K |
| 3: +VA +Closer 2 | 7–9 | You + 2 closers + VA | 140–150 | 15–20 | $62K–$84K | $23K–$33K |
| 4: +Sales Mgr | 10–12 | You + 3 closers + VA + mgr + renewals | 180–200 | 22–28 | $90K–$115K | $28K–$38K |
| 5: Mature | 13–24 | 4–5 closers + 2 VAs + mgr + renewals + marketing | 200–300 | 28–48 | $110K–$190K | $35K–$65K |

### 8.3 Year 1 & Year 2 Totals (Most Likely)

- **Year 1 gross revenue:** ~$680K
- **Year 1 total expenses:** ~$375K
- **Year 1 net to owner:** ~$305K
- **Year 2 gross revenue:** ~$1.6M–$2.0M
- **Year 2 net to owner:** ~$500K–$750K (before sub-ISO override income)

### 8.4 Sub-ISO Economics (Additional Revenue — Phase 5)

| Metric | Value |
|--------|-------|
| Revenue per sub-ISO deal (2-point override on $50K avg) | $1,000 |
| Lead cost per sub-ISO deal | $0 (sub-ISO sources their own leads) |
| Closer cost per sub-ISO deal | $0 (sub-ISO does the selling) |
| Your effort per deal | Minimal (VA submits to funders) |
| Active sub-ISOs target (Year 2) | 5–10 |
| Deals per sub-ISO per month | 3–5 |
| Additional monthly revenue (5 sub-ISOs × 4 deals × $1,000) | $20,000 |
| Additional monthly revenue (10 sub-ISOs × 4 deals × $1,000) | $40,000 |
| GHL platform fee per sub-ISO (optional) | $99–$199/month |
| GHL platform recurring revenue (10 sub-ISOs × $149) | $1,490/month |

**Sub-ISO revenue is nearly pure margin** — no lead cost, no closer commission, minimal operational effort. This is the scaling lever that transforms MFunding from a brokerage into a platform business.

### 8.5 Break-Even Analysis
- **Fixed costs:** $1,247/month (GHL $497, Plaid $200, phone $150, hosting $50, insurance $200, misc $150)
- **Revenue per new deal (to you, after closer split):** $2,000 (at 50/50 split on $4,000 commission)
- **Revenue per deal you close yourself:** $4,000 (100%)
- **Deals to break even on fixed costs alone:** 1 deal/month
- **Deals to break even on ALL costs (including leads):** 3 deals/month

---

## 9. STAFFING & COMPENSATION

### 9.1 Hiring Sequence (Metric-Based Triggers)

| Order | Role | Trigger to Hire | Compensation |
|-------|------|----------------|--------------|
| 1 | YOU (solo) | Day 1 | Keep 100% of commissions |
| 2 | MCA Closer #1 | Funding 5+ deals/month AND losing leads due to capacity | 1099: 50% split company leads, 70% self-gen. Optional $2,500/mo draw for 90 days |
| 3 | VA / Deal Coordinator | You + closer spending 30%+ time on admin/doc chasing | $1,200/month offshore (Philippines/LatAm) |
| 4 | MCA Closer #2 | Lead flow >100/month AND Closer #1 at capacity | Same as Closer #1 |
| 5 | Sales Manager | 3+ closers AND you need to step off sales floor | $3,500/mo base + 7% override on all team deals |
| 6 | Renewals Specialist | Funded book >50 merchants AND 6+ months history | 1099: 35% split on renewal commissions. Commission-only |
| 7 | Marketing Person | Year 2, want to reduce CPL and internalize lead gen | $5,000/month salary. Performance bonus for CPL reduction |
| 8 | Sub-ISO Partners | Strong funder relationships + GHL SaaS infrastructure ready | You keep 1–2 point override. Optional $99–$199/mo platform fee |

### 9.2 Commission Math Examples

| Scenario | Deal Size | Points | Gross Commission | Split | Closer Gets | You Keep |
|----------|-----------|--------|-----------------|-------|-------------|----------|
| Company lead → Closer | $50,000 | 8 pts | $4,000 | 50% | $2,000 | $2,000 |
| Company lead → Closer | $100,000 | 8 pts | $8,000 | 50% | $4,000 | $4,000 |
| Self-gen → Closer | $50,000 | 8 pts | $4,000 | 70% | $2,800 | $1,200 |
| Renewal → Specialist | $50,000 | 6 pts | $3,000 | 35% | $1,050 | $1,950 |
| Sub-ISO deal | $50,000 | 8 pts | $4,000 | N/A | Sub keeps 6 pts ($3,000) | $1,000 (2-pt override) |
| YOU close directly | $50,000 | 8 pts | $4,000 | 0% | N/A | $4,000 |

### 9.3 Golden Rule
**Never hire ahead of your lead supply.** Each closer needs 40–50 leads/month to stay productive. If you hire before you have the leads, they'll starve and quit. Scaling sequence: **Prove leads convert → Hire closer → Add VA → Increase lead flow → Hire another closer → Repeat.**

### 9.4 Red Flags — Don't Hire Yet If:
- You haven't personally funded at least 15 deals (you won't know what good looks like)
- Your lead-to-fund conversion is below 8% (fix your process before scaling it)
- You don't have at least 3 funder relationships established
- Monthly revenue doesn't cover the new hire's expected cost within 60 days
- You're hiring to fix a conversion problem (hire for VOLUME, not QUALITY)

---

## 10. SUB-ISO PROGRAM DETAILS

### 10.1 What Sub-ISOs Get from MFunding

1. **Funder access:** Submit deals through MFunding's established funder network (5–7+ funders with competitive rates)
2. **GHL white-label platform:** Full CRM, pipeline management, landing page builder, automation workflows, AI Employee — all pre-configured for MCA brokerage via the MFunding Snapshot
3. **Plaid integration:** Access to bank verification through MFunding's Plaid setup
4. **Compliance support:** Pre-built disclosure templates for all required states (NY, CA, VA, UT, FL, TX)
5. **Training:** Onboarding materials, sales scripts, underwriting guidelines, funder submission requirements
6. **Deal processing:** MFunding's VA team handles funder submissions and offer management

### 10.2 What MFunding Gets from Sub-ISOs

1. **Override commission:** 1–2 points on every funded deal (typically 2 points)
2. **Platform fee:** $99–$199/month for GHL sub-account access (recurring revenue)
3. **Usage markup:** Rebilled SMS, email, and phone usage with margin
4. **Volume:** Additional funded deals improve MFunding's standing with funders (better rates, faster processing)
5. **Zero lead cost:** Sub-ISOs source their own merchants

### 10.3 Sub-ISO Platform Features (GHL Sub-Account)

Each sub-ISO gets their own GHL sub-account with:
- **Their own CRM:** Manage leads, contacts, and communication history
- **Their own pipeline:** Track deals from lead to funded, with stages matching MFunding's workflow
- **Landing page builder:** Create their own city-specific or industry-specific landing pages
- **Automation workflows:** Pre-built follow-up sequences, auto-responses, nurture campaigns
- **AI Employee:** Pre-configured for MCA pre-qualification conversations
- **Calendar booking:** Schedule consultations with their own prospects
- **Phone/SMS:** Local numbers, SMS capability, call recording
- **Reporting:** See their own deal pipeline, conversion rates, and commission history
- **Deal submission workflow:** When sub-ISO moves deal to "Submit" stage, it triggers notification to MFunding's operations team for processing

### 10.4 Sub-ISO Onboarding Flow (Automated via GHL)

1. Sub-ISO visits MFunding partner recruitment page
2. Fills out application form (experience, markets, expected volume)
3. MFunding reviews and approves
4. Sub-ISO receives sign-up link → Stripe payment for first month ($99–$199)
5. GHL SaaS Mode auto-provisions sub-account with MCA Snapshot deployed
6. Sub-ISO receives login credentials + onboarding email sequence
7. 30-minute kickoff call with MFunding (funder guidelines, compliance, platform walkthrough)
8. Sub-ISO begins sourcing and submitting deals

### 10.5 Sub-ISO Agreement Key Terms

- Non-circumvention: Sub-ISO cannot go directly to MFunding's funders
- Non-solicitation: Cannot poach MFunding's direct merchants or other sub-ISOs' merchants
- Compliance: Must follow all state disclosure requirements
- Commission: Sub-ISO keeps [8 minus override] points. MFunding keeps [override] points.
- Payment: Within 5 business days of funder payment to MFunding
- Platform fee: Monthly subscription for GHL access
- Termination: 14 days written notice by either party. Pipeline deals within 30 days still eligible for commission.

---

## 11. COMPLIANCE & REGULATORY

### 11.1 State Disclosure Requirements (as of 2025–2026)
- **New York:** Commercial Financing Disclosure Law — must provide standardized disclosure including APR equivalent, total cost, payment amounts
- **California:** SB 1235 — similar disclosure requirements for commercial financing
- **Virginia:** Commercial Financing Disclosure requirements
- **Utah:** Commercial Financing Registration Act
- **Florida:** Disclosure regime that indirectly affects brokers
- **Connecticut, Georgia, Kansas:** Various compliance requirements
- **Texas, Missouri:** Broker-specific registration fields added 2025

### 11.2 Federal Compliance
- **CFPB Section 1071:** If arranging ≥100 covered transactions annually, must collect and report demographic and pricing data (timeline depends on litigation)
- **TCPA:** All phone and SMS communications must comply. GHL handles opt-in/opt-out tracking
- **Licensing:** Check NMLS (Nationwide Multistate Licensing System) for each state of operation

### 11.3 MCA vs Loan Distinction
**Critical for all sales conversations and marketing:** MCAs are NOT loans. They are purchases of future receivables. Misrepresenting an MCA as a loan can create regulatory and legal issues. All closers, sub-ISOs, and marketing materials must maintain this distinction.

---

## 12. 90-DAY LAUNCH PLAN

### Month 1: Foundation
- [ ] Sign up for GHL SaaS Pro ($497/month)
- [ ] Set up MFunding agency account with custom domain (funding.mfunding.com)
- [ ] Build pipeline stages in CRM
- [ ] Create Indianapolis landing page (first market)
- [ ] Build auto-response workflow (instant SMS + email)
- [ ] Set up phone number for Indianapolis market
- [ ] Begin buying live transfer leads for Indianapolis (20–30/month to test)
- [ ] Establish first 3 funder relationships
- [ ] **Budget: $2,000–$3,500 (GHL + leads + phone)**

### Month 2: Second Market + Automation
- [ ] Clone landing page for Phoenix (second market)
- [ ] Build full follow-up sequence (7-touch, 14-day)
- [ ] Configure lead source tagging and reporting
- [ ] Set up AI Employee for pre-qualification
- [ ] Launch Google Ads for Indianapolis and Phoenix ($50/day each)
- [ ] Start building React application portal with Plaid Link
- [ ] Add Columbus landing page (third market)
- [ ] Scale live transfers based on Month 1 conversion data
- [ ] **Budget: $4,000–$6,000 (GHL + leads + Google Ads)**

### Month 3: Optimize + Prepare for Scaling
- [ ] Analyze cost-per-funded-deal by market and source
- [ ] Double down on best-performing markets/channels
- [ ] Add DC and Sacramento landing pages
- [ ] Refine AI Employee scripts
- [ ] Begin interviewing MCA closers (prep for Month 4 hire)
- [ ] Complete Plaid integration in application portal
- [ ] Build renewal tracking workflow (for future use)
- [ ] **Budget: $5,000–$8,000 (scaling profitable channels)**

---

## 13. CRITICAL SUCCESS FACTORS

1. **Speed to application:** Live transfers at $50–$100 require immediate response. Plaid enables 60-second bank verification vs 2–3 day wait.
2. **Funder relationships:** Need 3–5 funders minimum to submit deals for competing offers. Approval rate depends on lead quality + funder fit.
3. **Follow-up automation:** 20–30% of initially cold leads convert through nurturing. GHL workflows recover these automatically.
4. **Market focus:** Indianapolis, Phoenix, Columbus showing strongest growth. DC has infrastructure boom. South Florida declining but still viable.
5. **Conversion tracking:** Must track cost per lead by source AND by market to optimize spend. GHL reporting + Google Ads conversion tracking essential.
6. **Sub-ISO platform stickiness:** The more features sub-ISOs use in the GHL platform, the harder it is for them to leave. Pre-built Snapshot with full automation is the moat.
7. **Compliance discipline:** State disclosure laws are expanding rapidly. Use LendSaaS or similar for auto-generated compliance docs.

---

## 14. DOCUMENTS IN THIS PACKAGE

| Document | Description |
|----------|-------------|
| v2_MCA_Brokerage_Financial_Model.xlsx | 8-tab workbook: Assumptions, Monthly P&L, Scenario Comparison, Market Allocation, Break-Even, Scaling P&L (24-month with staffing), Compensation Guide, Hiring Roadmap |
| v2_MCA_Commission_Agreement.docx | 1099 Independent Contractor commission agreement for MCA closers. Includes Schedule A with fill-in rates, draw provisions, clawback, non-circumvention, compliance requirements |
| v2_Sub_ISO_Partner_Agreement.docx | Sub-ISO partner agreement covering funder access, platform usage, commission override structure, non-circumvention, compliance, platform fees |
| v2_GHL_Platform_Strategy.docx | GoHighLevel SaaS Pro setup guide: phased implementation for MFunding operations + white-label sub-ISO portal. Includes Snapshot strategy, automation workflows, cost structure |
| v2_MCA_Brokerage_Master_Summary.md | This document — comprehensive summary of all business strategy, economics, technology, staffing, and operations for Claude Code reference |

---

## 15. KEY TERMINOLOGY REFERENCE

| Term | Definition |
|------|-----------|
| **ISO** | Independent Sales Organization — a brokerage that originates MCA deals and submits to funders |
| **Sub-ISO** | A smaller broker who submits deals through a larger ISO's funder network |
| **Funder** | The company that provides the actual capital for the MCA |
| **MCA** | Merchant Cash Advance — purchase of future receivables, NOT a loan |
| **Points** | Commission percentage. 8 points on a $50K deal = $4,000 commission |
| **Factor rate** | The multiplier applied to the advance amount. A 1.3 factor rate on $50K means the merchant pays back $65K |
| **Retrieval rate** | The daily/weekly percentage of sales debited from the merchant's account |
| **Stacking** | When a merchant takes multiple MCAs simultaneously |
| **UCC filing** | Public record filed when an MCA is issued. Used to find merchants with existing MCAs |
| **Live transfer** | Pre-qualified lead connected live via phone to your closer |
| **Aged lead** | Older lead data (30+ days) sold at discount |
| **Snapshot** | GHL template containing pre-built pipelines, workflows, landing pages, and automations |
| **Sub-account** | A separate GHL account provisioned under your agency account for a client or sub-ISO |
| **SaaS Mode** | GHL feature that lets you resell the platform under your brand with automated billing |
| **Override** | Commission points kept by the ISO on sub-ISO deals (typically 1–2 points) |
| **Draw** | A recoverable advance against future commissions, paid during ramp-up period |

---

*Last updated: March 2026 | Version 2.0*
*Source conversation: Claude.ai strategic planning session*
*For use in Claude Code instance for ongoing development and reference*
