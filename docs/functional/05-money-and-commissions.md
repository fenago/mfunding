# 5. Money — The Commission Model, in Plain English

---

## 5.1 The chain, in one picture

```
The funder wires $50,000 to the merchant.
        ↓
The funder pays US a commission — 8 points = 8% of $50,000 = $4,000.
        ↓                          ← this $4,000 is THE POOL
The closer's split comes out of the pool.
Company lead @ 30%  →  closer gets $1,200,  MFunding keeps $2,800.
        ↓
The owner approves it. It's paid within 5 business days of the funder paying us.
```

Everything below is detail on that picture.

---

## 5.2 Points — the size of the pool

**Points = percent of the funded amount that the funder pays us.**

| Deal | Points | Pool on a $50,000 deal |
|---|:--:|---|
| **New deal** | **8** | $4,000 |
| **Renewal** | **6** | $3,000 |

Points are paid on the **funded** amount, not the requested amount. If the merchant asked for $50K
and the funder approved $35K, the pool is 8% of **$35,000** = $2,800.

---

## 5.3 The splits — the closer's cut of the pool

Every closer has **three** rates on their record. Which one applies depends on **where the lead came
from**:

| Lead type | Default split to closer | Why |
|---|:--:|---|
| **Company lead** — we bought it, we generated it, we handed it to you | **30%** — *the Momentum Standard* | We paid for the lead, the CRM, the dialer, the funder relationships. |
| **Self-generated** — you found them yourself | **65%** | You brought the deal. You get the lion's share. |
| **Renewal** — on your **self-generated** funded book | **30%** | Renewals on your own book only. Company-lead deals are not renewal-eligible for the closer. |

**These are defaults.** The owner sets them **per closer** in **Admin → Closers**. Your actual
rates are shown at the top of your **My Earnings** page and on every math line — that is always the
truth for you.

### Worked examples — a $50,000 funded deal

| Scenario | Points | Pool | Split | **Closer gets** | Company keeps |
|---|:--:|---|:--:|---|---|
| Company lead | 8 | $4,000 | 30% | **$1,200** | $2,800 |
| Self-generated | 8 | $4,000 | 65% | **$2,600** | $1,400 |
| Renewal (self-gen book) | 6 | $3,000 | 30% | **$900** | $2,100 |
| Company lead, closer escalated to 40% | 8 | $4,000 | 40% | **$1,600** | $2,400 |

### A realistic month

8 funded deals at $50K average — 6 company leads, 2 self-generated:

- 6 × $1,200 = $7,200
- 2 × $2,600 = $5,200
- **Take-home: $12,400 for the month.** Commission-only, no cap.

---

## 5.4 Performance escalators — growing your split

Your **company-lead** split climbs with your monthly funded volume:

| Tier | Trigger | Company-lead split |
|---|---|:--:|
| **1 — Base** | Starting rate | **30%** (the Momentum Standard) |
| **2** | Fund **$250K+** in a month (≈5 funded deals) | **35%** |
| **3** | Fund **$500K+** in a month (≈10 funded deals) | **40%** |

Top performers also get first pick of premium live transfers.

Escalators apply to **company-lead** deals funded in the qualifying month and reset monthly.
Self-gen and renewal rates are unaffected. Thresholds are set by management and may be adjusted.

> **How it actually works in the software:** the escalator is a **policy**, not an automatic
> switch. The platform does **not** raise your rate by itself when you cross $250K. **The owner
> raises your rate on your closer record in Admin → Closers.** From that moment, every commission
> created for you uses the new rate. Commissions already created are not retroactively repriced.

---

## 5.5 The draw

A **draw** is a **recoverable advance against your future commissions**. It is not a salary.

- Offered at up to **$2,500/month for the first 90 days** while you build a pipeline.
- Whatever you earn is netted against what you drew. Out-earn the draw and there is nothing to
  recover — which is what happens if you work.
- The draw amount and period are set on your closer record.
- What happens if the draw period ends with an unrecovered balance is a **company-wide policy
  setting** (Platform Config → Closer draw treatment). It defaults to **repayable** — the balance
  is owed back. The alternative is **forgiven** — written off. **Whichever is set when your
  Schedule A is generated is the term you sign.** Check your Schedule A; it's in writing.

---

## 5.6 Clawbacks

If a merchant **defaults inside the funder's clawback window** (typically the first payments/days),
**the funder reverses our commission** — and the corresponding portion of your commission is
**clawed back, or deducted from future commissions**.

This is not a penalty. It is the reason we underwrite honestly: a deal that was never going to
perform costs everyone. Every closer signs a **Clawback Policy Acknowledgment** during onboarding,
and the exact window is written into your agreement.

A clawed-back commission appears on My Earnings in its own **Clawback** group, in red, showing the
amount reversed and **the reason**.

---

## 5.7 When you get paid

> **Commissions are paid within 5 business days after the funder pays MFunding on a funded deal.**
> Not at the point of sale. **We pay when we get paid.**

Payment is by **direct deposit (ACH)** — which is why the Direct Deposit Authorization and the W-9
must be on file before your first payout runs.

---

## 5.8 The approval lifecycle — what the owner runs

The commission is **created automatically** the moment a deal is marked **Funded** with an **amount
funded** on it. It snapshots the closer, their split rate at that moment, the pool, and the company
cut. It starts at **Pending**.

From there, the owner walks it through the **Commissions** dashboard (`/admin/commissions`, super
admin only):

| Step | Status | What it means | The closer is told |
|:--:|---|---|---|
| 1 | **Pending** | Booked, waiting on the owner's sign-off. | — |
| 2 | **Approved** | The owner signed off. Payout queued. | ✉️ *"Commission approved — Deal MF-2026-0013. Your payout is $1,200."* |
| 3 | **Funder Paid** | The funder has paid **us**. The 5-day clock is now running. | — |
| 4 | **Closer Paid** | The money has been sent to the closer. | ✉️ *"Commission paid — your payout of $1,200 has been sent."* |
| 5 | **Completed** | Closed out. | — |

### Putting a commission on hold

At any point before it's paid, the owner can **Hold** a commission. **A reason is required** — it
is not optional, and it is **shown to the closer, verbatim, on their My Earnings page.**

| Action | Status | The closer is told |
|---|---|---|
| **Hold** (reason required) | **On Hold / Unpaid** | ✉️ *"Commission on hold — Deal MF-2026-0013 ($1,200). Reason: [your reason]. We'll follow up."* |
| **Release hold** | back to **Pending** | ✉️ *"Commission hold released — it's back in the payout queue."* |

Every one of those notifications lands in the closer's in-app inbox. Nobody has to guess where
their money is.

---

## 5.9 Things that trip people up

**"I reassigned the deal, why is the commission still pointing at the old closer?"**
Because a commission is a **snapshot**, taken at funding. Reassigning a deal afterwards does **not**
move an existing commission — the platform warns you about this on-screen when you do it. Fix the
payout by hand in Commissions.

**"The deal is funded but there's no commission."**
The deal has no **amount funded** on it. Fill it in; the commission is created immediately.

**"My split changed but my old deal didn't reprice."**
Correct. The rate is captured when the commission is created. Rate changes apply to commissions
created **after** the change.

**"The deal has no closer on it."**
An **unassigned** deal cannot pay a commission and won't appear in anyone's analytics. Assign it —
or, if it's yours, **claim** it from the deal context bar.
