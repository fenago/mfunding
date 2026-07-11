# 6. For the Super Admin (the Owner)

Everything in this chapter is **super-admin only** unless it says otherwise.

---

## 6.1 Closer scorecards & KPIs

There are **two** closer-performance surfaces. They answer different questions.

### A. The live scorecards — `/admin/closers`
The one you'll actually live in. It **refreshes itself every 60 seconds**. Click any closer to
expand their full card.

**The graded metrics** — each one is scored green / amber / red against a target:

| Metric | How it's calculated | Target |
|---|---|---|
| **Close rate** | funded ÷ assigned | Tenure-based: **8%** under 3 months, **10%** under 6, **12%** under 12, **14%** after a year. *Not graded until they have at least 5 assigned deals* — "too few to grade." |
| **Run rate** | funded ÷ months of tenure | **2 deals/month** |
| **Speed to contact** | average hours from lead created → first contact | **under 1 hour** (fails at 24h) |
| **Time to fund** | average days from lead created → funded | **under 7 days** (fails at 21) |
| **Touches / open deal** | logged activity ÷ open deals | **3+ per week** |
| **⭐ Overall Score (0–100)** | Weighted: close rate **40** + run rate **30** + speed to contact **15** + touches **15**. | The single number to rank on. |

**The money block:** funded volume · gross commission · what the company kept · paid out · **owed**
(approved + pending + on hold) · clawbacks.

**Pipeline & conversion:** open deals · projected value · average deal size (benchmarked at $50K) ·
renewals · and a **10-step funnel bar chart**: Assigned → Contacted → Qualified → App Sent → Docs In
→ Submitted → Offer → Presented → Accepted → Funded. That chart tells you *where* a closer leaks.

**Work & activity:** deals worked · lost/declined · logged touches and calls · self-generated deals.

Closers are ranked by **total funded**, then overall score, then pipeline value.

> ⚠️ **The one thing to check first:** if a closer's card says *"No portal login linked"*, their
> deals and activity **cannot be attributed to them** and they cannot be auto-assigned leads. Link
> their login on their closer record.

### B. The historical scorecard — `/admin/analytics/closers`
A simpler, static view under Analytics: a "Top Closer" banner, a deals-funded bar chart, and a
table (Closer · Leads · Funded · Close Rate · Avg Deal · Revenue · Avg Days · This Month). Close
rate is colour-coded green ≥12% / yellow ≥8% / red below.

---

## 6.2 Commissions dashboard — `/admin/commissions`

**Top row:** Pending · **On Hold / Unpaid** (with the held count) · Completed · Clawbacks · This
Month (Company).

**Second row:** Total Gross Commission · **Company Revenue (Net)** — after closer and Sub-ISO splits
· Total Closer Payouts.

**Charts:** monthly revenue split into Company / Closer Payouts / Sub-ISO Overrides (last 12
months), and a top-5 revenue-by-closer pie.

**Filters:** All / Pending / Paid tabs, plus a per-closer dropdown and a status dropdown. Pick a
single closer and you get a totals strip for just them: Pending / Approved / Paid / On Hold.

**The actions on each row** (each only appears when it's valid):

1. **Approve** — from Pending.
2. **Mark Funder Paid** — from Pending or Approved.
3. **Mark Closer Paid** — from Funder Paid. *(This is the one that notifies the closer their money
   is on the way.)*
4. **Complete** — from Closer Paid.
5. **Hold** — from Pending, Approved, or Funder Paid. **Prompts you for a reason. The reason is
   mandatory and the closer sees it word-for-word.**
6. **Release hold** — from On Hold. Puts it back to Pending.

Full detail in [05-money-and-commissions.md](./05-money-and-commissions.md).

---

## 6.3 Managing closers — `/admin/closers`

Add or edit a closer and you control:

| Field | Notes |
|---|---|
| Name, email, phone | Email is what the onboarding package is sent to. |
| **Status** | active / inactive / terminated. **Only *active* closers get auto-assigned leads.** |
| **Company Lead %** | Default **30** — the Momentum Standard. **This is where you apply the performance escalators** (→35% at $250K/mo, →40% at $500K/mo). It is not automatic. |
| **Self-Gen %** | Default **65**. Never set this to 30. |
| **Renewal %** | Default **30**. |
| **Renewals enabled** | Off by default. When off, this closer **cannot open the Renewals screen** or see the renewal option in their calculator. |
| **Markets** | Indianapolis · Phoenix · Columbus · DC · Sacramento · South Florida. |
| **Max leads/month** | Their capacity ceiling. |
| **Draw amount + period** | The recoverable advance. Shown on their detail page. |
| Notes | Free text. |

**Rate changes apply going forward.** They never reprice a commission that already exists.

---

## 6.4 Deal reassignment & the unassigned queue

- **Deals** (`/admin/deals`) shows a red banner whenever any deal has no owner: *"N deals have no
  owning closer — commission and closer analytics can't attribute them."* Click **Show them**.
- The closer filter has a synthetic **"⚠ Unassigned only"** option.
- An unassigned deal's row shows a red **Unassigned** pill that links straight to the deal.
- **Reassign on the deal detail page** (admin+ only): pick the new closer from the dropdown.

> ⚠️ **Reassignment does NOT move an existing commission.** If the deal already funded and a
> commission was created for the previous closer, the platform warns you on screen and **leaves the
> payout pointing at the old closer**. You fix it by hand in Commissions.

Also here: CSV export of the filtered list, and **Bring back** for anything parked in
nurture/declined/dead.

---

## 6.5 Lead-assignment strategy — `/admin/platform-config`

One dropdown. It applies **in the database, on every new deal, from every intake path** — the web
application, debt-relief intake, live transfers, the CRM webhook, bulk import. No redeploy, effective
on the very next lead.

| Strategy | Behaviour |
|---|---|
| **Round-robin** *(default)* | Rotates evenly — the least-recently-assigned active closer gets the next lead. |
| **Least open deals** | Load-balances to whoever has the lightest open pipeline. |
| **Manual** | Nothing is auto-assigned. You work the Unassigned queue. |
| **Specific closer** | Everything goes to one chosen closer. |

Eligible = **active** closers **with a linked login**. If nobody is eligible, the deal saves
**unassigned** rather than failing. A lead is never lost.

---

## 6.6 The rest of Platform Config

| Setting | What it does |
|---|---|
| **Closer draw treatment** | **Repayable** (default — unrecovered draw is owed back) or **Forgiven** (written off). A **company-wide** policy, not per closer. It's merged into every Schedule A generated from now on; already-signed documents keep the term they were frozen with. |
| **White-label branding** | Company name, tagline, support email, logo, primary + accent colours. |
| **Underwriting scorecard** | The weights behind the Approve / Review / Decline recommendation. Every deal starts at 100 points and gets deducted for: NSFs, negative days, MCA positions, low average daily balance (two tiers), revenue below minimum, time in business below minimum, credit below minimum. You also set the **Approve at ≥** and **Review at ≥** cutoffs. "Reset to defaults" is there if you over-tune it. |
| **Pipeline reference** | Read-only display of the MCA and VCF stage lists. |
| **API keys** | Informational. Credentials live in the secure vault and are never edited from a browser. |

---

## 6.7 Closer onboarding & e-signature

Covered in full in [07-closer-onboarding.md](./07-closer-onboarding.md). The short version:

1. Fill in **Company terms** on `/admin/closer-docs` — legal name, signatory, governing state,
   clawback window, renewal override. **Until these are complete, nothing can be sent.**
2. Expand the closer → tick the e-signable documents → **Email them to e-sign**.
3. If any document still has an unfilled field, **nothing is sent** and you're told exactly which
   field, on which document, and where to fix it. A closer never receives a contract with a raw
   `[BRACKET]` in it.
4. Collect the manual documents (the .docx agreement, the W-9, direct deposit, licensing) and mark
   them off by hand.

---

## 6.8 Campaigns — `/admin/campaigns`

**Creating one** is a 3-step wizard: **Product** (partner + product from the catalogue) →
**Volume & price** (with a live budget preview) → **Launch** (name, start date, status, notes).

- **The campaign code is generated by the system.** Format: `PARTNER-CHANNEL-YEAR-###`, e.g.
  **`SYN-LT-2026-001`**, `SYN-RT-2026-002`, `HOU-REF-2026-001`. You never type it, and it never
  changes after creation. Neither does the channel.
- **A setup checklist attaches automatically, per channel** — with the actual infrastructure values
  captured on it. A live-transfer campaign asks you to create a dedicated tracking number *and type
  it in*. A real-time campaign asks for the dedicated inbound email alias. A cold-email campaign
  asks for the sending domain and the linked Instantly campaign.
- **Attribution:** give a campaign a **tracking email** or **tracking phone** and any lead arriving
  through it is attributed automatically, regardless of channel. Without one, attribution falls back
  to "whichever active campaign matches the channel" — which the app warns you is ambiguous the
  moment two campaigns share a channel. **Set the identifier.**

**The KPIs** (computed off real deal timestamps, not estimates):

| KPI | Definition | Target |
|---|---|---|
| Leads / Leads purchased | attributed deals vs. what you actually bought | — |
| Contact % · Qualify % · Application % · Submission % | stage-to-stage conversion | — |
| Close % | funded ÷ leads | 8–12% |
| **Acquisition CPL** | spend ÷ **leads purchased** — the true cost per lead | — |
| **⭐ Cost per funded** | spend ÷ funded | **< $1,500** |
| **⭐ ROAS** | estimated commission ÷ spend | **≥ 1** |
| Est. commission | funded amount × 8% | — |
| Pipeline value | requested $ still in flight | — |

There's a **Channels head-to-head** table that re-runs all of it per channel, so you can see which
channel is actually paying.

**AI analysis:** one button gives you a verdict — **scale / keep / fix / kill** — with what's
working, what's underperforming, a projected cost-per-funded, and numbered recommendations. Past
runs are kept.

**Monte Carlo projection:** simulate the campaign thousands of times to get **Worst (P10) / Most
likely (P50) / Best (P90)** ranges for funded deals, commission revenue, ROAS, and cost-per-funded —
plus **P(profit)** and **P(at least one funded deal)**. Every rate knob is tagged **"obs"** (from
this campaign's real data) or **"bench"** (an industry benchmark, because there isn't enough real
data yet). Don't trust a "bench" projection the way you'd trust an "obs" one.

---

## 6.9 Cold email & the Instantly infrastructure

**`/admin/email` — Email (Cold Outreach).** A live read-only dashboard on the Instantly account:

- Mailbox count, campaign count, how many are **warming**, average mailbox health.
- **Domain warmup dashboard** — per domain: days warming, a progress bar to the 6-week line, mailbox
  count, average warmup health, and a **live forwarding check** (✓ if the domain correctly forwards
  to mfunding.net, ✕ with the wrong target shown if not). Red under 3 weeks, yellow 3–6, green at
  6+ weeks.
- Every sending mailbox with its status, warmup state, health score, and daily limit.
- An 8-step runbook for standing up a new sending domain.

**`/admin/cold-email` — Cold Email Planner.**
- A **capacity calculator**: "I want to send N emails/day" → how many mailboxes and domains you
  need; or "I have D domains" → what volume that buys you. Plus the financial projection (leads →
  funded deals → revenue → net → ROI).
- **"Use my actuals"** pulls your real reply rates from Instantly and overwrites the assumptions.
- A **real** overlay: actual cold-email-sourced **funded deals** and revenue, straight from the deal
  data, sitting next to the model's projection.
- A **warmup seasoning tracker** for domains you own but haven't connected to Instantly yet.
  Seasoning: not started → warming (0–20 days) → **ready** (21–41 days, usable) → **seasoned** (42+).

> **What this is not:** the platform is a **monitoring window** onto Instantly. You cannot create
> campaigns, compose emails, or push lead lists from here. All sending and warmup control happens
> in Instantly itself.

**Two rules that are not negotiable:** never cold-send from the main brand domain, and never go live
on a domain that hasn't warmed for 6 weeks.

---

## 6.10 The funder network

See [08-funder-network.md](./08-funder-network.md) in full. Your screens:

| Screen | What it's for |
|---|---|
| **Lenders** (`/admin/lenders`) | The real funder network. Add, edit, and see the **funder scoreboard** — submissions, replies, offers, win rate per funder. |
| **Funder Directory** (`/admin/funder-directory`) | The researched prospect list. "Add to lenders" promotes one into the real network. |
| **Funder Matrix** (`/admin/funder-matrix`) | Every live funder's approval criteria side by side, editable inline. Filter by "needs voided check," "needs tax return," etc. |
| **Funder Guide** (`/admin/funder-guide`) | Read-only. Who's live, who's pending, who's a prospect — plus the routing cheat sheet. Closers can see this one. |
| **Funder Contacts** (`/admin/funder-contacts`) | The reply reconciler. Scans inbound email, matches unknown senders to funders by domain, and lets you save them as contacts — so every future reply from that person auto-associates. |

---

## 6.11 Lead sourcing

| Screen | What it's for |
|---|---|
| **Lead Partner (Synergy)** | Our primary live-transfer partner's full catalogue plus a unit-economics calculator. The verdict line is **cost per funded < $1,500**. |
| **Live Transfer Leads** | Rank live-transfer vendors against a scoring rubric (Reputation 30 · Risk/billing 20 · Cost/value 16 · Exclusivity 12 · Transparency 12 · CRM fit 10). |
| **Vendor Scorecard** | Vendor performance. |
| **Lead Sources** | Cost/ROI per source. |
| **Lead Import** | Bulk CSV import (UCC lists, aged lists). Admin+. |
| **Live Transfer ROI** | Slider-driven model across close rates 5/10/15/20%. |

---

## 6.12 Renewals — `/admin/renewals`

Funded deals sorted **closest to renewal first**. Update the **paydown %** on a row and hit
**Save + push to GHL**.

- Crossing **40%** automatically flips the deal to **Renewal Eligible** and stamps the date.
- The **push to GHL** is what actually fires the renewal outreach sequence. Saving the percentage
  alone does not.
- Milestones: **40%** may qualify · **60%** eligible · **75%** best terms · **100%** paid off, renew
  now.
