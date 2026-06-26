# Product Requirements Document
# mFunding SaaS Platform — Business Lending Brokerage & Sub-ISO Network

**Author:** Manus AI
**Client:** mFunding.com
**Document Version:** 1.1
**Date:** March 01, 2026
**Status:** Ready for Development

---

## Table of Contents

1. Executive Summary
2. Product Vision & Business Goals
3. User Personas & Role Hierarchy
4. Platform Architecture Overview
5. Module 1 — Lending Operations Core
6. Module 2 — CRM & Automation Core (GoHighLevel White-Label)
7. Module 3 — ISO & Sub-ISO Partner Management
8. Module 4 — Underwriting & Risk Intelligence
9. **Module 5 — The Plaid Integration: Real-Time Financial Data**
10. Module 6 — Collections & Servicing
11. Module 7 — Syndication Management
12. **Module 8 — E-Docs, Contract Generation & eSignature**
13. Module 9 — Portals (ISO, Merchant, Syndicator)
14. Module 10 — Reporting & Analytics
15. Module 11 — Platform Administration & White-Label Configuration
16. Third-Party API Integration Catalog
17. Non-Functional Requirements
18. Data Model Overview
19. Development Phases & Roadmap
20. References

---

## 1. Executive Summary

The **mFunding SaaS Platform** is a purpose-built, white-labeled software solution for mFunding.com, a business lending brokerage operating in the Merchant Cash Advance (MCA) and commercial finance space. The platform is designed to serve two simultaneous functions: it is the internal operating system for the mFunding brokerage itself, and it is a resellable SaaS product offered to sub-Independent Sales Organizations (sub-ISOs) who wish to operate under the mFunding brand and infrastructure.

The platform is architected around two integrated cores. The **Lending Operations Core** handles the specialized, deal-lifecycle workflows unique to MCA and alternative business lending — from lead capture and application scanning through underwriting, funding, collections, and syndication. The **CRM & Automation Core**, powered by a white-labeled GoHighLevel (GHL) instance, provides the foundational CRM, multi-channel communication, marketing automation, and sub-account management infrastructure. These two cores are connected via a real-time API integration layer, presenting a single, unified experience to all users under the mFunding brand.

This document has been updated to provide significantly more detail on the critical roles of **Plaid** for real-time financial data acquisition and the **E-Docs/eSignature** module for a fully digital, compliant, and efficient contract workflow.

---

## 2. Product Vision & Business Goals

### 2.1. Vision Statement

> To be the most powerful and intuitive all-in-one operating system for the MCA and business lending brokerage industry — enabling mFunding and its partner network to fund more businesses, faster, with less friction and greater transparency.

### 2.2. Business Goals

The platform must achieve the following measurable business outcomes:

| Goal | Description | Key Metric |
| :--- | :--- | :--- |
| **Operational Efficiency** | Eliminate manual, repetitive tasks across the deal lifecycle. | Reduction in average time-to-fund; reduction in manual data entry hours per week. |
| **Revenue from Sub-ISOs** | Generate recurring SaaS subscription revenue by onboarding sub-ISO partners. | Number of active sub-ISO accounts; Monthly Recurring Revenue (MRR) from sub-ISO subscriptions. |
| **Partner Performance** | Improve the quality and volume of deals submitted by sub-ISO partners. | Deal submission volume per ISO; funded deal conversion rate per ISO. |
| **Merchant Experience** | Deliver a professional, transparent experience for borrowers. | Merchant satisfaction score; reduction in inbound status-update calls. |
| **Portfolio Health** | Maintain visibility and control over the active lending portfolio. | On-time payment rate; NSF rate; default rate. |

---

## 3. User Personas & Role Hierarchy

(This section remains unchanged from version 1.0)

---

## 4. Platform Architecture Overview

(This section remains unchanged from version 1.0)

---

## 5. Module 1 — Lending Operations Core

(This section remains unchanged from version 1.0)

---

## 6. Module 2 — CRM & Automation Core (GoHighLevel White-Label)

(This section remains unchanged from version 1.0)

---

## 7. Module 3 — ISO & Sub-ISO Partner Management

(This section remains unchanged from version 1.0)

---

## 8. Module 4 — Underwriting & Risk Intelligence

This module provides the tools and data integrations needed to make fast, informed funding decisions. It relies heavily on data provided by the Plaid integration.

### 8.1. Bank Data Analysis (Plaid & Ocrolus)

Bank data analysis is the cornerstone of MCA underwriting. The platform will offer two methods for data acquisition: **Plaid (preferred)** for real-time, direct bank connections, and **Ocrolus (fallback)** for manual PDF statement uploads.

**Plaid-Driven Analysis:**
- When a merchant connects their bank account via Plaid, the system ingests up to 24 months of transaction data.
- The Lending Core processes this raw data to calculate and display key metrics in the deal's underwriting section.

**Ocrolus-Driven Analysis (Fallback):**
- If a merchant cannot or will not use Plaid, they can upload PDF bank statements.
- The system automatically triggers an analysis job via the Ocrolus API.

**Key Metrics Displayed (from either source):**
- Average Daily Balance (ADB)
- Average Monthly Deposits & Revenue
- Number of NSF/Returned Items per month
- Negative Day Count
- Identified MCA/Alternative Lender Payments (existing positions)
- Cash Advance Activity
- Largest Single Deposit (to identify non-recurring income)
- Risk flags are automatically highlighted (e.g., "3+ NSFs in last 30 days," "Existing MCA payments detected")

### 8.2. Credit & Identity Intelligence

**Requirements:**
- One-click soft or hard pull on personal credit via Experian integration.
- Business credit inquiry via Thomson Reuters CLEAR or PayNet.
- **Plaid Identity Verification:** Cross-reference merchant-provided name, address, phone, and email with the data on file at their bank (via Plaid Identity) to reduce fraud.
- Credit reports and verification summaries are stored on the deal record.

### 8.3. Business Verification

**Requirements:**
- Integration with a business data provider (e.g., Cobalt Intelligence) to verify business registration, status, and ownership.
- DataMerch integration to cross-reference merchant against a database of known risky borrowers.

### 8.4. Underwriting Scorecard

**Requirements:**
- A configurable underwriting scorecard that assigns a risk score to each deal based on weighted criteria (credit score, ADB from Plaid/Ocrolus, NSF count, time in business, monthly revenue, existing positions, industry).
- The scorecard output (e.g., "Approve," "Decline," "Manual Review") is displayed prominently on the deal record.

---

## 9. Module 5 — The Plaid Integration: Real-Time Financial Data

Plaid is a mission-critical component of the platform, serving as the primary method for securely and instantly gathering the financial data required for underwriting. It replaces the slow, insecure, and fraud-prone process of collecting PDF bank statements via email.

### 9.1. The Role of Plaid

Plaid provides a secure bridge between the mFunding platform and the merchant's bank accounts. By integrating Plaid, the platform can:

- **Accelerate Underwriting:** Reduce the time it takes to get verified financial data from days to seconds.
- **Enhance Security:** Eliminate the need for merchants to email sensitive documents. Data is transmitted via a secure, tokenized API.
- **Improve Data Accuracy:** Access real-time, unaltered transaction data directly from the source, eliminating the possibility of fraudulent or doctored bank statements.
- **Automate Workflows:** Use real-time data to automate identity verification, income verification, and cash flow analysis.

### 9.2. Plaid Integration Workflow

The merchant-facing workflow for connecting a bank account must be seamless and integrated directly into the Merchant Portal.

1.  **Initiate Plaid Link:** From the Merchant Portal, the merchant is prompted to "Securely Connect Your Bank Account." This action initializes the Plaid Link widget, a front-end component provided by Plaid.
2.  **Bank Selection & Authentication:** The merchant selects their bank from a list, enters their online banking credentials, and completes any multi-factor authentication steps required by their bank, all within the secure Plaid Link iframe.
3.  **Token Exchange:** Upon successful authentication, Plaid Link returns a temporary `public_token` to the client-side application. This token is immediately sent to the mFunding backend.
4.  **Secure Access Token:** The backend server exchanges the `public_token` for a permanent `access_token` using the Plaid API. This `access_token` is the key to accessing the merchant's data and must be stored securely (encrypted at rest) and associated with the deal.
5.  **Data Fetching & Webhooks:** The backend uses the `access_token` to make API calls to various Plaid endpoints to pull the required data. The platform will also configure Plaid webhooks to receive real-time notifications about events like new transactions or account updates.

### 9.3. Required Plaid API Products

The mFunding platform will utilize a suite of Plaid's API products to build a comprehensive financial profile of the applicant.

| Plaid Product | Purpose in mFunding Platform |
| :--- | :--- |
| **Auth** | Instantly verifies bank account and routing numbers. This is essential for setting up ACH debits for collections and for disbursing funds to the correct account. |
| **Identity** | Verifies the merchant's identity by matching the name, address, phone number, and email they provided against the official records at their bank. This is a powerful anti-fraud measure. |
| **Transactions** | Retrieves up to 24 months of categorized transaction data. This is the raw data used by the Lending Core to perform cash flow analysis, calculate ADB, detect NSFs, and identify existing lender payments. |
| **Assets** | Generates a holistic, point-in-time Asset Report containing account balances, historical transactions, and account holder identity information. This report can be used as a direct substitute for bank statements in the underwriting file. |
| **Income** | Verifies a merchant's income and employment from payroll data or by analyzing deposits in their bank accounts. This helps to confirm the stated monthly revenue and understand its consistency. |
| **Statements** | Retrieves official, watermarked PDF bank statements directly from the financial institution. This serves as a compliance backstop and can be provided to funders who still require a visual statement. |

---

## 10. Module 6 — Collections & Servicing

(This section remains unchanged from version 1.0, but relies on account/routing numbers verified by Plaid Auth)

---

## 11. Module 7 — Syndication Management

(This section remains unchanged from version 1.0)

---

## 12. Module 8 — E-Docs, Contract Generation & eSignature

This module provides a comprehensive, API-driven ecosystem for creating, managing, and executing all legally binding documents within the platform. It is designed to be fully digital, compliant, and deeply integrated into the deal workflow.

### 12.1. Core Philosophy: API-First & Embedded Experience

The entire E-Doc and eSignature process must be seamless. Users (merchants, agents) should never feel like they are being redirected to a third-party website. The experience must be fully embedded and white-labeled within the mFunding platform portals. This requires an eSignature provider with a robust, API-first architecture (e.g., DocuSign, HelloSign/Dropbox Sign, Verdocs, SignNow).

### 12.2. Dynamic Contract Generation Engine

**Requirements:**
- **Template Management:** Super Admins must have an interface to create and manage a library of dynamic contract templates (e.g., MCA Agreement, Loan Agreement). Templates are created in a rich-text editor and use a simple merge-field syntax (e.g., `{{merchant_legal_name}}`, `{{advance_amount}}`, `{{factor_rate}}`, `{{payment_amount}}`).
- **Conditional Logic:** The template engine should support basic conditional logic (if/else blocks) to include or exclude specific clauses based on deal data (e.g., include a specific state-mandated disclosure if `{{merchant_state}}` is 'CA').
- **Automated Generation:** When a deal moves to the "Offer Accepted" stage, the system automatically generates the correct contract by fetching the appropriate template and merging in all relevant data from the deal record. The generated document is a PDF stored in the E-Doc Vault.

### 12.3. The eSignature Workflow (Embedded Signing)

**Requirements:**
1.  **Envelope Creation:** Upon contract generation, the system makes an API call to the eSignature provider to create a new "envelope." This API call includes the generated PDF, signer information (name and email), and the placement of signature/initial/date fields (which can be pre-defined in the template).
2.  **Embedded Signing URL:** The API returns a unique, single-use URL for an embedded signing session.
3.  **Branded Notification:** The merchant receives a branded email/SMS notification from the mFunding platform (not the eSignature provider) with a link to the Merchant Portal to sign their contract.
4.  **Seamless Signing Experience:** When the merchant clicks the link, they are taken to a page within the Merchant Portal that embeds the eSignature provider's signing ceremony in an iframe. The entire experience is contained within the mFunding brand.
5.  **Real-Time Status Updates (Webhooks):** The platform must subscribe to webhooks from the eSignature provider to receive real-time status updates for the envelope (e.g., `Sent`, `Viewed`, `Signed`, `Declined`, `Completed`). These events update the deal stage and trigger notifications for the agent.
6.  **Completed Document Retrieval:** Upon completion, the system uses the API to automatically download the fully executed, legally binding contract (with its certificate of completion) and stores it in the E-Doc Vault, marking it as the final, executed version.

### 12.4. E-Doc Vault & Audit Trail

**Requirements:**
- **Secure Storage (AWS S3):** All documents, especially executed contracts, are stored securely in AWS S3 with encryption at rest. Access is strictly controlled.
- **Version Control:** The system must maintain a clear distinction between draft and executed versions of a contract.
- **Comprehensive Audit Trail:** Every action related to a document (generation, viewing, signing, completion) is logged in an immutable audit trail, linked to the deal record. The eSignature provider's certificate of completion, which includes IP addresses, timestamps, and a chain of custody, is attached to the final document.
- **Document Search & Retrieval:** Agents and admins can easily search for and retrieve documents by merchant name, deal ID, or document type.

---

## 13. Module 9 — Portals (ISO, Merchant, Syndicator)

(This section remains unchanged from version 1.0)

---

## 14. Module 10 — Reporting & Analytics

(This section remains unchanged from version 1.0)

---

## 15. Module 11 — Platform Administration & White-Label Configuration

(This section remains unchanged from version 1.0)

---

## 16. Third-Party API Integration Catalog

(This section is updated to reflect the new detailed breakdown)

### 16.1. Bank Data & Underwriting

| Provider | Function | Integration Method |
| :--- | :--- | :--- |
| **Plaid** | **(Primary)** Real-time bank account linking, identity verification, transaction history, income verification, and asset reports. | REST API |
| **Ocrolus** | **(Fallback)** AI-powered document analysis and OCR for PDF bank statement parsing. | REST API |

### 16.2. Credit & Risk Intelligence

| Provider | Function | Integration Method |
| :--- | :--- | :--- |
| **Experian** | Personal and business credit bureau data. | REST API |
| **Thomson Reuters CLEAR** | Identity verification, business intelligence, and regulatory compliance data. | REST API |

### 16.3. E-Docs & eSignature

| Provider | Function | Integration Method |
| :--- | :--- | :--- |
| **DocuSign / SignNow / Verdocs** | **(Choose one)** API-driven contract generation, embedded signing, and webhook-based status tracking. | REST API & Webhooks |

(Other integrations remain unchanged from version 1.0)

---

## 17. Non-Functional Requirements

(This section remains unchanged from version 1.0)

---

## 18. Data Model Overview

(This section remains unchanged from version 1.0)

---

## 19. Development Phases & Roadmap

(This section is updated to reflect the new modules)

### Phase 1 — Foundation (Weeks 1–8)
- GHL white-label setup
- User auth & RBAC
- Basic deal pipeline & detail view
- Document upload (manual) & S3 storage
- Basic GHL contact/opportunity sync

### Phase 2 — Core Underwriting & E-Docs (Weeks 9–18)
- **Plaid Integration:** Full implementation of Plaid Link workflow and API calls for Auth, Identity, and Transactions.
- **Ocrolus Integration:** Fallback for PDF statement analysis.
- **E-Docs & eSignature:** Contract template engine, generation, and embedded signing workflow with webhooks (DocuSign/SignNow).
- Credit pull integration (Experian).
- Application Scanner (PDF parsing).

(Subsequent phases are re-numbered and remain conceptually the same)

---

## 20. References

(This section is updated with new research)

[1] LendSaaS Website: [https://www.lendsaas.com](https://www.lendsaas.com)
[2] GoHighLevel Website: [https://www.gohighlevel.com](https://www.gohighlevel.com)
[3] GoHighLevel API Documentation: [https://marketplace.gohighlevel.com/docs/](https://marketplace.gohighlevel.com/docs/)
[4] **Plaid for Lending & Underwriting:** [https://plaid.com/use-cases/lending/](https://plaid.com/use-cases/lending/)
[5] **Plaid API Docs - Underwriting Products:** [https://plaid.com/docs/underwriting/](https://plaid.com/docs/underwriting/)
[6] **DocuSign eSignature API for Embedded Signing:** [https://developers.docusign.com/docs/esign-rest-api/esign101/concepts/embedding/](https://developers.docusign.com/docs/esign-rest-api/esign101/concepts/embedding/)
[7] **Verdocs API for Fintech (as an alternative):** [https://verdocs.com/esignature-api-fintech-apps/](https://verdocs.com/esignature-api-fintech-apps/)
[8] mFunding.com: [https://www.mfunding.com](https://www.mfunding.com)
