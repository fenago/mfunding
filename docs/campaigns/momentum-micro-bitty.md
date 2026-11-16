# Momentum Micro — Instantly cold-email campaigns (DRAFT, for compliance review + owner approval)

Status as of 2026-11-16: both campaigns exist in Instantly as **Draft (status 0), 0 leads**, verified by GET.
**Revision 2 (2026-11-16):** compliance-review edits applied to both campaigns via PATCH; GET bodies and subjects match this doc byte-for-byte.
Nothing has been activated, no leads added, no test sends made.

| Campaign | Instantly ID | Status | Leads |
|---|---|---|---|
| Momentum Micro — Bitty (Pilot) | `d749482a-4d18-44b7-93d3-3f8fc387d18b` | 0 = Draft | 0 |
| Momentum Micro — 90-day re-touch | `cbde9c17-e5db-48e2-8226-ddb924ec8e23` | 0 = Draft | 0 |

## LAUNCH BLOCKERS (must be closed before either campaign is activated)

1. **Mailing address.** Every footer (now led by the legal entity line "Agentic Voice Inc. d/b/a Momentum Funding (MFunding.net)") holds the literal placeholder `[MAILING ADDRESS — owner to supply]`. CAN-SPAM requires a valid physical postal address. Owner supplies it, then it gets patched into all 7 bodies.
2. **Opt-out link.** The Instantly API does not document the token its editor uses for the clickable unsubscribe link, so I did not guess one. What is live now: (a) `insert_unsubscribe_header = true`, which adds the List-Unsubscribe header (one-click unsubscribe in Gmail/Yahoo), and (b) a footer line: *Not interested? Reply "stop" and you won't hear from us again.* A reply-based opt-out is only compliant if somebody honors it within 10 business days, so either (i) in the Instantly editor, click **Insert unsubscribe link** in each step's footer (one click per step, 7 total), or (ii) set up a process that marks "stop" replies as unsubscribed. Option (i) is recommended.
3. **Sender-name variable.** Each email is signed `{{sendingAccountFirstName}}` because the 30 mailboxes use 6 different personas (Ernesto Lee, Carlos Marquez, Stephanie Decker, plus 15 different names on the 3 newer domains). If every email were signed "Ernesto", 25 of the 30 senders would look mismatched. The variable name comes from Instantly's sending-account variables but is **not confirmed in their API docs**. Before launch, open **Preview** in the editor with a sending account selected and confirm the name renders. If it doesn't, replace it with the variable shown in the editor's Variables menu.
4. **`{{industry}}` must always be populated.** Pilot email 3 uses it ("for businesses in {{industry}}"). The re-touch no longer does. Either the enrollment function sends a value for every lead, or the step is changed to `{{industry | your industry}}`. A blank renders as "businesses in ."
5. **Email 3 link** points to `https://mfunding.net/programs/momentum-micro.html`. It will be swapped for the GHL funnel page when that page ships.
6. **Plan budget (see "Volume math").** At 100 new leads per day, the plan's 1,000-contact monthly cap runs out in 10 send days.

## Settings (both campaigns, read back by GET)

| Setting | Value | Note |
|---|---|---|
| Sending accounts | all 30 (5 each on getmfunding, trymfunding, workmfunding, crystointegritypath, maximanewspringscope, flourishmanifestergo) | none on mfunding.net |
| Schedule | Mon–Fri 08:00–17:00, timezone `America/Detroit` | `America/New_York` is **not in Instantly's timezone enum**. America/Detroit is US Eastern with the same offset and DST. The API has **no per-lead timezone**: one schedule per campaign. West-coast leads receive email from 5am PT. Split into ET/CT/PT campaigns later if that matters. |
| Stop on reply | on | |
| Stop for company (whole domain stops when one person replies) | on | |
| Stop on auto-reply | off | out-of-office replies don't end the sequence |
| Open tracking | **off** | |
| Link tracking | **off** | |
| Text only (all steps, including the first) | on | plain text, no tracking pixel |
| List-Unsubscribe header | on | |
| Gap between emails per account | 10 min, plus up to 10 min random wait | |
| Allow risky contacts | off | |
| Bounce protection | on (not disabled) | |
| Pilot: daily email cap / daily new-lead cap | **150 / 100** | 150 across 30 mailboxes = 5 per mailbox per day, against a 30/day account limit. In week 1 only new leads go out (~100/day). From week 2, follow-ups compete with new leads under the 150 cap, so new-lead volume ramps down on its own instead of spiking. |
| Re-touch: daily email cap / daily new-lead cap | 100 / 50 | |
| Step 1 A/B | 2 variants, same body, different subject | auto-winner selection not enabled. Judge on reply rate manually (open tracking is off on purpose). |

### Warmup age (from `timestamp_warmup_start`, as of 2026-11-16). All green (6 weeks or more).
- getmfunding / trymfunding / workmfunding: started 2026-07-04/05, about 19 weeks.
- flourishmanifestergo: 2026-09-23, about 7.7 weeks.
- crystointegritypath: 2026-09-29, about 7 weeks.
- maximanewspringscope: 2026-09-30, about 6.9 weeks.
All 30 accounts: status active, warmup on, warmup score 100, daily_limit 30, setup_pending false. Instantly flags no errors on any account.

### DNS auth (dig, 2026-11-16)
All 6 domains: `google._domainkey` DKIM key published (v=DKIM1, RSA), SPF `include:_spf.google.com ~all`, DMARC `p=reject` (relaxed alignment), MX on Google.

## Volume math (plan read from the API)
- Plan: **Instantly Growth ($47/mo)**, `total_lead_limit` **1,000 uploaded contacts per month**, current count 0, period ends 2026-11-25. The API does not expose a monthly email cap. The 5,000 emails/mo figure comes from Instantly's pricing page and has not been verified.
- 4-step sequence × 1,000 contacts = up to 4,000 emails per month, inside a 5,000 cap.
- At 100 new leads per day, the 1,000 contacts are used up in 10 send days. To spread them over a month, set the daily new-lead cap to about 45–50. Owner decides. No change made.

## Pilot copy — "Momentum Micro — Bitty (Pilot)"
Sequence: Day 1, Day 3, Day 7, Day 12 (delays 2, 4, 5 days). Steps 2–4 have an empty subject, so they go out as replies in the same thread.

**Step 1 (Day 1)**. Subject A: `working capital for {{companyName | your business}}` (Instantly's documented fallback syntax: an empty companyName renders as "your business"). Subject B: `quick question, {{firstName}}`
```
Hi {{firstName}},

We arrange working capital advances through our funding partners, typically from $2,000 to $100,000, subject to underwriting, for businesses like {{companyName}} that have been open at least a year.

If a few thousand dollars would help right now (inventory, a repair, a slow month), is it worth a 10-minute call?

{{sendingAccountFirstName}}
Momentum Funding
```

**Step 2 (Day 3)**. Same thread.
```
Quick follow-up. To see what you may qualify for, we typically ask for a short application and your last 3–4 months of bank statements. There are no upfront fees to apply. We're paid by the funder, not by you.

Want me to send it over?

{{sendingAccountFirstName}}
Momentum Funding
```

**Step 3 (Day 7)**. Same thread.
```
{{firstName}}, we arrange working capital advances for businesses in {{industry}}. Here's a one-page overview: https://mfunding.net/programs/momentum-micro.html

Reply "yes" and I'll call you.

{{sendingAccountFirstName}}
Momentum Funding
```

**Step 4 (Day 12)**. Same thread.
```
I haven't heard back, so I'll stop reaching out after this one. If working capital becomes useful later, just reply to this email. It comes straight to me.

{{sendingAccountFirstName}}
Momentum Funding
```

**Footer (appended to every step of both campaigns)**
```
--
Agentic Voice Inc. d/b/a Momentum Funding (MFunding.net) · Momentum Funding arranges funding from third-party funders. · [MAILING ADDRESS — owner to supply]
Not interested? Reply "stop" and you won't hear from us again.
```

### Edits made to the supplied copy
Revision 1 (deliverability):
1. Every step: signature changed from `Ernesto` to `{{sendingAccountFirstName}}`, so the sign-off matches the mailbox persona (blocker 3). The owner is deciding whether the six persona names are real people. If not, the sign-off becomes "Momentum Funding team".
2. Steps 2–4: added the sign-off. The supplied copy had none on these steps.
3. Every step: footer appended.

Revision 2 (compliance review, applied to the live drafts):
1. Step 1 subject A: `{{companyName}}` became `working capital for {{companyName | your business}}`.
2. Step 1: removed the market claim "Most funders won't look at a request under $50,000." The offer is now stated as arranged "through our funding partners, typically ... subject to underwriting".
3. Step 2: "all it takes / credit doesn't have to be perfect / the funder pays us, never you" became "To see what you may qualify for, we typically ask for ... There are no upfront fees to apply. We're paid by the funder, not by you."
4. Step 3: the "a lot of {{industry}} owners who need a smaller amount" sentence became "we arrange working capital advances for businesses in {{industry}}."
5. Footer on all steps of both campaigns: legal entity line "Agentic Voice Inc. d/b/a Momentum Funding (MFunding.net) · Momentum Funding arranges funding from third-party funders. · [MAILING ADDRESS — owner to supply]", followed by the stop line.

### Compliance status
- The words "loan", "approved", "pre-approved", "guaranteed" and "no credit check" do not appear anywhere. The copy makes no rate or speed claims. The market claim in step 1 and the "credit doesn't have to be perfect" line have been removed.

## Re-touch copy — "Momentum Micro — 90-day re-touch" (written new)
For pilot non-responders, 90 days after their last pilot email. Revision 2: step 1's "programs change through the year" claim was replaced with a plain follow-up line. Step 2's "a lot of owners" sentence was replaced with a neutral description of what an advance can do. Step 2's "all we need is" and fee lines were aligned with the pilot's approved wording. Sequence: Day 1, Day 4, Day 9 (delays 3, 5 days). Steps 2–3 go out in the same thread. The same footer is appended.

**Step 1 (Day 1)**. Subject: `checking back, {{firstName}}`
```
Hi {{firstName}},

I'm following up on my note from a few months ago about working capital for {{companyName}}.

If there's a slow season coming, or something to stock up on before a busy one, a working capital advance from $2,000 to $100,000 may be an option. Is it worth a 10-minute call?

{{sendingAccountFirstName}}
Momentum Funding
```

**Step 2 (Day 4)**. Same thread.
```
A working capital advance can help cover the gap between when bills are due and when money comes in.

To see what's possible, we typically ask for a short application and your last 3–4 months of bank statements. There are no upfront fees to apply. We're paid by the funder, not by you.

Want me to send the application?

{{sendingAccountFirstName}}
Momentum Funding
```

**Step 3 (Day 9)**. Same thread.
```
Last note from me. If the timing ever lines up, just reply to this email. It comes straight to me.

{{sendingAccountFirstName}}
Momentum Funding
```

Re-touch timing: Instantly has no "90 days after the previous campaign" trigger. The enrollment side must add leads to this campaign once their pilot sequence has been finished for 90 days or more without a reply.

## Implementation notes (for whoever edits these through the API)
- **Email bodies must be HTML blocks** (`<div>line</div>`, `<div><br /></div>` for blank lines). The first create used bare text with `<br/>`, as the API docs show, and Instantly **silently stripped every word** and kept only the `<br />` tags. The create returned 200 anyway. Fixed by PATCH, then re-verified: the GET bodies match the intended copy byte-for-byte. Always GET after any write.
- Variable fallback syntax (Instantly help, "Placeholder Values"): `{{variableName | fallback text}}`.
- The delay on a step is the wait *before the next* step. The last step has delay 0.
- Status enum: 0 Draft, 1 Active, 2 Paused, 3 Completed, -1 Accounts Unhealthy, -2 Bounce Protect, -99 Suspended.
