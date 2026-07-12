-- ============================================================================
-- Real merchant document bundle — replaces the placeholder e-sign template with
-- the 4 counsel-cleared (2026-07-11) documents the GHL email path sends.
-- Applied live via management API 2026-07-12.
--
-- Sources (verbatim; see research/legal/ + research/platform_reqs/):
--   1. mca-funding-application            — 7-section layout (application-field-link-map.md)
--                                            + VERBATIM Lendini authorization clause
--                                            (mca-application-authorization-clause.md) + [STATE_DISCLOSURE]
--   2. mca-broker-compensation-disclosure — mca-broker-fee-disclosure.md
--   3. mca-bank-credit-authorization      — mca-bank-and-credit-authorization.md
--   4. mca-tcpa-contact-consent           — mca-tcpa-consent-language.md
--
-- Token contract (see merchantDocMerge.ts):
--   HARD (block send): [COMPANY] [BUSINESS NAME] [MERCHANT/BUSINESS NAME]
--       [MERCHANT NAME] [SIGNER NAME] [DATE]
--   SOFT (value-or-blank): [BUSINESS ADDRESS] [BUSINESS CITY STATE ZIP]
--       [BUSINESS PHONE] [BUSINESS EMAIL] [CELL PHONE] [OWNER EMAIL] [EIN]
--       [ENTITY TYPE] [INDUSTRY] [MONTHLY REVENUE] [AMOUNT REQUESTED]
--       [USE OF FUNDS] [TIME IN BUSINESS] [TITLE]
--   CONSTANT: [PHONE/EMAIL] [Privacy Policy] [Terms]
--   INJECTED: [STATE_DISCLOSURE]  (application only)
--
-- VERBATIM NOTES:
--   * The authorization clause hardcodes "Agentic Voice Inc dba Momentum Funding"
--     — that entity string is kept as-is (NOT tokenized to [COMPANY]), and its two
--     vendor typos ("request and receive and investigative reports"; "waives and
--     releases and claims") are PRESERVED per Lendini source.
--   * Internal editorial scaffolding present in the source .md files — the top
--     usage blockquotes, sections/lines explicitly marked "(internal)" or
--     "Note for attorney"/"Attorney to confirm", and the "— Merchant-Facing"
--     subtitle tags — is OMITTED from these merchant-signed instruments. All
--     merchant-facing legal/consent language is verbatim; only layout markdown differs.
--
-- MCA = purchase of future receivables, never a "loan".
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Retire the placeholder (do NOT delete — a sent document references it).
-- ---------------------------------------------------------------------------
update public.merchant_doc_templates
set active = false, updated_at = now()
where slug = 'mca-application-authorization';

-- ---------------------------------------------------------------------------
-- 1. MCA Funding Application (7-section layout + authorization clause + disclosure)
-- ---------------------------------------------------------------------------
insert into public.merchant_doc_templates (slug, name, product_type, sort_order, body_md)
values (
  'mca-funding-application',
  'MCA Funding Application',
  'mca',
  1,
  $md$# MCA Funding Application
### [COMPANY]

**Applicant / Business:** [BUSINESS NAME]
**Authorized signer:** [SIGNER NAME]
**Date:** [DATE]

This is your application for working capital through a purchase of your business's future receivables (a merchant cash advance). A merchant cash advance is **not a loan**; it is the purchase of a portion of your future sales. Fields we already have on file are filled in below; please review them and complete any blanks.

## Section 1 — Business Information

Legal Business Name: [BUSINESS NAME]
DBA (Doing Business As): __________________
Business Address: [BUSINESS ADDRESS]
City, State, ZIP: [BUSINESS CITY STATE ZIP]
Business Phone: [BUSINESS PHONE]
Business Email: [BUSINESS EMAIL]
Website: __________________
Federal Tax ID (EIN): [EIN]
Date Business Established: __________________  (Time in business on file: [TIME IN BUSINESS])
Type of Entity: [ENTITY TYPE]
Industry: [INDUSTRY]

## Section 2 — Owner / Guarantor

Full Name: [SIGNER NAME]
Title: [TITLE]
Ownership %: __________________
Social Security Number: __________________
Date of Birth: __________________
Driver's License #: __________________
Home Phone: __________________
Cell Phone: [CELL PHONE]
Home Address: __________________
City, State, ZIP: __________________
Email Address: [OWNER EMAIL]

**Additional Owner (if any)**
Full Name: __________________
Title: __________________
Ownership %: __________________
Social Security Number: __________________
Date of Birth: __________________
Cell Phone: __________________

## Section 3 — Funding Request

Amount Requested: [AMOUNT REQUESTED]
Use of Funds: [USE OF FUNDS]
How Soon Do You Need Funding: __________________

## Section 4 — Business Financials

Average Monthly Revenue: [MONTHLY REVENUE]
Average Monthly Deposits: __________________
Annual Gross Revenue: __________________
Number of Employees: __________________
Do you have outstanding advances? __________________
Current positions (funder / original amount / balance / payment):
- __________________
- __________________
- __________________
Bankruptcy? (Y/N; year; chapter; status): __________________
Tax liens or judgments? (Y/N; amount; payment plan): __________________

## Section 5 — Bank Account

Bank Name: __________________
Account Holder Name: __________________
Routing Number: __________________
Account Number: __________________
Account Type (checking / savings): __________________
How long with this bank: __________________

## Authorization & Consent

The Merchant and Owner(s)/Officer(s) identified above (individually, and "Applicant") each represents, acknowledges and agrees that (1) all the information and documents provided to Agentic Voice Inc dba Momentum Funding and their representatives, ("Representative") including credit card processor statements are true, accurate and complete, (2) Applicant will immediately notify Representative of any change in such information or financial condition, (3) Applicant authorizes Representative to disclose all information and documents that Representative may obtain including credit reports to the other persons or entities (collectively, "Assignees") that may be involved with or acquire commercial funding having daily repayment features or purchases of future receivables, including Merchant Cash Advance transactions, including without limitation the application therefor (collectively, "Transactions"), and each Assignee is authorized to use such information and documents, and share such information and documents with other Assignees, in connection with potential Transactions, (4) Representative and each Assignee will rely upon the accuracy and completeness of such information and documents, (5) Representative, Assignees, and each of their representatives, successors, assigns and designees (collectively, "Recipients") are authorized to request and receive and investigative reports, credit reports, statements from creditors or financial institutions, verification information, or any other information that a Recipient deems necessary, (6) Applicant waives and releases and claims against Recipients and any other information-providers arising from any act or omission relating to the requesting, receiving, or release of information, (7) each Owner/Officer represents that he or she is authorized to sign this form on behalf of Merchant and (8) Applicant consents to receive marketing calls and texts from Representative and its affiliates or assigns using automated technology. Consent is not a condition of funding. A copy of this authorization may be accepted as an original. Applicant further agrees to the use of electronic signatures for the execution of this document, including, but not limited to, the use of specialized electronic signature platforms.

## State Disclosure

[STATE_DISCLOSURE]

## Signatures

By typing my full legal name and confirming below, I, [SIGNER NAME], certify that the information in this application is true and complete and I agree to the Authorization & Consent above on behalf of [BUSINESS NAME].

Merchant signature (typed at signing): __________________
Print Name: [SIGNER NAME]
Title: [TITLE]
Date: [DATE]
$md$
)
on conflict (slug) do update
  set name = excluded.name, product_type = excluded.product_type,
      sort_order = excluded.sort_order, body_md = excluded.body_md,
      active = true, version = public.merchant_doc_templates.version + 1,
      updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. Broker Compensation Disclosure (verbatim: mca-broker-fee-disclosure.md)
-- ---------------------------------------------------------------------------
insert into public.merchant_doc_templates (slug, name, product_type, sort_order, body_md)
values (
  'mca-broker-compensation-disclosure',
  'Broker Compensation Disclosure',
  'mca',
  2,
  $md$# Broker Compensation Disclosure
### [COMPANY] (Momentum Funding)

**Merchant / Business:** [MERCHANT/BUSINESS NAME]
**Date:** [DATE]

Please read this disclosure before proceeding with your funding request.

## Who We Are
[COMPANY], d/b/a Momentum Funding, is an **Independent Sales Organization (ISO) / broker**. We help business owners find working capital and business-financing options by packaging your request and submitting it to funders and lenders in our network. **We are not the funder/lender** — we do not provide the capital ourselves.

## How We Are Paid — No Upfront Fees to You
- **You pay us no upfront fees.** There is no application fee, no processing fee, and no out-of-pocket cost to you for our brokerage services.
- We are compensated by the **funder or lender** that funds your transaction, typically as a commission ("points") calculated as a percentage of the amount funded.
- This commission is paid to us **by the funder/lender**, separate from the amounts you agree to pay under your funding agreement with that funder/lender.

## What This Means for You
- Our compensation does not add a separate charge billed to you by us. The full cost of your transaction (for an MCA: the purchase price, purchased amount/payback, factor rate, and retrieval rate; for a loan product: rate, fees, and terms) is set out in **your agreement with the funder/lender** — read it carefully before signing.
- Because we receive a commission from the funder/lender, we have a financial interest in your transaction closing. We work to present suitable options and, where available, **more than one offer** so you can compare.
- We do **not** guarantee approval, a specific amount, a specific rate or factor, or funding timing.

## Product Note
For a **Merchant Cash Advance (MCA)**, the product is a **purchase of your future receivables — it is not a loan.** For actual loan products (term loan, SBA, line of credit, equipment financing), standard loan terms and disclosures apply and will be provided by the lender.

## Credit
Reviewing your options generally does **not** affect your credit. Only a **formal submission to a funder/lender** that involves a credit inquiry may affect credit, and only with your authorization (see the Bank & Credit Authorization).

## State Disclosures
Depending on your state, you may be entitled to additional **commercial-financing disclosures** provided separately at or before the time an offer is presented. (See the State Disclosures document.)

---

**Acknowledgment.** I have read and understand how [COMPANY] is compensated and that I owe no upfront fees for its brokerage services.

Merchant signature: __________________  Print name: [SIGNER NAME], [TITLE]  Date: [DATE]
$md$
)
on conflict (slug) do update
  set name = excluded.name, product_type = excluded.product_type,
      sort_order = excluded.sort_order, body_md = excluded.body_md,
      active = true, version = public.merchant_doc_templates.version + 1,
      updated_at = now();

-- ---------------------------------------------------------------------------
-- 3. Bank Verification & Credit Authorization (verbatim: mca-bank-and-credit-authorization.md)
--    Bottom "Note for attorney" line omitted (internal editorial annotation).
-- ---------------------------------------------------------------------------
insert into public.merchant_doc_templates (slug, name, product_type, sort_order, body_md)
values (
  'mca-bank-credit-authorization',
  'Bank Verification & Credit Authorization',
  'mca',
  3,
  $md$# Bank Verification & Credit Authorization (incl. Plaid Consent)
### [COMPANY] (Momentum Funding)

**Merchant / Business:** [MERCHANT/BUSINESS NAME]
**Authorized signer:** [SIGNER NAME], [TITLE]
**Date:** [DATE]

By signing below, I authorize the following in connection with my request for business funding.

## 1. Bank Statement & Transaction Access
I authorize [COMPANY] to obtain, review, and share with prospective funders/lenders my business bank account information, including **3–6 months (or more) of bank statements and transaction history**, for the purpose of evaluating and submitting my funding request.

## 2. Plaid Consent (Instant Bank Verification)
I understand [COMPANY] uses **Plaid Inc.** to securely connect to my financial institution and retrieve account and transaction data. By connecting my account via Plaid Link:
- I authorize my financial institution to share account, balance, and transaction data with Plaid and [COMPANY];
- I understand Plaid's handling of my data is governed by **Plaid's own privacy policy and end-user agreement**, which I should review;
- I may revoke this access at any time by contacting [COMPANY] and/or disconnecting through Plaid, though data already shared for submission may have been provided to funders.

## 3. Credit Authorization
I authorize [COMPANY] and prospective funders/lenders to obtain credit and background information about my business and, where applicable, about me personally as owner/guarantor, to evaluate my request.
- I understand that **reviewing options with [COMPANY] generally does not affect my credit** (soft inquiry / no inquiry).
- I understand a **formal submission to a funder/lender may involve a hard credit inquiry that can affect credit**, and this occurs only with this authorization.

## 4. Sharing With Funders
I authorize [COMPANY] to share my application, bank data, credit information, and supporting documents (stips) with funders/lenders in its network for the purpose of obtaining offers on my behalf.

## 5. Accuracy & Data Handling
I certify the information I provide is true and accurate. I understand my data will be handled per [COMPANY]'s Data Security Policy and applicable law, and stored in Company-approved systems.

## 6. Scope & Revocation
This authorization is effective on the date signed and remains in effect for the duration of my funding request and any resulting transaction, unless I revoke it in writing. Revocation does not affect actions already taken in reliance on it.

---

I have read and agree to this Bank Verification & Credit Authorization.

Merchant signature: __________________  Print name: [SIGNER NAME], [TITLE]  Date: [DATE]
$md$
)
on conflict (slug) do update
  set name = excluded.name, product_type = excluded.product_type,
      sort_order = excluded.sort_order, body_md = excluded.body_md,
      active = true, version = public.merchant_doc_templates.version + 1,
      updated_at = now();

-- ---------------------------------------------------------------------------
-- 4. TCPA / Contact Consent (verbatim consent language: mca-tcpa-consent-language.md)
--    Top usage blockquote, "Required Operational Practices (internal)" section,
--    and bottom attorney note omitted (internal editorial scaffolding). The
--    Short/Expanded/SMS consent language is verbatim (blockquote markers dropped).
-- ---------------------------------------------------------------------------
insert into public.merchant_doc_templates (slug, name, product_type, sort_order, body_md)
values (
  'mca-tcpa-contact-consent',
  'TCPA / Contact Consent',
  'mca',
  4,
  $md$# TCPA / Contact Consent
### [COMPANY] (Momentum Funding)

**Merchant / Business:** [MERCHANT/BUSINESS NAME]
**Authorized signer:** [SIGNER NAME], [TITLE]
**Date:** [DATE]

## Consent to Contact
By providing my phone number and checking this box, I agree that [COMPANY] (Momentum Funding) and its representatives may contact me at the number provided — including by **autodialer, prerecorded/artificial voice, SMS text, and email** — about business funding and related offers. **Consent is not a condition of any purchase or funding.** Message and data rates may apply; message frequency varies. Reply **STOP** to opt out of texts, **HELP** for help. I also agree to the [Privacy Policy] and [Terms].

## Expanded Consent
By submitting this request, I represent that I am the business owner or an authorized representative and that the contact information provided is mine. I consent to receive communications from [COMPANY], its affiliates, and the funders/lenders to whom my request is submitted, regarding my funding request and related products, at the phone number(s) and email provided, including via **automatic telephone dialing systems, prerecorded or artificial voice messages, SMS/MMS text messages, and email**, even if my number is on a Do-Not-Call list. **I understand consent is not required to obtain a quote or funding** and I may revoke it at any time. To stop texts, reply **STOP**; to stop calls, tell the representative or contact [PHONE/EMAIL]. Message and data rates may apply.

## SMS Program Disclosure
[COMPANY] SMS: You'll receive messages about your funding request and offers. Msg frequency varies. Msg & data rates may apply. Reply **STOP** to cancel, **HELP** for help. Carriers are not liable for delayed/undelivered messages. See [Privacy Policy] and [Terms].

---

I have read and agree to this Contact Consent.

Merchant signature: __________________  Print name: [SIGNER NAME], [TITLE]  Date: [DATE]
$md$
)
on conflict (slug) do update
  set name = excluded.name, product_type = excluded.product_type,
      sort_order = excluded.sort_order, body_md = excluded.body_md,
      active = true, version = public.merchant_doc_templates.version + 1,
      updated_at = now();
