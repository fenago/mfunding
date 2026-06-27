# MFunding — GHL Build Guide

### Pipelines, Stages & Automations · Last updated June 27, 2026

**How to use this:** Parts 1 & 2 are **already built** (pipelines + custom fields). Your remaining manual work is **Part 3** (automations — build the CORE set first, see the build order) and **Part 4** (the two web/intake forms). **EMAIL ONLY** — this account has no SMS; build every message as Email. Everything below the **REFERENCE** line is background detail. This doc is the single source of truth — if it's not here, you don't need it.

**At a glance**

- **Pipeline 1: `MFunding MCA Pipeline`** — standard funding — **13 stages**
- **Pipeline 2: `MFunding VCF Pipeline`** — debt relief — **8 stages**
- **Won** and **Lost** are opportunity *statuses* (not stages). **Nurture / Re-engage** is a real stage.
- Compliance: MCA copy never says "loan" (use funding/capital/advance); no upfront fees; no credit impact until funder submission.

**Build status (as of June 27, 2026)**

- ✅ **PART 1 pipelines — DONE & VERIFIED** (both pipelines exist with correct stages/order; see PART 1 for live pipeline + stage IDs).
- ✅ **PART 2 custom fields — DONE** (created via API; see PART 2 for exact field keys). Reuse the existing ones; do not duplicate. (4 web-form fields + "Web Form" Lead Source option added 6/27.)
- ⬜ PART 3 automations — build in GHL.
- 🟡 **PART 4 web application form** — ✅ **"MCA Funding Application" form BUILT in GHL (6/27)** (form id `Ow1imQrxjJN9yfDUiBG3`) with all business + owner fields (dropdowns auto-populated), email-only consent (required), submit = "Submit My Funding Request". ✅ **`/apply` page (mfunding.net) now EMBEDS this GHL form** (`src/pages/ApplyPage.tsx`), the old inline landing form (`ApplySection.tsx`) is replaced by a CTA band → `/apply`, and **all CTAs repointed from `#apply` to `/apply`** (tsc clean). ✅ **Companion workflow "MCA 00 - Web Form Intake (Create New Lead)" BUILT & PUBLISHED (6/27)** — trigger Form Submitted = MCA Funding Application → Create opportunity (MFunding MCA Pipeline / New Lead / Open / source Web Form / name {{contact.business_name}}) → Update contact (Lead Source=Web Form, Product Type=MCA). ✅ `/apply` embed verified rendering live. ✅ **Live Transfer Intake form created (6/27)** (clone of the application form) + ✅ **companion workflow "MCA 00B - Live Transfer Intake (Qualifying)" BUILT & PUBLISHED** — trigger Form Submitted = Live Transfer Intake → Create opportunity (MFunding MCA Pipeline / **Qualifying** / Open / source Live Transfer) → Update contact (Lead Source=Live Transfer, Product Type=MCA). ⬜ Remaining: minor field-order cleanup on the application form.
- ✅ App side: `ghl-sync` / `ghl-webhook` edge functions deployed; lender submission emails/routing stored in DB.
- ⚠️ **Code fix needed:** `ghl-sync` currently uses `pipelines[0]` (the first pipeline returned = the inactive Marketing pipeline). It must select the **MFunding MCA Pipeline by name/ID** (`bG9ZEh4eP9x60E1CyaMx`) so deals don't sync to the wrong board. There are 5 pipelines in the account.

## ✅ YOUR MANUAL TO-DO (the only things left — do in this order)
Pipelines and custom fields are already built. Everything below is **EMAIL ONLY** and lives in this doc.

1. **Build the Opt-Out / DNC workflow FIRST** (PART 3, 🟥 recovery) — it overrides everything.
2. **Build Automation 1 — Speed-to-Lead** (web leads). Fill the 3 blanks (pipeline, user, due date), delete any SMS step, Publish.
3. **Build Automation 1B — Live Transfer → Qualifying** (phone transfers). Same blanks.
4. **Build Automation 6 — Bank Statements chase** (#1 leak) and **Automation 11 — Funded → review/referral**.
5. **Build the two forms (PART 4):** the public **MCA Funding Application** (embed on mfunding.net → New Lead) and the internal **Live Transfer Intake** (closers fill on calls → Qualifying).
6. *(Later / enrichment)* the remaining automations (2–5, 7–10, 12–13, per-funder submissions, VCF, recovery) — all written below in email-only form.

**Two gotchas on every workflow:** (a) the AI leaves 3 blanks — trigger pipeline/stage, assigned user, task due date; (b) delete any SMS / "missed-call text-back" step (this account is email-only). See PART 3 "READ FIRST."

---

# PART 1 — Create the two pipelines

> ✅ **DONE & VERIFIED — June 26, 2026.** Both pipelines exist in the MFunding location (`t7NmVR4WCy927j4Zon4b`) with the exact stages and order below. Do NOT recreate them. The live IDs (use these when wiring automations / app sync) are at the end of this section.

In GHL: **Opportunities → Pipelines → + Create Pipeline.**

## Pipeline 1 — name it exactly: `MFunding MCA Pipeline`

Add these **13 stages, in this order, named exactly:**

1. New Lead
2. Contacted
3. Qualifying
4. Application Sent
5. Docs Collected
6. Bank Statements
7. Submitted to Funders
8. Offer Received
9. Offer Presented
10. Offer Accepted
11. Funded
12. Renewal Eligible
13. Nurture / Re-engage

**Then how wins/losses work (don't make these stages):**

- A deal that **funds** → drag to **Funded**, and mark the opportunity **status = Won**.
- A deal that **doesn't fund but is worth keeping** (funder declined / merchant declined / went dark) → **Nurture / Re-engage** (stays Open, worked by reactivation).
- A deal that's **truly dead** (texted STOP, prohibited industry, given up after re-tries) → mark opportunity **status = Lost** + a reason. It leaves the board.

## Pipeline 2 — name it exactly: `MFunding VCF Pipeline`

Add these **8 stages, in order:**

1. New Lead (Distressed)
2. Hardship Consultation
3. Positions & Balances Analysis
4. Strategy / Proposal
5. Agreement Sent
6. Submitted to VCF
7. Restructure Executed
8. Servicing / Monitoring

## Live pipeline & stage IDs (verified June 26, 2026)

Use these for automation wiring and app sync (`ghl-sync` targets the **MCA** pipeline by name/ID).

**`MFunding MCA Pipeline`** — pipeline id `bG9ZEh4eP9x60E1CyaMx`

| #  | Stage                | Stage ID                                 |
| -- | -------------------- | ---------------------------------------- |
| 1  | New Lead             | `d60d563a-9904-423f-9a8e-0d0df0b12976` |
| 2  | Contacted            | `bc68ac6f-d45d-4d56-b1c8-c10a7ec4fdf7` |
| 3  | Qualifying           | `27960f79-0b08-48ac-8fee-f4a9bf7748e3` |
| 4  | Application Sent     | `2071ceb6-b0cf-4700-b57b-f8a3ef4b15bf` |
| 5  | Docs Collected       | `c49fa9f8-a155-4d14-a597-2b23fd937b32` |
| 6  | Bank Statements      | `72d926b3-ee88-4ee5-8ca2-ddb7071b2fc5` |
| 7  | Submitted to Funders | `47d3f297-bf23-40a3-8e2b-48fa6c04e809` |
| 8  | Offer Received       | `5881c6a8-a84a-4753-be7f-6b8cd3f7d5be` |
| 9  | Offer Presented      | `718d76bc-58c9-4913-a68d-e0345ed0b515` |
| 10 | Offer Accepted       | `7e3cfb93-8e6e-428c-be99-9dfc77f300e6` |
| 11 | Funded               | `69995f02-4f20-41b9-8206-bbaaf7060c10` |
| 12 | Renewal Eligible     | `bfd0515e-7dfd-4527-8460-1edef442311a` |
| 13 | Nurture / Re-engage  | `d4c4ce2d-75af-4766-82cf-c3ff56f0137b` |

**`MFunding VCF Pipeline`** — pipeline id `nsmH6jIeVA0SsZMMq4LC`

| # | Stage                         | Stage ID                                 |
| - | ----------------------------- | ---------------------------------------- |
| 1 | New Lead (Distressed)         | `625e5afd-94a9-455c-b1bd-d712cad4cb17` |
| 2 | Hardship Consultation         | `bcdd76ef-f798-4d14-8606-4087edaa6d42` |
| 3 | Positions & Balances Analysis | `a1c7e1c8-2404-4a81-bf70-0bd21837fd33` |
| 4 | Strategy / Proposal           | `36ccf48f-c0a4-4264-bc42-066803ec6b75` |
| 5 | Agreement Sent                | `046a711e-2303-4aa1-84e5-c32dac68d72b` |
| 6 | Submitted to VCF              | `6ad1513c-08e1-4e60-99c5-7809da5a6d99` |
| 7 | Restructure Executed          | `a46a57f5-b75c-4ae7-8705-98979db4bb53` |
| 8 | Servicing / Monitoring        | `5e684647-324c-4f31-90aa-59d9ca6a596c` |

> Note: pipeline structure (create/edit stages) is **not writable** via the current Private Integration Token (returns 401 — missing scope). Edit pipelines in the GHL UI, or add the Opportunities/pipelines write scope to the token.

---

# PART 2 — Create the custom fields

> ✅ **DONE — built via API on June 26, 2026.** All required Contact custom fields now exist in the MFunding location (`t7NmVR4WCy927j4Zon4b`). The table below is the source of truth for **exact field keys** (used by automations and by our app's `ghl-sync`). You do NOT need to recreate these. Skip to PART 3.

In GHL these live under: **Settings → Custom Fields** (Contact).

| Field                     | Type (as built)                                                                                                   | Field Key                            | Status                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Paydown %                 | Number (NUMERICAL)                                                                                                | `contact.paydown_`                 | ✅ created 6/26 —`ghl-sync` matches this for renewal triggers                                  |
| Lead Source               | Dropdown: **Web Form**, Live Transfer, Google Ads, Aged Lead, UCC, Referral, SEO/Organic, Sub-ISO, Other          | `contact.lead_source`              | ✅ created 6/26 · "Web Form" added 6/27                                                          |
| Target Market             | Dropdown: Indianapolis, Phoenix/Scottsdale, Columbus/Cincinnati, DC/NoVA, Sacramento, South Florida, Texas, Other | `contact.target_market`            | ✅ created 6/26                                                                                   |
| Funding Amount Requested  | Monetary                                                                                                          | `contact.funding_amount_requested` | ✅ created 6/26                                                                                   |
| Product Type              | Dropdown: MCA, Term Loan, SBA, LOC, Equipment, VCF                                                                | `contact.product_type`             | ✅ created 6/26                                                                                   |
| Plaid Connected           | Checkbox (Yes)                                                                                                    | `contact.plaid_connected`          | ✅ created 6/26                                                                                   |
| Disclosure Acknowledged   | Checkbox (Yes)                                                                                                    | `contact.disclosure_acknowledged`  | ✅ created 6/26                                                                                   |
| Active MCA Positions      | Number (NUMERICAL)                                                                                                | `contact.active_mca_positions`     | ✅ created 6/26                                                                                   |
| Monthly Revenue           | **Dropdown** ranges (Under $25K … $250K+)                                                                  | `contact.monthly_revenue`          | ♻️ already existed (range-dropdown, used by the live opt-in funnel — NOT a free number)        |
| Industry                  | **Dropdown** (Trucking, Construction, Restaurant, Retail, E-comm, Healthcare, Professional Services, Other) | `contact.industry`                 | ♻️ already existed (dropdown, not free text)                                                    |
| Time in Business Months   | Number (NUMERICAL)                                                                                                | `contact.months_in_business`       | ♻️ already existed as**"Months in Business"** — reuse it                                 |
| Total Daily/Weekly Debits | Monetary                                                                                                          | `contact.total_daily_debit`        | ♻️ already existed as**"Total Daily Debit"** (daily only; weekly not separately captured) |
| State                     | —                                                                                                                | `contact.state`                    | ⚙️ use the**built-in standard** State field (GHL blocks a custom field named "State")     |
| Do Not Contact            | Checkbox (Yes)                                                                                                    | `contact.do_not_contact`           | ✅ created 6/26 — used by the Opt-Out/DNC gate + Mass-Reactivation exclusion                     |
| Business Entity           | Dropdown: LLC, S-Corp, C-Corp, Sole Proprietor, Partnership, LLP, PLLC                                            | `contact.business_entity`          | ✅ created 6/27 (web application form)                                                            |
| Use of Funds              | Dropdown: Working Capital, Inventory, Equipment, Payroll, Expansion / Renovation, Marketing, Debt Refinance, Other| `contact.use_of_funds`             | ✅ created 6/27 (web application form)                                                            |
| Federal Tax ID (EIN)      | Text                                                                                                              | `contact.federal_tax_id_ein`       | ✅ created 6/27 (web application form)                                                            |
| Monthly Credit Card Sales | Dropdown: Does not accept cards, <$7K, $7K–$30K, $30K–$100K, >$100K, >$500K                                        | `contact.monthly_credit_card_sales`| ✅ created 6/27 (web application form)                                                            |

**Two type notes that affect automations:**

- **Monthly Revenue** and **Industry** are **dropdowns**, not the Number/Text originally specced — because the live MCA-qualifier opt-in form already feeds the dropdown versions. The DQ logic in Automation 3 ("Monthly Revenue < $15,000") must therefore branch on the **range option** (e.g. flag "Under $25K"), not a numeric comparison.
- Additional qualifier fields already present and usable: `FICO Range`, `Number of MCAs`, `Payment Status`, `Total Business Debt`, `Total Outstanding MCA Balance`, `Reason for Restructure`, `Current Funder Names`, `TCPA Consent`, `Best time to reach you`, `Are your documents ready?`, `Funnel Source`, `Business Name`, `Message`.

---

# PART 3 — Build the automations

**Each stage has its own automation that fires when a deal moves INTO that stage** (GHL trigger: *Pipeline Stage Changed*). Build them **one at a time**: GHL → Automation → Workflows → **+ New Workflow → Start with AI** → paste one prompt below → review → Publish. Then do the next.

## ⚠️ READ FIRST — global rules for EVERY workflow below
These five rules apply to every automation. They override any SMS-flavored copy still shown in the prompts.

**1. EMAIL ONLY — this account has NO SMS.** Wherever a prompt mentions SMS, build it as an **Email** instead, and **delete any SMS step** the AI adds (especially "missed-call text-back"). Paste this line into every prompt: *"This account is EMAIL ONLY — do not add any SMS steps."*

**2. Keep workflows LINEAR — no branches, waits, or conditions.** GHL's "Build with AI" loves to add If/Else branches and "wait-for-reply" steps; they come out half-built and throw the red *"Resolve errors"* panel. Paste this too: *"Strictly linear — no If/Else branches, no Wait steps, no conditions."* (A **trigger filter** — e.g. "Lead Source is Live Transfer" — is fine; that's not a branch.)

**3. After the AI generates each workflow, fill the 3 blanks it always leaves** (these cause the red errors):
- **Trigger** → re-select Pipeline = `MFunding MCA Pipeline` + the correct **Stage**.
- **Assign / round-robin step** → pick the user(s): you, Carlos, Diego, and/or Stephanie.
- **Task step** → set a **Due date** (e.g. "in 5 minutes").
Then **delete any SMS step → Save → confirm zero errors → flip Draft → Publish.**

**4. How deals advance (important):** automations do **NOT** move deals between stages. **A human (the closer) drags the deal** as they work it; each stage's automation just fires that stage's email + task. (Email-only can't reliably detect "the lead replied," so there is no auto-advance.) The only reliable **auto-entry** is a **form submission** — web form → New Lead; Live Transfer Intake → Qualifying (see PART 4).

**5. Compliance (every email):** never use "loan" for MCA (use funding / capital / advance); lead with "no upfront fees · no credit impact to see options"; honor unsubscribe + DND. Merge fields: `{{contact.first_name}}`, `{{contact.company_name}}`.

## Build order — do the CORE first (enough to operate); the rest is polish
1. **Opt-Out / DNC gate** (build FIRST — it overrides everything) — see the 🟥 recovery section.
2. **Speed-to-Lead** (New Lead) — web-form leads — Automation 1.
3. **Live Transfer → Qualifying** — phone transfers — Automation 1B.
4. **Bank Statements chase** (#1 funnel leak) — Automation 6 — and **Funded → review/referral** — Automation 11.

Everything else (no-answer, soft-no, application/disclosure, docs, offer flows, renewal triggers, mass reactivation, per-funder submissions, VCF, recovery) is **next-phase enrichment** — build it once real leads are flowing. Each is written below in email-only form.

---

### 🟦 Automation 1 — New Lead / Speed-to-Lead (WEB-FORM leads)
*Fires when the web application form (PART 4) creates an opportunity at New Lead. Email-only, linear.*

```
Build a GHL workflow named "MCA 01 - Speed to Lead".
This account is EMAIL ONLY. Strictly linear — no If/Else branches, no Wait steps, no SMS.
TRIGGER: Pipeline Stage Changed -> MFunding MCA Pipeline -> stage "New Lead", status Open.
ACTIONS in order:
1. Send Email — subject "{{contact.first_name}}, your MFunding funding request — next steps".
   Body: thank them for their interest in working capital for {{contact.company_name}}; a funding
   specialist will call them shortly; three reasons to choose us — no upfront fees, no credit impact
   to see your options, funding typically in 24–48 hours. (Never use the word "loan.")
2. Assign the opportunity to a user (leave the user for me to select — closer round-robin pool).
3. Create a Task "Call {{contact.first_name}} within 5 minutes — NEW LEAD", assigned to that user, due in 5 minutes.
```
**Fill these blanks after it generates:** trigger Pipeline=`MFunding MCA Pipeline`/Stage=`New Lead`; the assign user(s); the task **Due date = in 5 minutes**. Delete any SMS/"missed-call text-back" step.
**How it advances:** the closer calls the lead, then **manually drags the deal to "Qualifying."**

### 🟦 Automation 1B — Live Transfer → Qualifying (PHONE transfers)
*For paid live/call transfers. The lead is already on the phone; the closer fills the internal **Live Transfer Intake form** (PART 4) during the call, which creates the opportunity at **Qualifying** with **Lead Source = Live Transfer**. This greets them correctly — it must NOT say "we'll call you," because you're already talking.*

```
Build a GHL workflow named "MCA 01B - Live Transfer (Qualifying)".
This account is EMAIL ONLY. Strictly linear — no If/Else branches, no Wait steps, no SMS.
TRIGGER: Pipeline Stage Changed -> MFunding MCA Pipeline -> stage "Qualifying", status Open.
TRIGGER FILTER: Lead Source is "Live Transfer".  (a trigger filter, not a branch)
ACTIONS in order:
1. Send Email — subject "Great speaking with you, {{contact.first_name}} — here's what's next".
   Body: thank them for the call; you're getting {{contact.company_name}} matched to the right funding;
   the documents we need next are: last 3 months of business bank statements, a photo of the owner's
   driver's license, and a voided business check; reassure no upfront fees and no credit impact to see
   options. (Never use the word "loan.")
2. Create a Task for the assigned closer: "Send application + collect docs — {{contact.first_name}}" due in 1 hour.
```
**Fill these blanks:** trigger Pipeline/Stage=`Qualifying`; the **Lead Source = Live Transfer** filter; the assign/task user; the task **Due date = in 1 hour**.
**How it advances:** closer collects the docs, then **drags the deal to "Bank Statements."**
**Who kicks it off:** the **closer**, by submitting the Live Transfer Intake form on the call — not the merchant. (Full explanation + the intake form is in PART 4.)

### 🟦 Automation 2 — No-Answer Nurture (7-day)  *(enrichment — email-only; build later)*

```
Build a GHL workflow named "MCA 02 - No Answer Nurture".
TRIGGER: Tag "no-answer" added (set by Automation 1) — OR stage = Contacted with no reply in 2h.
GOAL: reach an unresponsive lead over 7 days, then rest them.
ACTIONS:
Day 0: SMS "Hi {{contact.first_name}}, this is {{user.first_name}} from MFunding. When's a good time today to chat about capital for {{contact.company_name}}? Reply STOP to opt out."
Day 0 + 2h: Create call task "Attempt 2 — {{contact.first_name}}".
Day 1 AM: SMS "{{contact.first_name}}, I may be able to get {{contact.company_name}} $[range] in working capital — takes a 5-min call. Text CALL and I'll ring you now. STOP to opt out." + send Email (subject "Quick question about capital for {{contact.company_name}}").
Day 2: Create call task "Attempt 3 + voicemail".
Day 4: SMS "{{contact.first_name}}, still happy to help when you're ready. Not interested? Reply STOP. Otherwise text me a good time."
Day 7: Breakup SMS "Hi {{contact.first_name}}, I've tried a few times — I'll close your file for now, but you've got my number. Best of luck! STOP to opt out."
BRANCH: if the contact replies at any point -> remove tag "no-answer", move opportunity to "Contacted".
END: after Day 7 with no reply -> move opportunity to stage "Nurture / Re-engage" and add tag "nurture".
```

### 🟦 Automation 3 — Qualifying (BANT-F + soft-no)

```
Build a GHL workflow named "MCA 03 - Qualifying".
TRIGGER: Pipeline Stage Changed -> stage "Qualifying".
ACTIONS:
1. Send SMS: "Great talking, {{contact.first_name}}! To match you with the right funding, I just need a few quick details — I'll text a 60-second form." then send the qualification form link (Monthly Revenue, Time in Business, Funding Amount, Industry, # of current advances).
2. When the form is submitted, map answers to existing custom fields: Monthly Revenue (dropdown range, contact.monthly_revenue), Months in Business (contact.months_in_business), Funding Amount Requested (contact.funding_amount_requested), Industry (dropdown, contact.industry), Active MCA Positions (contact.active_mca_positions).
3. IF Months in Business < 6 OR Monthly Revenue = "Under $25K" (lowest range — covers the <$15k DQ threshold) OR Industry is prohibited (cannabis, adult, firearms): add tag "disqualified", notify the closer, and STOP (move to Nurture / Re-engage unless hard-prohibited, then mark Lost reason prohibited_industry). NOTE: Monthly Revenue & Industry are range/option dropdowns, so branch on the option value, not a numeric comparison.
4. IF Active MCA Positions >= 2 (stacked/distressed): add tag "route-to-vcf" (hands to the VCF routing automation).
5. IF the merchant says "not right now": add tag "soft-no".
ADVANCE: if qualified, move opportunity to "Application Sent".
BRANCH (soft-no): tag "soft-no" starts a 90-day nurture — Day 30 check-in SMS, Day 45 value email (a cash-flow tip, no pitch), Day 60 "new programs" SMS, Day 75 industry case study, Day 90 final check-in, then quarterly. Re-engage -> back to Qualifying.
```

### 🟦 Automation 4 — Application Sent (+ Disclosure)

```
Build a GHL workflow named "MCA 04 - Application + Disclosure".
TRIGGER: Pipeline Stage Changed -> stage "Application Sent".
ACTIONS:
1. SMS: "{{contact.first_name}}, here's your quick MFunding application — takes about 3 minutes: [application link]. No upfront fees, and this won't impact your credit. STOP to opt out." Send the same link by email.
2. Send the state- and product-specific disclosure document for the merchant's State + Product Type; when signed, set custom field "Disclosure Acknowledged" = true.
3. Reminders if not completed: +4 hours SMS, Day 1 SMS + call task.
ADVANCE: when the application is submitted, move opportunity to "Docs Collected".
BRANCH: if not completed after Day 3 -> SMS "Want me to hold your file or pick this up later?"; no response -> move to Nurture / Re-engage, tag "nurture", lost_reason docs_not_provided.
```

### 🟦 Automation 5 — Docs Collected (non-bank stips)

```
Build a GHL workflow named "MCA 05 - Docs Collection".
TRIGGER: Pipeline Stage Changed -> stage "Docs Collected".
GOAL: collect the non-bank stips: signed application, owner's driver's license/ID, a voided check, and the credit authorization.
ACTIONS:
1. SMS with a secure upload link: "{{contact.first_name}}, almost there! Please upload 4 quick items: photo ID, a voided check, and sign the application + authorization here: [upload link]. STOP to opt out."
2. Send a checklist email listing the 4 items with the upload link.
3. Reminders: +4h SMS, Day 1 SMS + call task, Day 2 SMS "Which item can I help you grab?"
ADVANCE: when all non-bank stips are received, move opportunity to "Bank Statements".
```

### 🟦 Automation 6 — Bank Statements (Sequence A, 14-day) ⭐ #1 PRIORITY

```
Build a GHL workflow named "MCA 06 - Bank Statements (Seq A)".
This account is EMAIL ONLY. No SMS. Use timed EMAILS + closer call tasks (no branches).
TRIGGER: Pipeline Stage Changed -> MFunding MCA Pipeline -> stage "Bank Statements", status Open.
GOAL (the #1 funnel leak): get the 3 most recent business bank statements. Plaid is OPTIONAL; manual upload/email is the default.
ACTIONS (14-day email cadence; the closer stops it the moment statements arrive by moving the deal):
Day 0: Email "{{contact.first_name}}, last step to get you funded" — ask for the 3 most recent business
   bank statements; say they can email them to docs@mfunding.com (or use the secure upload link, and the
   60-second bank-connect link if Plaid is enabled). No upfront fees; no credit impact.
Day 1: Create a call task "Bank statements — {{contact.first_name}}" + Email "A funder is reviewing files today — just need your statements."
Day 2: Email "Three easy ways to send your statements: secure upload, email to docs@mfunding.com, or connect your bank."
Day 4: Create a call task "Attempt 2 + voicemail" + Email "Still optimistic about your options — just need those statements."
Day 7: Email "Heads up — pre-approvals expire after 7–10 days. Send your statements this week and I'll lock in your offers."
Day 10: Email restating all the ways to send.
Day 14: Breakup Email "Closing your file for now — no hard feelings. It's saved; reply anytime when you're ready."
WHEN a bank is connected (Plaid): set custom field "Plaid Connected" (contact.plaid_connected) = Yes.
```
**Fill these blanks:** trigger Pipeline/Stage=`Bank Statements`; call-task **assignee + due dates**. Delete any SMS step.
**How it advances:** when statements arrive, the **closer drags the deal to "Submitted to Funders."** If nothing by Day 14, the closer drags it to **Nurture / Re-engage** (set the opp lost-reason `docs_not_provided` only if truly dead).

### 🟦 Automation 7 — Submitted to Funders (orchestrator)

```
Build a GHL workflow named "MCA 07 - Submission Orchestrator".
TRIGGER: Pipeline Stage Changed -> stage "Submitted to Funders".
ACTIONS:
1. Notify the assigned closer + ops: "Deal ready — package built for {{contact.company_name}}, submitting to funders."
2. This stage fires the PER-FUNDER submission workflows (one each, below) selected by the tags submit:corfin / submit:gokapital / submit:reliant / submit:ucs / submit:funderial / submit:guidant. Submit to 3–5 in parallel.
3. Start a 5-day SLA timer.
ADVANCE: when ANY funder returns an offer (a submission is marked offer_made) -> move opportunity to "Offer Received".
BRANCH: if ALL funder submissions come back declined -> add tag "all-declined" (hands to the All-Funders-Declined recovery automation).
```

*(The per-funder send/follow-up prompts are in the REFERENCE section — one per funder with its email address and routing.)*

### 🟦 Automation 8 — Offer Received

```
Build a GHL workflow named "MCA 08 - Offer Received".
TRIGGER: Pipeline Stage Changed -> stage "Offer Received".
ACTIONS:
1. Notify the closer: "Offer in for {{contact.company_name}} — {{offer terms}}. Build the comparison and present."
2. Internal task: "Assemble best 2+ offers side-by-side (amount, factor, term, daily/weekly payment)."
ADVANCE: when offers are ready to show, move opportunity to "Offer Presented".
```

### 🟦 Automation 9 — Offer Presented (+ decline rework, Sequence D)

```
Build a GHL workflow named "MCA 09 - Offer Presented".
TRIGGER: Pipeline Stage Changed -> stage "Offer Presented".
ACTIONS:
1. SMS: "{{contact.first_name}}, your funding offer is ready! Review your options here: [branded offer link]. Happy to walk you through them — when's a good time? STOP to opt out."
2. Create a follow-up task for the closer for the same day.
3. If no decision in 24h: SMS "Any questions on your offer, {{contact.first_name}}? I can usually tweak the terms."
ADVANCE (accept): when the merchant accepts, move opportunity to "Offer Accepted".
BRANCH (decline) — add tag "offer-declined" to start the 45-day rework (Sequence D):
  Day 0: Call task "Why didn't it work — cost, term, amount, or payment? Find a better fit."
  Day 1–3: SMS "Found a different option that addresses [their concern] — 3-min call?" and resubmit to other funders (move back to Submitted to Funders).
  Day 7: SMS "One more option with [specific improvement] — worth a look?"
  Day 14: Breakup SMS.
  Day 45: Re-engage SMS "New programs opened with better terms — want me to re-run your numbers?"
  If still no -> move to Nurture / Re-engage, lost_reason merchant_declined.
```

### 🟦 Automation 10 — Offer Accepted (to signed/funded)

```
Build a GHL workflow named "MCA 10 - Offer Accepted".
TRIGGER: Pipeline Stage Changed -> stage "Offer Accepted".
ACTIONS:
1. SMS: "Congrats {{contact.first_name}} — great choice! I'm sending your agreement to e-sign now. Once signed, funding usually hits in 24–48 hours."
2. Send the funder agreement for e-signature; reminders at +4h, Day 1, Day 2 if unsigned.
3. Notify ops to coordinate funding with the funder.
ADVANCE: when the contract is signed and the funder confirms funding, move opportunity to "Funded".
BRANCH: funder rescinds / contract unsigned after Day 3 / final-underwriting decline -> tag "funding-failed" -> move back to Submitted to Funders (resubmit) or to Nurture / Re-engage, lost_reason funding_fell_through.
```

### 🟦 Automation 11 — Funded (Sequence E: review + referral)

```
Build a GHL workflow named "MCA 11 - Funded -> Renewal".
This account is EMAIL ONLY. No SMS. Strictly linear.
TRIGGER: Pipeline Stage Changed -> MFunding MCA Pipeline -> stage "Funded".
ACTIONS:
1. Set the opportunity STATUS = Won.
2. Day 1: Send Email "Congrats {{contact.first_name}} — your capital is on the way!" with two asks:
   (1) a 30-second Google review [review link], and (2) refer another business owner for a $100 gift
   card per funded referral (have them mention your name).
3. Day 7: Send Email "How's the funding working out? Know anyone who could use capital? $100 gift card per funded referral."
```
**Fill these blanks:** trigger Pipeline/Stage=`Funded`; review link. Delete any SMS step.
**How renewals work:** you do NOT advance the deal here. Our app pushes **Paydown %** (`contact.paydown_`) as the merchant pays down, which fires **Automation 12 (Renewal Triggers)** at 40/60/75/100%. Build Automation 12 too if you want renewals automated; otherwise the renewal nudges are manual.

### 🟦 Automation 12 — Renewal Eligible (paydown triggers)

```
Build a GHL workflow named "MCA 12 - Renewal Triggers".
TRIGGER: custom field "Paydown %" changes (our app pushes this value).
ACTIONS (branch by value):
  At 40%: SMS "{{contact.first_name}}, you're ~halfway through your advance — at this point many clients qualify for additional capital at better terms. Want me to check?"
  At 60%: Call task + SMS "Good news — based on your payment history you're likely eligible to renew for a larger amount. Run the numbers?"
  At 75%: SMS "Almost done! This is the best time to renew — most favorable terms. Pull your options?"
  At 100%: Call task "Congrats on completing your advance! Many clients keep revolving capital available — see what you'd qualify for."
ADVANCE: a renewal application re-enters the pipeline at "Application Sent" as a new deal (tag "renewal").
```

### 🟦 Automation 13 — Nurture / Re-engage (Sequence F, monthly)

```
Build a GHL workflow named "MCA 13 - Mass Reactivation".
TRIGGER: scheduled monthly (1st of the month). AUDIENCE: opportunities in stage "Nurture / Re-engage" (tags "nurture"/"dead-recoverable"). EXCLUDE anyone with Do Not Contact = true or DND on.
ACTIONS: rotate 3 templates month to month:
  Month A: "Hi {{contact.first_name}}, we connected a while back about capital for {{contact.company_name}}. Things change — still looking for working capital? Reply YES and I'll take another look. STOP to opt out."
  Month B: "Several of our funding partners just launched new programs with faster approvals. If {{contact.company_name}} could use capital, now's a great time. Reply YES."
  Month C: "We just helped a {{Industry}} business get funded last week. If you could use a boost, text me anytime."
BRANCH: reply YES -> move opportunity back to "New Lead" (fresh deal). After ~3 cycles with zero engagement -> tag "archived" and stop sending.
```

### 🟥 Recovery Automation — All Funders Declined

```
Build a GHL workflow named "MCA RX - All Funders Declined".
TRIGGER: Tag "all-declined" added (from Automation 7).
ACTIONS:
1. Resubmit to a tier-2 / specialty funder set: move the opportunity back to "Submitted to Funders" and add tag "resubmit:tier2".
2. IF still no offer AND tag "stacked": add tag "route-to-vcf" (hands to VCF routing).
3. ELSE: move to "Nurture / Re-engage", lost_reason funders_declined_all, and start a 30/60-day "we're exploring alternatives" nurture that re-submits when revenue grows / positions clear.
```

### 🟥 Recovery Automation — Route to VCF

```
Build a GHL workflow named "RX - Route to VCF".
TRIGGER: Tag "route-to-vcf" added, OR Product Type set to "VCF".
ACTIONS:
1. Create an opportunity in the "MFunding VCF Pipeline" at stage "New Lead (Distressed)" for this contact; set Product Type = VCF.
2. Notify the VCF team.
3. Send empathetic SMS: "{{contact.first_name}}, it looks like you've got multiple advances stacking up. We have a program built exactly for that — to consolidate and lower your payments. Let's talk options. STOP to opt out."
```

### 🟥 Recovery Automation — Opt-Out / DNC (TCPA) — build this FIRST, it overrides all

```
Build a GHL workflow named "RX - Opt Out / DNC".  EMAIL ONLY. Strictly linear.
TRIGGER: Contact unsubscribes / email reply contains STOP, UNSUBSCRIBE, REMOVE, or QUIT, OR DND is set.
ACTIONS:
1. Set custom field "Do Not Contact" (contact.do_not_contact) = Yes and turn on DND for all channels.
2. Remove the contact from EVERY workflow/sequence.
3. Mark the opportunity status = Lost, reason "opted_out".
4. Never message again unless they explicitly re-opt-in.
This gate overrides every other automation. (Email-only: the email unsubscribe footer is the primary opt-out; this also catches reply keywords.)
```

---

### Appendix — build EVERYTHING in one prompt (optional, NOT recommended)

> ⚠️ **Not recommended.** This one-shot prompt tends to produce the bloated, branchy, SMS-laden workflows that throw "Resolve errors" (exactly what we hit). **Prefer building the CORE automations one at a time** from the prompts above (they're email-only and linear). If you do use this, it is **EMAIL ONLY** — add *"EMAIL ONLY, strictly linear, no SMS, no branches, no waits"* to the prompt, and you'll still have to fill the 3 blanks (pipeline, users, due dates) and delete SMS steps in every workflow it makes. Pipelines and custom fields already exist — do NOT let it recreate them.

If your GHL plan has the Workflow AI assistant and you'd rather scaffold it all at once (terser, less copy), paste this single prompt. Then go back and enrich each workflow with the detailed copy above.

### 🤖 Paste this into GHL Workflow AI

```
You are configuring my GoHighLevel sub-account "MFunding.net", location t7NmVR4WCy927j4Zon4b.

COMPLIANCE: We broker business funding (MCA, term, SBA, LOC, equipment) AND run a debt-relief
line (VCF). MCAs are NOT loans — never use "loan" in MCA copy; use "funding/capital/advance/
working capital." No upfront fees. "No credit impact" until funder submission. VCF copy: no
guarantees of savings or approval. CHANNEL: use EMAIL as the primary channel for every message;
SMS is optional — only add an SMS version if SMS is enabled. If SMS is used it includes an opt-out
line and respects TCPA/quiet hours.

STEP 1 — CUSTOM FIELDS (Contact): ALREADY BUILT (June 26, 2026) — do NOT recreate. The fields
exist with these keys: contact.paydown_, contact.lead_source, contact.target_market,
contact.funding_amount_requested, contact.product_type (MCA/Term Loan/SBA/LOC/Equipment/VCF),
contact.plaid_connected, contact.disclosure_acknowledged, contact.active_mca_positions,
contact.monthly_revenue (DROPDOWN ranges, not a number), contact.industry (DROPDOWN, not text),
contact.months_in_business (= "Time in Business Months"), contact.total_daily_debit. Use the
built-in standard contact.state for State. Reference these existing fields in the workflows below;
do not add duplicates.

STEP 2 — BUILD TWO PIPELINES
"MFunding MCA Pipeline", stages in order, named EXACTLY:
  New Lead, Contacted, Qualifying, Application Sent, Docs Collected, Bank Statements,
  Submitted to Funders, Offer Received, Offer Presented, Offer Accepted, Funded, Renewal Eligible,
  Nurture / Re-engage
  (Funded = set opportunity status WON. Recoverable losses go to Nurture / Re-engage, status OPEN.
  Truly-dead deals = set opportunity status LOST with a reason; do NOT make Won/Lost their own stages.)
"MFunding VCF Pipeline", stages in order:
  New Lead (Distressed), Hardship Consultation, Positions & Balances Analysis, Strategy / Proposal,
  Agreement Sent, Submitted to VCF, Restructure Executed, Servicing / Monitoring

STEP 3 — MCA PIPELINE WORKFLOWS (trigger = Opportunity Stage Changed to the named stage)
A) Speed-to-Lead — New Lead: SMS <1 min ("Thanks for reaching out to MFunding — a funding
   specialist will call you shortly. Reply STOP to opt out."), intro email, round-robin assign,
   task "Call within 5 minutes", missed-call text-back.
B) No-Answer Nurture — Contacted + no reply 2h: 7-day (Day0 SMS, +2h call, Day1 SMS+email, Day2
   call, Day4 SMS, Day7 breakup); on no response tag "dead" + "nurture".
C) Soft-No Nurture — tag "soft-no": 90-day (Day30 check-in, Day45 value email, Day60 "new
   programs" SMS, Day75 case study, Day90 final) then quarterly.
D) Application + Disclosure — Application Sent: send app/funnel link + state/product disclosure;
   set Disclosure Acknowledged on sign; reminders +4h, Day1.
E1) Docs Collection — Docs Collected: collect non-bank stips (application, owner ID, voided
   check, credit authorization); reminders Day0, +4h, Day1.
E2) Bank Statements (HIGHEST PRIORITY) — Bank Statements: 14-day — Day0 SMS w/ secure upload +
   (if Plaid enabled) bank-connect link + photo/email alts; +2h SMS; Day1 call+SMS; Day2
   three-methods SMS; Day4 call+VM+SMS; Day7 urgency; Day10 email; Day14 breakup. Plaid OPTIONAL.
F) Offer Follow-up / Declined — Offer Presented: follow-up task; if tag "offer-declined", 45-day
   rework (Day0 objection call, Day1-3 new options, Day7 one more, Day14 breakup, Day45).
G) Funded → Renewal — Funded: set opportunity Won; Day1 congrats SMS+email, Google review request,
   referral ask ($100 gift card). Arm renewal reminders.
H) Renewal Triggers — when Paydown % changes: 40 "may qualify for additional capital"; 60 call +
   renewal-offer SMS; 75 "best time to renew"; 100 direct-call task.
I) Mass Reactivation — monthly, audience = Nurture / Re-engage stage (tags "nurture"/"dead"),
   rotate 3 templates. EXCLUDE any contact with Do Not Contact = true or DND on. After ~2-3
   cycles with zero engagement, tag "archived" and stop sending.

STEP 4 — PER-FUNDER EMAIL SUBMISSION WORKFLOWS (all trigger on stage = Submitted to Funders,
filtered by a per-funder tag; ONE per funder; submit to 3-5 in parallel). Each emails the deal
package (attach signed application + 3 months bank statements + stips), subject "Deal Submission
— {{contact.business_name}} — {{Funding Amount Requested}}"; ~4h bounce check; Day1 follow-up +
call-underwriter task; Day2 call again; on offer move deal to Offer Received + notify; on decline
log it; if ALL funders decline move deal to Nurture / Re-engage (or VCF if stacked). Recipients:
  - Submit: Corfin — tag submit:corfin — underwriting@corfingroup.com
  - Submit: GoKapital — tag submit:gokapital — deals@gokapital.com
  - Submit: Reliant — tag submit:reliant — submissions@reliantfunding.com; IF high-risk
    (bankruptcy/default) tag, instead submissions@thelcfgroup.com, CC kmaimaron@thelcfgroup.com
    and prm@thelcfgroup.com
  - Submit: United Capital Source — tag submit:ucs — isosubmissions@unitedcapitalsource.com;
    email SUBJECT = merchant's exact legal/DBA business name; attach 4 months statements
  - Submit: Funderial — tag submit:funderial — michael@funderial.com
  - Submit: Guidant — tag submit:guidant — jordan.stefnik@guidantfinancial.com

STEP 5 — VCF PIPELINE WORKFLOWS (relief tone, no guarantees)
  - Distressed Intake — New Lead (Distressed): empathetic SMS+email, book hardship consult.
  - Positions Request — Positions & Balances Analysis: request all current MCA agreements + bank
    statements showing debits; reminders.
  - Submit to VCF — Submitted to VCF: email package to partnerprogram@valuecapitalfunding.com,
    same flow as Step 4.

STEP 6 — RECOVERY & ROUTING WORKFLOWS (so no deal dead-ends)
  - All-Funders-Declined — tag "all-declined": resubmit to a tier-2/specialty funder set (move
    back to Submitted to Funders, tag resubmit:tier2); if still no offer and tag "stacked", route
    to the VCF pipeline; else move to Nurture / Re-engage and start a 30/60-day resubmit nurture.
  - Merchant-Declined (Sequence D) — tag "offer-declined": Day0 objection call; resubmit to other
    funders for better terms; Day1-3 alternatives; Day7 one more; Day14 breakup; Day45 re-engage.
  - Route-to-VCF — tag "route-to-vcf" OR Product Type = VCF: create/move to the VCF pipeline at
    New Lead (Distressed) and notify the VCF team.
  - Opt-Out / DNC (TCPA) — inbound message contains STOP/UNSUBSCRIBE/REMOVE, or DND set: set Do
    Not Contact = true, remove from ALL workflows, mark opportunity Lost (reason opted_out), and
    NEVER message again unless they re-opt-in. This gate overrides every other workflow.

Confirm each pipeline and workflow is created and list their IDs.
```

---

# PART 4 — MCA Web Application Form (GHL form on mfunding.net)

> Modeled on a deep analysis of the mcashadvance.com/apply-business form, rebuilt MCA-compliant. This GHL form is the **primary web lead-entry point** — submissions create a contact + an opportunity in **`MFunding MCA Pipeline` at New Lead**, which fires **Automation 1 (Speed-to-Lead)**. New custom fields it needs were created via API on 6/27 (see PART 2).

**Build in GHL:** Sites → Forms → **+ Build Form**. Name it **"MCA Funding Application"**. Make it **2 steps**. Every field maps to a contact field so it feeds the pipeline/automations.

### Step 1 — Business
| Form field | Type | Required | Maps to |
|---|---|---|---|
| Legal Business Name | text | ✅ | `contact.business_name` |
| Business Entity | dropdown (LLC, S-Corp, C-Corp, Sole Proprietor, Partnership, LLP, PLLC) | ✅ | `contact.business_entity` |
| Industry | dropdown (curated — **prohibited industries removed**: no cannabis/adult/firearms) | ✅ | `contact.industry` |
| Business Address | address | ✅ | standard address |
| State | (from address) | ✅ | `contact.state` |
| Amount Requested | number/currency | ✅ | `contact.funding_amount_requested` |
| Use of Funds | dropdown (Working Capital, Inventory, Equipment, Payroll, Expansion / Renovation, Marketing, Debt Refinance, Other) | ✅ | `contact.use_of_funds` |
| Average Monthly Revenue | dropdown ranges (Under $25K, $25K–$50K, $50K–$100K, $100K–$250K, $250K+) | ✅ | `contact.monthly_revenue` |
| Time in Business | dropdown ranges (0–6 mo, 6 mo–1 yr, 1–2 yr, 2 yr+) | ✅ | `contact.time_in_business` |
| Federal Tax ID (EIN) | text | optional | `contact.federal_tax_id_ein` |
| Company Website | text | optional | standard `website` |
| Existing advances with other funders? | radio Yes/No | ✅ | (drives next 2) |
| Number of current advances | dropdown (1, 2–3, 4–6, 7+) | conditional | `contact.number_of_mcas` / `contact.active_mca_positions` |
| Total outstanding advance balance | currency | conditional | `contact.total_outstanding_mca_balance` |
| Monthly Credit Card Sales | dropdown (Does not accept cards, <$7K, $7K–$30K, $30K–$100K, >$100K, >$500K) | optional | `contact.monthly_credit_card_sales` |

### Step 2 — Owner + Consent
| Form field | Type | Required | Maps to |
|---|---|---|---|
| Owner First Name | text | ✅ | `contact.first_name` |
| Owner Last Name | text | ✅ | `contact.last_name` |
| Mobile Number | phone | ✅ | `contact.phone` |
| Email Address | email | ✅ | `contact.email` |
| Credit Score (FICO) | dropdown (<500, 500–549, 550–599, 600–649, 650–699, 700+) | ✅ | `contact.fico_range` |
| Additional info | textarea | optional | `contact.message` |
| **TCPA consent** | checkbox **(required)** | ✅ | `contact.tcpa_consent` |

**Compliance (bake into the form):**
- Never the word "loan" — use **funding / capital / advance**.
- Microcopy near submit: *"No upfront fees · Checking your options won't impact your credit."*
- TCPA checkbox is **required**; use the same consent language as the `TCPA Consent` field.
- Prohibited industries are **removed from the Industry dropdown** (not just flagged).
- Submit button: **"Submit My Funding Request"**.

**On submit (GHL form settings / a tied workflow):**
1. Create/update the contact with all mapped fields.
2. Set **Lead Source = Web Form** and **Product Type = MCA**.
3. Create an **opportunity in `MFunding MCA Pipeline` (id `bG9ZEh4eP9x60E1CyaMx`) at stage New Lead**, monetary value = Amount Requested.
4. → Automation 1 (Speed-to-Lead) fires.

**Put it on mfunding.net:** build the form in GHL → copy its **embed/iframe snippet** → drop it on a React `/apply` page on mfunding.net. Submissions flow straight into the CRM (no backend). Keep the public copy MCA-compliant (no "loan").

## Live Transfer Intake form (internal — closers only)
**The question this answers:** for paid live/phone transfers, the merchant is on the call *now* — they will NOT stop to fill a web form, and you shouldn't make them. **The closer fills this form while talking to them**, and submitting it is what drops the deal into the pipeline and kicks off the process. No link is sent for entry; a link is only emailed later for document collection.

Build a **second GHL form** named **"Live Transfer Intake"** — **same fields as the web Application form above** (so nothing extra to learn), with two differences in its settings/tied workflow:
- On submit, set **Lead Source = Live Transfer** (not Web Form) and **Product Type = MCA**.
- Create the opportunity at **Qualifying** (NOT New Lead) — because contact already happened live. This makes **Automation 1B** fire (the "great speaking with you" email), and ensures the New-Lead "we'll call you" Speed-to-Lead email never goes out.

**How closers use it:** keep the Live Transfer Intake form bookmarked → when a transfer comes in, open it → fill it in as the merchant answers → submit. Deal lands at **Qualifying** as a Live Transfer → 1B fires → closer collects docs → drags to **Bank Statements**. Make it internal (don't link it on the public site).

> Tip: a closer with the merchant on the phone can capture just the essentials live (name, business, revenue range, amount, existing advances, email) to get them into the pipeline fast, then gather EIN / exact figures / bank statements during the docs stage. Speed > completeness on the live call.

## Two lead-entry paths — ONE pipeline (do not split)
Both channels run through the **same `MFunding MCA Pipeline`**; they differ only by entry stage + Lead Source, not by process:

| | Web form lead | Live / call transfer |
|---|---|---|
| Created by | This GHL form | Closer creates the opp during/after the live call |
| Enters at stage | **New Lead** | **Qualifying** (contact already happened live) |
| Lead Source | **Web Form** | **Live Transfer** |
| Greeting automation | Automation 1 (Speed-to-Lead, "a specialist will call you") | "Great speaking with you" + doc checklist (does NOT say "we'll call you") |
| Assignment | Round-robin | The closer who took the call |

Because Speed-to-Lead triggers only on **New Lead**, live transfers (entered at **Qualifying**) never get the wrong "we'll call you" message. Segment/report by **Lead Source**. Keep two pipelines only for genuinely different processes (MCA vs. VCF debt relief).

---

---

# REFERENCE

*(Only needed if you build automations by hand, or want the detail behind each step.)*

## MCA stage automations — what each stage does

- **New Lead:** auto-response SMS+email <1 min, round-robin, AI pre-qual, "call in 5 min" task, missed-call text-back. No contact → Sequence B → breakup → Nurture.
- **Contacted:** log convo, book qualification call.
- **Qualifying:** capture BANT-F; disqualify below thresholds (<6 mo / <$15k/mo); "not now" → Sequence C; **if stacked/distressed → route to VCF.**
- **Application Sent:** send app link + compliance disclosure (capture acknowledgment); reminders.
- **Docs Collected:** non-bank stips (app, ID, voided check, cred auth).
- **Bank Statements ⭐ #1 leak:** Sequence A (14-day) bank-statement chase; Plaid optional, manual default; set Plaid Connected if a bank links.
- **Submitted to Funders:** fire the per-funder email workflows (below), 3–5 in parallel.
- **Offer Received:** collect every offer for side-by-side comparison.
- **Offer Presented:** branded offer link, present 2+ options; decline → Sequence D.
- **Offer Accepted:** collect/sign funder agreement; confirm funding.
- **Funded:** set Won; Sequence E (congrats, review, referral); commission auto-calcs.
- **Renewal Eligible:** Paydown % triggers at 40/60/75/100%.
- **Nurture / Re-engage:** recoverable losses; Sequence F monthly reactivation (excludes Do Not Contact); re-engaged → back to New Lead; exhausted/opt-out → Lost.

## Per-funder email submission (fires at "Submitted to Funders")

One workflow per funder, submit to 3–5 in parallel.

| Funder                          | Send to                                    | Routing / notes                                                                                                                         |
| ------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Corfin Group**          | `underwriting@corfingroup.com`           | mca                                                                                                                                     |
| **GoKapital**             | `deals@gokapital.com` (☎ 305-749-5299)  | mca / revenue-based, c-paper                                                                                                            |
| **Reliant Funding**       | `submissions@reliantfunding.com`         | **High-risk (BK/default) → instead `submissions@thelcfgroup.com`, CC `kmaimaron@thelcfgroup.com` + `prm@thelcfgroup.com`** |
| **United Capital Source** | `isosubmissions@unitedcapitalsource.com` | **Subject = exact legal/DBA name**; 4 mo statements (PDF) + app                                                                   |
| **Funderial**             | `michael@funderial.com`                  | mca / LOC                                                                                                                               |
| **Guidant Financial**     | `jordan.stefnik@guidantfinancial.com`    | startup (ROBS/SBA); portal`app.guidantfinancial.com/partner/center`                                                                   |

**VCF** (separate product line, VCF Pipeline): `partnerprogram@valuecapitalfunding.com` (Ferne Kornfeld). Submit-to: also use this address; full doc checklist (FDIC Bank Term Loan vs. Debt Restructuring) is in the lender record's `submission_notes`.
**Not live yet** (don't enable a per-funder workflow until approved):

- `application_submitted` (applied 6/26/2026, awaiting approval): **Fantastic Funding** (`subs@fantastic-funding.com`), **CapitaWize** (`info@capitawize.com`).
- `potential` (email-only ISO setup, not yet contacted): **FAC Solutions** (`info@facsolutions.biz` — send 3 mo statements + app; no portal; excludes Trucking/Auto Sales/Real Estate; no CA/TX).

**Each funder workflow:** send package email → ~4h bounce check → Day1 follow-up + call underwriter → Day2 call → on offer move deal to Offer Received + notify closer; on decline log it; if all decline → Nurture / Re-engage (or VCF if stacked).

## What happens when it doesn't fund (target: ~20–30% fund)

Non-funded deals fall into three planned buckets, all handled:

- **All funders decline** → resubmit tier-2 → VCF if stacked → else Nurture / Re-engage.
- **Merchant declines** → Sequence D: objection → resubmit for better terms → alternatives → Nurture / Re-engage.
- **Merchant goes dark** → breakup sequence → Nurture / Re-engage.

**Nurture / Re-engage** = recoverable, kept Open, worked monthly by Sequence F (this is the biggest non-funded bucket — a $0-cost volume asset). **Truly dead** (opt-out/DNC, prohibited industry, exhausted) = opportunity **Lost** + reason, off the board, never messaged again.

## VCF Pipeline — stage detail (🟡 confirm before building)

Debt relief, relief tone. 1) Distressed intake (no cross-sell) → 2) Hardship consult (positions, balances, debits) → 3) Collect all MCA agreements + statements → 4) Consolidate/refinance/renegotiate proposal → 5) E-sign engagement → 6) Email package to VCF → 7) Restructure executed → 8) Servicing. No savings/approval guarantees; never "loan."

## After GHL builds it

1. In our app, open a Deal → **Sync to GHL** (or call `ghl-sync` `{"action":"pipelines"}`) to confirm the MCA pipeline + stage IDs. Sync targets the **MCA Pipeline** by matching stage names.
2. Register the inbound webhook (`/functions/v1/ghl-webhook?secret=…`) for Opportunity + Contact events.
3. Our app pushes `Paydown %` (field key `contact.paydown_`) on deal sync → drives the Renewal Triggers workflow (Automation 12). The `ghl-sync` "paydown" action finds the field by matching "paydown" in the name, so this is wired end-to-end.
