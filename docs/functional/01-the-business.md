# 1. What the Business Is

**Agentic Voice Inc. d/b/a MFunding.net | Momentum Funding**

---

## 1.1 We are a broker, not a lender

MFunding is an **ISO** — an Independent Sales Organization. In plain English: a **brokerage**.

- A **merchant** (a small business) needs working capital.
- A **funder** has the capital, underwrites the deal, and wires the money.
- **We** find the merchant, qualify them, package the file, and get it in front of the right
  funders. The funder pays us a commission — called **points** — on every deal that funds.

**We never fund a deal with our own money.** We are paid by the funder, not by the merchant.

> ### The rule that has no exceptions
> **We never charge the merchant an upfront fee.** Our compensation comes from the funder. If a
> merchant is ever asked to pay us to get funded, something has gone badly wrong.

### Where everyone sits

```
FUNDER            has the capital, underwrites, wires the money
  │  pays points to
ISO / BROKER      ← that's us (MFunding / Momentum Funding)
  │  pays a split to
CLOSER            1099 independent contractor sales rep working our leads
```

A **Sub-ISO** (a smaller broker submitting through our funder network, where we keep an override)
is supported in the platform but is not in active use today.

---

## 1.2 The two product lines

Everything in the platform is one of these two. A deal carries a **deal type**, and the deal type
decides which pipeline it runs on, which stages it moves through, and — critically — **which words
you are allowed to use**.

| | **MCA** | **VCF** |
|---|---|---|
| **What it is** | A **Merchant Cash Advance** — the funder *purchases a portion of the merchant's future receivables* at a discount. | **Debt relief / restructuring.** The merchant is buried in existing MCA debt; we get their positions restructured into something survivable. |
| **Who it's for** | A healthy-enough business that needs capital fast. | A distressed business being crushed by daily/weekly debits from multiple MCAs. |
| **How the merchant finds us** | `/apply` on the site, live transfers, real-time leads, aged leads, cold email, campaigns. | `/debt-relief` on the site, or a closer identifying a distressed merchant. |
| **How we get paid** | Points from the funder on the funded amount. | Fee on the restructure. |
| **Pipeline** | 11 stages (New Lead → Funded), then Renewal Eligible. | 8 stages (New Lead (Distressed) → Servicing). |
| **Language rule** | ⚠️ **NEVER the word "loan."** | Standard debt/restructuring language is fine. |

The platform also supports these other deal types on the same MCA pipeline: **Term Loan**, **Line
of Credit**, **SBA Loan**, **Equipment Financing**. Those *are* real loans — for those, normal
lending vocabulary is correct and expected.

---

## 1.3 The compliance language rules

These are not stylistic preferences. They are the difference between a compliant brokerage and a
regulatory problem. Every screen, every email, every SMS, every script, and every word you say on
a live call has to follow them.

### Rule 1 — An MCA is **not** a loan. Ever.

An MCA is a **purchase of future receivables**. It is not credit, it is not lending, there is no
interest rate, and there is no borrower.

| ❌ Never say | ✅ Say instead |
|---|---|
| loan | advance, funding, working capital, capital |
| borrow / borrower | receive an advance / merchant |
| lender | funder, funding partner |
| interest rate / APR | factor rate |
| monthly payment | remittance, daily/weekly debit, retrieval |
| loan amount | advance amount, funded amount |
| repay / repayment | remit, payback |
| approved for a loan | approved for an advance |

This rule is baked into the Closer Code of Conduct that every closer signs (see
[07-closer-onboarding.md](./07-closer-onboarding.md)).

### Rule 2 — When the product **is** a loan, talk like it

If the deal type is Term Loan, SBA, Line of Credit, or Equipment Financing, then "loan,"
"interest rate," and "monthly payment" are the *correct* terms. **Know which product you are
selling before you open your mouth.** The error goes both ways.

### Rule 3 — When you don't know the product yet, stay neutral

Anything that goes out before the product is decided — a first-touch email, a landing page, a
cold-email sequence, an SMS — must use product-neutral language: **"funding," "capital,"
"business financing."** Never a word that commits you to a product you haven't chosen.

### Rule 4 — "No credit impact" is a narrow claim

Filling out our application does **not** hit the merchant's credit. Only a formal submission to a
funder can. Say it precisely; don't blur it into "this will never affect your credit."

### Rule 5 — State disclosures

Several states require a specific commercial-financing disclosure, and the required disclosure is
**different for an MCA than for a loan**. The templates live on the **Compliance** screen
(`/admin/compliance`, super admin). If you are working a deal in one of those states, the correct
disclosure for **that product type** must go out.

### Rule 6 — TCPA

Consent, quiet hours, and opt-outs are not optional. Every closer signs a TCPA & Regulatory
Compliance Acknowledgment before they take a single call. Consent is recorded in the platform when
a merchant submits a form.

---

## 1.4 What "good" looks like

The whole business runs on one ratio:

> **Cost to acquire a funded deal < $1,500, and average commission > $4,000.**

That's it. Everything on the analytics and campaign screens exists to keep those two numbers on
the right side of each other. The single number the owner watches hardest is **cost per funded
deal**, target **under $1,500**.
