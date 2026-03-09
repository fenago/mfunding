# MFunding.com — Claude Code Project Context
## Everything Claude Code Needs to Know About This Business & Codebase
### Last Updated: March 2026

---

## WHAT THIS IS

This document summarizes the complete strategic planning conversation for MFunding, LLC — a Merchant Cash Advance (MCA) brokerage business. It was developed across an extensive Claude.ai session covering market strategy, lead acquisition, Google Ads campaigns, sales funnel design, follow-up automation sequences, CRM architecture (GoHighLevel SaaS Pro), financial modeling, staffing plans, legal agreements, and Sub-ISO partner program design.

**Use this as the master context file when working on any MFunding project in Claude Code.** All referenced documents are in the same package.

---

## BUSINESS IDENTITY

- **Company:** MFunding (Florida C-Corp)
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

## ARCHITECTURE DECISION

**GoHighLevel = Operational CRM for closers and VAs.** Do NOT replicate GHL features in React/Supabase.
**React + Supabase = Management layer, public site, portals, Plaid, analytics, compliance, eSignature, Google Workspace.**

### What GHL Handles (Do NOT Build)
- Live deal pipeline (drag-and-drop stages)
- SMS/email automation sequences (all 6 follow-up sequences)
- AI Employee for 24/7 pre-qualification
- Phone system with local numbers per market
- Landing pages at funding.mfunding.com/[city]
- Sub-ISO white-label portal (GHL sub-accounts)
- Lead round-robin assignment
- Missed-call text-back
- Google Ads conversion tracking

### What React + Supabase Handles (What We Build)
- Public marketing website (landing page, product pages, SEO content, about, contact)
- Customer application portal with Plaid Link (apply.mfunding.com)
- Admin dashboard (deal management, commission tracking, analytics, compliance)
- Merchant portal (deal status, document upload, offer review, contract signing)
- Plaid integration (bank verification, transaction analysis)
- Commission tracking and calculation engine
- GHL two-way sync (webhooks + API)
- Analytics and reporting (cost-per-funded-deal, pipeline velocity, closer performance)
- Compliance disclosure engine (state-specific)
- E-Docs & eSignature (contract templates, generation, embedded signing, vault)
- Google Workspace integration (Gmail, Calendar, Drive, Sheets, Docs, Meet, People)
- Underwriting workbench (configurable scorecard, risk dashboard)

---

## TECHNOLOGY STACK

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Frontend** | React 19 + Vite + TypeScript + Tailwind CSS + DaisyUI | Main website (mfunding.com) |
| **Database** | Supabase (PostgreSQL) | Database, auth, RLS, edge functions, storage |
| **Charts** | Recharts | Analytics dashboards |
| **CRM / Automation** | GoHighLevel SaaS Pro ($497/mo) | Lead management, pipelines, SMS/email automation, AI Employee, Sub-ISO white-label portal |
| **Campaign Landing Pages** | GHL page builder | funding.mfunding.com/[city] — per-city pages with auto-CRM integration |
| **Bank Verification** | Plaid API | Instant 3-6 month bank transaction history |
| **Application Portal** | React + Plaid Link | apply.mfunding.com — custom portal for instant bank verification |
| **Phone System** | GHL built-in (LeadConnector) | Call tracking, recording, local numbers per market |
| **AI** | Google Gemini 2.0 | Customer recommendations, AI-powered matching |
| **Web Scraping** | Firecrawl + Hyperbrowser | Lender/vendor website analysis |
| **Deployment** | Netlify (primary), Vercel (backup) | Hosting and CI/CD |

### Architecture

```
mfunding.com (React + Vite)                GHL (Landing Pages + CRM + Sub-ISO Portal)
─────────────────────────────              ──────────────────────────────────────────
Main brand website                         Campaign pages (per city)
  └─ About / Trust / SEO                     └─ funding.mfunding.com/indianapolis
  └─ Product pages (business loans, CRE)     └─ funding.mfunding.com/phoenix
  └─ Blog / Educational content              └─ funding.mfunding.com/columbus
  └─ Customer portal (/portal/*)             └─ funding.mfunding.com/financiamiento (Spanish)
  └─ Admin dashboard (/admin/*)           Sub-ISO white-label portals
  └─ "Apply Now" → redirects to GHL         └─ Each Sub-ISO gets own GHL sub-account

apply.mfunding.com (React + Plaid)
  └─ Merchant connects bank via Plaid
  └─ 60-second bank verification
  └─ 3-6 months transaction data
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
| 5. Docs Collected | Bank statements via Plaid or manual | 50–60% of apps | **#1 LEAK IN FUNNEL** — Plaid = 60 seconds vs. days for manual |
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

## DATABASE (Supabase)

All tables use UUID primary keys and have RLS enabled. Key existing tables:
- **profiles** — User accounts (roles: user, admin, super_admin)
- **customers** — CRM pipeline (statuses: lead → contacted → application_submitted → in_review → approved → funded → renewed → declined → follow_up)
- **customer_interactions** — Activity history per customer
- **customer_documents** — Document management per customer
- **lenders** — Funder network (39 lenders with types, requirements, commission structures)
- **lender_documents** — Lender agreement/rate sheet storage
- **marketing_vendors** — Lead vendor management (11 vendors)
- **messages** — Internal messaging system
- **kanban_tasks** — Internal project management
- **funding_applications** — Public intake form submissions
- **activity_log** — Polymorphic audit trail across entities
- **company_documents** — Internal company documents
- **documents / document_chunks / document_embeddings** — AI/RAG document system

---

## ROUTE STRUCTURE

### Public Routes
- `/` — Landing page
- `/about`, `/contact`, `/privacy`, `/terms`
- `/business-loans`, `/business-loans/:slug`
- `/real-estate`, `/real-estate/:slug`
- `/auth/sign-in`, `/auth/sign-up`

### Customer Portal (authenticated)
- `/portal/` — Dashboard
- `/portal/documents` — Document management
- `/portal/inbox` — Messaging

### Admin (admin + super_admin)
- `/admin/` — Dashboard
- `/admin/todos` — Kanban board
- `/admin/customers`, `/admin/customers/:id`
- `/admin/analytics`, `/admin/analytics/realtime`

### Super Admin only
- `/admin/lenders`, `/admin/lenders/:id`, `/admin/lenders/resources`
- `/admin/marketing`, `/admin/marketing/:id`, `/admin/marketing/resources`
- `/admin/unit-economics`, `/admin/bmc`, `/admin/settings`

---

## CODING CONVENTIONS

- React 19 functional components with TypeScript
- Tailwind CSS + DaisyUI for styling
- Supabase client at `src/supabase/index.ts`
- Path alias: `@` maps to `src/`
- Context providers in `src/context/`
- Custom hooks in `src/hooks/`
- Services in `src/services/`
- Types in `src/types/`

---

## LEGAL DOCUMENTS IN PACKAGE

### 1. Independent Contractor Commission Agreement (v2_MCA_Commission_Agreement.docx)
- For 1099 MCA closers working under MFunding
- Schedule A: Fill-in rates for company-lead commission (rec: 40–50%), self-gen commission (rec: 60–70%), renewal commission (rec: 30–40%), optional draw against commission (rec: $2,500/mo for 90 days)
- Covers: scope of services, payment terms (5 biz days after funder pays), clawback provision, independent contractor status, non-solicitation (12 months), non-circumvention (12 months), confidentiality, TCPA/regulatory compliance, MCA-as-receivables-not-loans language

### 2. Sub-ISO Partner Agreement (v2_Sub_ISO_Partner_Agreement.docx)
- For Sub-ISO partners submitting deals through MFunding's funder network
- Schedule A: MFunding override (rec: 2 points), monthly platform fee ($99–$199), SMS/phone usage rebilling
- Covers: funder access, GHL platform provision, deal submission workflow, independent contractor status, non-circumvention (18 months), funder exclusivity, liquidated damages ($25K or 12 months commissions for circumvention breach), insurance requirement (E&O or GL minimum $500K), compliance obligations

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

## BUILD PLAN

The master build plan is at **`/plan_goals.md`** — it contains the full database schema (14 new tables), 10 agent teams with task lists, API key requirements, LendSaaS competitive audit, and 5-phase build sequencing with an 8-week parallel work map. Start any build session by reading that file.

---

## KEY REFERENCE DOCUMENTS

All strategy documents are in `/research/platform_reqs/`:

| Document | Contents |
|----------|---------|
| `V2_MFunding_Claude_Code_Context.md` | Master business context (source for this CLAUDE.md) |
| `V2_MFunding_Brokerage_Playbook.md` | Live transfer vendor list, funder tiers, Google Ads keywords, referral plan, compliance, 90-day launch plan |
| `V2_MFunding_Campaign_Strategy.md` | 5 Google Ads campaigns with keywords, ad copy, Spanish-language, negative keywords, projections |
| `V2_MFunding_Funnel_FollowUp_CRM.md` | 9-stage funnel metrics, 12 KPIs, 6 follow-up sequences with scripts, GHL setup guide |
| `V2_MFunding_Landing_Page.html` | Production-ready HTML landing page (navy/green/gold design, lead form, testimonials) |
| `V2_Sales_Funnel_Diagram.mermaid` | Visual flowchart: lead acquisition → qualification → conversion → funding → recovery |
| `V2_Follow_Up_Decision_Tree.mermaid` | Decision tree: 5 branches for why leads go cold → each leads to its own sequence |
| `V2_Funnel_Metrics_Waterfall.mermaid` | Waterfall: 175 leads → 8 funded = $36K revenue |
| `v2_MCA_Brokerage_Master_Summary.md` | Complete operating plan for the MCA brokerage |
| `Product Requirements Document.md` | Full PRD v1.1 — 11 modules (Plaid, eSignature, Portals, Underwriting, Collections, Syndication) |
| `mFunding SaaS Platform_ Comprehensive User Journeys & Daily Workflows.md` | Daily workflows for every persona (Sub-ISO Admin, Closer, Merchant, Underwriter, Super Admin) |
| `mFunding SaaS Platform_ Google Workspace Integration Specification.md` | Gmail, Calendar, Drive, Sheets, Docs, Meet, People API integration specs |
| `mFunding SaaS Platform_ Claude Code Agent Team Architecture.md` | Manus AI agent architecture (reference only — we use our own 10-team structure in plan_goals.md) |

---

*This context document is loaded at the start of every Claude Code session involving MFunding development. It provides the complete business logic, terminology, architecture, and strategic rationale needed to make informed implementation decisions.*
