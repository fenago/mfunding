# 7. Closer Onboarding — The Document Package

**Screen:** `/admin/closer-docs` — **Closer Onboarding & Documents**

Two audiences, one screen:

- **The owner / an admin** sees every closer's checklist, who still owes what, and the **send**
  button.
- **A closer** sees **only their own documents** and their own signing status. Not because the menu
  hides other people's — because the database will not return them.

---

## 7.1 The nine documents

Every closer signs or returns all nine before they take a live call.

| # | Document | What it is | Action | How it's done |
|:--:|---|---|---|---|
| 1 | **Independent Contractor Commission Agreement (v2)** | The master 1099 agreement. Everything else hangs off it. | SIGN | **Send manually** |
| 2 | **Schedule A — Compensation Rate Sheet** | The splits, the draw, the payout timing. Attaches to #1. | SIGN | **E-sign in app** |
| 3 | **Confidentiality & Non-Disclosure Agreement** | Protects the funder network, merchant data, and pricing. | SIGN | **E-sign in app** |
| 4 | **TCPA & Regulatory Compliance Acknowledgment** | Consent, quiet hours, opt-outs, script adherence. | SIGN | **E-sign in app** |
| 5 | **Closer Code of Conduct** | The do's and don'ts on live calls. **Includes the MCA-is-not-a-loan rule.** | SIGN | **E-sign in app** |
| 6 | **Clawback Policy Acknowledgment** | What happens to commission when a funded deal defaults or unwinds. | SIGN | **E-sign in app** |
| 7 | **IRS Form W-9** | Required before the first payout. | COLLECT | **External form** (irs.gov) |
| 8 | **Direct Deposit (ACH) Authorization** | Where the commission actually lands. **No payout runs without it.** | COMPLETE | **Secure upload** |
| 9 | **State licensing / registration proof** | Only if their target states require it. Otherwise mark **N/A**. | COLLECT | **External** (issued by the state) |

**Reference only — received, never signed:** the **Closer Compensation Offer Sheet** (sent during
recruiting) and the **Closer Onboarding Checklist & Training SOP** (the full ramp plan; this
document package is Phase 0 of it).

### Why some are e-signed and some aren't

| Delivery | Which | Why |
|---|---|---|
| **E-sign in app** (5 docs) | #2, #3, #4, #5, #6 | These are ours. They're merged with the closer's real values, frozen, emailed, and signed in the app. This is the real flow. |
| **Send manually** (1 doc) | #1, the master agreement | It's a .docx — it can't be merged or rendered in the browser, so it's excluded from the e-sign package. Download it, fill it in, and send it for signature by hand. **Schedule A must travel with it.** |
| **External form** (2 docs) | #7 W-9, #9 licensing | Somebody else's form. We link out, collect it back, and mark it received. |
| **Secure upload** (1 doc) | #8 Direct Deposit | The closer fills in **their own bank details**. Full account and routing numbers must never go through plain email, so this one comes back via secure upload — never e-signed. |

---

## 7.2 Before you can send anything: company terms

At the top of the screen, under **"Company terms used in every document"** (super admin), fill in:

| Field | Currently set to |
|---|---|
| **Company legal name** | **Agentic Voice Inc. d/b/a MFunding.net \| Momentum Funding** |
| **Company signatory** (name, title) | *must be set* |
| **Governing-law state** | Florida |
| **Clawback window (days)** | *must be set* |
| **Renewal override %** | *must be set* |
| Payment method | direct deposit (ACH) |

**If any of these are blank, the send is blocked.** The screen shows an amber
*"⚠ incomplete — blocks sending"* badge until they're filled.

The **draw treatment** (repayable vs. forgiven) is not here — it's a policy flag on **Platform
Config**, and it has a safe default (**repayable**), so it never blocks a send.

---

## 7.3 Sending the package — the procedure

1. Open **`/admin/closer-docs`**.
2. Confirm **Company terms** are complete (no amber badge).
3. Under **"Who has signed what,"** click the closer to expand their checklist.
4. The **e-signable documents they haven't signed yet are pre-ticked**. Adjust if you want.
5. Click **"Email N docs to [name] to e-sign."**
6. One email goes to their address with **a signing link per document**.

### What happens under the hood, and why it matters

- Each document is **merged** with the real values — the company name, the signatory, their name,
  their splits, their draw — then **frozen**. What they sign is exactly what you sent. It cannot
  drift afterwards.
- **If any selected document still has an unfilled field, NOTHING is sent.** You get a red panel
  listing exactly which field, on which document, and where to fix it — *"Company terms above"* or
  *"[name]'s closer record."*

> **A closer must never receive a contract with a raw `[BRACKET]` in it.** The platform enforces
> that; it will not let you send a half-filled contract.

---

## 7.4 How a closer signs

1. They get the email and click the link — or open **Closer Documents** in the app, where anything
   waiting says **"Read & sign."**
2. They read the document in full.
3. At the bottom they **type their full legal name** and tick the consent box:

   > *"I have read this document in full and I agree to be bound by it. I intend my typed name below
   > to be my legal electronic signature."*

4. Done. The platform records their typed name, the consent sentence, **a snapshot and fingerprint
   of the exact text they agreed to**, the timestamp, and their IP address and browser — captured
   on the server, not from their machine.

**The signature ledger is append-only.** Nothing can edit or delete a signature after the fact, by
design. And **a closer cannot mark their own paperwork as signed** — the only way a document becomes
"signed" is by actually signing it.

---

## 7.5 Recording the manual documents

For the four that aren't e-signed (#1 the agreement, #7 W-9, #8 direct deposit, #9 licensing), the
owner records the status by hand from the dropdown on the closer's checklist:

| Status | Meaning |
|---|---|
| **Not sent** | Nothing has gone out. |
| **Sent** | It's with them, awaiting return. |
| **Collected / signed** | You have it. |
| **N/A** | Doesn't apply (used for #9 when no target state requires licensing). |

You cannot use this dropdown to fake an e-signature. It only appears on the documents that aren't
e-signable.

---

## 7.6 Tracking

The closer's row shows **"N/9 signed"** and, when relevant, an amber **"N awaiting signature."**
It turns green when everything is resolved (signed **or** N/A).

**Nobody takes a live call until their package is complete.** Two things in particular gate real
money:

- **W-9 + Direct Deposit Authorization** — no payout runs without both.
- **TCPA Acknowledgment + Code of Conduct** — no dialling without both.
