# MFunding — GHL Build Guide
### Pipelines, Stages & Automations · Last updated June 26, 2026

**How to use this:** do **Part 1 → 2 → 3** in GoHighLevel. That's all you need to build it. Everything below the line marked **REFERENCE** is detail you only need if you build the automations by hand instead of pasting the prompt.

**At a glance**
- **Pipeline 1: `MFunding MCA Pipeline`** — standard funding — **13 stages**
- **Pipeline 2: `MFunding VCF Pipeline`** — debt relief — **8 stages**
- **Won** and **Lost** are opportunity *statuses* (not stages). **Nurture / Re-engage** is a real stage.
- Compliance: MCA copy never says "loan" (use funding/capital/advance); no upfront fees; no credit impact until funder submission.

---

# ✅ BUILD STATUS — live checklist (updated June 27, 2026)

**Foundation**
- [x] `MFunding MCA Pipeline` — 13 stages (live)
- [x] `MFunding VCF Pipeline` — 8 stages (live)
- [x] Contact custom fields (created via API)
- [x] Form: **MCA Funding Application** (`Ow1imQrxjJN9yfDUiBG3`)
- [x] Form: **Live Transfer Intake**
- [x] Form: **Bank Statements & Documents Upload** (`vO16UFona1IkxuezRg0d`) — fields `mca_bank_statements` (max 6), `mca_stips_documents` (max 8). Share link: `https://link.vibereach.io/widget/form/vO16UFona1IkxuezRg0d`

**Lead intake → app wiring**
- [x] **MCA 00 — Web Form Intake** → New Lead (PUBLISHED) + **Webhook** to Supabase
- [x] **MCA 00B — Live Transfer Intake** → Qualifying (PUBLISHED) + **Webhook** to Supabase
- [x] **Gap A** — `ghl-webhook` edge function now CREATES deals (deployed, v8). Webhook URL: `.../functions/v1/ghl-webhook?secret=…`
- [ ] **TEST**: confirm a real form submission creates a *deal* (not just a customer); if not, add native Settings→Webhooks OpportunityCreate subscription

**Automations (PART 3)**
- [x] **MCA 01 — Speed to Lead** (New Lead) — PUBLISHED (email → round-robin assign → call task)
- [ ] **Opt-Out / DNC gate** — IN PROGRESS (build first; overrides all)
- [ ] **MCA 02 — No-Answer Nurture**
- [ ] **MCA 03 — Qualifying**
- [ ] **MCA 04 — Application + Disclosure**
- [ ] **MCA 05 — Docs Collected**
- [x] **MCA 06 — Bank Statements** — PUBLISHED (request w/ upload link → wait 2d → reminder → call task)
- [ ] **MCA 07 — Submitted to Funders** *(Gap B — see note)*
- [ ] **MCA 08 — Offer Received**
- [ ] **MCA 09 — Offer Presented**
- [ ] **MCA 10 — Offer Accepted** *(+ e-sign via GHL Documents)*
- [x] **MCA 11 — Funded** — PUBLISHED (congrats + review + $100 referral → call task)
- [ ] **MCA 12 — Renewal Eligible**
- [ ] **MCA 13 — Mass Reactivation**

**Cross-cutting (recommend as CODE, not GHL)**
- [ ] **Gap B — funder submission**: best as an app edge function that emails the *selected* funders' `submission_email` on "Submit" (mirrors the Gap A fix). A GHL workflow would blast all funders blindly.
- [ ] **VCF automations**: needs the VCF pipeline automations in GHL **and** a `vcf` deal_type + VCF statuses in the app DB/`ghl-sync` (MCA-only today).
- [ ] **E-sign**: GHL native Documents & Contracts (no DocuSign) — templates + send-for-signature in MCA 10 / VCF Agreement Sent.

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

**Each stage has its own automation that fires when a deal moves INTO that stage** (GHL trigger: *Pipeline Stage Changed*). Build them **one at a time**: GHL → Automation → Workflows → **+ New Workflow → Start with AI** → paste one prompt below → review → Publish. Then do the next.

**Channel — EMAIL FIRST (SMS optional):** Build every message as an **Email**. The prompts below also show **SMS** copy, but **SMS is optional** — if you don't have SMS enabled, send the same content by Email and skip the SMS step (and its "Reply STOP" line; the email unsubscribe footer covers opt-out). When you paste a prompt, tell the AI: *"Use Email as the primary channel for every message; only add an SMS version if SMS is enabled."* The cadence/timing stays the same either way.

**Compliance (every message):** never use the word "loan" for MCA (use funding/capital/advance); lead with no upfront fees / no credit impact; honor unsubscribe + DND. If SMS is used, it ends with "Reply STOP to opt out" and respects quiet hours (8a–9p) / TCPA. Use merge fields like `{{contact.first_name}}` and `{{contact.company_name}}`.

---

### 🟦 Automation 1 — New Lead (Speed-to-Lead)
```
Build a GHL workflow named "MCA 01 - Speed to Lead".
TRIGGER: Pipeline Stage Changed -> MFunding MCA Pipeline -> stage "New Lead".
ACTIONS in order:
1. (Immediately) Send SMS: "Hi {{contact.first_name}}, it's MFunding — thanks for your interest in working capital for {{contact.company_name}}! A funding specialist will call you in the next few minutes. About how much capital do you need? Reply STOP to opt out."
2. Send Email — subject "Your MFunding funding request — what happens next", body: thank them, set expectations (a specialist calls shortly), and the 3 reasons to choose us: no upfront fees, no credit impact to check options, funding typically in 24–48 hours.
3. Assign the opportunity to a user via round-robin (the closer pool).
4. Create Task for the assigned user: "Call {{contact.first_name}} within 5 minutes — NEW LEAD" due in 5 minutes.
5. Enable missed-call text-back on the assigned number.
6. Wait 2 hours. IF the contact has NOT replied and no call is logged: add tag "no-answer" (this hands off to Automation 2).
ADVANCE: when the contact replies by SMS or an inbound/answered call is logged, move the opportunity to stage "Contacted".
```

### 🟦 Automation 2 — No-Answer Nurture (7-day)
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
2. When the form is submitted, map answers to custom fields: Monthly Revenue, Time in Business Months, Funding Amount Requested, Industry, Active MCA Positions.
3. IF Time in Business < 6 months OR Monthly Revenue < $15,000 OR Industry is prohibited (cannabis, adult, firearms): add tag "disqualified", notify the closer, and STOP (move to Nurture / Re-engage unless hard-prohibited, then mark Lost reason prohibited_industry).
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
TRIGGER: Pipeline Stage Changed -> stage "Bank Statements".
GOAL (this is the #1 funnel leak): get the 3 most recent business bank statements (or a bank connection). Plaid is OPTIONAL — manual upload is the default path.
ACTIONS (14-day cadence; stop the moment statements arrive):
Day 0: SMS "{{contact.first_name}}, last step to get you funded — your 3 most recent business bank statements. Fastest: connect your bank in 60 seconds [bank-connect link, if Plaid enabled]. Or snap photos / email to docs@mfunding.com. STOP to opt out." If Plaid is disabled, omit the connect link and lead with upload.
Day 0 + 2h: SMS reminder with the upload link again.
Day 1 (9am): Call task "Bank statements — {{contact.first_name}}" + SMS "Morning {{contact.first_name}}! I have a funder reviewing files today — just need your bank statements. 60-sec link: [link]."
Day 2: SMS "3 easy ways to send your statements: connect bank, text photos, or email docs@mfunding.com. Which is easiest?"
Day 4: Call task + voicemail drop + SMS "Left you a quick voicemail — still optimistic about your options, just need those statements."
Day 7: SMS "{{contact.first_name}}, heads up — pre-approvals expire after 7–10 days. Send your statements this week and I'll lock in your offers."
Day 10: Email (different channel) restating all 3 methods.
Day 14: Breakup SMS "Hi {{contact.first_name}}, closing your file for now — no hard feelings. It's saved; text me anytime when ready. STOP to opt out."
WHEN a bank is connected (Plaid): set custom field "Plaid Connected" = true.
ADVANCE: when statements (or Plaid data) are received, move opportunity to "Submitted to Funders".
END: Day 14 no statements -> move to Nurture / Re-engage, tag "nurture", lost_reason docs_not_provided.
```

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
TRIGGER: Pipeline Stage Changed -> stage "Funded".
ACTIONS:
1. Set the opportunity STATUS = Won.
2. Day 1: SMS "Congrats {{contact.first_name}} — your capital is on the way! 🎉 Two quick favors: (1) a 30-sec Google review means the world: [review link]. (2) Refer another business owner and earn a $100 gift card per funded referral — just have them mention your name." + congrats email.
3. Day 7: SMS "How's the funding working out, {{contact.first_name}}? Know anyone who could use capital? $100 gift card per funded referral."
4. Arm the renewal reminders (Automation 12) based on Paydown %.
ADVANCE: when paydown reaches the first milestone, move opportunity to "Renewal Eligible".
```

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
Build a GHL workflow named "RX - Opt Out / DNC".
TRIGGER: Inbound message contains STOP, UNSUBSCRIBE, REMOVE, or QUIT (and GHL DND set).
ACTIONS:
1. Set custom field/contact "Do Not Contact" = true and turn on DND for all channels.
2. Remove the contact from EVERY workflow/sequence.
3. Mark the opportunity status = Lost, reason "opted_out".
4. Never message again unless they explicitly re-opt-in.
This gate overrides every other automation.
```

---

### Appendix — build EVERYTHING in one prompt (optional)
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
