# MFunding — GHL Pipelines, Stages & Automations (Build Spec)
### Last updated: June 26, 2026

> **Why this doc:** GHL's API v2 **cannot create pipelines/stages** (only `GET` exists). You build them in the **GHL UI** or with **GHL's Workflow AI** (paste prompt at the bottom). This is the exact spec: the pipelines, their stages, and the automation on each stage — including the **per-funder email submission** workflows.

---

# ⭐ THE TWO PIPELINES (at a glance)

You build **TWO separate pipelines** in GHL. A deal lives in exactly one of them based on product line.

| | **Pipeline 1 — `MFunding MCA Pipeline`** | **Pipeline 2 — `MFunding VCF Pipeline`** |
|---|---|---|
| **Product line** | Standard business funding (MCA, term loan, SBA, LOC, equipment) | **VCF debt relief** — bail out merchants stacked with multiple MCAs (consolidate / refinance / renegotiate) |
| **Customer** | Wants new capital | Over-leveraged, distressed, 2+ active MCAs |
| **# stages** | 10 | 8 |
| **Funders** | The 5 live MCA funders (GoKapital, Reliant, UCS, Funderial, Guidant) | Value Capital Funding only |

**Stage lists (exact names, in order):**

| # | Pipeline 1 — MCA Pipeline | Pipeline 2 — VCF Pipeline |
|---|---|---|
| 1 | `New Lead` | `New Lead (Distressed)` |
| 2 | `Contacted` | `Hardship Consultation` |
| 3 | `Qualifying` | `Positions & Balances Analysis` |
| 4 | `Application Sent` | `Strategy / Proposal` |
| 5 | `Docs Collected` | `Agreement Sent` |
| 6 | `Submitted to Funder` | `Submitted to VCF` |
| 7 | `Offer Received` | `Restructure Executed` |
| 8 | `Offer Presented` | `Servicing / Monitoring` |
| 9 | `Funded` | — |
| 10 | `Renewal Eligible` | — |

> ⚠️ **Pipeline 1 stage names must be EXACT** — our app's `ghl-sync` maps a deal's status to the GHL stage by matching these names (case-insensitive). Wrong names → opportunities land in the first stage.
> 🟡 **Pipeline 2 (VCF) stages are a recommended draft** — confirm them (and qualification thresholds + commission) before building; VCF auto-sync is a later phase.
> **MCA ≠ loan** in all MCA copy: use "funding / capital / advance / working capital." **No upfront fees. No credit impact** until funder submission.

---

# Custom fields to create first (Contact level)
`Monthly Revenue` (number), `Time in Business Months` (number), `Industry` (text), `Lead Source` (dropdown), `Target Market` (dropdown), `Funding Amount Requested` (number), `Product Type` (dropdown: MCA / Term Loan / SBA / LOC / Equipment / **VCF**), `Paydown %` (number), `State` (text), `Plaid Connected` (checkbox), `Disclosure Acknowledged` (checkbox), `Active MCA Positions` (number — for VCF), `Total Daily/Weekly Debits` (number — for VCF).

---

# PIPELINE 1 — MFunding MCA Pipeline: stage automations

Each stage: **on-entry automation**, the **follow-up sequence** (A–F), **exit condition**, **cold branch**.

### 1) New Lead
On entry: instant auto-response (SMS+email <1 min), round-robin to a closer, AI Employee 2-way pre-qual, "Call within 5 min" task, missed-call text-back. → **Contacted** when they reply/answer. Cold: no contact → **Sequence B (No Answer, 7d)** → Day 7 breakup → tag `nurture-60` → Dead/Lost.

### 2) Contacted
On entry: log conversation, book qualification call. Continue **Sequence B** if calls unanswered. → **Qualifying** when a real conversation starts.

### 3) Qualifying
On entry: capture BANT-F into custom fields; auto-disqualify below thresholds (<6 mo TIB or <$15k/mo). "Not right now" → **Sequence C (Soft No, 90d → quarterly)**. → **Application Sent** when qualified.

### 4) Application Sent
On entry: send the application form/funnel link + the **compliance disclosure** step (state+product disclosure, capture `Disclosure Acknowledged`); reminders Day 0, +4h, Day 1. → **Docs Collected** when the app is submitted.

### 5) Docs Collected ⭐ #1 funnel leak
On entry: **Sequence A (Stips/Docs, 14d — HIGHEST PRIORITY)** — Day0 SMS w/ upload + bank-connect (Plaid) link + photo/email alts; +2h SMS; Day1 call+SMS; Day2 three-methods SMS; Day4 call+VM+SMS; Day7 urgency; Day10 email; Day14 breakup. Set `Plaid Connected` on bank link. → **Submitted to Funder** when stips complete. Cold: Day14 breakup → `nurture-30`.

### 6) Submitted to Funder  ← the funder EMAIL SUBMISSION automations live here
On entry: our app packages the deal + writes `deal_submissions`; GHL fires **one email-submission workflow per chosen funder** (3–5 in parallel). See **"Per-funder email submission workflows"** below. → **Offer Received** when a funder responds. Cold: all decline → **Sequence D** / resubmit.

### 7) Offer Received
On entry: assemble best offers (factor, term, amount, daily/weekly payment) for side-by-side comparison (our app). → **Offer Presented** when shown to merchant.

### 8) Offer Presented
On entry: send branded offer link, present **2+ options**, "follow up on offer" task. Declined → **Sequence D (Offer Declined, 45d)**. → **Funded** when accepted + deposited.

### 9) Funded
On entry: **Sequence E (Funded → Renewal)** — Day1 congrats + Google review + referral ask ($100 gift card); our app calcs commission. → **Renewal Eligible** at first paydown milestone.

### 10) Renewal Eligible
Paydown triggers (driven by our app's `Paydown %` push): **40%** "may qualify for additional capital"; **60%** call+SMS renewal offer; **75%** "best time to renew"; **100%** direct call. Exit: new application re-enters at **Application Sent**.

**Cross-pipeline — Sequence F (Mass Reactivation):** standalone monthly blast to `dead`/`nurture` tags, 3 rotating templates → re-enters at **New Lead**.

---

## Per-funder email submission workflows (fire at Stage 6 "Submitted to Funder")

Build **one GHL workflow per active funder**, each with its own recipient/CC/routing baked in. Submit to **3–5 in parallel**, never one. **All email for now.**

### Active MCA funders (status `live_vendor`) — where the package goes
| # | Funder | Send package to | CC / routing | Notes |
|---|--------|-----------------|--------------|-------|
| 1 | **GoKapital** | `deals@gokapital.com` (☎ 305-749-5299) | — | mca / revenue-based, c-paper |
| 2 | **Reliant Funding** | `submissions@reliantfunding.com` | **High-risk (BK/defaults) → instead send to The LCF Group `submissions@thelcfgroup.com`, CC `kmaimaron@thelcfgroup.com` + `prm@thelcfgroup.com`** | mca, c-paper |
| 3 | **United Capital Source** | `isosubmissions@unitedcapitalsource.com` | — | **Subject = exact legal/DBA name.** 4 mo statements (PDF) + app. $25k+/mo, 12+ mo, ~575+ credit |
| 4 | **Funderial** | `michael@funderial.com` | — | mca / line-of-credit |
| 5 | **Guidant Financial** | `jordan.stefnik@guidantfinancial.com` (portal also `app.guidantfinancial.com/partner/center`) | — | startup financing (ROBS/SBA) |

> ⏳ Not live yet (`application_submitted`) — add a workflow each when they flip to `live_vendor`: **Greenbox Capital, Kapitus Partners, Lionsford ISO Program, Mantis Funding.**

### The flow each funder workflow runs
1. **Send package (email)** — trigger: `deal_submissions` row created for this funder / opportunity tagged `submit:<funder>`. Email to the funder (+CC), subject `Deal Submission — {{business_name}} — {{amount_requested}}`, attach **signed app + 3 mo bank statements (+ stips)**; stamp `submitted_at`.
2. **Confirm + SLA** — ~4 business hrs: check bounce/auto-reply; alert ops on bounce.
3. **Day 1 no decision** — follow-up email + task to call the underwriter.
4. **Day 2** — call/SMS underwriter task again.
5. **On response:** Approved/Offer → move to **Offer Received** + capture terms + notify closer · Stips → send docs, reset timer · Declined → log reason; if all declined → **Sequence D** + resubmit next funder.
6. **Day 4–5 no response** → escalate (manager call), mark submission `stale`.

**Division of labor:** 🟣 GHL sends emails + timers + per-funder routing · 🔵 our app assembles the package + writes `deal_submissions` (Phase 4 multi-funder UI kicks it off).

---

## Pipeline 1 — Workflow ↔ stage trigger map
| GHL Workflow | Trigger | Notes |
|---|---|---|
| Speed-to-Lead | stage → `New Lead` | SMS+email+call task, round-robin |
| No-Answer (Seq B) | `Contacted` + no reply 2h | 7-day, breakup |
| Soft-No (Seq C) | tag `soft-no` | 90d → quarterly |
| Application + Disclosure | stage → `Application Sent` | form link + disclosure + ack |
| Stips/Docs (Seq A) | stage → `Docs Collected` | 14-day, highest priority |
| **Submit: GoKapital** | stage → `Submitted to Funder` (tag `submit:gokapital`) | email `deals@gokapital.com` |
| **Submit: Reliant** | `Submitted to Funder` (tag `submit:reliant`) | + high-risk → LCF Group |
| **Submit: United Capital Source** | `Submitted to Funder` (tag `submit:ucs`) | subject=legal name, 4mo stmts |
| **Submit: Funderial** | `Submitted to Funder` (tag `submit:funderial`) | email Michael |
| **Submit: Guidant** | `Submitted to Funder` (tag `submit:guidant`) | email/portal |
| Offer Follow-up / Declined (Seq D) | stage → `Offer Presented` + tag `offer-declined` | 45-day |
| Funded → Renewal (Seq E) | stage → `Funded` | review + referral |
| Renewal Triggers | `Paydown %` = 40/60/75/100 | from our app |
| Mass Reactivation (Seq F) | monthly on `dead` tag | rotate 3 templates |

---

# PIPELINE 2 — MFunding VCF Pipeline: stage automations (🟡 draft — confirm)

VCF = MCA **debt relief**. Tone is **relief, not sales**. Submission contact: `partnerprogram@valuecapitalfunding.com` (Ferne Kornfeld). Lead sources: UCC filings w/ multiple positions, distressed-merchant lists, inbound "drowning in MCAs."

1. **New Lead (Distressed)** — empathetic intro; do NOT cross-sell a new MCA.
2. **Hardship Consultation** — capture position count, total balances, daily/weekly debits, urgency.
3. **Positions & Balances Analysis** — collect **all current MCA agreements + bank statements showing debits**; tally exposure (VCF's "Docs Collected").
4. **Strategy / Proposal** — consolidate vs refinance vs renegotiate; present relief plan.
5. **Agreement Sent** — e-sign the VCF engagement agreement.
6. **Submitted to VCF** — email package to `partnerprogram@valuecapitalfunding.com` (same send → SLA → follow-up → branch flow as Pipeline 1).
7. **Restructure Executed** — positions paid off/settled; single new arrangement in place.
8. **Servicing / Monitoring** — keep merchant on track; later referral/renewal.

**Compliance:** no savings/approval guarantees; separate disclosures; still "purchase of future receivables," never "loan." Confirm state debt-settlement rules.

---

## ✅ How to build it
**Path A — GHL UI:** Opportunities → Pipelines → create **both** pipelines with the exact stages → Automations → build each workflow.
**Path B — GHL Workflow AI:** paste the prompt below.

---

## 🤖 GHL AI BUILDER PROMPT (paste into GHL's Workflow AI)

```
You are configuring my GoHighLevel sub-account "MFunding.net" (a business-funding
brokerage / ISO), location t7NmVR4WCy927j4Zon4b. Build the following exactly.

COMPLIANCE
- We broker business funding (MCA, term loan, SBA, LOC, equipment) AND run a debt-relief
  line (VCF). MCAs are NOT loans — never use "loan" in MCA-specific copy; use "funding,
  capital, advance, working capital." No upfront fees. "No credit impact" until funder
  submission. VCF/debt-relief copy: no guarantees of savings or approval.

STEP 1 — CUSTOM FIELDS (Contact)
Monthly Revenue (number), Time in Business Months (number), Industry (text), Lead Source
(dropdown), Target Market (dropdown), Funding Amount Requested (number), Product Type
(dropdown: MCA, Term Loan, SBA, LOC, Equipment, VCF), Paydown % (number), State (text),
Plaid Connected (checkbox), Disclosure Acknowledged (checkbox), Active MCA Positions
(number), Total Daily/Weekly Debits (number).

STEP 2 — BUILD TWO PIPELINES
Pipeline A, named EXACTLY "MFunding MCA Pipeline", stages in order, named EXACTLY:
  New Lead, Contacted, Qualifying, Application Sent, Docs Collected, Submitted to Funder,
  Offer Received, Offer Presented, Funded, Renewal Eligible
Pipeline B, named "MFunding VCF Pipeline", stages in order:
  New Lead (Distressed), Hardship Consultation, Positions & Balances Analysis,
  Strategy / Proposal, Agreement Sent, Submitted to VCF, Restructure Executed,
  Servicing / Monitoring

STEP 3 — MCA PIPELINE WORKFLOWS (trigger = Opportunity Stage Changed to the named stage)
A) Speed-to-Lead — New Lead: SMS <1 min ("Thanks for reaching out to MFunding — a funding
   specialist will call you shortly. Reply STOP to opt out."), intro email, round-robin
   assign, task "Call within 5 minutes", missed-call text-back.
B) No-Answer Nurture — Contacted + no reply 2h: 7-day (Day0 SMS, +2h call task, Day1 SMS+email,
   Day2 call, Day4 SMS, Day7 breakup); on no response tag "dead" + "nurture-60".
C) Soft-No Nurture — tag "soft-no": 90-day (Day30 check-in, Day45 value email, Day60 "new
   programs" SMS, Day75 case study, Day90 final) then quarterly.
D) Application + Disclosure — Application Sent: send app/funnel link (SMS+email) + the state/
   product disclosure; set Disclosure Acknowledged on sign; reminders +4h, Day1.
E) Stips & Docs (HIGHEST PRIORITY) — Docs Collected: 14-day — Day0 SMS w/ secure upload + bank
   (Plaid) link + photo/email alts; +2h SMS; Day1 call+SMS; Day2 three-methods SMS; Day4
   call+VM+SMS; Day7 urgency; Day10 email; Day14 breakup. Set Plaid Connected on bank link.
F) Offer Follow-up / Declined — Offer Presented: follow-up task; if tag "offer-declined",
   45-day rework (Day0 objection call, Day1-3 new options, Day7 one more, Day14 breakup, Day45).
G) Funded → Renewal — Funded: Day1 congrats SMS+email, Google review request, referral ask
   ($100 gift card). Arm renewal reminders.
H) Renewal Triggers — when Paydown % changes: 40 "may qualify for additional capital"; 60 call
   + renewal-offer SMS; 75 "best time to renew"; 100 direct-call task.
I) Mass Reactivation — monthly schedule, audience tagged "dead"/"nurture-*", rotate 3 templates.

STEP 4 — PER-FUNDER EMAIL SUBMISSION WORKFLOWS (all trigger on stage = Submitted to Funder,
filtered by a per-funder tag; build ONE per funder; submit to 3-5 in parallel). Each: email the
deal package (attach signed application + 3 months bank statements + stips), subject
"Deal Submission — {{contact.business_name}} — {{Funding Amount Requested}}"; then ~4h bounce
check, Day1 follow-up + call-underwriter task, Day2 call again; on Approved move to Offer
Received + notify; on Declined log reason. Recipients:
  - Submit: GoKapital — tag submit:gokapital — to deals@gokapital.com
  - Submit: Reliant — tag submit:reliant — to submissions@reliantfunding.com; IF high-risk
    (bankruptcy/default) tag, instead send to submissions@thelcfgroup.com, CC
    kmaimaron@thelcfgroup.com and prm@thelcfgroup.com
  - Submit: United Capital Source — tag submit:ucs — to isosubmissions@unitedcapitalsource.com;
    email SUBJECT must be the merchant's exact legal/DBA business name; attach 4 months statements
  - Submit: Funderial — tag submit:funderial — to michael@funderial.com
  - Submit: Guidant — tag submit:guidant — to jordan.stefnik@guidantfinancial.com

STEP 5 — VCF PIPELINE WORKFLOWS (relief tone, no guarantees)
  - Distressed Intake — New Lead (Distressed): empathetic SMS+email, book hardship consult.
  - Positions Request — Positions & Balances Analysis: request all current MCA agreements + bank
    statements showing debits; reminders.
  - Submit to VCF — Submitted to VCF: email package to partnerprogram@valuecapitalfunding.com,
    same send → SLA → follow-up → branch flow as Step 4.

All SMS include an opt-out line; respect TCPA/quiet hours. Keep MCA copy free of "loan."
Confirm each pipeline and workflow is created and list their IDs.
```

---

## After GHL builds it
1. Open a Deal → **Sync to GHL** (or call `ghl-sync` `{"action":"pipelines"}`) to confirm the MCA pipeline + stage IDs. Our sync targets the **MCA** pipeline by matching its stage names.
2. Register the inbound webhook (`/functions/v1/ghl-webhook?secret=…`) for Opportunity + Contact events.
3. Our app already pushes `Paydown %` on deal sync → drives the Renewal Triggers workflow.
