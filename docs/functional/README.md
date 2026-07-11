# MFunding.net — Functional & Business Documentation

**Company:** Agentic Voice Inc. **d/b/a MFunding.net | Momentum Funding**
**Live site:** [mfunding.net](https://mfunding.net)
**Audience:** the owner (super admin), admins/employees, and closers.

This is the **operator's manual**: what the platform does and how you use it. It is not an
engineering document — there is no code here. Everything in this set was written by reading the
live application and querying the live database, so what you read here is what the software
actually does today.

> **If a screen and a document disagree, the screen wins — and this document is wrong.**
> Tell the owner so it gets fixed.

---

## Start here

| If you are… | Read, in this order |
|---|---|
| **A brand-new closer** | 1 → 2 → 4 → 5 → 7 → 9 |
| **A new admin / employee** | 1 → 2 → 3 → 8 → 9 |
| **The owner (super admin)** | 1 → 3 → 5 → 6 → 8 |
| **Just need a word defined** | 9 |

---

## The documents

| # | File | What's in it |
|---|---|---|
| 1 | [01-the-business.md](./01-the-business.md) | What MFunding is, the two product lines (MCA and VCF), and the **compliance language rules** every screen and every conversation depends on. |
| 2 | [02-roles-and-access.md](./02-roles-and-access.md) | The five roles — super_admin, admin, employee, closer, user/merchant — and exactly which screens each one can open. |
| 3 | [03-deal-lifecycle.md](./03-deal-lifecycle.md) | End to end: how a lead arrives, how it's auto-assigned, the real pipeline stages, docs/stips, funder submission, offers, funding, renewals. |
| 4 | [04-closer-day-to-day.md](./04-closer-day-to-day.md) | The closer's daily loop: **My Day** (the two lanes), the **Revenue Playbook**, the **AI deal assistant**, and **My Earnings**. |
| 5 | [05-money-and-commissions.md](./05-money-and-commissions.md) | Points, the pool, the splits, the escalators, the draw, clawbacks — with worked examples — plus the approve→pay lifecycle the owner runs. |
| 6 | [06-super-admin-guide.md](./06-super-admin-guide.md) | Owner-only: closer scorecards & KPIs, commissions dashboard, deal reassignment, lead-assignment strategy, campaigns, cold email, platform config. |
| 7 | [07-closer-onboarding.md](./07-closer-onboarding.md) | The nine-document package: what gets e-signed in-app, what's collected by hand, and how the send/sign flow works. |
| 8 | [08-funder-network.md](./08-funder-network.md) | How funders are onboarded, what a submission recipe is, how submissions go out and how funder replies come back. |
| 9 | [09-glossary.md](./09-glossary.md) | Every term: ISO, MCA, points, factor rate, stips, stacking, live transfer, VCF, clawback, draw, override, and the rest. |

---

## The two-minute version

1. We are a **broker** (an ISO). We connect small businesses that need capital with **funders**
   who provide it. **We never lend our own money.**
2. We sell two things: **MCA** (a purchase of future receivables — *never* call it a loan) and
   **VCF** (debt relief / restructuring for merchants drowning in existing MCA debt).
3. Leads arrive from the website, live transfers, real-time transfers, aged leads, cold email
   and campaigns. The database **auto-assigns each one to a closer** the moment it lands
   (round-robin by default).
4. A closer works the deal in the **Revenue Playbook**, guided step by step, chasing docs and
   bank statements — that is the #1 place deals die.
5. The packaged deal is **submitted to 3–5 funders at once**. Offers come back, the best two go
   in front of the merchant, the merchant signs, the funder wires the money.
6. The funder pays us **points** (8 on a new deal, 6 on a renewal). That is the **pool**. The
   closer's split comes out of the pool. The owner approves it, and it's paid **within 5 business
   days of the funder paying us**.
