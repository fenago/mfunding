# Momentum Funding — Legal & Compliance Document Templates

**⚠ DRAFT TEMPLATES — every file in this folder is a working draft for attorney review before use. Nothing here is legal advice.**

These templates implement the **"B) Documents to Create"** checklist in
`research/platform_reqs/GHL_Pipeline_And_Automations.md`. They are ~80% drafts intended to be tailored, attorney-reviewed, and (for signable ones) loaded into **GHL Documents & Contracts** for native e-sign. Fill-in placeholders use the form `[CLOSER NAME]`, `[DATE]`, `[COMMISSION %]`, `[COMPANY]`, `[STATE]`, etc.

Already done elsewhere (not in this folder): Closer Comp Offer Sheet (`research/Momentum_Closer_Comp_Offer_Sheet.md`) and VCF own-book call scripts (`research/VCF_Debt_Relief_Call_Scripts.md`).

## Compliance ground rules baked into every doc
- **MCA is never a "loan"** — advance / funding / working capital / purchase of future receivables. Real loan products (term, SBA, LOC, equipment, the VCF FDIC refinance) use standard loan terms.
- **No upfront fees** to merchants — Company is paid by funders/lenders/provider.
- **VCF debt relief:** no guaranteed savings/approval; "**not a law firm**"; substantiate any savings range.
- **No invented statutory language** — state disclosure language is left as attorney-fill placeholders.

---

## Index

### B1 — Closers (1099)
| File | Purpose | Status |
|---|---|---|
| `closer-ic-commission-agreement-scheduleA.md` | Rate sheet (splits, draw, escalators, clawback) to accompany the v2 IC Commission Agreement | **ATTORNEY REVIEW** + set business rates |
| `closer-nda-confidentiality.md` | Confidentiality / NDA for closers | ATTORNEY REVIEW |
| `closer-tcpa-compliance-acknowledgment.md` | TCPA/DNC + product-language + script-adherence sign-off | ATTORNEY REVIEW |
| `closer-code-of-conduct.md` | Do's & Don'ts (never "loan", disclosures, no upfront fees, fraud) | Ready-to-use after light review |
| `closer-clawback-policy-acknowledgment.md` | Explains/acknowledges commission clawbacks | ATTORNEY REVIEW |
| `closer-onboarding-checklist-sop.md` | Onboarding checklist + training SOP | **Ready-to-use** (operational) |
| `closer-direct-deposit-form.md` | ACH authorization for commission payments | **Ready-to-use** (light review) |

### B2 — MCA Merchant-Facing
| File | Purpose | Status |
|---|---|---|
| `mca-broker-fee-disclosure.md` | "Paid by funder, no upfront fees" broker disclosure | ATTORNEY REVIEW |
| `mca-bank-and-credit-authorization.md` | Bank-statement access + soft-pull consent + Plaid consent | **ATTORNEY REVIEW (FCRA/GLBA/Plaid)** |
| `mca-tcpa-consent-language.md` | TCPA opt-in / consent language for forms & SMS | ATTORNEY REVIEW |
| `mca-state-disclosures-STRUCTURE.md` | **Structure/placeholder only** — lists CA, NY, VA, UT, FL, CT, GA, KS, TX, MO; attorney inserts statutory text | **MANUAL / ATTORNEY (statutory)** |
| `mca-funder-submission-cover-sheet.md` | Internal/funder-facing submission package template | **Ready-to-use** (operational) |
| `mca-offer-comparison-sheet-template.md` | Side-by-side offer comparison (ties to Offer Received automation) | **Ready-to-use** (light review) |

### B3 — VCF Debt Relief
| File | Purpose | Status |
|---|---|---|
| `vcf-debt-relief-disclosures.md` | No upfront fees, "not a law firm", claim-substantiation, no guarantees | **ATTORNEY REVIEW** |
| `vcf-referral-noncircumvention-terms.md` | Defines Company's referral commission + non-circumvention | ATTORNEY REVIEW + **needs VCF rate card** |
| `vcf-tcpa-consent-language.md` | TCPA consent for distressed-merchant outreach | ATTORNEY REVIEW |

### B4 — Company Foundational
| File | Purpose | Status |
|---|---|---|
| `master-compliance-tcpa-dnc-policy.md` | TCPA + DNC + litigator-scrub SOP | ATTORNEY REVIEW |
| `data-security-policy.md` | Data handling/security (PII, financial data, Plaid, retention, incident response) | ATTORNEY/SECURITY REVIEW |

---

## CODE vs MANUAL / external-input notes
- **Ready-to-use (operational, minimal legal exposure):** onboarding SOP, direct-deposit form, funder submission cover sheet, offer comparison sheet, code of conduct. Use after a light internal review.
- **Require attorney review before any external use (regulated content):** Schedule A, NDA, both TCPA acknowledgments/consents, broker fee disclosure, bank & credit authorization, clawback acknowledgment, VCF disclosures, VCF referral terms, master compliance policy, data security policy.
- **Cannot be completed in code (external input required):**
  - **State statutory disclosure language** → `mca-state-disclosures-STRUCTURE.md` (attorney supplies CA/NY/VA/UT/FL/CT/GA/KS/TX/MO text).
  - **VCF rate card & white-label/partner agreement** → needed to finalize `vcf-referral-noncircumvention-terms.md` (get from Value Capital Funding in writing).
  - **E&O / GL insurance** → purchase (referenced in onboarding/compliance; MANUAL).
  - **W-9** → standard IRS form, collected manually (not drafted here).
  - **Funder/ISO agreements** → each funder provides their own paper (MANUAL).

## Top documents that MOST need attorney review (prioritize)
1. `mca-state-disclosures-STRUCTURE.md` — statutory disclosures (legal exposure if wrong; placeholders must be filled by counsel).
2. `mca-bank-and-credit-authorization.md` — FCRA permissible purpose, GLBA, ECOA, and Plaid end-user requirements.
3. `vcf-debt-relief-disclosures.md` — "not a law firm", no-guarantee, claim-substantiation, and state debt-relief licensing.
4. `master-compliance-tcpa-dnc-policy.md` — TCPA one-to-one consent, DNC, and state calling-law accuracy drives all outreach.
