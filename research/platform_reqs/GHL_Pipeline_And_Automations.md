# MFunding — GHL Build Guide
### Pipelines, Stages & Automations · Last updated June 26, 2026

**How to use this:** do **Part 1 → 2 → 3** in GoHighLevel. That's all you need to build it. Everything below the line marked **REFERENCE** is detail you only need if you build the automations by hand instead of pasting the prompt.

**At a glance**
- **Pipeline 1: `MFunding MCA Pipeline`** — standard funding — **13 stages**
- **Pipeline 2: `MFunding VCF Pipeline`** — debt relief — **8 stages**
- **Won** and **Lost** are opportunity *statuses* (not stages). **Nurture / Re-engage** is a real stage.
- Compliance: MCA copy never says "loan" (use funding/capital/advance); no upfront fees; no credit impact until funder submission.

---

# PART 1 — Create the two pipelines

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

---

# PART 2 — Create the custom fields

In GHL: **Settings → Custom Fields → Add Field** (Contact). Create these:

| Field | Type |
|---|---|
| Monthly Revenue | Number |
| Time in Business Months | Number |
| Industry | Text |
| Lead Source | Dropdown |
| Target Market | Dropdown |
| Funding Amount Requested | Number |
| Product Type | Dropdown (MCA, Term Loan, SBA, LOC, Equipment, VCF) |
| Paydown % | Number |
| State | Text |
| Plaid Connected | Checkbox |
| Disclosure Acknowledged | Checkbox |
| Active MCA Positions | Number (VCF) |
| Total Daily/Weekly Debits | Number (VCF) |

---

# PART 3 — Build the automations

**Fastest way:** open **GHL → Automation → Workflows → Create with AI** (Workflow AI assistant) and paste the prompt below. It builds the custom fields, both pipelines, and every workflow in one shot.

> If your GHL plan doesn't have Workflow AI, build each workflow by hand using the **REFERENCE** section below — every workflow, trigger, and message is spelled out there.

### 🤖 Paste this into GHL Workflow AI

```
You are configuring my GoHighLevel sub-account "MFunding.net", location t7NmVR4WCy927j4Zon4b.

COMPLIANCE: We broker business funding (MCA, term, SBA, LOC, equipment) AND run a debt-relief
line (VCF). MCAs are NOT loans — never use "loan" in MCA copy; use "funding/capital/advance/
working capital." No upfront fees. "No credit impact" until funder submission. VCF copy: no
guarantees of savings or approval. Every SMS includes an opt-out line; respect TCPA/quiet hours.

STEP 1 — CUSTOM FIELDS (Contact): Monthly Revenue (number), Time in Business Months (number),
Industry (text), Lead Source (dropdown), Target Market (dropdown), Funding Amount Requested
(number), Product Type (dropdown: MCA, Term Loan, SBA, LOC, Equipment, VCF), Paydown % (number),
State (text), Plaid Connected (checkbox), Disclosure Acknowledged (checkbox), Active MCA
Positions (number), Total Daily/Weekly Debits (number).

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

| Funder | Send to | Routing / notes |
|---|---|---|
| **Corfin Group** | `underwriting@corfingroup.com` | mca |
| **GoKapital** | `deals@gokapital.com` (☎ 305-749-5299) | mca / revenue-based, c-paper |
| **Reliant Funding** | `submissions@reliantfunding.com` | **High-risk (BK/default) → instead `submissions@thelcfgroup.com`, CC `kmaimaron@thelcfgroup.com` + `prm@thelcfgroup.com`** |
| **United Capital Source** | `isosubmissions@unitedcapitalsource.com` | **Subject = exact legal/DBA name**; 4 mo statements (PDF) + app |
| **Funderial** | `michael@funderial.com` | mca / LOC |
| **Guidant Financial** | `jordan.stefnik@guidantfinancial.com` | startup (ROBS/SBA); portal `app.guidantfinancial.com/partner/center` |

**VCF** (separate product line, VCF Pipeline): `partnerprogram@valuecapitalfunding.com` (Ferne Kornfeld).
**Not live yet** (`application_submitted` — add when approved): Greenbox Capital, Kapitus Partners, Lionsford ISO Program, Mantis Funding.

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
3. Our app pushes `Paydown %` on deal sync → drives the Renewal Triggers workflow.
