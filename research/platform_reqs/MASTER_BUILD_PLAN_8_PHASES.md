# MFunding — Master Build Plan (8 Phases)
### Everything to build the full platform + GHL automation + your manual tasks
### Created: June 26, 2026

This is the single consolidated task list, synthesized from `plan_goals.md`, the PRD (M1–M11),
the GHL strategy docs, the funnel/follow-up + brokerage playbook, the API-keys checklist, and
the user-journeys + Google Workspace specs — reconciled against what actually exists today.

## Legend
- 🔵 **BUILD** — code in this React/Supabase app (I do this)
- 🟣 **GHL** — configure in GoHighLevel (you, or me via the `mfunding-ghl` skill / the AI prompt in `GHL_Pipeline_And_Automations.md`)
- 🟡 **MANUAL** — human/owner task outside any app (legal, funders, vendors, ads, compliance, keys)
- 🔑 **KEYS** — API credentials needed to start the phase

## Architecture rule (applies to every phase)
**Automate as much as possible in GHL — that is the default.** For every feature, first ask "can GHL do this?" (forms, intake, document collection, reminders, SMS/email/voice, scheduling, e-sign, disclosures-as-workflow, payments, review requests, round-robin, AI Employee). Only build custom in this app when GHL genuinely can't.
**GHL = automation engine + system of action** (talking, scheduling, e-sign, intake, follow-up).
**This app = system of record + intelligence** (financial math, underwriting, funder matching/submission, deep analytics) — the things GHL can't do.
**MCA ≠ loan** in all MCA copy. **No upfront fees. No credit impact** until funder submission.

---

## ✅ Already done (so we don't repeat it)
- Supabase project confirmed (`CAI3303Demo` / `ehibjeonqpqskhcvizow`) + twice-daily heartbeat keeping it awake.
- GHL credentials obtained, tested live (200), stored in `.env` + Supabase **vault**; `get_ghl_config()` RPC (service-role only).
- Project-scoped **`mfunding-ghl`** skill (isolated from the OSP `ghl` skill); CLAUDE.md guard added.
- Edge functions deployed: **`ghl-sync`** (outbound) + **`ghl-webhook`** (inbound). `ghlService.ts` + **"Sync to GHL"** buttons on Deal & Customer pages.
- `customers.ghl_contact_id` column added.
- Admin **UI already coded** for deals/commissions/closers/sub-ISOs/analytics (but tables NOT yet in DB — see Phase 1).
- Strategy docs written: `GHL_Automation_Blueprint.md`, `GHL_Integration_Checklist.md`, `GHL_Pipeline_And_Automations.md` (← your GHL build spec + paste-ready AI prompt).

## ❌ Not building (broker model — from PRD/LendSaaS audit)
ACH collections (M6), funder contract generation, **syndication (M7)**, automated repayment tracking — funders own these. (Syndicator portal = future-only.)

---

# PHASE 1 — Foundation: Database + Deal Pipeline Core
**Goal:** the already-coded admin UI runs on real tables; deal → commission → analytics works end-to-end internally.
🔑 None (uses existing Supabase).

- 🔵 Apply the 3 unapplied migrations: `20260301_001_create_deals.sql`, `_002_create_commissions.sql`, `_003_create_analytics.sql` → creates `deals`, `deal_submissions`, `commissions`, `closers`, `sub_isos`, `lead_sources` + analytics views. **(Critical — these tables don't exist yet; the deal-side GHL sync is dead until this runs.)**
- 🔵 Run `get_advisors` after; fix RLS/policy gaps on the new tables.
- 🔵 Smoke-test the existing pages against real data: Deal list/detail/create, Commission dashboard, Closer list/detail, Sub-ISO list, the 7 analytics pages.
- 🔵 Wire commission auto-calc on deal → `funded` (50% company / 70% self-gen / 35% renewal / Sub-ISO 2-pt override).
- 🔵 Seed a few test deals/closers to validate funnel + analytics math.
- 🟡 Business foundation (if not done): LLC/EIN/bank account, business email, `mfunding.com` brand site live.
- 🟡 Start gathering **P0 keys** (Plaid, Supabase service role) for Phase 3.
- **Exit:** create a deal → move stages → mark funded → commission appears → shows in analytics.

---

# PHASE 2 — GHL Integration Layer + the 9-Stage Pipeline (the automation backbone)
**Goal:** GHL is the live CRM/automation engine; deals/contacts sync both ways; first sequences run.
🔑 GHL (have it), `SUPABASE_SERVICE_ROLE_KEY`.

- 🟣 **Build the 9-stage pipeline** `MFunding Deal Pipeline` with EXACT stage names (New Lead → … → Renewal Eligible) — see `GHL_Pipeline_And_Automations.md`. (Currently only a generic "Marketing Pipeline" exists.)
- 🟣 Create custom fields (Monthly Revenue, Time in Business, Industry, Lead Source, Target Market, Funding Amount, Product Type, Paydown %, State, Plaid Connected, Disclosure Acknowledged).
- 🟣 Auto-response workflow (SMS <60s + email), missed-call text-back, round-robin assignment, local phone number.
- 🟣 Build **Sequence A** (Stips/Docs, 14-day) + **Sequence B** (No-Answer, 7-day). Configure **AI Employee** for 24/7 pre-qual.
- 🟣 Build the first city landing page (Indianapolis) + form → CRM. *(Or keep landing pages in GHL per architecture.)*
- 🔵 `follow_up_sequences` table + tracking UI; lead-source tagging by campaign/market.
- 🔵 Integration/sync-status dashboard (`/admin/settings/integrations`): sync health, retry failed syncs.
- 🔵 Backfill/reconcile `ghl_*_id` mapping (customers⇄contacts, deals⇄opportunities).
- 🔵 **Register the inbound webhook** in GHL (`/functions/v1/ghl-webhook?secret=…`) for Contact + Opportunity events; add `GHL_WEBHOOK_SECRET` to vault.
- 🔵 **Wire the paydown trigger** (now that `deals.paydown_percentage` exists): push Paydown % to GHL → fires renewal workflow.
- **Exit:** a GHL form submission creates a customer+deal here; moving a stage in GHL updates the deal (and vice versa); Sequence A fires on "Docs Collected".

---

# PHASE 3 — Application Portal + Document Intake (Plaid OPTIONAL)
**Goal:** merchants can apply and submit bank docs end-to-end **without Plaid**; Plaid is a pluggable enhancement that drops in once keys clear.
🔑 None required to ship the phase. Plaid keys (`PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`) are **optional/deferred** — sandbox is instant, but **production keys require a Plaid application/approval process**, so the portal must NOT depend on them.

**Plaid is optional — design for it, don't block on it:**
- 🔵 Public **application portal** (`apply.mfunding.com` / `/apply`): business info → **bank statement upload (manual, the default path)** → confirmation. Ships with zero Plaid dependency. *(Intake can also live in GHL; this is the doc hand-off page.)*
- 🔵 Manual bank-statement upload + document review flow as the **primary** verification path (works today).
- 🔵 **Manual bank-metrics entry** — a form for staff to key in the same summary metrics Plaid would auto-produce (ADB, monthly deposits/revenue, NSF count, negative days, existing-MCA payments, largest deposit) from the uploaded statements. This is the manual equivalent of Plaid's data extraction, so underwriting (Phase 4) works with or without Plaid. Store in the same shape Plaid will populate, so the underwriting workbench reads one source regardless.
- 🔵 Feature-flag Plaid (`VITE_PLAID_ENABLED` / config): when keys are absent, the portal shows only manual upload; when present, it adds the "Connect bank instantly" button. No code changes needed to flip it on.
- 🔵 (When keys arrive) `plaid_connections` table (encrypted tokens + summary metrics).
- 🔵 (When keys arrive) Plaid edge functions (Link token create, public→access exchange, webhooks); raw data encrypted in Storage; Plaid Link React component.
- 🔵 (When keys arrive) Transaction processing: ADB, monthly deposits/revenue, NSF count, negative days, existing-MCA detection, largest deposit → summary on deal detail.
- 🔵 Set GHL `Plaid Connected` field via sync when bank links (advances Sequence A) — only relevant once Plaid is on.
- 🟣 **Let GHL automate the chasing.** Document collection (manual or Plaid) is driven by GHL **Sequence A** (the 14-day stips workflow) — SMS/email/voicemail reminders with the upload link. Our portal just receives the files; GHL does the follow-up. Maximize GHL here rather than building our own reminder logic.
- 🟡 **Start the Plaid key process now** (sandbox immediately; submit the production application early since approval takes time). Define pre-qual thresholds (min ADB, NSF cap, revenue match) for whenever bank data is available (Plaid or parsed manually).
- **Exit:** a merchant completes the application and submits bank statements via the portal **without Plaid**; flipping the Plaid flag on (once keys clear) adds 60-second bank connect with no rework.

---

# PHASE 4 — Internal Underwriting + Multi-Funder Submission (the money path)
**Goal:** we only submit fundable deals, to the right 3–5 funders, and compare offers.
🔑 Experian / Ocrolus optional (P2).

- 🔵 `underwriting_scorecards` table + configurable weighted scorecard (credit, ADB, NSF, TIB, revenue, positions, industry → Approve/Decline/Review).
- 🔵 **Underwriting workbench**: queue + risk dashboard (reads **one** bank-data source — Plaid auto-extracted OR the manual bank-metrics entry from Phase 3) + notes. Scorecard works identically whether the metrics came from Plaid or were keyed in by hand.
- 🔵 **Funder matching engine** (Gemini) — match deal profile to best-fit funders using `lenders` criteria.
- 🔵 **Multi-funder submission UI** on deal detail (`deal_submissions`): package + submit to 3–5 funders, track status/offers.
- 🔵 **Offer comparison** — side-by-side factor rate / term / amount / daily payment.
- 🟡 **DATA — funder criteria matrix**: apply to 15–20 funders (GoKapital, Greenbox, Rapid Finance, CAN Capital, National Funding, Nexi, Meritus, NRG, etc.); get 3–5 approved; record min credit/revenue/TIB, ranges, factor, paper tier, stips, submission method, underwriter contacts. Populate `lenders`.
- 🟡 **DATA — live-transfer vendor specs**: finalize vendors (Lead Tycoons, Synergy, Exclusive Leads, MCA Leads Pro, Master MCA); record qualification specs + TCPA certs; populate `marketing_vendors`.
- 🟡 Stips matrix per product/funder.
- 🔵 (P2) Experian credit pull + Ocrolus PDF fallback edge functions.
- **Exit:** a Plaid-verified deal gets scored, matched, submitted to multiple funders, offers compared — all in-app.

---

# PHASE 5 — Compliance + Documents + Merchant Portal
**Goal:** correct disclosures auto-attach; merchants self-serve status/docs.
🔑 None new (SendGrid/Resend optional, P2 — GHL covers most comms).

- 🔵 `compliance_disclosures` table + generator (state + product → correct disclosure text).
- 🔵 Compliance dashboard (`/admin/compliance`): missing-disclosure alerts, completion rates, deals-by-state.
- 🔵 Document review workflow (drag-drop, type categorization, pending→reviewed→approved→rejected).
- 🔵 Compliance-grade audit trail (expand `activity_log`).
- 🔵 **Merchant portal** upgrade: visual status tracker (Submitted → Under Review → Offer Ready → Funded), document checklist + upload + mobile photo, prominent Plaid button, messages, renewal request.
- 🟣 Disclosure delivered + acknowledged as a GHL workflow step (content supplied by our generator via API).
- 🟡 **DATA — state disclosure content** for NY, CA(SB 1235), VA, UT, FL, CT, GA, KS, TX, MO.
- 🟡 MCA-vs-loan closer training doc; data-security/retention procedures; TCPA opt-in handling.
- **Exit:** a deal in a disclosure state can't progress without the right disclosure acknowledged; merchant sees live status + uploads docs.

---

# PHASE 6 — E-Docs & eSignature
**Goal:** generate, send, sign, and vault contracts (commission agreements + any broker paperwork).
🔑 DocuSign/SignNow (P1) — **OR** decide to use GHL's built-in Documents & Contracts (you said docs/sign are "already in GHL"). **Decision point.**

- 🟡 **DECIDE:** GHL Documents & Contracts (recommended, no extra integration) vs DocuSign/SignNow engine. If GHL → most of this phase is 🟣 config, not 🔵 build.
- 🔵 (if custom) `contract_templates` + `contracts` tables; template editor w/ merge fields (`{{merchant_legal_name}}`, `{{advance_amount}}`…) + conditional clauses by state.
- 🔵 (if custom) Generation on "Offer Accepted" → merge → PDF → vault; eSignature provider (envelope, embedded signing in merchant portal, status webhooks Sent→Viewed→Signed→Completed); E-Doc vault w/ versioning + audit + completion certificate.
- 🟣 (if GHL) Build contract/proposal templates in GHL, trigger send-for-signature on stage change.
- 🟡 Provide contract/agreement content (commission agreement template already exists in `/research`).
- **Exit:** an accepted offer produces a signable doc; signed copy is stored + audit-logged.

---

# PHASE 7 — Marketing, Renewals & Google Workspace (full automation)
**Goal:** demand gen + the renewal flywheel + back-office automation.
🔑 Google Cloud OAuth (`GOOGLE_CLIENT_ID/SECRET`, P1); Google Ads (P2).

- 🟣 Build remaining sequences: **C** (Soft-No 90d), **D** (Offer Declined 45d), **E** (Funded→Renewal), **F** (Mass Reactivation monthly). Reputation/review requests. Google Ads conversion tracking.
- 🟣 Renewal triggers at 40/60/75/100% paydown (fed by our Phase-2 paydown push).
- 🔵 Renewal monitoring dashboard (paydown %, eligible list) — surfaces what drives the GHL triggers.
- 🔵 `referral_partners` table + partner signup page (`/partners`); city landing template + Spanish page *(or in GHL)*; blog/`/resources` framework; conversion-optimized landing per V2 design.
- 🔵 **Google Workspace** (`google_connections` + OAuth): Gmail two-way sync, Calendar auto-events on stage change, Drive per-deal folders + doc sync, Sheets "Export to Sheets", Docs deal summaries, Meet "Start a Meeting", People contact sync; Connected-Accounts settings page.
- 🟡 **Google Ads**: 5 campaigns ($185/day) + ad groups, 15 headlines/4 descriptions, negative keywords, conversion tracking, landing strategy.
- 🟡 Recruit referral partners (CPAs, bookkeepers, CRE agents, equipment vendors); referral agreement; $100 gift-card program.
- **Exit:** cold/declined/funded leads auto-nurture; renewals fire on paydown; reports export to Sheets; agent email/calendar synced.

---

# PHASE 8 — Sub-ISO White-Label Platform + Scale + Hardening
**Goal:** turn the platform into a Sub-ISO product; staff up; lock it down.
🔑 Stripe (only if billing outside GHL) — GHL SaaS Pro has Stripe built in.

- 🟣 GHL **SaaS Mode** + "MCA Brokerage Snapshot" (pipelines/workflows/templates), Stripe rebilling (SMS/phone/email markup), Sub-ISO recruitment funnel, sub-account auto-provisioning.
- 🔵 Sub-ISO management dashboard (`/admin/sub-isos`): onboarding, override config (2 pts), platform-fee billing, performance; sync `sub_isos.ghl_location_id`.
- 🔵 Super-admin configuration: pipeline-stage config, contract templates, scorecard weights, **API key management**, white-label branding.
- 🔵 (Optional/future) Syndicator portal (M7) — only if MFunding ever funds directly.
- 🟡 Sub-ISO Partner Agreement (template exists); recruit 5–10 sub-ISOs; hiring path (closer #1 at 5+ deals/mo, VA, sales mgr at 3+ closers, renewals specialist at 50+ funded).
- 🔵 Security pass: `get_advisors` clean-up (RLS, SECURITY DEFINER, leaked-password protection), rotate the leaked `sbp_` Supabase token in the public repo, secrets audit.
- 🟡 NMLS/state registration review per expansion state; CFPB 1071 demographic-field readiness.
- **Exit:** a sub-ISO can be provisioned with branded portal + billing; super-admin can configure the platform; security advisors clean.

---

## Cross-phase manual track (start anytime — gates later phases)
1. **Keys:** P0 (Plaid, GHL✓, Supabase service role) → P1 (DocuSign/Google) → P2 (Experian/Ocrolus/Google Ads).
2. **Funders:** apply now — approvals take 5–10 days and gate Phase 4 submission.
3. **Legal:** ISO broker agreement, 1099 closer agreement, Sub-ISO agreement, referral agreement, privacy policy.
4. **Compliance:** state disclosures (10 states), MCA-not-loan training, TCPA certs from every vendor, excluded industries, no-upfront-fees messaging, data-security policy, 7-yr retention.
5. **Rotate the public-repo `sbp_` token** (security) — do this immediately, independent of phases.

---

## Suggested execution order
P1 → P2 (these two light up the core + GHL) → P3 → P4 (the money path) → P5 → P6 → P7 → P8.
Manual tracks (funders, keys, legal, compliance) run in parallel from day one because they have lead times.
