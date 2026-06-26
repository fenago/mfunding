# V2 — MFunding Funnel, Follow-Up & CRM Playbook
## Complete Operations Manual: Funnel Metrics, Follow-Up Sequences, GHL Setup
### MFunding, LLC | mfunding.com | March 2026

---

# PART 1: THE FUNNEL — 9 STAGES, EVERY METRIC

## The MFunding MCA Deal Pipeline (Built in GHL)

```
New Lead → Contacted → Qualifying → Application Sent → Docs Collected → Submitted to Funder → Offer Received → Offer Presented → Funded → Renewal Eligible
```

---

### STAGE 1: LEAD ACQUISITION

| Metric | Target | Red Flag |
|--------|--------|----------|
| Total leads/month | 100–200 (scaling up) | Below 35 |
| Cost per lead (blended) | $50–$75 | Above $100 |
| Lead source mix | 60% transfers, 25% ads, 15% aged/UCC/referral | Over-reliance on single source |
| Lead quality (% meeting minimums: $15K+ revenue, 6+ months in biz) | 70%+ | Below 55% (bad vendor) |

**Sources:** Live transfers (primary), Google Ads (geo-targeted per city), aged MCA leads, UCC filing data, referrals, Sub-ISO overflow.

**The lever:** If CPL too high → negotiate vendor, optimize ads, add aged leads. If quality low → tighten vendor specs, add negative keywords.

---

### STAGE 2: INITIAL CONTACT

| Metric | Target | Red Flag |
|--------|--------|----------|
| Contact rate | 65%+ | Below 50% |
| Speed to contact | < 60 sec (transfers), < 5 min (web leads) | Over 15 min |
| Wrong number rate | < 10% | Above 15% (demand credits) |

**The lever:** Speed is everything. GHL auto-response fires instant SMS within 60 seconds of form submission. AI Employee handles after-hours chat/SMS. Every minute of delay costs 10% contact rate on web leads.

---

### STAGE 3: QUALIFICATION

**The MCA qualification checklist:**
- Business type and industry (no nonprofits, cannabis, adult entertainment, firearms)
- Time in business: 6+ months minimum
- Monthly revenue: $15K+ minimum ($20K+ preferred)
- Funding amount needed and use of funds
- Active business bank account with consistent deposits
- Owner is the decision-maker

| Metric | Target | Red Flag |
|--------|--------|----------|
| Qualification rate | 55–65% of contacted | Below 40% |
| Average deal size requested | $40K–$75K | Below $20K consistently |
| Top disqualification reasons | Tracked in GHL custom fields | If >30% "not interested" → lead source intent problem |

---

### STAGE 4: APPLICATION SUBMITTED

| Metric | Target | Red Flag |
|--------|--------|----------|
| App submission rate | 65–75% of qualified | Below 50% |
| Time to submit | < 24 hours | Over 48 hours |

**The lever:** Get the application done ON THE FIRST CALL. Don't say "I'll send you a link." Say "Let me grab a few quick details right now." Walk them through it live. If you must send a link, text it immediately via GHL automation and follow up in 2 hours.

---

### STAGE 5: DOCS COLLECTED (⚠️ #1 LEAK IN THE FUNNEL)

This is where MFunding's **Plaid integration** is the competitive advantage. Instead of asking merchants to email bank statement PDFs (which 40–60% never do), Plaid lets them connect their bank account in 60 seconds for instant verification.

**Two paths:**
1. **Plaid path (preferred):** Merchant visits apply.mfunding.com → connects bank via Plaid Link → instant 3–6 month transaction data → ready to submit to funders in minutes
2. **Manual path (fallback):** Merchant texts photos of bank statements or emails PDFs → VA packages for submission

| Metric | Target | Red Flag |
|--------|--------|----------|
| Docs/stips completion rate | 50–60% | Below 35% |
| Average time to collect | < 24 hours (Plaid), < 48 hours (manual) | Over 5 days |
| Plaid adoption rate | 60%+ | Below 30% (improve the UX or sales pitch) |
| Follow-up touches to collect | 3–5 | If 8+ → process needs work |

**The lever:** See Stips Collection sequence in Part 2. Make it ridiculously easy. Lead with Plaid. Offer fallback methods. Follow up aggressively first 48 hours. Use urgency ("I have a funder ready to review your file TODAY").

---

### STAGE 6: SUBMITTED TO FUNDER

| Metric | Target | Red Flag |
|--------|--------|----------|
| Approval rate (at least 1 offer) | 55–65% | Below 40% |
| Offers per deal | 2–3 | Consistently only 1 |
| Time to offer | < 24 hours | Over 48 hours |
| Funder-specific approval rate | Track per funder | Drop anyone below 30% |

**The lever:** If approval rate is low → need more funders, OR you're submitting wrong paper to wrong funders. Build a funder matrix: "This deal's profile = Funder X, Y, Z."

---

### STAGE 7: OFFER PRESENTED

| Metric | Target | Red Flag |
|--------|--------|----------|
| Offer acceptance rate | 70–80% | Below 55% |
| Time from offer to acceptance | < 48 hours | Over 5 days |

**The lever:** Always present 2+ offers. Frame consultatively: "Option A gives you more capital with slightly higher payments. Option B gives lower payments. Which works better for your cash flow?" If acceptance is low on price → need better-tier funders.

---

### STAGE 8: FUNDED

| Metric | Target | Red Flag |
|--------|--------|----------|
| Funding rate | 85–90% of accepted | Below 75% |
| Commission per deal | $3,500–$5,500 | Below $3,000 consistently |
| Revenue per lead | $200–$300 | Below $120 |

---

### STAGE 9: RENEWAL ELIGIBLE

| Metric | Target | Red Flag |
|--------|--------|----------|
| Renewal rate | 45% of funded merchants at 6 months | Below 25% |
| Renewal commission | 6 points ($3,000 on $50K deal) | N/A |
| Renewals specialist split | 35% ($1,050) — you keep $1,950 | N/A |

---

## MASTER METRICS DASHBOARD (Track Weekly in GHL)

| # | Metric | Formula | Target |
|---|--------|---------|--------|
| 1 | Total leads | Count | 100–200/month |
| 2 | Cost per lead | Spend ÷ leads | $50–$75 |
| 3 | Contact rate | Contacted ÷ total | 65%+ |
| 4 | Qualification rate | Qualified ÷ contacted | 55%+ |
| 5 | App submission rate | Apps ÷ qualified | 65%+ |
| 6 | ⚠️ Docs completion rate | Complete ÷ apps | 50%+ |
| 7 | Approval rate | Offers ÷ submitted | 55%+ |
| 8 | Acceptance rate | Accepted ÷ presented | 70%+ |
| 9 | Funding rate | Funded ÷ accepted | 85%+ |
| 10 | **Overall close rate** | **Funded ÷ total leads** | **8–14%** |
| 11 | **Cost per funded deal** | **Total spend ÷ funded** | **$500–$1,500** |
| 12 | **Avg commission** | **Commissions ÷ funded** | **$4,000–$5,000** |

---

# PART 2: FOLLOW-UP SEQUENCES (Build These as GHL Workflows)

## SEQUENCE A: STIPS/DOCS COLLECTION (14-Day — Highest Priority)

Triggers when deal moves to "Application Sent" stage and docs are not yet received.

| Day | Channel | Message |
|-----|---------|---------|
| **Day 0** (immediate) | SMS | "Hi [First Name], it's [Closer] from MFunding! Thanks for your application. I just need one more step to get you funding offers: securely connect your bank account here → [Plaid Link]. Takes about 60 seconds. Or you can snap photos of your last 3 months of bank statements and text them right back. Let's get you funded! 💪" |
| **Day 0** (+2hr) | SMS | "Quick follow-up [First Name] — here's the secure link again to connect your bank: [Plaid Link]. If you prefer, you can also email statements to docs@mfunding.com. Once I have your bank info, I can start getting you offers today." |
| **Day 1** (9am) | Call + SMS if no answer | "Morning [First Name]! I have a funder reviewing files today and I'd love to get yours in front of them. Just need to verify your bank info — takes about 60 seconds with our secure link: [Plaid Link]. If you're having trouble, I can walk you through it right now. Call or text me!" |
| **Day 2** (afternoon) | SMS | "Hey [First Name], checking in on your MFunding application. Three easy ways to send your bank info: 🔗 Secure link → [Plaid Link] / 📸 Snap photos → text to this number / 📎 Email → docs@mfunding.com. Which works best?" |
| **Day 4** | Call + voicemail drop + SMS | Voicemail: "Hi [First Name], it's [Closer] from MFunding. Based on your application, I'm optimistic about your funding options. Just need your bank verification to make it official. I can walk you through it in about 60 seconds. Call me at [number]." SMS: "Left you a voicemail — can you send your bank info today?" |
| **Day 7** | SMS (urgency) | "[First Name], heads up — pre-approvals typically expire after 7–10 days. Your application for [Business Name] is still active. Send your bank info this week and I can lock in offers. Text me HELP and I'll call you right now." |
| **Day 10** | Email | Subject: "Your MFunding application — still open." Professional email with Plaid link, alternative methods, and offer to keep file on hand. |
| **Day 14** | SMS (breakup) | "Hi [First Name], closing out your funding file for now since we haven't received your bank info. No hard feelings — your application is saved. Text me anytime when you're ready and I'll pick it right back up. Wishing [Business Name] all the best! — [Closer]" |

→ After Day 14: Move to 30-Day Nurture (Sequence D)

**Breakup messages have the highest response rate in the sequence — expect 10–15% re-engagement.**

---

## SEQUENCE B: NO ANSWER / NEVER REACHED (7-Day)

Triggers when a transfer disconnects or web lead doesn't pick up on first call.

| Day | Channel | Message |
|-----|---------|---------|
| **Day 0** | SMS | "Hi [First Name], this is [Closer] from MFunding. I was just trying to reach you about business capital options. When's a good time to chat? Call or text me back at this number." |
| **Day 0 +2hr** | Call #2 | Ring. No voicemail unless personal greeting confirms right person. |
| **Day 1 AM** | SMS | "[First Name], tried reaching you again about capital for [Business Name]. I may be able to get you $[range] — just need 5 minutes. Text CALL and I'll ring you right now." |
| **Day 1 PM** | Email | Subject: "Quick question about capital for [Business Name]" — short, professional, phone number prominent. |
| **Day 2** | Call #3 + voicemail + SMS | Warm voicemail. Follow-up SMS: "Just left you a message — hope to connect soon!" |
| **Day 4** | SMS | "[First Name], still trying to connect about business funding. If you're no longer interested, no worries — text STOP. Otherwise I'd love to chat when you have a minute." |
| **Day 7** | Breakup SMS | "Hi [First Name], I've tried reaching you a few times. I'll close your file for now, but if you ever need capital, you've got my number. Best of luck! — [Closer]" |

→ After Day 7: Move to 60-Day Nurture

---

## SEQUENCE C: SOFT NO — "Not Right Now" (90-Day Long Nurture)

| Day | Channel | Message |
|-----|---------|---------|
| **Day 0** | SMS | "Totally understand [First Name]. Timing is everything. I'll keep your info on file — if you ever need working capital, you've got a direct line to me. Wishing you a great week!" |
| **Day 30** | SMS | "Hi [First Name], just checking in — hope business is going well at [Business Name]. If you ever need a cash flow boost, I'm a text away." |
| **Day 45** | Email | Value-add content — NOT a sales pitch. Tip about managing cash flow, seasonal inventory, etc. |
| **Day 60** | SMS | "Hey [First Name], I've got some new funding programs with better terms than before. Want me to run the numbers for [Business Name]? No commitment." |
| **Day 75** | Email | Case study or success story relevant to their industry. |
| **Day 90** | SMS | "It's been about 3 months since we connected. Things change — if you need capital for [Business Name], I'm still here. — [Closer]" |
| **Quarterly** | SMS (ongoing) | Rotate: new program announcements, seasonal check-ins, simple "just checking in" messages. |

---

## SEQUENCE D: OFFER DECLINED (45-Day Rework)

| Day | Channel | Action |
|-----|---------|--------|
| **Day 0** | Call | "What specifically didn't work — payment amount, total cost, or term length? Let me find something better." |
| **Day 0** | Internal | Resubmit to different funders based on objection. |
| **Day 1–3** | Call + SMS | "Good news — found a different option that addresses [their concern]. Quick 3-minute call?" |
| **Day 7** | SMS | "One more option I'd like to share — it's [specific improvement]. Worth a call?" |
| **Day 14** | Breakup SMS | "Exhausted my options for now. I'll circle back in 30 days to see if new programs are available." |
| **Day 45** | Re-engagement | "New programs just opened up with better terms. Want me to take another look?" |

---

## SEQUENCE E: FUNDED CLIENT → RENEWAL PIPELINE

Highest-ROI sequence. Renewal deals cost $0 in lead acquisition and close at 40–60%.

| Timing | Channel | Message |
|--------|---------|---------|
| **Day 1 post-funding** | SMS | "Congrats [First Name]! Your capital should be in your account. It was a pleasure. Would you mind leaving us a quick Google review? [LINK]. And if you know any business owner friends who need capital, I'll send you a $100 gift card for every funded referral!" |
| **Day 7** | SMS | "Hope the funding is helping! Know any business owners who could use capital? $100 gift card for each funded referral. Just have them mention your name." |
| **40% paydown** | SMS | "Your advance is getting close to halfway. At 50–60% paydown, you may qualify for additional capital — sometimes at better terms. Want me to check?" |
| **60% paydown** | Call + SMS | "Great news — based on your payment history, you're likely eligible for renewal. Larger amount, similar or better terms. Want me to run the numbers?" |
| **75% paydown** | SMS | "Almost done with your current advance. Best time to renew — most favorable terms. Shall I pull options?" |
| **100% paydown** | Call | Direct: "Congratulations on completing your advance! How's cash flow? Many clients keep revolving capital available. Want to see what you'd qualify for?" |

---

## SEQUENCE F: MASS REACTIVATION (Monthly Blast to Dead Leads)

Run monthly to entire dead lead database. Rotate messages each month.

**Month 1:** "Hi [First Name], we connected [X] months ago about capital for [Business Name]. Things change — still looking for working capital? Reply YES and I'll take another look."

**Month 2:** "Several of our funding partners just launched new programs with faster approvals. If [Business Name] could use capital, now might be a great time. Reply YES."

**Month 3:** "We just helped a [their industry] business get $[amount] funded last week. If [Business Name] could use a boost, text me anytime."

**Expected:** 3–5% re-engagement per month. On 500 dead leads = 15–25 fresh conversations at $0 per lead.

---

# PART 3: CRM — GHL SAAS PRO ($497/MO)

## Why GHL SaaS Pro (Not Starter, Not HubSpot)

The SaaS Pro plan is required because MFunding needs TWO capabilities:

1. **Running your own brokerage operations** — CRM, pipelines, SMS/email automation, AI Employee, landing pages, phone system, reporting
2. **White-labeling sub-accounts for Sub-ISOs** — each Sub-ISO gets their own branded portal. This is the scaling lever that transforms MFunding from a brokerage into a platform business.

| Feature | Why It Matters for MFunding |
|---------|---------------------------|
| SMS automation (unlimited, native) | Your entire follow-up playbook runs on automated SMS. $0.0079/segment usage. |
| Built-in phone + call tracking | Local numbers per market (317 for Indy, 480 for Phoenix, etc.). Call recording. Missed-call text-back. |
| Pipeline management | Exact 9-stage pipeline matching this funnel. Drag-and-drop. Stage-change triggers fire automations. |
| Landing pages + forms | One page per city at funding.mfunding.com/[city]. Forms auto-create CRM contacts + trigger workflows. |
| AI Employee | Pre-qualifies merchants 24/7 via chat and SMS. Books calls with closers. |
| Google Ads integration | Track which keywords/campaigns generate funded deals, not just leads. |
| SaaS Mode + Snapshots | Auto-provision Sub-ISO accounts with full MCA brokerage template. Charge $99–$199/mo. |
| Stripe rebilling | Mark up SMS/phone/email usage to Sub-ISOs for margin on every message. |
| Flat pricing | $497/mo covers everything. HubSpot equivalent = $800–$2,000+/mo. Custom-built = weeks of dev time. |

## GHL Setup Priorities — Week 1

| Step | Task | Time |
|------|------|------|
| 1 | Sign up for SaaS Pro, set up agency branding, connect funding.mfunding.com | 30 min |
| 2 | Create "MFunding Operations" sub-account | 5 min |
| 3 | Build MCA Deal Pipeline (9 stages) | 20 min |
| 4 | Add custom fields: Monthly Revenue, Time in Business, Industry, Lead Source, Target Market, Funding Amount | 15 min |
| 5 | Build Indianapolis landing page with form | 1 hr |
| 6 | Create auto-response workflow (instant SMS + email on form submit) | 30 min |
| 7 | Purchase Indianapolis phone number (317) | 5 min |
| 8 | Set up missed-call text-back | 10 min |
| 9 | Build Stips Collection workflow (Sequence A) | 45 min |
| 10 | Build No Answer workflow (Sequence B) | 30 min |

**Total: ~4 hours for a working system.** Start receiving leads the next day.

## Month 2: Add Automation + Markets
- Build full follow-up sequences (Sequences C–F)
- Clone landing pages for Phoenix, Columbus
- Configure AI Employee for MCA pre-qualification
- Connect Google Ads conversion tracking
- Add closer assignment (round-robin) when first closer hired

## Month 6+: Sub-ISO Infrastructure
- Create MCA Brokerage Snapshot from your proven operations
- Activate SaaS Mode, connect Stripe
- Build Sub-ISO recruitment funnel
- Configure usage rebilling with markup
- Set up deal submission notification workflow (Sub-ISO moves to "Submit" → MFunding VA gets notified)

---

# PART 4: DAILY OPERATIONS — HOW IT ALL CONNECTS

## A Day in the Life (Post-Setup)

**8:00 AM** — GHL dashboard: 3 new Google Ads leads overnight. Auto-SMS already sent. Call all 3 within 5 minutes.

**8:30 AM** — Live transfer #1: restaurant owner in Phoenix, $40K for equipment. Qualify on call, take app live, send Plaid link while on the phone. Bank data in 60 seconds. Ready to submit to funders.

**9:00 AM** — GHL shows: 2 merchants completed Plaid verification overnight from yesterday's stips sequence. VA packages and submits to 4 funders each.

**10:00 AM** — Funder calls: offer on yesterday's deal. $50K at 1.28 factor, 9-month term. Call merchant, present offer. She accepts. Move to "Funded." Auto-trigger: Google review request + referral ask.

**11:00 AM–2:00 PM** — More transfers, callbacks, submissions, offers. Core selling hours.

**3:00 PM** — Reactivation: GHL automation sends today's monthly blast to 500 dead leads. 2 respond "YES" immediately. Schedule callbacks.

**4:30 PM** — Friday: 30 minutes optimizing Google Ads. Pause 1 bad keyword, add 3 negatives from Search Terms report.

---

## Quick Reference: Review Frequency

| Frequency | What to Review |
|-----------|----------------|
| **Daily** | New leads, calls made, docs received, deals submitted |
| **Weekly** | Close rate, cost per lead, pipeline value, Google Ads performance, GHL dashboard |
| **Monthly** | Cost per funded deal, revenue by channel, funder approval rates, dead lead reactivation rate, closer performance |
| **Quarterly** | Channel ROI, vendor performance, overall P&L, Sub-ISO program metrics |

---

*Last updated: March 2026 | V2.0 — Aligned with MFunding operating plan, GHL SaaS Pro, and Plaid integration*
