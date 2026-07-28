<div class="cover">

Data Governance

# Data Retention & Disposal Policy

Agentic Voice, Inc. — d/b/a MFunding.net \| Momentum Funding

|                  |                                                         |
|------------------|---------------------------------------------------------|
| Document         | Data Retention and Disposal Policy                      |
| Version          | 1.0                                                     |
| Effective Date   | July 28, 2026                                           |
| Next Review      | July 28, 2027 (annual)                                  |
| Owner / Approver | Ernesto Lee, Chief Executive Officer & Security Officer |
| Companion To     | Information Security Policy v1.0                        |

</div>

## 1. Purpose & Scope

This policy governs how long Agentic Voice, Inc. ("the Company") retains
the data it collects and how that data is securely disposed of when it
is no longer needed. It covers all consumer and business data processed
by the Company, with particular attention to consumer financial data
obtained through **Plaid Inc.** Our principle is data minimization: we
keep personal and financial data only as long as there is a legitimate
business or legal reason to do so, and then we delete or de-identify it.

## 2. Retention Schedule

| Data Category | Retention Period | Basis |
|----|----|----|
| **Bank data obtained via Plaid** (transactions, statements, balances, account/routing details) — *funded deals* | Duration of the funding relationship + up to **7 years**, then deleted | Financial-recordkeeping, tax, and dispute/audit obligations |
| **Bank data obtained via Plaid** — *declined, withdrawn, or inactive applications* | Deleted within **90 days** of decline/withdrawal, or on request | No ongoing need; data minimization |
| **Plaid access tokens / connection credentials** | Revoked and deleted immediately on account disconnection or when data pulls are complete and no longer needed | Least-privilege; minimize credential exposure |
| **Funding application & applicant PII** (name, contact, EIN, business financials) — funded | Up to **7 years** after the relationship ends | Legal, tax, and commission-recordkeeping |
| **Applications / leads** — declined or inactive | Up to **24 months** of inactivity, then deleted or de-identified | Follow-up window; then minimization |
| **Call recordings & call metadata** | Up to **24 months** | Quality assurance & dispute resolution |
| **Marketing / outreach contact data** | Until opt-out or **36 months** of inactivity | Consent-based; honor opt-outs promptly |
| **Application & security audit logs** | Retained per managed-provider defaults (up to ~24 months) | Security monitoring & incident investigation |
| **Automated backups** | Cycled out on the managed provider's backup rotation | Disaster recovery; deleted data ages out of backups on rotation |

<div class="note">

Where a longer retention period is required by a specific law,
regulation, funder contract, or an active legal hold, that requirement
governs and supersedes the periods above for the affected records.

</div>

## 3. Deletion & Disposal Procedures

When data reaches the end of its retention period, or when a valid
deletion request is received, the Company disposes of it as follows:

- **Plaid connections.** The Plaid Item is removed via Plaid's
  `/item/remove` API, which revokes the access token and terminates
  further access. The associated stored access token (held in the
  encrypted vault) is deleted.
- **Database records.** Records are deleted from the Supabase
  (PostgreSQL) database. Because the platform encrypts data at rest,
  deletion combined with provider key management renders data
  unrecoverable (crypto-erasure); deleted records age out of automated
  backups on the provider's rotation.
- **Stored files.** Documents in storage (bank statements, IDs, and
  other uploads) are deleted from their storage buckets, including the
  underlying storage objects.
- **CRM records.** Contact and conversation records held in GoHighLevel
  (GHL) are deleted upon a valid deletion request or at end of
  retention.
- **Disposal method.** Disposal is performed by secure deletion through
  provider APIs and crypto-erasure of managed encrypted storage. Any
  physical media, if ever used, is wiped or destroyed before disposal.

## 4. Consumer Data Access & Deletion Requests

Individuals may request access to, correction of, or deletion of their
personal information — including data obtained through Plaid — and may
disconnect a linked bank account at any time. Requests are submitted
through either channel below and are actioned by the Security Officer:

- Email: **sales@send.mfunding.net**
- Web: the contact form at **mfunding.net/contact**

The Company verifies the requester's identity, then completes verified
deletion requests within a reasonable period and consistent with
applicable law, except where data must be retained to meet a legal, tax,
or contractual obligation (in which case only the minimum required data
is retained and the requester is informed).

## 5. Responsibilities & Review

- The **Security Officer** (Ernesto Lee, CEO) owns this policy, actions
  deletion requests, and confirms that data past its retention period is
  removed.
- Retention and disposal practices are reviewed **annually**, alongside
  the quarterly access review, to confirm they remain accurate and
  compliant.
- This policy is a companion to the Company's Information Security
  Policy and is maintained under version control.

<div class="sig">

Approved and adopted on behalf of Agentic Voice, Inc.:

<div class="sig-line">

Ernesto Lee — Chief Executive Officer & Security Officer

</div>

<div class="sig-line">

Date

</div>

</div>

Agentic Voice, Inc. d/b/a MFunding.net \| Momentum Funding — Data
Retention & Disposal Policy v1.0 — Confidential.
