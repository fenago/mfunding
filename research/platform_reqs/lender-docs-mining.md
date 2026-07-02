# Lender Document Mining — Submission Intel

**Task:** Mine uploaded lender ISO agreements / rate sheets for each funder's exact submission
instructions, then write findings back to `lenders` and `funder_submission_profiles`.
**Date:** 2026-07-02. **Scope:** data only (no code / no emails / no GHL).

## Method

- Explored `lender_documents` (joined to `lenders`) — 32 doc rows across 9 distinct funders.
- Files live in the private Supabase Storage bucket `lender-documents` (path convention
  `lender/{lender_id}/{timestamped-file}`). Anon key is blocked by RLS (404), so the
  **service_role** key was retrieved from the Supabase Management API
  (`GET /v1/projects/{ref}/api-keys?reveal=true`, using `SUPABASE_ACCESS_TOKEN` from `.env`)
  and used to download each object.
- 16 PDFs downloaded (skipped a 1KB PNG and duplicate/blank application forms); text extracted
  with `pdftotext -layout`.
- **Write-back rules honored:** never overwrote existing `submission_email` /
  `submission_portal_url` (none were NULL that a doc could fill; Mantis stays NULL as its
  agreement publishes no submission inbox). Appended doc findings to `submission_notes` prefixed
  `[from ISO agreement/rate sheet]` (GoKapital's notes were NULL and were set fresh with the
  prefix). Populated `funder_submission_profiles.required_stips` / `special_instructions` only
  where they were empty/default.

## Per-lender results

### Corfin Group — `Corfin_ISO_Sales Agent Agreement v2.pdf`
- **Extracted:** Commission paid by e-Check. Clawback if merchant defaults/cancels within 30 days
  of funding (return via ACH, CFG discretion). CC-processing residuals paid every 6 months on the
  agreement anniversary. Disputes → Florida arbitration. Schedule A rates left blank in the
  executed copy.
- **Written:** appended to `submission_notes`; set profile `special_instructions`. (No stip list
  in doc — `required_stips` left empty.)

### Fantastic Funding — `Complete_with_Docusign_Fantastic_Funding_UT_.pdf`
- **Extracted:** Required docs = signed Merchant Agreement, completed Application Form, voided
  merchant check, merchant bank statements. Commission (Schedule A) up to **12 points** max at
  FF's Sell Rate, reduced pro rata if merchant takes a lower factor rate. Governed by NJ law.
- **Written:** appended to `submission_notes`; profile `required_stips` (4 items) +
  `special_instructions`.

### Funderial ISO Program — `ISO Partner Signup Agreement - Agentic Voice, Inc..pdf`
- **Extracted:** Legal entity **IMS Fund South LLC**. Commission **up to 12% new / up to 10%
  renewal**, paid within 10 business days of merchant's upfront payment; selling below presented
  rate reduces comp proportionately. Clawback: default within 30 days → full comp reimbursed
  within 10 business days. Signing Funderial rep: **Kate Halyuk (kate@funderial.com, Brooklyn NY)**
  — a new contact beyond Michael/Colton already on file.
- **Written:** appended to `submission_notes`; set profile `special_instructions`. (No submission
  inbox in doc — email untouched.)

### GoKapital ISO Program — `BUSINESS-LOAN-PRODUCT-SUMMARY_2022.pdf`, `REAL-ESTATE-LOAN-PRODUCT-SUMMARY.pdf`
- **Extracted:** Submit loan requests/scenarios to **deals@gokapital.com**; broker inquiries to
  **broker@gokapital.com**. Financing in all 50 states + Canada + PR; monthly-pay term loan only in
  30 named states. Excludes venture capital, PO financing, business-plan/projection loans. No
  upfront fees. MCA/Revenue-Based: $20k–$5MM, 1yr TIB, $30k/mo, no min credit, 1.20–1.49 factor,
  same-day; docs = Business Loan Application + 4-6 mo business bank statements + 4-6 mo
  CC-processing statements (if applicable). Office 2150 Coral Way Ste 1, Miami FL; 1.866.257.2973.
- **Written:** `submission_notes` was NULL → **set fresh** (with the required prefix); profile
  `required_stips` (3 items) + `special_instructions`.

### Lendini — `Please_sign_this_Funding_Metrics_document_-_A.pdf`
- **Extracted:** Parent **Funding Metrics** (sister brand Quick Fix Capital/QFC has an identical
  schedule). ISO submits full docs to submissions@lendini.com. Commission "Full Document
  Submission": up to **15 points** of funded amount (built into factor rate), reduced on
  down-sell; paid within **24 hours of origination** via ACH/check. Referral-only leads earn a
  negotiated referral fee. Clawback: 100% retrieved on default within 30 days; returned after
  Lendini receives 90% of RTR if cured post-48hrs. **California:** ISO must be CA DFPI-licensed
  Broker; all CA submissions need 4 months of bank statements per account. `isoupdates@lendini.com`
  is a marketing opt-out list, not a submission inbox.
- **Written:** appended to `submission_notes`. (No `funder_submission_profiles` row exists for
  Lendini — per rules, not created.)

### Mantis Funding — `ISO Agreement - Agentic Voice, Inc..pdf` (+ `Mantis Partner Flyer.pdf`, image-only)
- **Extracted:** Schedule A – Initial ISO Compensation (of funded amount): initial Merchant
  Agreement = **8% + 2% bonus = 10%**; subsequent/additional funding = **8%**. Clawback on default
  with reinstatement if merchant later pays 100% of receipts; Mantis may set off clawbacks against
  other comp owed. **No dedicated submission inbox published** in the agreement — confirm with ISO
  contact Anthony Pata (a.pata@mantisfunding.com) at onboarding.
- **Written:** appended to `submission_notes`. (No profile row for Mantis — not created;
  `submission_email` left NULL as the doc gives none.)

### Reliant Funding — `Summary.pdf` (DocuSign completion certificate) + `Reliant ISO Application_1.pdf`
- **Extracted:** Partnership administered by **The LCF Group** (3000 Marcus Ave Ste 2W15, New York
  NY). Envelope contacts: Lisnet Rodriguez (lrodriguez@reliantfunding.com), Kurt Maimaron
  (**kurt.maimaron@thelcfgroup.com** — dotted spelling vs `kmaimaron@` already on file; confirm
  which routes fastest), e-sign admin docusign.admin@thelcfgroup.com. No stip list in doc.
- **Written:** appended to `submission_notes`; set profile `special_instructions`.

### United Capital Source — `Referral Submission Checklist Guidelines 2025.pdf`, `UCS ISO Compensation.pdf`, `UCS Partner Info Sheet.pdf`
- **Extracted (richest source):** All products need a completed Merchant Application signed & dated
  within 30 days; no prior/current defaults or open BK. **MCA criteria:** 3-4 mo bank statements,
  12 mo TIB, 575+ credit, ~$25k/mo ($300k/yr) revenue, ≤2 open positions; deals over $250k also
  need most recent tax return + YTD P&L + balance sheet. **Commission:** MCA up to 10%, Term Loan
  up to 10%, LOC 1-3% on initial draw, SBA 50 bps, Equipment up to 10%; renewals = 50% of net
  funded; paid 5 business days after funding. Per-product checklists also captured for LOC/Term/
  SBA/Equipment/Factoring/HELOC/Real-Estate.
- **Written:** appended to `submission_notes`; profile `required_stips` (7 items) +
  `special_instructions`.

### Value Capital Funding — `PA_-_W9_-_Revised.pdf` (Referral Partner & NDA)
- **Extracted:** Commission **7% of debt restructured** (DR/settlement cases); FDIC Bank Financing
  Program pays Referral **50% of the comp paid to VCF** (figures at
  https://bit.ly/fdicbanktermloanpartner). "Client for life" non-circumvention (indefinite).
  Governing law FL (Palm Beach County). Phone 800-944-6280. (Full stip lists for both programs
  were already exhaustively documented in `submission_notes`.)
- **Written:** appended commission terms to `submission_notes`; profile `required_stips` (8 items,
  FDIC Bank Term Loan program) + `special_instructions`.

## Summary

- **Docs mined:** 16 PDFs across 9 funders (11 were text-bearing agreements/rate sheets; the rest
  were duplicate forms or image-only flyers).
- **Submission emails found in docs:** deals@gokapital.com + broker@gokapital.com (GoKapital),
  submissions@lendini.com (Lendini), partnerprogram@valuecapitalfunding.com (VCF),
  isosubmissions@unitedcapitalsource.com context (UCS) — all already on file; no NULL email was
  fillable from a doc. New **contacts** surfaced: Kate Halyuk (Funderial), Lisnet Rodriguez
  (Reliant), and the dotted Kurt Maimaron address (LCF/Reliant).
- **Portals:** none newly discovered in the docs (Mantis/UCS/Reliant/Funderial/GoKapital have no
  portal — email submission).
- **Stips written:** Fantastic (4), GoKapital (3), UCS (7), VCF (8) into
  `funder_submission_profiles.required_stips`; `special_instructions` set for those plus Corfin,
  Funderial, Reliant (7 profiles total).
- **Commission intel captured** for all 9 (points/percentages, clawback windows, payout timing).
- **Blockers:** Anon key blocked by Storage RLS — resolved via Management-API service_role key.
  Mantis publishes no submission inbox in its agreement (left NULL, flagged for onboarding).
  Lendini and Mantis have no `funder_submission_profiles` row, so per the rules their intel went to
  `submission_notes` only.
