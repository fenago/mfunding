# Data Security & Privacy Policy
### [COMPANY] (Momentum Funding) — Internal

**Effective Date:** [DATE]  ·  **Owner:** [SECURITY/PRIVACY OWNER]  ·  **Applies to:** all personnel and contractors handling Company or merchant data.

## 1. Purpose & Scope
Defines how Company protects sensitive data — especially merchant **personal and financial information** (bank statements, transaction data, SSNs/EINs, credit data, IDs). Designed to align with common financial-privacy expectations (e.g., GLBA-type safeguards) and applicable state privacy/breach laws. Counsel/security to confirm specific legal obligations.

## 2. Data We Handle
- Merchant/owner PII (name, SSN/EIN, DOB, address, ID documents)
- Financial data (bank statements, Plaid transaction data, balances, credit reports)
- Deal/CRM data, funder submissions, VCF client hardship data
- Employee/contractor records (W-9, direct deposit info)

## 3. Approved Systems Only
- Store and process data **only** in Company-approved systems: **GHL (CRM), Supabase, Plaid, Google Workspace, and approved e-sign** — each access-controlled.
- **Prohibited:** storing merchant data on personal devices, personal email/cloud, USB drives, spreadsheets outside approved storage, or messaging apps.

## 4. Access Control
- **Least privilege**: access granted by role (closer, VA, manager, admin, super_admin) and removed promptly on role change/offboarding.
- **MFA required** on all systems that support it.
- Unique accounts; **no shared logins**; strong passwords / password manager.
- Database access protected by RLS; admin/super-admin scopes limited.

## 5. Data In Transit & At Rest
- TLS/HTTPS for all data in transit; no transmitting full bank/account numbers or SSNs in plain-text email/SMS.
- Encryption at rest via provider defaults (Supabase, Google Workspace, GHL); rely on Plaid for secure bank connectivity (we avoid storing raw credentials).
- Secrets/API keys kept in `.env` (gitignored) and the Supabase vault — never committed to source control.

## 6. Plaid / Third-Party Processors
- Use Plaid for bank verification; merchants consent via the Bank & Credit Authorization.
- Maintain an inventory of processors (GHL, Supabase, Plaid, Google, e-sign, scrub vendor) and rely on their security/DPA terms; review periodically.

## 7. Retention & Disposal
- Retain merchant data only as long as needed for the transaction and legal/record obligations (**[RETENTION SCHEDULE — confirm with counsel]**).
- Securely delete/destroy data and revoke access at end of retention; contractors return/destroy data at offboarding (per NDA).

## 8. Contractor Obligations
- All contractors sign the NDA/Confidentiality and follow this policy.
- No exporting merchant lists or data for personal use; non-circumvention applies.

## 9. Incident Response
1. Report any suspected breach/loss to [SECURITY OWNER] **immediately** (same day).
2. Contain (revoke access, isolate systems), assess scope, preserve logs.
3. Notify affected parties and regulators **as required by applicable state breach-notification law** — counsel to determine obligations and timing.
4. Remediate root cause; document the incident and lessons learned.

## 10. Acceptable Use & Devices
- Keep devices patched, locked, and protected (screen lock, disk encryption, anti-malware).
- No accessing merchant data on unsecured public Wi-Fi without VPN.

## 11. Training & Review
- Security/privacy onboarding for all personnel; annual refresher.
- Policy reviewed at least annually and on material change.

---

Approved by: _________________________ [NAME, TITLE]  Date: __________

*Counsel/security to confirm GLBA Safeguards applicability, state privacy/breach-notification duties, and processor DPA terms before reliance. The public-facing website Privacy Policy is a separate document.*
