-- Researched per-state commercial-financing disclosure TEMPLATES (broker perspective).
-- 9 enacted states (CA, NY, VA, UT, GA, CT, FL, MO, KS); Texas has no enacted law (inactive).
-- These are TEMPLATES with [MERGE] placeholders — the funder/provider issues the official
-- per-transaction disclosure; MFunding (broker) ensures delivery + provides broker disclosures.
-- Final legal language requires compliance counsel. Sources: state CFDL statutes (2026).

UPDATE compliance_disclosures SET title = 'California Commercial Financing Disclosure (SB 1235, Cal. Fin. Code §§22800-22805)', body =
'California commercial financing disclosure. Statute: SB 1235, Cal. Fin. Code 22800-22805. Effective Dec 9, 2022. Regulator: DFPI. Applies to commercial financing of $5,000 to $500,000.

For MCA products this is a purchase of future receivables, not a loan.

Deliver this standardized disclosure to the recipient BEFORE the agreement is signed (values calculated per offer):
- Total funds provided: [TOTAL_FUNDS_PROVIDED]
- Net amount disbursed to recipient (after payoffs/third-party amounts): [NET_DISBURSED]
- Total cost of financing (finance charge, itemized): [FINANCE_CHARGE]
- Total amount to be repaid: [TOTAL_REPAYMENT]
- Annual Percentage Rate (APR), calculated using the DFPI methodology: [APR]
- Payment amount and frequency: [PAYMENT_AMOUNT] / [PAYMENT_FREQUENCY]
- Estimated term: [TERM]
- Prepayment policy: [PREPAYMENT_TERMS]
- Itemized fees: [FEES]

Note: MFunding is a broker compensated by the funder, not your fiduciary or advisor. The funder/provider must be registered with the DFPI where required.

Recipient acknowledges receipt before signing.  Signature: __________  Date: ______

TEMPLATE ONLY - not final legal text. The funder/provider must issue the official per-transaction disclosure in the DFPI-prescribed format and APR methodology; MFunding must ensure it is delivered before signing. Have compliance counsel finalize.'
WHERE state = 'CA';

UPDATE compliance_disclosures SET title = 'New York Commercial Finance Disclosure (NY Fin. Servs. Law §§800-812)', body =
'New York commercial finance disclosure. Statute: NY Financial Services Law 800-812. Effective Aug 1, 2023. Regulator: NYDFS. Applies to commercial financing up to $2,500,000.

For MCA products this is a purchase of future receivables, not a loan.

Deliver this standardized disclosure (it may be integrated into the contract if prominent and in the prescribed format) BEFORE the agreement is signed (values calculated per offer):
- Total funds provided: [TOTAL_FUNDS_PROVIDED]
- Net amount disbursed to recipient (after payoffs/third-party amounts): [NET_DISBURSED]
- Total cost of financing (finance charge, itemized): [FINANCE_CHARGE]
- Total amount to be repaid: [TOTAL_REPAYMENT]
- Annual Percentage Rate (APR), calculated using the NYDFS methodology for sales-based financing: [APR]
- Payment amount and frequency: [PAYMENT_AMOUNT] / [PAYMENT_FREQUENCY]
- Estimated term: [TERM]
- Prepayment policy: [PREPAYMENT_TERMS]
- Itemized fees: [FEES]

Broker note: MFunding is a broker (not the funder), compensated by the funder ([BROKER_COMPENSATION]); MFunding must be registered with NYDFS as a commercial financing broker and does not act as your fiduciary or advisor.

Recipient acknowledges receipt before signing.  Signature: __________  Date: ______

TEMPLATE ONLY - not final legal text. The funder/provider must issue the official per-transaction disclosure in the NYDFS-prescribed format and APR methodology. Confirm broker registration. Have compliance counsel finalize.'
WHERE state = 'NY';

UPDATE compliance_disclosures SET title = 'Virginia Sales-Based Financing Disclosure (HB 1027, Va. Code §§6.2-2228-2238)', product_type = 'mca', body =
'Virginia sales-based financing (MCA) disclosure. Statute: HB 1027, Va. Code 6.2-2228 to 2238. Effective Nov 1, 2022. Regulator: Virginia State Corporation Commission (SCC). Applies to sales-based financing (MCA/revenue-share); no dollar cap.

This is a purchase of future receivables, not a loan.

Deliver this disclosure to the recipient BEFORE the agreement is signed (values calculated per offer):
- Total funds provided: [TOTAL_FUNDS_PROVIDED]
- Net amount disbursed to recipient: [NET_DISBURSED]
- Total cost of financing (finance charge): [FINANCE_CHARGE]
- Total amount to be repaid: [TOTAL_REPAYMENT]
- Estimated APR (repayment timing depends on future sales, so APR is an estimate): [APR]
- Average monthly payment / payment frequency: [PAYMENT_AMOUNT] / [PAYMENT_FREQUENCY]
- Estimated term: [TERM]
- Prepayment policy: [PREPAYMENT_TERMS]

Broker note: under Virginia law BOTH the provider and the broker must register with the SCC. MFunding is a broker compensated by the funder ([BROKER_COMPENSATION]); not your fiduciary.

Recipient acknowledges receipt before signing.  Signature: __________  Date: ______

TEMPLATE ONLY - not final legal text. Confirm SCC registration for provider and broker. The funder must issue the official per-transaction disclosure. Have compliance counsel finalize.'
WHERE state = 'VA';

UPDATE compliance_disclosures SET title = 'Utah Commercial Financing Registration Act (CFRA, Utah Code §§7-27-101 et seq.)', body =
'Utah commercial financing disclosure. Statute: Commercial Financing Registration Act, Utah Code 7-27-101 et seq. Effective Jan 1, 2023. Regulator: Utah Dept. of Financial Institutions (DFI). No dollar cap. Registration-focused; disclosure is simpler than CA/NY.

For MCA products this is a purchase of future receivables, not a loan.

Deliver this disclosure to the recipient BEFORE the agreement is signed (values calculated per offer):
- Total funds provided: [TOTAL_FUNDS_PROVIDED]
- Net amount disbursed to recipient: [NET_DISBURSED]
- Total cost of financing (finance charge): [FINANCE_CHARGE]
- Total amount to be repaid: [TOTAL_REPAYMENT]
- Payment amount and frequency: [PAYMENT_AMOUNT] / [PAYMENT_FREQUENCY]
- Estimated term: [TERM]
- Prepayment policy: [PREPAYMENT_TERMS]
(APR disclosure is optional under the Utah CFRA but include [APR] if available.)

Note: the provider must be registered annually with the Utah DFI. MFunding is a broker compensated by the funder, not your fiduciary.

Recipient acknowledges receipt before signing.  Signature: __________  Date: ______

TEMPLATE ONLY - not final legal text. Confirm Utah DFI registration. Have compliance counsel finalize.'
WHERE state = 'UT';

UPDATE compliance_disclosures SET title = 'Georgia Commercial Financing Disclosure Act (SB 90, Ga. Code §§7-7-1 et seq.)', body =
'Georgia commercial financing disclosure. Statute: SB 90, Ga. Code 7-7-1 et seq. Effective Jan 1, 2024. Regulator: Georgia Dept. of Banking and Finance. Applies to commercial financing up to $500,000.

For MCA products this is a purchase of future receivables, not a loan.

Deliver this standardized disclosure to the recipient BEFORE the agreement is signed (values calculated per offer):
- Total funds provided: [TOTAL_FUNDS_PROVIDED]
- Net amount disbursed to recipient: [NET_DISBURSED]
- Total cost of financing (finance charge, itemized): [FINANCE_CHARGE]
- Total amount to be repaid: [TOTAL_REPAYMENT]
- Annual Percentage Rate (APR): [APR]
- Payment amount and frequency: [PAYMENT_AMOUNT] / [PAYMENT_FREQUENCY]
- Estimated term: [TERM]
- Prepayment policy: [PREPAYMENT_TERMS]
- Itemized fees: [FEES]

Broker note (required by SB 90): MFunding is a broker, must register, and discloses its compensation ([BROKER_COMPENSATION], paid by the funder, not a fee charged to you). MFunding is not your fiduciary or advisor. No undisclosed lender kickbacks or double-dipping.

Recipient acknowledges receipt before signing.  Signature: __________  Date: ______

TEMPLATE ONLY - not final legal text. Confirm broker registration + compensation disclosure. Have compliance counsel finalize.'
WHERE state = 'GA';

UPDATE compliance_disclosures SET title = 'Connecticut Commercial Financing Disclosure (SB 1032, Conn. Gen. Stat. §36a-861 et seq.)', body =
'Connecticut commercial financing disclosure. Statute: SB 1032, Conn. Gen. Stat. 36a-861 et seq. Effective Jul 1, 2024. Regulator: Connecticut Dept. of Banking. Applies to commercial financing up to $250,000.

For MCA products this is a purchase of future receivables, not a loan.

Deliver this standardized disclosure to the recipient BEFORE the agreement is signed (values calculated per offer):
- Total funds provided: [TOTAL_FUNDS_PROVIDED]
- Net amount disbursed to recipient: [NET_DISBURSED]
- Total cost of financing (finance charge, itemized): [FINANCE_CHARGE]
- Total amount to be repaid: [TOTAL_REPAYMENT]
- Annual Percentage Rate (APR): [APR]
- Payment amount and frequency: [PAYMENT_AMOUNT] / [PAYMENT_FREQUENCY]
- Estimated term: [TERM]
- Prepayment policy: [PREPAYMENT_TERMS]
- Itemized fees: [FEES]

Broker note: MFunding is a broker compensated by the funder ([BROKER_COMPENSATION]); not your fiduciary. Broker registration may be required.

Recipient acknowledges receipt before signing.  Signature: __________  Date: ______

TEMPLATE ONLY - not final legal text. The funder must issue the official per-transaction disclosure. Have compliance counsel finalize.'
WHERE state = 'CT';

UPDATE compliance_disclosures SET title = 'Florida Commercial Financing Disclosure (HB 1353, Fla. Stat. §§559.952-559.964)', body =
'Florida commercial financing disclosure. Statute: HB 1353, Fla. Stat. 559.952-559.964. Effective Jul 1, 2023. Regulator: Florida Office of Financial Regulation (OFR). Applies to commercial financing up to $500,000. Registration-focused; disclosure simpler than CA.

For MCA products this is a purchase of future receivables, not a loan.

Deliver this disclosure to the recipient BEFORE the agreement is signed (values calculated per offer):
- Total funds provided: [TOTAL_FUNDS_PROVIDED]
- Net amount disbursed to recipient: [NET_DISBURSED]
- Total cost of financing (finance charge): [FINANCE_CHARGE]
- Total amount to be repaid: [TOTAL_REPAYMENT]
- Estimated APR (for sales-based/MCA products): [APR]
- Payment amount and frequency: [PAYMENT_AMOUNT] / [PAYMENT_FREQUENCY]
- Estimated term: [TERM]
- Prepayment policy: [PREPAYMENT_TERMS]

Note: the provider must be registered with the Florida OFR. MFunding is a broker compensated by the funder, not your fiduciary.

Recipient acknowledges receipt before signing.  Signature: __________  Date: ______

TEMPLATE ONLY - not final legal text. Confirm OFR registration. The funder must issue the official per-transaction disclosure. Have compliance counsel finalize.'
WHERE state = 'FL';

UPDATE compliance_disclosures SET title = 'Missouri Commercial Financing Disclosure (SB 1359, Mo. Rev. Stat. §427.300 et seq.)', body =
'Missouri commercial financing disclosure. Statute: SB 1359, Mo. Rev. Stat. 427.300 et seq. Effective Aug 28, 2024. Regulator: Missouri Division of Finance. Applies to commercial financing up to $500,000. Modeled on Florida; implementation still maturing.

For MCA products this is a purchase of future receivables, not a loan.

Deliver this disclosure to the recipient BEFORE the agreement is signed (values calculated per offer):
- Total funds provided: [TOTAL_FUNDS_PROVIDED]
- Net amount disbursed to recipient: [NET_DISBURSED]
- Total cost of financing (finance charge): [FINANCE_CHARGE]
- Total amount to be repaid: [TOTAL_REPAYMENT]
- Annual Percentage Rate (APR; estimated for sales-based/MCA): [APR]
- Payment amount and frequency: [PAYMENT_AMOUNT] / [PAYMENT_FREQUENCY]
- Estimated term: [TERM]
- Prepayment policy: [PREPAYMENT_TERMS]

Note: provider registration required with the Missouri Division of Finance. MFunding is a broker compensated by the funder, not your fiduciary.

Recipient acknowledges receipt before signing.  Signature: __________  Date: ______

TEMPLATE ONLY - not final legal text. Missouri rules are still being refined; confirm current Division of Finance guidance. Have compliance counsel finalize.'
WHERE state = 'MO';

UPDATE compliance_disclosures SET title = 'Kansas Commercial Financing Disclosure Act (HB 2247, Kan. Stat. Ann. §9-2401 et seq.)', body =
'Kansas commercial financing disclosure. Statute: HB 2247, Kan. Stat. Ann. 9-2401 et seq. Effective Jul 1, 2024. Regulator: Office of the State Bank Commissioner. Applies to commercial financing up to $500,000.

For MCA products this is a purchase of future receivables, not a loan.

Deliver this standardized disclosure to the recipient BEFORE the agreement is signed (values calculated per offer):
- Total funds provided: [TOTAL_FUNDS_PROVIDED]
- Net amount disbursed to recipient: [NET_DISBURSED]
- Total cost of financing (finance charge, itemized): [FINANCE_CHARGE]
- Total amount to be repaid: [TOTAL_REPAYMENT]
- Annual Percentage Rate (APR): [APR]
- Payment amount and frequency: [PAYMENT_AMOUNT] / [PAYMENT_FREQUENCY]
- Estimated term: [TERM]
- Prepayment policy: [PREPAYMENT_TERMS]
- Itemized fees: [FEES]

Note: provider registration required with the Office of the State Bank Commissioner. MFunding is a broker compensated by the funder, not your fiduciary.

Recipient acknowledges receipt before signing.  Signature: __________  Date: ______

TEMPLATE ONLY - not final legal text. The funder must issue the official per-transaction disclosure. Have compliance counsel finalize.'
WHERE state = 'KS';

UPDATE compliance_disclosures SET title = 'Texas - no enacted commercial financing disclosure law (monitor)', is_active = false, body =
'As of 2026 Texas has NO enacted commercial financing disclosure law. A narrower bill focused on merchant cash advances and broker registration has been proposed but is not yet in force. No Texas-specific commercial financing disclosure is currently required. This entry is marked inactive; monitor pending legislation and revisit with counsel before relying on it.'
WHERE state = 'TX';
