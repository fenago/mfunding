# 3. The Deal Lifecycle — End to End

This is the whole machine, from "a stranger fills out a form" to "the funder wires the money and
we get paid." Every stage name below is the real one used by the platform.

---

## 3.1 Two customer records, one deal

- A **Customer** is the merchant — the business and the owner's contact details.
- A **Deal** is one funding attempt for that customer. A customer can have several deals over time
  (an original advance, then a renewal).
- Every deal carries a **deal number** (e.g. `MF-2026-0013`), a **deal type**, a **stage**, an
  **owning closer**, a **lead source**, and — if it came from a paid channel — a **campaign**.

---

## 3.2 How a lead arrives

Every one of these paths creates a **Customer** and a **Deal** automatically, and the deal is
**auto-assigned to a closer at the moment it is inserted** (see 3.3).

| How it arrives | Lead source | What happens | Deal starts at |
|---|---|---|---|
| **Website application** — merchant fills the form at **`/apply`** | `website_apply` | Creates the customer + MCA deal and pushes the contact into the CRM. | New Lead |
| **Debt-relief intake** — merchant fills the form at **`/debt-relief`** | `website` | Creates a **VCF** deal with the merchant's positions, balances, daily debit and hardship reason captured up front. | New Lead (Distressed) |
| **Live transfer** — a vendor connects a pre-qualified merchant to a closer, live, by phone | `live_transfer` | The vendor's notification email is parsed automatically; a deal is created with the qualification data already attached, marked **hottest**, with a **15-second** speed-to-lead clock. | New Lead |
| **Real-time transfer / appointment** | `realtime_appt` | Same automatic intake. **Hottest**, **60-second** clock. | New Lead |
| **Aged transfer** — an older lead re-contacted | `aged_transfer` | Automatic intake. 30-minute SLA. | New Lead |
| **Purchased web lead** | `web_purchased` | Automatic intake. 5-minute SLA. | New Lead |
| **Cold email reply / landing page** | `cold_email`, `cold_email_landing` | A reply to a cold-email campaign becomes a lead. | New Lead |
| **Bulk CSV import** (UCC lists, aged lists) | varies | Loaded via **Admin → Lead Import**. | New Lead |
| **Referral** | `referral` | Logged manually or via the partner sign-up. | New Lead |
| **Renewal** | `renewal` | A funded deal crosses 40% paydown and becomes renewal-eligible. | Renewal Eligible |
| **Created by hand** | manual | A closer or admin adds it from **Deals → New Deal**. | New Lead |

Each lead source has its own **temperature** (cold → hottest) and its own **speed-to-lead SLA**.
That is what drives the colour, the countdown, and the ranking on **My Day**.

---

## 3.3 Auto-assignment to a closer

**This happens in the database, on every single deal, no matter which door it came in.** There is
no path that skips it.

The strategy is a single **super-admin setting** (**Platform Config → Lead assignment strategy**):

| Strategy | What it does |
|---|---|
| **Round-robin** *(the default)* | Rotates evenly across active closers — the **least-recently-assigned** closer gets the next lead. |
| **Least open deals** | Load-balances: the active closer with the lightest open pipeline gets the lead. |
| **Manual** | Nothing is auto-assigned. Leads arrive unassigned and the owner works the Unassigned queue. |
| **Specific closer** | Every new lead goes to one chosen closer. |

**Who is eligible:** only closers whose status is **active** *and* who have a login linked to their
closer record.

**The safety net:** if no eligible closer can be resolved, **the deal is still saved — just
unassigned.** A lead is never dropped. Unassigned deals surface as a red banner on **Deals** and
via the "⚠ Unassigned only" filter, and an unassigned deal cannot pay a commission or show up in
closer analytics until someone owns it.

Changing the strategy takes effect immediately, on the next lead, with no deploy.

---

## 3.4 The MCA pipeline — the real stages

| # | Stage | What it means | Who moves it |
|---|---|---|---|
| 1 | **New Lead** | Lead exists. Nobody has spoken to them. | — |
| 2 | **Contacted** | You got them on the phone (or they replied). | Closer |
| 3 | **Qualifying** | You're running the qualification — revenue, time in business, amount, industry, existing positions. | Closer |
| 4 | **App Sent** | The application + disclosure + secure upload link have gone out to the merchant. | Closer |
| 5 | **Docs Collected** | Signed application + supporting documents are coming back. | Closer |
| 6 | **Bank Statements** | The last 4 months of statements are in. **This is the #1 place deals die.** | Closer |
| 7 | **Submitted to Funders** | The package went out to 3–5 funders at once. | Closer |
| 8 | **Offer Received** | At least one funder came back with terms. | Closer / auto |
| 9 | **Offer Presented** | The best 2+ offers are in front of the merchant, side by side. | Closer |
| 10 | **Offer Accepted** | The merchant picked one and signed the funder's agreement. | Closer |
| 11 | **Funded** | The money is in the merchant's account. **The commission is created here.** | Closer |
| 12 | **Renewal Eligible** | Paydown has crossed 40%. Back in the pipeline for a second advance. | Auto, from Renewals |

## 3.5 The VCF pipeline — the real stages

| # | Stage | What it means |
|---|---|---|
| 1 | **New Lead (Distressed)** | A merchant drowning in existing MCA debt. |
| 2 | **Hardship Consultation** | The call where you understand what actually happened. |
| 3 | **Positions & Balances** | Every open position, every balance, the combined daily/weekly debit. |
| 4 | **Strategy / Proposal** | The restructure plan and what it saves them. |
| 5 | **Agreement Sent** | The engagement agreement is out for signature. |
| 6 | **Submitted to VCF** | The file is with the restructuring partner. |
| 7 | **Restructure Executed** | Done. The debits are restructured. |
| 8 | **Servicing / Monitoring** | Ongoing. |

## 3.6 The three exits (both pipelines)

| Stage | When to use it |
|---|---|
| **Nurture / Re-engage** | Not now, but not dead. Comes back later. |
| **Declined** | Doesn't qualify, or the funders all passed. |
| **Dead** | Gone. Unreachable, or a hard no. |

A parked deal remembers the last active stage it was in, so **"Bring back"** on the Deals screen
restores it exactly where it was. No confirmation dialog — it's a safe, reversible action.

---

## 3.7 Documents and stips — the leak

More deals die between **App Sent** and **Bank Statements** than anywhere else in the funnel. This
is where the closer earns the money.

**Two rails bring documents back:**

1. **E-signed, automatic.** The **Merchant Funding Application** and the **Broker Compensation
   Disclosure** go out from the CRM as e-signable documents. The merchant fills the fields and
   signs in one flow; the signed PDFs come back and attach to their contact record automatically.
2. **Uploaded, by the merchant.** The **bank statements, photo ID, voided check, and proof of
   ownership** come back through a secure upload link. That link **keeps working** and every new
   submission **adds** to the same file — partial is fine. Get the e-signature, the ID, and the
   voided check while you have them on the phone; chase the statements after.

**The commitment date.** In the Revenue Playbook's docs step there is a field: **"Statements
promised by."** Do not leave it blank. Ask the merchant to name a day, type that day in, and it
becomes your chase clock — the moment it slips, My Day surfaces the deal as an **overdue chase**,
loudly, at the top of the follow-up lane.

**Voided check never blocks anything.** A screenshot of their bank portal satisfies it. Do not
hold a submission for it.

**The one hard gate:** you cannot submit to any funder until the **e-signed application PDF** is
on file in the platform. That single document unblocks every funder at once.

---

## 3.8 Submission → offers → funded

1. **Package it.** Open the deal → the funder step. The platform scores every live funder against
   this deal (product, paper tier, credit, funding range, revenue, time in business) and shows the
   best matches first.
2. **Get a second opinion.** Hit **AI: recommend lenders**. It checks each funder's *hard*
   criteria in code (not by guesswork), cross-checks against bank-statement-verified revenue if
   the statements have been read, and gives you a ranked short-list with reasons and watch-outs.
3. **Pick 3–5 and submit.** One click fans the whole package out to all of them at once. Each
   funder gets their file the way *they* want it (see [08-funder-network.md](./08-funder-network.md)).
4. **Replies come back automatically.** The platform reads each funder's response, works out
   whether it's a decline, a stip request, a question, or an **offer**, and updates the submission.
5. **Log every offer** — amount, factor, term, payment. The board ranks them cheapest-payback-first
   and flags the best value.
6. **Always present 2+.** Put the best two in front of the merchant side by side and let them
   choose. This is the single highest-leverage habit in the job.
7. **Accepted → Funded.** Mark the offer accepted, the funder agreement goes out for signature, and
   when the money lands you move the deal to **Funded** and enter the **amount funded**.

> **Advancing the stage is always a separate, deliberate click.** Submitting to funders does not
> move the stage. Logging an offer does not move the stage. Nothing moves a deal behind your back.

---

## 3.9 The moment money is created

When a deal is marked **Funded** *and* has an **amount funded** on it, the platform **creates the
commission automatically** — the gross pool, the closer's split (using *that* closer's own rates),
and the company's cut. It lands at status **Pending**, waiting on the owner's approval.

If you mark a deal Funded before you know the amount, that's fine — the commission is created the
moment you fill the amount in.

See [05-money-and-commissions.md](./05-money-and-commissions.md) for the math and the payout flow.

---

## 3.10 Renewals

- Renewal candidates are funded deals, sorted **closest to renewal first**.
- The trigger is **paydown percentage**. Milestones: **40%** ("may qualify"), **60%** ("eligible"),
  **75%** ("best terms"), **100%** ("paid off — renew now").
- Update the paydown on the **Renewals** screen. **The moment it crosses 40%, the deal
  automatically flips to Renewal Eligible.** Then hit **Save + push to GHL**, which is what fires
  the renewal outreach sequence.
- A renewal pays **6 points** instead of 8.
- Submit the renewal to the **incumbent funder first** — they already have the payment history.
- A closer can only work renewals if **Renewals enabled** is switched on for them.
