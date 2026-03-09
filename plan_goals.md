# MFunding Platform — Master Build Plan
## Complete Strategy, Schema, Agent Teams, APIs & LendSaaS Audit
### Version 2.0 | March 2026

---

## TABLE OF CONTENTS

1. [Platform Vision & Architecture Decision](#1-platform-vision--architecture-decision)
2. [PRD Module Map — 11 Modules](#2-prd-module-map--11-modules)
3. [User Journeys & Personas](#3-user-journeys--personas)
4. [LendSaaS Feature Audit & Gap Analysis](#4-lendsaas-feature-audit--gap-analysis)
5. [Current State — What Exists Today](#5-current-state--what-exists-today)
6. [Database Schema — What Needs to Be Built](#6-database-schema--what-needs-to-be-built)
7. [Agent Teams — Who Builds What](#7-agent-teams--who-builds-what)
8. [APIs, Keys & External Services Required](#8-apis-keys--external-services-required)
9. [Build Priority & Sequencing](#9-build-priority--sequencing)

---

## 1. PLATFORM VISION & ARCHITECTURE DECISION

### The Decision
MFunding will NOT replicate GoHighLevel's CRM capabilities in the React/Supabase app. Instead:

- **GoHighLevel SaaS Pro ($497/mo)** = Operational CRM for closers and VAs
  - Live deal pipeline (drag-and-drop stages)
  - SMS/email automation sequences (all 6 follow-up sequences)
  - AI Employee for 24/7 pre-qualification
  - Phone system with local numbers per market
  - Landing pages at funding.mfunding.com/[city]
  - Sub-ISO white-label portal (GHL sub-accounts)
  - Lead round-robin assignment
  - Missed-call text-back
  - Google Ads conversion tracking

- **React + Supabase (mfunding.com)** = Management Layer + Public Site + Portals
  - Public marketing website (landing page, product pages, SEO content, about, contact)
  - Customer application portal with Plaid Link (apply.mfunding.com)
  - Customer self-service portal (document upload, deal status, messaging)
  - Admin management dashboard (analytics, lender management, commission tracking, Sub-ISO oversight, vendor tracking)
  - AI-powered lender matching and recommendations
  - Reporting and business intelligence (cost per funded deal, pipeline velocity, ROI by channel)
  - Compliance document generation and tracking
  - Internal project management (kanban board — already built)

### Integration Strategy
GHL and Supabase communicate via:
- **GHL Webhooks → Supabase Edge Functions**: When a lead enters GHL or a deal changes stage, webhook fires to Supabase to sync data
- **Supabase → GHL API**: When admin actions in React need to push data to GHL (e.g., create contact, trigger workflow)
- **Plaid → Supabase**: Bank verification data stored in Supabase, summary sent to GHL as custom field or note
- **Google Workspace → Supabase**: Gmail sync, Calendar events, Drive document storage, all via OAuth 2.0
- **eSignature Provider → Supabase**: Contract generation, embedded signing, webhook status updates

---

## 2. PRD MODULE MAP — 11 MODULES

The platform is organized into 11 modules (from PRD v1.1). Each module maps to specific agent team responsibilities.

| Module | Name | What It Does | Primary Owner |
|---|---|---|---|
| **M1** | Lending Operations Core | Deal lifecycle from lead to funded — the 9-stage pipeline, deal management, offer handling | Backend Team + Deal Pipeline Agent |
| **M2** | CRM & Automation Core (GHL) | White-labeled GHL: contacts, pipelines, SMS/email, AI Employee, Sub-ISO sub-accounts | GHL Integration Agent |
| **M3** | ISO & Sub-ISO Partner Management | Sub-ISO onboarding, white-label portal, commission overrides, platform fees, performance tracking | Commission Agent + Sub-ISO Management |
| **M4** | Underwriting & Risk Intelligence | Bank data analysis (Plaid/Ocrolus), credit pulls (Experian), business verification, underwriting scorecard | Plaid Agent + Financial Data Agent |
| **M5** | Plaid Integration | Full Plaid workflow: Link, Auth, Identity, Transactions, Assets, Income, Statements | Plaid Integration Agent |
| **M6** | Collections & Servicing | NOT NEEDED for broker model. Funders handle ACH collections. MFunding tracks paydown for renewals only. | N/A (broker) |
| **M7** | Syndication Management | NOT NEEDED Phase 1. Future if MFunding funds directly. | N/A (future) |
| **M8** | E-Docs, Contract Generation & eSignature | Dynamic contract templates, merge fields, conditional clauses, embedded eSignature (DocuSign/SignNow), E-Doc vault | eSignature Integration Agent |
| **M9** | Portals (ISO, Merchant, Syndicator) | Merchant portal (status tracker, doc upload, offer acceptance, e-sign), ISO agent portal (Today View, pipeline, communication) | Portal Agent + Frontend Team |
| **M10** | Reporting & Analytics | Master KPI dashboard, funnel waterfall, cost-per-deal, closer/lender/market performance, export to Google Sheets | Analytics Agent |
| **M11** | Platform Administration & White-Label | Global settings, pipeline config, contract templates, API key management, white-label branding, user/role management | Backend Team |

---

## 3. USER JOURNEYS & PERSONAS

### 3.1 Sub-ISO Admin (Business Owner)
- **Onboarding:** Receives invitation → branded signup → logo/branding setup → agree to terms → banking info for payouts → GHL sub-account provisioned → onboarding checklist (branding, invite team, review workflows)
- **Daily:** Morning dashboard (team leaderboard, aggregate pipeline, revenue/commissions) → deal oversight → lead reassignment → commission reports → performance analytics

### 3.2 Sub-ISO Agent / Closer (Power User)
- **"Today View":** Prioritized task list, new leads, unread messages in Unified Inbox
- **Daily workflow:** Work new leads (Kanban pipeline) → document follow-up → receive Plaid notifications → submit for underwriting → receive offers → present offers via branded Offer Link → handle acceptance → send contracts for eSignature → deal funded → commission appears in pending report
- **Key UI:** Deal Detail View with communication panel, document tab, funder submissions tab, offer presentation, contract review

### 3.3 Merchant (End Borrower)
- **Journey:** Fill out application → receive portal invitation → login to portal → see Status Tracker (Application Submitted → Under Review → Offer Ready) → Document Checklist with Plaid button → upload docs or connect bank → receive offer notification → view/accept offer → review & e-sign contract → status updates to "Funded!" → post-funding: see balance, next payment, payment history
- **Key UI:** Visual Status Tracker, Document Checklist, Plaid Link (prominent), Offer Page with Accept button, embedded eSignature

### 3.4 Underwriter
- **Underwriting Workbench:** Select deal from queue → review Risk Dashboard (Plaid ADB, NSFs, credit score, business verification) → fill Underwriting Scorecard → submit to funders (select specific funders) or decline (reason code)
- **Key data:** ADB, monthly deposits, NSF count, negative days, existing MCA payments, largest single deposit, risk flags

### 3.5 Super Admin (God Mode)
- **Dashboard:** Platform-wide aggregates (total funded volume, revenue, new deals across all accounts)
- **Management:** Sub-ISO onboarding panel, subscription management, performance reports per partner
- **Configuration:** Pipeline stages, contract templates, underwriting scorecard weights, API keys, white-label branding

---

## 4. LENDSAAS FEATURE AUDIT & GAP ANALYSIS

LendSaaS is the leading MCA origination & servicing platform. Below is a complete audit of their features and how MFunding's GHL + React/Supabase stack covers each one.

### LendSaaS Feature Inventory

| # | LendSaaS Feature | Description | MFunding Coverage | Notes |
|---|---|---|---|---|
| 1 | **Deal Pipeline / CRM** | Visual deal tracking from application to funding | GHL Pipeline (9 stages) | Covered by GHL |
| 2 | **Lead Intake & Management** | Capture leads from multiple sources, tag, assign | GHL CRM + webhooks | Covered by GHL |
| 3 | **ISO/Broker Portal** | White-label portal for brokers to submit deals | GHL SaaS Mode sub-accounts | Covered by GHL Sub-ISO portal |
| 4 | **Customizable Underwriting Flows** | Configure underwriting criteria, auto-scoring | BUILD NEEDED | React admin + AI matching engine |
| 5 | **Application Management** | Digital application intake, status tracking | GHL forms + React portal | GHL for intake, React for customer-facing portal |
| 6 | **Bank Statement Parsing** | AI-powered bank statement analysis | BUILD NEEDED (Plaid + Ocrolus) | Plaid for live data; consider Ocrolus for PDF parsing |
| 7 | **Plaid Integration** | Real-time bank account verification and transaction data | BUILD NEEDED | Priority 1 — React app + Supabase |
| 8 | **Credit Bureau Integration** | Experian, Thomson Reuters CLEAR for credit checks | BUILD NEEDED | Phase 2 — Experian API integration |
| 9 | **Automated ACH Collections** | Schedule daily/weekly ACH pulls, track repayment | NOT NEEDED (broker, not funder) | MFunding is the broker, not the funder. Funders handle ACH. |
| 10 | **Contract Generation** | Auto-generate funding contracts | NOT NEEDED (broker) | Funders generate contracts. MFunding generates commission agreements (already have templates). |
| 11 | **Syndication Management** | Manage multiple investors, allocations, returns | NOT NEEDED (Phase 1) | Future consideration if MFunding ever funds directly |
| 12 | **White Label** | Brand the platform for partners | GHL SaaS Mode | Covered — Sub-ISOs get branded GHL sub-accounts |
| 13 | **Compliance & Disclosure Automation** | Auto-generate state-specific disclosures (NY, CA, VA, etc.) | BUILD NEEDED | React admin — generate disclosures based on merchant state + product type |
| 14 | **Audit Trail** | Tamper-resistant records of all deal activity | PARTIALLY BUILT | `activity_log` table exists. Needs expansion for compliance-grade audit trail. |
| 15 | **Renewal Automation** | Monitor paydown %, auto-identify renewal opportunities | BUILD NEEDED | React admin + GHL workflow triggers at 40/60/75/100% paydown |
| 16 | **Automated Payment Tracking** | Track repayment progress, missed payments, alerts | NOT NEEDED (broker) | Funders track repayment. MFunding tracks commission payments. |
| 17 | **Reporting & Analytics** | Performance dashboards, market trends, financial performance | PARTIALLY BUILT | Analytics pages exist. Need deal-level reporting, cost-per-funded-deal by source/market, closer performance. |
| 18 | **Document Management** | Upload, store, organize documents per deal | PARTIALLY BUILT | `customer_documents` and `lender_documents` tables exist. Need enhanced upload flow + document status tracking. |
| 19 | **Communication Tools** | Direct messaging, status updates, notifications | GHL + React | GHL handles SMS/email automation. React handles internal messaging (already built). |
| 20 | **Deal Submission to Multiple Funders** | Submit deal packages to 3-5 funders simultaneously | BUILD NEEDED | Core feature — `deal_submissions` table + admin UI to package and submit to lender network |
| 21 | **Offer Comparison** | Present multiple funder offers side-by-side | BUILD NEEDED | React admin — compare offers by factor rate, term, amount, daily payment |
| 22 | **Commission Tracking** | Track commissions per deal, splits, overrides, payments | BUILD NEEDED | `commissions` table + admin UI |
| 23 | **Stips/Document Collection Workflow** | Track required documents per deal, status, follow-up | BUILD NEEDED | GHL automation handles follow-up. React tracks document status per deal. |
| 24 | **Funder Matrix / Matching** | Match deal profile to best-fit funders based on criteria | BUILD NEEDED | AI-powered matching using lender requirements data (already in `lenders` table) |

### Key Takeaway
**MFunding does NOT need LendSaaS** because:
- MFunding is a **broker**, not a funder. LendSaaS's core value (ACH collections, contract generation, syndication, payment tracking) serves funders. MFunding doesn't need these.
- The **broker-specific features** (deal pipeline, lead management, follow-up automation, ISO portal) are better served by GHL which also provides SMS/email/phone automation that LendSaaS doesn't.
- The **gaps** (Plaid integration, lender matching, commission tracking, compliance disclosures, analytics) are exactly what we're building in React/Supabase.

### Features We Must Build That LendSaaS Has

| Priority | Feature | Where It's Built |
|---|---|---|
| P0 | Plaid bank verification | React portal + Supabase |
| P0 | Deal submission to multiple funders | React admin + Supabase |
| P0 | Commission tracking & splits | React admin + Supabase |
| P1 | Offer comparison (side-by-side) | React admin |
| P1 | Compliance disclosure automation | React admin + Supabase |
| P1 | Renewal tracking (paydown monitoring) | Supabase + GHL webhook triggers |
| P1 | Funder matching engine (AI-powered) | React admin + Gemini AI |
| P2 | Credit bureau integration (Experian) | Supabase edge function |
| P2 | Bank statement PDF parsing (Ocrolus) | Supabase edge function |
| P2 | Advanced reporting (cost-per-deal by source) | React admin + Supabase views |

---

## 5. CURRENT STATE — WHAT EXISTS TODAY

### Tech Stack (Already Deployed)
- React 19 + Vite + TypeScript + Tailwind CSS + DaisyUI
- Supabase (PostgreSQL) — 19 tables with RLS
- Google Gemini 2.0 — AI recommendations
- Firecrawl + Hyperbrowser — Web scraping
- Recharts — Analytics charts
- Netlify (primary deployment)
- Framer Motion — Animations

### Existing Database Tables (19)
| Table | Rows | Status |
|---|---|---|
| profiles | 1 | Working — user/admin/super_admin roles |
| customers | 0 | Schema ready, no data |
| customer_interactions | 0 | Schema ready |
| customer_documents | 0 | Schema ready |
| lenders | 39 | Populated with funder network |
| lender_documents | 26 | Populated |
| marketing_vendors | 11 | Populated |
| messages | 0 | Schema ready |
| kanban_tasks | 155 | Actively used for project management |
| task_comments | 0 | Schema ready |
| task_activity | 0 | Schema ready |
| kanban_phases | 8 | Populated |
| kanban_categories | 24 | Populated |
| funding_applications | 0 | Public intake form — schema ready |
| documents | 4 | Document storage |
| document_chunks | 0 | RAG system |
| document_embeddings | 0 | RAG system (RLS disabled) |
| company_documents | 4 | Internal docs |
| activity_log | 5 | Polymorphic audit trail |

### Existing Routes
**Public:** Landing page, About, Contact, Privacy, Terms, Business Loans, Real Estate, Auth
**Customer Portal:** Dashboard, Documents, Inbox
**Admin:** Dashboard, Kanban, Customers, Analytics
**Super Admin:** Lenders, Marketing Vendors, Unit Economics, BMC, Settings

### What's Working Well
- Landing page with product showcase
- Admin dashboard with lender management (39 lenders loaded)
- Marketing vendor tracking (11 vendors loaded)
- Kanban board for internal project management
- Authentication with role-based access control
- Document management infrastructure
- AI-powered customer recommendations (Gemini)

### What's Missing (The Build)
- Plaid integration (bank verification)
- Deal pipeline with multi-funder submission
- Commission tracking and calculation
- GHL integration (webhooks, API sync)
- Follow-up sequence tracking
- Renewal monitoring
- Compliance disclosure engine
- Enhanced analytics (cost-per-deal, pipeline velocity)
- Customer application portal
- Sub-ISO management dashboard
- Funder matching engine
- E-Docs & eSignature engine (contract templates, dynamic generation, embedded signing, E-Doc vault)
- Google Workspace integration (Gmail sync, Calendar events, Drive folders, Sheets export, Meet links, People sync)
- Underwriting workbench (configurable scorecard, risk dashboard, Plaid data consolidation)

---

## 6. DATABASE SCHEMA — WHAT NEEDS TO BE BUILT

### New Tables Required

#### 4.1 `deals` — Individual Funding Deals
```sql
CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  deal_number TEXT UNIQUE, -- MF-2026-0001
  deal_type TEXT NOT NULL CHECK (deal_type IN ('mca', 'term_loan', 'line_of_credit', 'sba', 'equipment_financing')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new', 'contacted', 'qualifying', 'application_sent', 'docs_collected',
    'submitted_to_funder', 'offer_received', 'offer_presented', 'funded',
    'renewal_eligible', 'declined', 'dead'
  )),
  amount_requested NUMERIC,
  amount_funded NUMERIC,
  use_of_funds TEXT,
  urgency TEXT,
  application_type TEXT CHECK (application_type IN ('mini_app', 'full_app')),
  plaid_connection_id UUID REFERENCES plaid_connections(id),
  -- Timestamps for each stage
  contacted_at TIMESTAMPTZ,
  qualified_at TIMESTAMPTZ,
  application_sent_at TIMESTAMPTZ,
  docs_collected_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  offer_received_at TIMESTAMPTZ,
  offer_presented_at TIMESTAMPTZ,
  funded_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  -- Assignment
  assigned_closer_id UUID REFERENCES profiles(id),
  lead_source TEXT,
  lead_source_detail TEXT,
  market TEXT, -- indianapolis, phoenix, columbus, dc, sacramento, south_florida
  -- Renewal tracking
  is_renewal BOOLEAN DEFAULT false,
  original_deal_id UUID REFERENCES deals(id),
  renewal_count INTEGER DEFAULT 0,
  paydown_percentage NUMERIC DEFAULT 0,
  renewal_eligible_date DATE,
  -- GHL sync
  ghl_contact_id TEXT,
  ghl_opportunity_id TEXT,
  --
  notes TEXT,
  tags TEXT[] DEFAULT '{}',
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### 4.2 `deal_submissions` — Submissions to Individual Funders
```sql
CREATE TABLE deal_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id),
  lender_id UUID NOT NULL REFERENCES lenders(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'submitted', 'under_review', 'approved', 'declined',
    'offer_made', 'offer_accepted', 'offer_declined', 'funded', 'withdrawn'
  )),
  submitted_at TIMESTAMPTZ,
  response_at TIMESTAMPTZ,
  submitted_by UUID REFERENCES profiles(id),
  -- Offer details (populated when funder responds)
  offer_amount NUMERIC,
  factor_rate NUMERIC,
  term_months INTEGER,
  daily_payment NUMERIC,
  weekly_payment NUMERIC,
  total_payback NUMERIC,
  commission_points NUMERIC,
  commission_amount NUMERIC,
  -- Decline details
  decline_reason TEXT,
  -- Notes
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### 4.3 `commissions` — Commission Tracking
```sql
CREATE TABLE commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id),
  deal_submission_id UUID REFERENCES deal_submissions(id),
  -- Amounts
  gross_commission NUMERIC NOT NULL, -- Total from funder
  commission_points NUMERIC NOT NULL,
  -- Splits
  closer_id UUID REFERENCES profiles(id),
  closer_split_percentage NUMERIC, -- 50% or 70%
  closer_amount NUMERIC,
  company_amount NUMERIC,
  -- Sub-ISO (if applicable)
  sub_iso_id UUID REFERENCES sub_isos(id),
  override_points NUMERIC, -- typically 2
  override_amount NUMERIC,
  -- Sales manager override
  manager_override_percentage NUMERIC,
  manager_override_amount NUMERIC,
  -- Payment tracking
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN (
    'pending', 'funder_paid', 'closer_paid', 'completed', 'clawback'
  )),
  funder_paid_at TIMESTAMPTZ,
  closer_paid_at TIMESTAMPTZ,
  -- Clawback
  clawback_amount NUMERIC DEFAULT 0,
  clawback_reason TEXT,
  --
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### 4.4 `sub_isos` — Sub-ISO Partner Management
```sql
CREATE TABLE sub_isos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id), -- If they have a login
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  -- Agreement terms
  override_points NUMERIC DEFAULT 2,
  platform_fee_monthly NUMERIC, -- $99, $149, $199
  agreement_start_date DATE,
  agreement_end_date DATE,
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'active', 'suspended', 'terminated'
  )),
  -- GHL
  ghl_sub_account_id TEXT,
  ghl_location_id TEXT,
  -- Performance
  total_deals_submitted INTEGER DEFAULT 0,
  total_deals_funded INTEGER DEFAULT 0,
  total_commission_earned NUMERIC DEFAULT 0,
  total_override_earned NUMERIC DEFAULT 0,
  -- Stripe
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  --
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES profiles(id)
);
```

#### 4.5 `plaid_connections` — Plaid Bank Verification
```sql
CREATE TABLE plaid_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  -- Plaid tokens
  plaid_item_id TEXT,
  plaid_access_token TEXT, -- ENCRYPTED — store server-side only
  plaid_institution_id TEXT,
  institution_name TEXT,
  -- Verification status
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'connected', 'verified', 'expired', 'error'
  )),
  -- Summary data (safe to store)
  account_count INTEGER,
  avg_daily_balance NUMERIC,
  avg_monthly_deposits NUMERIC,
  avg_monthly_withdrawals NUMERIC,
  nsf_count INTEGER,
  negative_balance_days INTEGER,
  months_of_data INTEGER,
  -- Raw data reference (stored in secure storage, not DB)
  transaction_data_path TEXT,
  --
  connected_at TIMESTAMPTZ,
  last_refreshed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### 4.6 `closers` — 1099 Independent Contractor Sales Reps
```sql
CREATE TABLE closers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  -- Commission structure
  company_lead_split NUMERIC DEFAULT 50, -- percentage
  self_gen_split NUMERIC DEFAULT 70,
  renewal_split NUMERIC DEFAULT 35,
  draw_amount NUMERIC, -- monthly draw (if any)
  draw_start_date DATE,
  draw_end_date DATE,
  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'terminated')),
  start_date DATE,
  end_date DATE,
  -- Assignment
  markets TEXT[] DEFAULT '{}', -- which markets they handle
  max_leads_per_month INTEGER DEFAULT 50,
  -- Performance (calculated/cached)
  total_deals_funded INTEGER DEFAULT 0,
  total_commission_earned NUMERIC DEFAULT 0,
  close_rate NUMERIC DEFAULT 0,
  --
  agreement_signed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### 4.7 `follow_up_sequences` — Sequence Tracking
```sql
CREATE TABLE follow_up_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  sequence_type TEXT NOT NULL CHECK (sequence_type IN (
    'stips_collection',    -- Sequence A: 14-day
    'no_answer',           -- Sequence B: 7-day
    'soft_no',             -- Sequence C: 90-day
    'offer_declined',      -- Sequence D: 45-day
    'funded_renewal',      -- Sequence E: paydown-based
    'mass_reactivation'    -- Sequence F: monthly blast
  )),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  current_step INTEGER DEFAULT 0,
  total_steps INTEGER,
  started_at TIMESTAMPTZ DEFAULT now(),
  next_action_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  -- GHL sync
  ghl_workflow_id TEXT,
  --
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### 4.8 `compliance_disclosures` — State-Specific Disclosures
```sql
CREATE TABLE compliance_disclosures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  state TEXT NOT NULL, -- NY, CA, VA, UT, FL, CT, GA, KS, TX, MO
  product_type TEXT NOT NULL, -- mca, term_loan, etc.
  disclosure_type TEXT NOT NULL,
  disclosure_content TEXT, -- Generated disclosure text
  -- Tracking
  generated_at TIMESTAMPTZ DEFAULT now(),
  presented_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  signature_url TEXT, -- If e-signed
  --
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### 4.9 `lead_sources` — Lead Source Cost Tracking
```sql
CREATE TABLE lead_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, -- "Lead Tycoons", "Google Ads - Indianapolis", etc.
  type TEXT NOT NULL CHECK (type IN (
    'live_transfer', 'google_ads', 'aged_lead', 'ucc_filing',
    'referral', 'sub_iso', 'organic', 'social_media', 'other'
  )),
  vendor_id UUID REFERENCES marketing_vendors(id),
  -- Cost tracking
  cost_per_lead NUMERIC,
  monthly_budget NUMERIC,
  -- Performance (calculated)
  total_leads INTEGER DEFAULT 0,
  total_funded INTEGER DEFAULT 0,
  total_spend NUMERIC DEFAULT 0,
  total_revenue NUMERIC DEFAULT 0,
  cost_per_funded_deal NUMERIC, -- calculated
  roi_percentage NUMERIC, -- calculated
  --
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### 4.10 `referral_partners` — Referral Partner Tracking
```sql
CREATE TABLE referral_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_type TEXT NOT NULL CHECK (partner_type IN (
    'cpa', 'bookkeeper', 'commercial_re_agent', 'insurance_agent',
    'equipment_vendor', 'attorney', 'other_broker', 'other'
  )),
  company_name TEXT,
  contact_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  -- Incentive tracking
  gift_card_amount NUMERIC DEFAULT 100,
  total_referrals INTEGER DEFAULT 0,
  total_funded INTEGER DEFAULT 0,
  total_gift_cards_paid NUMERIC DEFAULT 0,
  --
  status TEXT DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### 6.11 `contract_templates` — Dynamic Contract Template Engine
```sql
CREATE TABLE contract_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, -- "MCA Agreement", "Term Loan Agreement"
  product_type TEXT NOT NULL, -- mca, term_loan, loc, sba, equipment
  template_content TEXT NOT NULL, -- Rich text with merge fields: {{merchant_legal_name}}, {{advance_amount}}, etc.
  conditional_clauses JSONB DEFAULT '{}', -- State-specific conditional blocks
  signature_field_positions JSONB DEFAULT '[]', -- Where to place sign/initial/date fields
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### 6.12 `contracts` — Generated Contracts
```sql
CREATE TABLE contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id),
  template_id UUID REFERENCES contract_templates(id),
  -- Generated document
  generated_pdf_path TEXT, -- Supabase Storage path
  merged_data JSONB, -- Snapshot of data used for merge
  version TEXT DEFAULT 'draft', -- draft, final, executed
  -- eSignature tracking
  esignature_envelope_id TEXT, -- DocuSign/SignNow envelope ID
  esignature_status TEXT DEFAULT 'pending' CHECK (esignature_status IN (
    'pending', 'sent', 'viewed', 'signed', 'declined', 'completed', 'voided'
  )),
  signing_url TEXT, -- Embedded signing URL
  signed_at TIMESTAMPTZ,
  executed_pdf_path TEXT, -- Final signed version with certificate
  -- Audit
  generated_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### 6.13 `google_connections` — Google Workspace OAuth Tokens
```sql
CREATE TABLE google_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  google_email TEXT NOT NULL,
  -- OAuth tokens (ENCRYPTED)
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  -- Connected services (granular permissions)
  gmail_connected BOOLEAN DEFAULT false,
  calendar_connected BOOLEAN DEFAULT false,
  drive_connected BOOLEAN DEFAULT false,
  sheets_connected BOOLEAN DEFAULT false,
  contacts_connected BOOLEAN DEFAULT false,
  -- Drive folder references
  drive_root_folder_id TEXT, -- "mFunding Deals" folder in user's Drive
  --
  connected_at TIMESTAMPTZ DEFAULT now(),
  last_synced_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### 6.14 `underwriting_scorecards` — Configurable Risk Assessment
```sql
CREATE TABLE underwriting_scorecards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id),
  -- Scored criteria (weights configurable by super admin)
  credit_score INTEGER,
  credit_score_weight NUMERIC DEFAULT 20,
  avg_daily_balance NUMERIC,
  adb_weight NUMERIC DEFAULT 25,
  nsf_count INTEGER,
  nsf_weight NUMERIC DEFAULT 15,
  time_in_business_months INTEGER,
  tib_weight NUMERIC DEFAULT 15,
  monthly_revenue NUMERIC,
  revenue_weight NUMERIC DEFAULT 15,
  existing_positions INTEGER DEFAULT 0,
  positions_weight NUMERIC DEFAULT 10,
  -- Calculated
  total_score NUMERIC,
  recommendation TEXT CHECK (recommendation IN ('approve', 'decline', 'manual_review')),
  -- Underwriter notes
  underwriter_id UUID REFERENCES profiles(id),
  underwriter_notes TEXT,
  decision_made_at TIMESTAMPTZ,
  --
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Database Views Needed

```sql
-- Cost per funded deal by source
CREATE VIEW v_cost_per_funded_deal AS ...;

-- Pipeline velocity (avg days per stage)
CREATE VIEW v_pipeline_velocity AS ...;

-- Closer performance scorecard
CREATE VIEW v_closer_performance AS ...;

-- Lender approval rates
CREATE VIEW v_lender_approval_rates AS ...;

-- Monthly revenue summary
CREATE VIEW v_monthly_revenue AS ...;

-- Market performance comparison
CREATE VIEW v_market_performance AS ...;
```

---

## 7. AGENT TEAMS — WHO BUILDS WHAT

### Team Structure

Use Claude Code Agent Teams (experimental, now enabled in settings.json). The lead agent coordinates, assigns tasks, and synthesizes. Each teammate owns a distinct domain with minimal file overlap.

### Agent Team 1: Deal Pipeline Engine
**Owner:** `deal-pipeline-agent`
**Scope:** The core business logic — deals, submissions, offers

**Tasks:**
1. Create migration for `deals`, `deal_submissions` tables
2. Build TypeScript types for deal entities
3. Build deal list page (`/admin/deals`) with filtering by status, market, closer, date range
4. Build deal detail page (`/admin/deals/:id`) with:
   - Deal header (customer info, status badge, assignment)
   - Stage progression timeline (visual 9-stage pipeline)
   - Funder submission panel (submit to 3-5 funders, track responses)
   - Offer comparison table (side-by-side: amount, factor rate, term, daily payment, total cost)
   - Document checklist (required stips with status)
   - Activity feed (all interactions, status changes, notes)
5. Build deal creation flow (from customer or standalone)
6. Build funder matching engine — given deal profile, recommend best-fit lenders from `lenders` table based on credit tier, revenue, industry, time in business

**Files touched:** `supabase/migrations/`, `src/types/deals.ts`, `src/pages/admin/deals/`, `src/components/deals/`, `src/services/dealService.ts`, `src/services/lenderMatchingService.ts`

---

### Agent Team 2: Commission & Financial Engine
**Owner:** `commission-agent`
**Scope:** All money tracking — commissions, splits, Sub-ISO overrides, closer payments

**Tasks:**
1. Create migration for `commissions`, `closers`, `sub_isos` tables
2. Build commission calculator service (handles all split scenarios from CLAUDE.md economics)
3. Build closer management page (`/admin/closers`) — list, add, edit, performance
4. Build Sub-ISO management page (`/admin/sub-isos`) — list, add, edit, deal tracking
5. Build commission dashboard (`/admin/commissions`) — pending, paid, clawback tracking
6. Build financial reporting views (revenue by month, by closer, by Sub-ISO, by market)
7. Auto-calculate commissions when deal status changes to "funded"

**Files touched:** `supabase/migrations/`, `src/types/commissions.ts`, `src/pages/admin/closers/`, `src/pages/admin/sub-isos/`, `src/pages/admin/commissions/`, `src/services/commissionService.ts`

---

### Agent Team 3: Plaid Integration
**Owner:** `plaid-agent`
**Scope:** Bank account verification — the #1 competitive advantage

**Tasks:**
1. Create migration for `plaid_connections` table
2. Set up Plaid SDK server-side (Supabase Edge Function for token exchange)
3. Build Plaid Link component in React (drop-in UI for bank connection)
4. Build application portal page (`/apply` or `/portal/apply`) with:
   - Step 1: Business info (pre-filled if existing customer)
   - Step 2: Connect bank via Plaid Link
   - Step 3: Confirmation + next steps
5. Process Plaid transaction data — calculate summary metrics (avg daily balance, monthly deposits, NSFs, negative days)
6. Store summary in `plaid_connections`, raw data in Supabase Storage (encrypted)
7. Display bank verification results in deal detail page

**Files touched:** `supabase/functions/plaid-exchange/`, `supabase/functions/plaid-transactions/`, `supabase/migrations/`, `src/components/plaid/`, `src/pages/apply/`, `src/services/plaidService.ts`

---

### Agent Team 4: GHL Integration Layer
**Owner:** `ghl-integration-agent`
**Scope:** Two-way sync between GoHighLevel and Supabase

**Tasks:**
1. Build Supabase Edge Function: `ghl-webhook-receiver` — receives webhooks from GHL when:
   - New contact created (→ create customer in Supabase)
   - Pipeline stage changes (→ update deal status)
   - Form submitted (→ create funding application)
   - Task completed (→ log activity)
2. Build GHL API service (`src/services/ghlService.ts`):
   - Create/update contacts in GHL
   - Move opportunities through pipeline stages
   - Trigger workflows (follow-up sequences)
   - Push custom field data (Plaid summary, deal status)
3. Build sync status dashboard (`/admin/settings/integrations`) showing sync health
4. Build follow-up sequence tracking table and UI
5. Handle GHL → Supabase lead source tagging (which campaign, which market)

**Files touched:** `supabase/functions/ghl-webhook-receiver/`, `src/services/ghlService.ts`, `src/types/ghl.ts`, `supabase/migrations/` (follow_up_sequences table)

---

### Agent Team 5: Analytics & Reporting Engine
**Owner:** `analytics-agent`
**Scope:** All dashboards, KPIs, reporting

**Tasks:**
1. Create database views for all metrics from the Funnel doc (12 master KPIs)
2. Build enhanced analytics dashboard (`/admin/analytics`) with:
   - Funnel waterfall chart (leads → contacted → qualified → ... → funded)
   - Cost per funded deal by source AND by market
   - Pipeline velocity (avg days per stage)
   - Close rate trend over time
   - Revenue by month (actual vs. projected)
3. Build closer performance dashboard:
   - Deals by closer, close rate, avg commission, revenue generated
4. Build lender performance dashboard:
   - Approval rate by lender, avg offer amount, response time
5. Build market performance comparison:
   - Leads, deals, cost, revenue by target market
6. Build lead source ROI dashboard:
   - Cost per lead, cost per funded deal, ROI by channel
7. Create migration for `lead_sources` table

**Files touched:** `supabase/migrations/` (views + lead_sources), `src/pages/admin/analytics/`, `src/components/analytics/`, `src/services/analyticsService.ts` (enhance existing)

---

### Agent Team 6: Compliance & Document Engine
**Owner:** `compliance-agent`
**Scope:** State disclosures, document management, audit trail

**Tasks:**
1. Create migration for `compliance_disclosures` table
2. Build disclosure generator service — given state + product type, generate correct disclosure text
3. Build disclosure management UI in deal detail page
4. Enhance document upload flow for customer portal:
   - Drag-and-drop upload
   - Document type categorization (bank statement, ID, application, etc.)
   - Review status tracking (pending → reviewed → approved → rejected)
5. Build compliance dashboard (`/admin/compliance`):
   - Deals requiring disclosures by state
   - Missing disclosures alerts
   - Disclosure completion rates
6. Enhance `activity_log` for compliance-grade audit trail

**Files touched:** `supabase/migrations/`, `src/services/complianceService.ts`, `src/pages/admin/compliance/`, `src/components/compliance/`, `src/components/documents/`

---

### Agent Team 7: Customer Portal Enhancement
**Owner:** `portal-agent`
**Scope:** Merchant-facing self-service portal

**Tasks:**
1. Enhance `/portal/` dashboard:
   - Show active deals with current status and stage visualization
   - Show required documents with upload capability
   - Show offers (when available) with accept/decline
2. Enhance `/portal/documents`:
   - Upload documents per deal
   - Photo capture from mobile (bank statements)
   - Integration with Plaid Link (connect bank button)
3. Enhance `/portal/inbox`:
   - Messages from assigned closer
   - Notifications for status changes, document requests
4. Build deal status tracking page (`/portal/deals/:id`):
   - Visual timeline of deal progress
   - Document checklist with upload
   - Offer details (when presented)
5. Build renewal request flow — funded clients can request additional capital

**Files touched:** `src/pages/portal/`, `src/components/portal/`, `src/services/portalService.ts`

---

### Agent Team 8: Public Site & Marketing
**Owner:** `marketing-agent`
**Scope:** Public-facing pages, SEO, landing page improvements

**Tasks:**
1. Enhance landing page with conversion optimization (from V2_Landing_Page.html design)
2. Build city-specific landing page template (`/funding/:city`)
3. Build Spanish-language landing page (`/es` or `/financiamiento`)
4. Enhance product pages (business loans, real estate) with better SEO structure
5. Build referral partner signup page (`/partners`)
6. Create migration for `referral_partners` table
7. Build blog/content section framework (`/resources` or `/blog`)
8. Ensure all MCA-related content uses compliant language (never "loan")

**Files touched:** `src/pages/`, `src/components/landing/`, `src/components/marketing/`, `supabase/migrations/`

---

### Agent Team 9: E-Docs & eSignature Engine
**Owner:** `esignature-agent`
**Scope:** Contract generation, embedded signing, E-Doc vault (PRD Module 8)

**Tasks:**
1. Create migration for `contract_templates`, `contracts` tables
2. Build contract template management UI (`/admin/settings/templates`):
   - Rich-text editor with merge field syntax (`{{merchant_legal_name}}`, `{{advance_amount}}`, etc.)
   - Conditional clauses based on state (e.g., CA disclosure)
   - Signature/initial/date field placement
3. Build contract generation service:
   - Auto-generate when deal moves to "Offer Accepted"
   - Merge deal data into template
   - Generate PDF and store in Supabase Storage
4. Build eSignature integration (DocuSign or SignNow):
   - Create signing envelope via API
   - Generate embedded signing URL
   - Handle webhooks for status updates (Sent → Viewed → Signed → Completed)
   - Retrieve and store executed PDF with certificate of completion
5. Build merchant-facing signing experience:
   - Branded notification (email/SMS) with portal link
   - Embedded signing iframe within Merchant Portal
6. Build E-Doc vault UI in deal detail page:
   - Document list with version control (draft vs. executed)
   - Immutable audit trail for all document actions
   - Search and retrieval by merchant, deal, or document type

**Files touched:** `supabase/migrations/`, `src/services/contractService.ts`, `src/services/esignatureService.ts`, `supabase/functions/esignature-webhook/`, `src/pages/admin/settings/templates/`, `src/components/contracts/`

---

### Agent Team 10: Google Workspace Integration
**Owner:** `google-workspace-agent`
**Scope:** Full Google Workspace integration (Gmail, Calendar, Drive, Sheets, Docs, Meet, People API)

**Tasks:**
1. Create migration for `google_connections` table
2. Build Google OAuth 2.0 flow:
   - "Connect Google Account" button in user settings
   - Granular permission consent (Gmail, Calendar, Drive individually)
   - Secure token storage with refresh logic
3. Build Gmail two-way sync:
   - Emails with merchant email auto-appear in deal communication log
   - Emails sent from mFunding go through user's Gmail (appears in their Sent folder)
4. Build Google Calendar integration:
   - Auto-create calendar events on deal stage changes and task assignments
   - Follow-up call scheduling, underwriting review deadlines
5. Build Google Drive integration:
   - Auto-create "mFunding Deals" folder structure per deal
   - Sync documents between deal record and Google Drive
6. Build Google Sheets export:
   - "Export to Sheets" button on all reports and data tables
   - Optional live dashboard Sheet with auto-refresh
7. Build Google Meet integration:
   - "Start a Meeting" button on deal/contact records
   - Auto-generate Meet link and send to merchant
8. Build People API contact sync:
   - Two-way contact sync between mFunding and Google Contacts
9. Build Connected Accounts settings page (`/admin/settings/integrations`):
   - Connect/disconnect each Google service individually
   - Sync status and last synced timestamps

**Files touched:** `supabase/migrations/`, `src/services/googleWorkspaceService.ts`, `supabase/functions/google-oauth/`, `src/pages/admin/settings/integrations/`, `src/components/google/`

---

## 8. APIS, KEYS & EXTERNAL SERVICES REQUIRED

### Already Configured
| Service | Environment Variable | Status |
|---|---|---|
| Supabase | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Active |
| Google Gemini AI | `VITE_GEMINI_API_KEY` | Active |
| Firecrawl | `VITE_FIRECRAWL_API_KEY` | Active |
| Hyperbrowser | `VITE_HYPERBROWSER_API_KEY` | Active |

### Must Get Before Build Starts

| # | Service | Keys Needed | Where to Sign Up | Cost | Priority | Used By Agent Team |
|---|---|---|---|---|---|---|
| 1 | **Plaid** | `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` (sandbox → development → production) | [plaid.com/docs](https://plaid.com/docs) — developer account | Free (sandbox), ~$200/mo (production) | **P0 — Get NOW** | Team 3 (Plaid) |
| 2 | **GoHighLevel API** | `GHL_API_KEY`, `GHL_LOCATION_ID`, webhook callback URLs configured in GHL | GHL dashboard → Settings → API Keys (requires SaaS Pro subscription) | Included in $497/mo SaaS Pro | **P0 — Get NOW** | Team 4 (GHL Integration) |
| 3 | **Stripe** | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | [stripe.com](https://stripe.com) → Developers → API Keys | 2.9% + $0.30 per transaction | **P1** | Team 2 (Sub-ISO billing, commission payouts) |
| 4 | **Supabase Service Role Key** | `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Settings → API | Already have (part of Supabase plan) | **P0 — Get NOW** | Teams 3, 4, 9, 10 (Edge Functions) |
| 5 | **DocuSign or SignNow** | `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_SECRET_KEY`, `DOCUSIGN_ACCOUNT_ID` (or SignNow equivalents) | [developers.docusign.com](https://developers.docusign.com) or [signnow.com/developers](https://signnow.com/developers) | Free sandbox; production varies ($10-$40/envelope or monthly plan) | **P1** | Team 9 (eSignature) |
| 6 | **Google Cloud Platform (Workspace APIs)** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (OAuth 2.0 credentials), enable Gmail, Calendar, Drive, Sheets, Docs, Meet, People APIs | [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials | Free (API calls), Google Workspace subscription separate | **P1** | Team 10 (Google Workspace) |
| 7 | **Google Ads API** | `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_DEVELOPER_TOKEN`, OAuth credentials | [developers.google.com/google-ads/api](https://developers.google.com/google-ads/api) — requires approved developer token | Free (API), ad spend separate | **P2** | Team 5 (Analytics) |
| 8 | **Experian API** | `EXPERIAN_CLIENT_ID`, `EXPERIAN_CLIENT_SECRET` | [developer.experian.com](https://developer.experian.com) | Variable pricing | **P2** | Team 1 (Underwriting) |
| 9 | **Ocrolus** (fallback for PDF bank statements) | `OCROLUS_API_KEY` | [ocrolus.com](https://ocrolus.com) | Variable pricing | **P2** | Team 3 (PDF bank statement parsing) |
| 10 | **Thomson Reuters CLEAR** (optional) | `CLEAR_API_KEY` | [thomsonreuters.com](https://thomsonreuters.com) | Enterprise pricing | **P3** | Team 1 (Business verification) |
| 11 | **SendGrid or Resend** | `EMAIL_API_KEY` | [sendgrid.com](https://sendgrid.com) or [resend.com](https://resend.com) | Free tier available | **P2** | Team 7 (Portal notifications) |

### Plaid Products Required (from PRD Module 5)

| Plaid Product | Purpose | Priority |
|---|---|---|
| **Auth** | Verify bank account + routing numbers (for ACH setup by funders) | P0 |
| **Identity** | Anti-fraud — match merchant-provided info against bank records | P0 |
| **Transactions** | Up to 24 months of categorized transaction data for cash flow analysis | P0 |
| **Assets** | Point-in-time Asset Report — substitute for bank statements in underwriting | P1 |
| **Income** | Verify merchant income from payroll/deposit analysis | P1 |
| **Statements** | Retrieve official watermarked PDF bank statements from institution | P1 |

### API Key Delivery Instructions
When you have the keys, add them to the project's `.env` file:
```env
# Plaid (P0)
PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_secret
PLAID_ENV=sandbox  # Change to development, then production

# GoHighLevel (P0)
GHL_API_KEY=your_api_key
GHL_LOCATION_ID=your_location_id

# Supabase Service Role (P0)
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Stripe (P1)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# DocuSign (P1) — or SignNow equivalent keys
DOCUSIGN_INTEGRATION_KEY=your_integration_key
DOCUSIGN_SECRET_KEY=your_secret_key
DOCUSIGN_ACCOUNT_ID=your_account_id
DOCUSIGN_BASE_URL=https://demo.docusign.net  # Change to production URL

# Google Workspace (P1)
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret

# Google Ads (P2)
GOOGLE_ADS_CUSTOMER_ID=your_customer_id
GOOGLE_ADS_DEVELOPER_TOKEN=your_dev_token

# Experian (P2)
EXPERIAN_CLIENT_ID=your_client_id
EXPERIAN_CLIENT_SECRET=your_client_secret

# Ocrolus (P2)
OCROLUS_API_KEY=your_api_key

# Email (P2)
EMAIL_API_KEY=your_api_key
```

---

## 9. BUILD PRIORITY & SEQUENCING

### Phase 1: Core Pipeline (Weeks 1-3)
**Agent Teams Active:** 1 (Deal Pipeline), 2 (Commission), 5 (Analytics)
**Dependencies:** None — these teams work on separate files
**Deliverable:** Working deal pipeline with commission tracking and basic analytics

**What gets built:**
- `deals`, `deal_submissions`, `commissions`, `closers`, `lead_sources` tables
- Deal list + detail pages in admin
- Commission calculator and dashboard
- Funder matching (recommend best lenders for a deal)
- Enhanced analytics dashboard with funnel waterfall

### Phase 2: Plaid + GHL Integration (Weeks 2-4)
**Agent Teams Active:** 3 (Plaid), 4 (GHL Integration)
**Dependencies:** Plaid API keys (P0), GHL API key (P0), Supabase Service Role Key (P0)
**Deliverable:** Bank verification working end-to-end, GHL syncing leads and deal status

**What gets built:**
- Plaid Link in customer portal and application flow
- Bank data processing and summary calculation
- GHL webhook receiver (lead/deal sync)
- GHL API service (push data from React to GHL)
- Follow-up sequence tracking

### Phase 3: Customer Portal + Compliance (Weeks 3-5)
**Agent Teams Active:** 6 (Compliance), 7 (Customer Portal)
**Dependencies:** Phase 1 deal tables, Phase 2 Plaid
**Deliverable:** Merchants can apply, connect bank, upload docs, track deals. Compliance disclosures auto-generated.

**What gets built:**
- Enhanced customer portal with deal status, document upload, Plaid
- Compliance disclosure generator by state
- Document review workflow
- Audit trail enhancement

### Phase 4: Marketing + Sub-ISO (Weeks 4-6)
**Agent Teams Active:** 8 (Marketing), 2 (Commission — Sub-ISO extension)
**Dependencies:** Phase 1 base infrastructure, Stripe API key
**Deliverable:** City-specific landing pages, referral tracking, Sub-ISO management

**What gets built:**
- City landing page templates
- Spanish-language page
- Referral partner management
- Sub-ISO onboarding and management dashboard
- Stripe billing for Sub-ISO platform fees

### Phase 5: E-Docs, eSignature & Google Workspace (Weeks 5-8)
**Agent Teams Active:** 9 (E-Docs & eSignature), 10 (Google Workspace)
**Dependencies:** Phase 1 deal tables, DocuSign/SignNow API keys (P1), Google Cloud OAuth credentials (P1)
**Deliverable:** Full contract lifecycle (template → generate → sign → vault), Google Workspace connectivity

**What gets built:**
- Contract template engine with merge fields and conditional clauses
- Auto-generation of contracts when deal hits "Offer Accepted"
- Embedded eSignature signing within Merchant Portal
- Webhook processing for signing status updates
- E-Doc vault with version control and audit trail
- Google OAuth 2.0 flow with granular service permissions
- Gmail two-way sync (emails appear in deal communication log)
- Google Calendar auto-events on deal stage changes
- Google Drive auto-folder per deal with document sync
- "Export to Sheets" on all reports and data tables
- "Start a Meeting" button generating Google Meet links
- People API two-way contact sync
- Connected Accounts settings page

### Parallel Work Map

```
Week 1  ████████████████████████████████████████
        Team 1: Deal tables + types + list page
        Team 2: Commission tables + calculator
        Team 5: Analytics views + dashboard layout

Week 2  ████████████████████████████████████████
        Team 1: Deal detail page + funder matching
        Team 2: Closer management + commission dashboard
        Team 3: Plaid edge functions + React component  ← needs PLAID keys
        Team 4: GHL webhook receiver                    ← needs GHL keys
        Team 5: Funnel waterfall + source ROI charts

Week 3  ████████████████████████████████████████
        Team 1: Deal submission flow + offer comparison
        Team 3: Application portal + bank data processing
        Team 4: GHL API service + sync dashboard
        Team 6: Compliance tables + disclosure generator
        Team 7: Portal deal status + document upload

Week 4  ████████████████████████████████████████
        Team 4: Follow-up sequence tracking
        Team 5: Closer + lender + market dashboards
        Team 6: Compliance dashboard + audit trail
        Team 7: Portal messaging + renewal request
        Team 8: City landing pages + SEO structure

Week 5  ████████████████████████████████████████
        Team 2: Sub-ISO management + Stripe billing     ← needs STRIPE keys
        Team 7: Mobile-optimized portal
        Team 8: Spanish page + referral partner signup
        Team 9: Contract template tables + template UI   ← needs DOCUSIGN keys
        Team 10: Google OAuth flow + connection mgmt     ← needs GOOGLE keys

Week 6  ████████████████████████████████████████
        Team 9: Contract generation service + PDF output
        Team 10: Gmail sync + Calendar integration
        Integration testing (Teams 1-8)

Week 7  ████████████████████████████████████████
        Team 9: Embedded signing + webhook processing
        Team 10: Drive sync + Sheets export + Meet links
        Team 9: E-Doc vault UI + audit trail

Week 8  ████████████████████████████████████████
        Team 10: People API sync + Connected Accounts settings
        Full integration testing across all 10 teams
        End-to-end flow: lead → deal → submit → offer → sign contract → fund → commission
```

---

## SUMMARY — WHAT TO DO NEXT

1. **Get API keys** — Plaid, GHL, and Supabase Service Role Key are P0 (needed immediately)
2. **Start a new Claude Code session** — Agent teams are enabled in settings.json
3. **Reference this file** — Tell the lead agent: "Read plan_goals.md and execute Phase 1"
4. **Start with Teams 1, 2, 5** — They're independent and need no external API keys
5. **Add Teams 3, 4 when you have** Plaid and GHL API keys
6. **Add Teams 9, 10 when you have** DocuSign/SignNow and Google Cloud credentials (P1)
7. **Each team works in its own domain** — minimal file conflicts

---

## REFERENCE DOCUMENTS

All source documents used to build this plan are in `/research/platform_reqs/`:

| # | Document | Contents |
|---|---|---|
| 1 | `V2_MFunding_Claude_Code_Context.md` | Master business context — identity, economics, markets, compliance |
| 2 | `V2_MFunding_Brokerage_Playbook.md` | Vendor network, lender relationships, lead strategy |
| 3 | `V2_MFunding_Campaign_Strategy.md` | Google Ads campaigns, budgets, targeting by market |
| 4 | `V2_MFunding_Funnel_FollowUp_CRM.md` | Funnel metrics, 6 follow-up sequences, GHL automation setup |
| 5 | `V2_MFunding_Landing_Page.html` | Production-ready HTML landing page template |
| 6 | `V2_Sales_Funnel_Diagram.mermaid` | Visual sales funnel flowchart (9 stages) |
| 7 | `V2_Follow_Up_Decision_Tree.mermaid` | Follow-up decision tree for lead routing |
| 8 | `V2_Funnel_Metrics_Waterfall.mermaid` | Conversion waterfall (140 leads → 6 funded) |
| 9 | `v2_MCA_Brokerage_Master_Summary.md` | Complete operating plan for the MCA brokerage |
| 10 | `Product Requirements Document.md` | Full PRD v1.1 — 11 modules (Plaid, eSignature, Portals, Underwriting) |
| 11 | `mFunding SaaS Platform_ Comprehensive User Journeys & Daily Workflows.md` | Daily workflows for every persona (Sub-ISO Admin, Closer, Merchant, Underwriter, Super Admin) |
| 12 | `mFunding SaaS Platform_ Google Workspace Integration Specification.md` | Gmail, Calendar, Drive, Sheets, Docs, Meet, People API integration specs |
| 13 | `mFunding SaaS Platform_ Claude Code Agent Team Architecture.md` | Manus AI's 5-team agent architecture (reference only — we use our 10-team structure) |

---

*Last updated: March 2026 | Source: Complete platform requirements analysis + LendSaaS competitive audit + PRD v1.1 + User Journeys + Google Workspace Spec*
