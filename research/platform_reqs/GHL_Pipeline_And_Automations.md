# MFunding — GHL Pipelines & Automations (Build Spec)
### Last updated: June 26, 2026

> GHL's API can't create pipelines/stages — build them in the **GHL UI** or with **GHL's Workflow AI** (paste prompt at the bottom). This is the exact spec: both pipelines, their stages, the automation on each stage, and the **per-funder email submission** workflows.

---

# The two pipelines

You build **two** pipelines in GHL. A deal lives in exactly one, by product line.

### `MFunding MCA Pipeline` — standard business funding (MCA, term, SBA, LOC, equipment) — 12 stages
| # | Stage (exact name) | Deal status |
|---|---|---|
| 1 | New Lead | `new` |
| 2 | Contacted | `contacted` |
| 3 | Qualifying | `qualifying` |
| 4 | Application Sent | `application_sent` |
| 5 | Docs Collected | `docs_collected` |
| 6 | Bank Statements | `bank_statements` |
| 7 | Submitted to Funders | `submitted_to_funder` |
| 8 | Offer Received | `offer_received` |
| 9 | Offer Presented | `offer_presented` |
| 10 | Offer Accepted | `offer_accepted` |
| 11 | Funded | `funded` |
| 12 | Renewal Eligible | `renewal_eligible` |

**Off-pipeline outcomes (mark the opportunity Lost, don't make them forward stages):** `declined` (no fundable offer, or merchant passed), `dead` (unresponsive/lost).

> ⚠️ The MCA stage names must be **exact** — our `ghl-sync` maps a deal's status to the GHL stage by name. Wrong names → opportunities land in stage 1.

### `MFunding VCF Pipeline` — debt relief (consolidate/refinance stacked MCAs) — 8 stages
| # | Stage (exact name) |
|---|---|
| 1 | New Lead (Distressed) |
| 2 | Hardship Consultation |
| 3 | Positions & Balances Analysis |
| 4 | Strategy / Proposal |
| 5 | Agreement Sent |
| 6 | Submitted to VCF |
| 7 | Restructure Executed |
| 8 | Servicing / Monitoring |

> VCF stages are a recommended draft — confirm them (and qualification thresholds + commission) before building. VCF auto-sync from our app is a later phase.
> **MCA ≠ loan** in all MCA copy ("funding / capital / advance / working capital"). **No upfront fees. No credit impact** until funder submission.

---

# How the funder submission actually works (stages 7–11 of the MCA Pipeline)

This is the part that branches, so read it carefully:

- **Submitted to Funders (stage 7):** we send the package to **multiple funders in parallel** (one email workflow per funder), never just one.
- Each funder responds **independently**, tracked on its own `deal_submissions` row — NOT as a deal stage:
  - a funder **makes an offer** → that submission = `offer_made`
  - a funder **declines** → that submission = `declined`
- **Offer Received (stage 8):** the deal advances here as soon as **at least one** funder makes an offer. (Multiple offers can arrive; we collect them all.)
  - If **every** funder declines → the deal goes to the **Declined** outcome.
- **Offer Presented (stage 9):** we present the best offer(s) to the merchant.
- The **merchant decides**:
  - **accepts** → **Offer Accepted (stage 10)** → **Funded (stage 11)**
  - **declines** → rework via **Sequence D** (resubmit to other funders) or → **Declined** outcome.
- **Funded → Renewal Eligible (stage 12)** as paydown progresses.

So: *funder* accept/decline = per-submission (many per deal); *merchant* accept/decline = the deal-level Offer Accepted stage vs the Declined outcome.

---

# Branches, loops & recovery paths — every outcome (so nothing dead-ends silently)

A deal at any stage has three kinds of outcome: **forward** (happy path), **stall** (no response → a nurture sequence), or **branch** (a specific negative that routes somewhere). No path is allowed to silently dead-end — every loss is tagged with a `lost_reason` and dropped into reactivation.

| Stage | Forward | Stall (no response) | Branch (negative) → where it goes |
|---|---|---|---|
| New Lead | → Contacted | Sequence B (7d) | bad number/lead → `no_contact`, request vendor replacement (live transfer) |
| Contacted | → Qualifying | Sequence B | not interested → Sequence C (soft-no) or `dead` |
| Qualifying | → Application Sent | Sequence C | disqualified → `disqualified` **OR if over-stacked/distressed → route to VCF**; "not now" → Sequence C |
| Application Sent | → Docs Collected | reminders → breakup | abandons app → `docs_not_provided` → nurture |
| Docs Collected | → Bank Statements | reminders | won't provide stips → `docs_not_provided` |
| Bank Statements | → Submitted to Funders | Sequence A (14d) → breakup | won't connect → `docs_not_provided`; **fails internal pre-qual** (NSFs/ADB/positions) → decline `bank_data_fail` **OR route to VCF if over-leveraged** |
| Submitted to Funders | → Offer Received (≥1 offer) | escalate → call underwriters | **ALL decline → see Loop A below** |
| Offer Received | → Offer Presented | — | only bad terms → negotiate / resubmit |
| Offer Presented | → Offer Accepted | Sequence D | **merchant declines → see Loop B below** |
| Offer Accepted | → Funded | contract reminders | funder rescinds / contract unsigned / final-UW decline → `funding_fell_through` → **back to Submitted to Funders** or Declined |
| Funded | → Renewal Eligible | — | early default → no renewal; commission **clawback** |
| Renewal Eligible | → new deal at Application Sent | quarterly check-in | doesn't renew → stay in nurture |

### 🔁 Loop A — all funders decline / no offer
1. **Auto-resubmit** to the next funder tier (B/C/D paper, specialty funders) → opportunity moves **back to Submitted to Funders** with a wider funder set + tag `resubmit:tier2`.
2. Still no offer **and merchant is stacked/distressed** → **route to the VCF pipeline** (debt relief), set `lost_reason = routed_to_vcf`, create a VCF opportunity, notify the VCF team.
3. Otherwise → **Declined** (`funders_declined_all`) → "we're exploring alternatives" SMS → **30/60-day nurture** → auto-resubmit when the profile improves (more revenue, fewer positions, time passes).

### 🔁 Loop B — merchant declines the offer
1. **Sequence D Day 0:** call to pinpoint the objection (cost / term / amount / payment / timing).
2. Fixable by a different funder → **back to Submitted to Funders** (resubmit for better terms) → new Offer Received → Offer Presented.
3. Wants smaller/different → present an **alternative offer** (stay in Offer Presented).
4. "Not now" → **Sequence C** (soft-no, 90d).
5. Ghosts → Sequence D 45-day re-engage → **Declined** (`merchant_declined`) → reactivation.

### Cross-product routing → VCF
A merchant is a VCF candidate (not an MCA candidate) whenever they're **over-leveraged with multiple active MCAs**. Detect + route at three points: **Qualifying** (they tell us), **Bank Statements** (we see 2+ MCA debits), or **all-funders-decline** (nobody will stack them further). Routing = create a VCF-pipeline opportunity + tag, set `Product Type = VCF`.

### Terminal states — recoverable vs truly dead (some deals just die)
Not everything loops forever. Two kinds of ending, each stamped with a `lost_reason`:

**Recoverable loss (`declined`)** — circumstances can change, so these DO feed **Sequence F (monthly reactivation)** and can re-enter at **New Lead**. Reasons: `funders_declined_all`, `merchant_declined`, `docs_not_provided`, `bank_data_fail`, `offer_expired`, `funding_fell_through`, `no_contact`.

**Truly dead (`dead`) — exits the funnel, NOT reactivated:**
- `opted_out` — merchant texted **STOP** / revoked consent → set `customers.do_not_contact = true`, remove from EVERY sequence, suppress from all blasts. **TCPA: never message again** unless they re-opt-in.
- `prohibited_industry` — cannabis / adult / firearms / fraud / defunct business → hard disqualify, never market to.
- **Repeated non-engagement** — after ~2–3 reactivation cycles with zero response, archive the contact so we stop burning sends (and SMS cost) on a corpse.

`do_not_contact` is a **hard gate**: Sequence F and every workflow must check it first and skip suppressed contacts. This isn't optional — it's the legal line.

`lost_reason` codes: `no_contact`, `disqualified`, `docs_not_provided`, `bank_data_fail`, `funders_declined_all`, `merchant_declined`, `offer_expired`, `funding_fell_through`, `routed_to_vcf`, `opted_out`, `prohibited_industry`, `duplicate`, `other`.

---

# Custom fields to create first (Contact level)
`Monthly Revenue` (number), `Time in Business Months` (number), `Industry` (text), `Lead Source` (dropdown), `Target Market` (dropdown), `Funding Amount Requested` (number), `Product Type` (dropdown: MCA / Term Loan / SBA / LOC / Equipment / VCF), `Paydown %` (number), `State` (text), `Plaid Connected` (checkbox), `Disclosure Acknowledged` (checkbox), `Active MCA Positions` (number — VCF), `Total Daily/Weekly Debits` (number — VCF).

---

# MCA Pipeline — stage automations

### 1) New Lead
Instant auto-response (SMS+email <1 min), round-robin to a closer, AI Employee 2-way pre-qual, "Call within 5 min" task, missed-call text-back. → **Contacted** on reply. No contact → **Sequence B (No Answer, 7d)** → breakup → `nurture-60` → Dead.

### 2) Contacted
Log conversation, book qualification call. Continue Sequence B if unanswered. → **Qualifying** when a real conversation starts.

### 3) Qualifying
Capture BANT-F into custom fields; auto-disqualify below thresholds (<6 mo TIB / <$15k/mo). "Not right now" → **Sequence C (Soft No, 90d)**. → **Application Sent** when qualified.

### 4) Application Sent
Send application form/funnel link + the **compliance disclosure** step (state+product disclosure, capture `Disclosure Acknowledged`); reminders Day 0, +4h, Day 1. → **Docs Collected** when submitted.

### 5) Docs Collected
Collect the **non-bank stips** — signed application, owner ID, voided check, credit authorization. Reminders for missing items. → **Bank Statements** once the non-bank stips are in.

### 6) Bank Statements ⭐ #1 funnel leak
Dedicated bank-verification stage. Fire **Sequence A (Bank Statements, 14d — HIGHEST PRIORITY)**: Day0 SMS w/ secure upload + (if enabled) Plaid link + photo/email alts; +2h SMS; Day1 call+SMS; Day2 three-methods SMS; Day4 call+VM+SMS; Day7 urgency; Day10 email; Day14 breakup. **Plaid optional** — manual upload is the default; set `Plaid Connected` only if a bank links. → **Submitted to Funders** when 3 recent statements (or Plaid data) are in.

### 7) Submitted to Funders ← per-funder email submission workflows fire here
Our app packages the deal + writes one `deal_submissions` row per chosen funder; GHL fires **one email-submission workflow per funder, in parallel** (see the funder table below). → **Offer Received** when ≥1 funder offers; if all decline → **Declined**.

### 8) Offer Received
Collect every funder offer (factor, term, amount, daily/weekly payment) for side-by-side comparison (our app). → **Offer Presented** when shown to the merchant.

### 9) Offer Presented
Send branded offer link; present **the best 2+ options**; "follow up on offer" task.

### 10) Offer Accepted
Merchant accepted. Generate/collect the funder agreement; confirm funding details. → **Funded** when money is deposited. (Merchant **declines** instead → **Sequence D** rework or **Declined**.)

### 11) Funded
**Sequence E (Funded → Renewal)** — Day1 congrats + Google review + referral ask ($100 gift card); our app calculates commission. → **Renewal Eligible** at first paydown milestone.

### 12) Renewal Eligible
Paydown triggers (our app pushes `Paydown %`): **40%** "may qualify for more capital"; **60%** call+SMS renewal offer; **75%** "best time to renew"; **100%** direct call. New application re-enters at **Application Sent**.

**Standalone — Sequence F (Mass Reactivation):** monthly blast to `dead`/`nurture` tags, 3 rotating templates → re-enters at **New Lead**.

---

# Per-funder email submission workflows (fire at "Submitted to Funders")

One GHL workflow per active funder, recipient/CC/routing baked in. Submit to **3–5 in parallel**. **All email for now.**

### Active MCA funders (status `live_vendor` in the DB)
| # | Funder | Send package to | CC / routing | Notes |
|---|--------|-----------------|--------------|-------|
| 1 | **Corfin Group** | `underwriting@corfingroup.com` | — | mca |
| 2 | **GoKapital** | `deals@gokapital.com` (☎ 305-749-5299) | — | mca / revenue-based, c-paper |
| 3 | **Reliant Funding** | `submissions@reliantfunding.com` | **High-risk (BK/defaults) → instead `submissions@thelcfgroup.com`, CC `kmaimaron@thelcfgroup.com` + `prm@thelcfgroup.com`** | mca, c-paper |
| 4 | **United Capital Source** | `isosubmissions@unitedcapitalsource.com` | — | **Subject = exact legal/DBA name.** 4 mo statements (PDF) + app. $25k+/mo, 12+ mo, ~575+ credit |
| 5 | **Funderial** | `michael@funderial.com` | — | mca / line-of-credit |
| 6 | **Guidant Financial** | `jordan.stefnik@guidantfinancial.com` (portal also `app.guidantfinancial.com/partner/center`) | — | startup financing (ROBS/SBA) |

> **Value Capital Funding (VCF)** is a `live_vendor` too but is the **debt-relief product line**, not an MCA funder — it uses the VCF Pipeline, `partnerprogram@valuecapitalfunding.com` (Ferne Kornfeld).
> ⏳ Not live yet (`application_submitted`) — add a workflow each when approved: **Greenbox Capital, Kapitus Partners, Lionsford ISO Program, Mantis Funding.**

### The flow each funder workflow runs
1. **Send package (email)** — trigger: `deal_submissions` row created for this funder / opportunity tagged `submit:<funder>`. Email the funder (+CC), subject `Deal Submission — {{business_name}} — {{amount_requested}}`, attach **signed app + 3 mo bank statements (+ stips)**; stamp `submitted_at`.
2. **Confirm + SLA** — ~4 business hrs: bounce/auto-reply check; alert ops on bounce.
3. **Day 1 no decision** — follow-up email + task to call the underwriter.
4. **Day 2** — call/SMS the underwriter again.
5. **On response (per funder):** **offer** → set that submission `offer_made`, move the deal to **Offer Received** (if not already), notify closer · **decline** → set submission `declined`; if **all** submissions declined → move deal to **Declined** + fire **Sequence D**.
6. **Day 4–5 no response** → escalate (manager call), mark submission `stale`.

**Division of labor:** 🟣 GHL sends emails + timers + per-funder routing · 🔵 our app assembles the package + writes `deal_submissions` (the Phase 4 multi-funder UI kicks it off).

---

# MCA Pipeline — workflow ↔ stage trigger map
| GHL Workflow | Trigger | Notes |
|---|---|---|
| Speed-to-Lead | stage → New Lead | SMS+email+call task, round-robin |
| No-Answer (Seq B) | Contacted + no reply 2h | 7-day, breakup |
| Soft-No (Seq C) | tag `soft-no` | 90d → quarterly |
| Application + Disclosure | stage → Application Sent | form link + disclosure + ack |
| Docs Collection | stage → Docs Collected | app, ID, voided check, cred auth |
| Bank Statements (Seq A) | stage → Bank Statements | 14-day, highest priority, Plaid optional |
| Submit: Corfin | Submitted to Funders + tag `submit:corfin` | email `underwriting@corfingroup.com` |
| Submit: GoKapital | Submitted to Funders + tag `submit:gokapital` | email `deals@gokapital.com` |
| Submit: Reliant | Submitted to Funders + tag `submit:reliant` | + high-risk → The LCF Group |
| Submit: United Capital Source | Submitted to Funders + tag `submit:ucs` | subject=legal name, 4mo stmts |
| Submit: Funderial | Submitted to Funders + tag `submit:funderial` | email Michael |
| Submit: Guidant | Submitted to Funders + tag `submit:guidant` | email/portal |
| Offer Follow-up / Declined (Seq D) | stage → Offer Presented + tag `offer-declined` | 45-day rework |
| Funded → Renewal (Seq E) | stage → Funded | review + referral |
| Renewal Triggers | `Paydown %` = 40/60/75/100 | from our app |
| Mass Reactivation (Seq F) | monthly on `dead` tag | rotate 3 templates |

---

# VCF Pipeline — stage automations (🟡 draft — confirm)

Debt relief. Tone = **relief, not sales**. Submission: `partnerprogram@valuecapitalfunding.com` (Ferne Kornfeld). Leads: UCC filings w/ multiple positions, distressed-merchant lists, inbound "drowning in MCAs."

1. **New Lead (Distressed)** — empathetic intro; do NOT cross-sell a new MCA.
2. **Hardship Consultation** — capture position count, total balances, daily/weekly debits, urgency.
3. **Positions & Balances Analysis** — collect **all current MCA agreements + bank statements showing debits**; tally exposure.
4. **Strategy / Proposal** — consolidate vs refinance vs renegotiate; present the relief plan.
5. **Agreement Sent** — e-sign the VCF engagement agreement.
6. **Submitted to VCF** — email package to `partnerprogram@valuecapitalfunding.com` (same send → SLA → follow-up → branch flow as the MCA funders).
7. **Restructure Executed** — positions paid off/settled; single new arrangement in place.
8. **Servicing / Monitoring** — keep merchant on track; later referral/renewal.

**Compliance:** no savings/approval guarantees; separate disclosures; still "purchase of future receivables," never "loan."

---

# How to build it
**GHL UI:** Opportunities → Pipelines → create **both** pipelines with the exact stages → Automations → build each workflow.
**GHL Workflow AI:** paste the prompt below.

## 🤖 GHL AI builder prompt

```
You are configuring my GoHighLevel sub-account "MFunding.net", location t7NmVR4WCy927j4Zon4b.

COMPLIANCE: We broker business funding (MCA, term, SBA, LOC, equipment) AND run a debt-relief
line (VCF). MCAs are NOT loans — never use "loan" in MCA copy; use "funding/capital/advance/
working capital." No upfront fees. "No credit impact" until funder submission. VCF copy: no
guarantees of savings or approval.

STEP 1 — CUSTOM FIELDS (Contact): Monthly Revenue (number), Time in Business Months (number),
Industry (text), Lead Source (dropdown), Target Market (dropdown), Funding Amount Requested
(number), Product Type (dropdown: MCA, Term Loan, SBA, LOC, Equipment, VCF), Paydown % (number),
State (text), Plaid Connected (checkbox), Disclosure Acknowledged (checkbox), Active MCA
Positions (number), Total Daily/Weekly Debits (number).

STEP 2 — BUILD TWO PIPELINES
"MFunding MCA Pipeline", stages in order, named EXACTLY:
  New Lead, Contacted, Qualifying, Application Sent, Docs Collected, Bank Statements,
  Submitted to Funders, Offer Received, Offer Presented, Offer Accepted, Funded, Renewal Eligible
"MFunding VCF Pipeline", stages in order:
  New Lead (Distressed), Hardship Consultation, Positions & Balances Analysis,
  Strategy / Proposal, Agreement Sent, Submitted to VCF, Restructure Executed, Servicing / Monitoring

STEP 3 — MCA PIPELINE WORKFLOWS (trigger = Opportunity Stage Changed to the named stage)
A) Speed-to-Lead — New Lead: SMS <1 min ("Thanks for reaching out to MFunding — a funding
   specialist will call you shortly. Reply STOP to opt out."), intro email, round-robin assign,
   task "Call within 5 minutes", missed-call text-back.
B) No-Answer Nurture — Contacted + no reply 2h: 7-day (Day0 SMS, +2h call, Day1 SMS+email, Day2
   call, Day4 SMS, Day7 breakup); on no response tag "dead" + "nurture-60".
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
G) Funded → Renewal — Funded: Day1 congrats SMS+email, Google review request, referral ask
   ($100 gift card). Arm renewal reminders.
H) Renewal Triggers — when Paydown % changes: 40 "may qualify for additional capital"; 60 call
   + renewal-offer SMS; 75 "best time to renew"; 100 direct-call task.
I) Mass Reactivation — monthly, audience tagged "dead"/"nurture-*", rotate 3 templates. EXCLUDE
   any contact with Do Not Contact = true or DND on. After ~2-3 cycles with zero engagement,
   tag "archived" and stop sending.

STEP 4 — PER-FUNDER EMAIL SUBMISSION WORKFLOWS (all trigger on stage = Submitted to Funders,
filtered by a per-funder tag; ONE per funder; submit to 3-5 in parallel). Each emails the deal
package (attach signed application + 3 months bank statements + stips), subject "Deal Submission
— {{contact.business_name}} — {{Funding Amount Requested}}"; ~4h bounce check; Day1 follow-up +
call-underwriter task; Day2 call again; on offer move deal to Offer Received + notify; on decline
log it; if all funders decline move deal to Declined. Recipients:
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
  - All-Funders-Declined — trigger: tag "all-declined" (set when every funder submission is
    declined). Actions: resubmit to a tier-2/specialty funder set (move opportunity back to
    Submitted to Funders, tag resubmit:tier2); if still no offer and tag "stacked", route to the
    VCF pipeline; else move to Lost with reason "funders_declined_all" and start a 30/60-day
    "exploring alternatives" nurture that resubmits later.
  - Merchant-Declined (Sequence D) — trigger: tag "offer-declined". Day0 objection call task;
    resubmit to other funders for better terms; Day1-3 present alternatives; Day7 one more;
    Day14 breakup; Day45 re-engage. If "not now" add tag soft-no.
  - Route-to-VCF — trigger: tag "route-to-vcf" OR Product Type = VCF (set at Qualifying, Bank
    Statements when 2+ MCA positions, or after all-funders-declined). Create/move to the VCF
    pipeline at New Lead (Distressed) and notify the VCF team.
  - Funding-Fell-Through — trigger: tag "funding-failed" (funder rescinds / contract unsigned /
    final-UW decline). Move back to Submitted to Funders to resubmit, or to Lost reason
    "funding_fell_through".
  - Opt-Out / DNC (TCPA) — trigger: inbound message contains STOP/UNSUBSCRIBE/REMOVE, or DND set.
    Actions: set Do Not Contact = true, remove the contact from ALL workflows/sequences, move to
    Lost reason "opted_out", and NEVER message again unless they explicitly re-opt-in. This gate
    overrides every other workflow.

All SMS include an opt-out line; respect TCPA/quiet hours. Keep MCA copy free of "loan".
Confirm each pipeline and workflow is created and list their IDs.
```

---

# After GHL builds it
1. Open a Deal → **Sync to GHL** (or call `ghl-sync` `{"action":"pipelines"}`) to confirm the MCA pipeline + stage IDs. Our sync targets the **MCA Pipeline** by matching its stage names.
2. Register the inbound webhook (`/functions/v1/ghl-webhook?secret=…`) for Opportunity + Contact events.
3. Our app already pushes `Paydown %` on deal sync → drives the Renewal Triggers workflow.
