# mFunding SaaS Platform: Comprehensive User Journeys & Daily Workflows

**Author:** Manus AI
**Client:** mFunding.com
**Document Version:** 2.0
**Date:** March 01, 2026

---

## 1. Introduction

This document provides a definitive, step-by-step walkthrough of the daily workflows for **every** user persona on the mFunding SaaS Platform. It expands significantly on the previous version to ensure absolute clarity on how each user interacts with the system, the specific UI elements they touch, and the automated events that guide their journey. The goal is to create an experience that is not just functional, but intuitive and empowering for every stakeholder.

---

## 2. The Sub-ISO Journey: The Platform as a Business

For Sub-ISOs, the mFunding platform is their primary tool for running their entire lending brokerage. Their experience is about empowerment, efficiency, and brand autonomy.

### 2.1. The Sub-ISO Admin Journey: The Business Owner

The Sub-ISO Admin is the principal of the partner brokerage. Their journey is about setup, oversight, and financial management.

**Phase 1: Onboarding & Setup**
1.  **Invitation:** The journey begins with an email invitation from the mFunding Super Admin: "You're invited to join the mFunding Partner Platform."
2.  **Branded Onboarding:** Clicking the link leads to a white-labeled onboarding flow (`app.mfunding.com/signup`) where they:
    *   Set their company name and upload their own logo.
    *   Agree to the mFunding Partner Terms of Service.
    *   Enter their banking information for commission payouts.
    *   Choose a subscription plan (if applicable, managed by GHL SaaS Mode).
3.  **Initial Login:** Upon completion, their GHL sub-account is provisioned. They receive a welcome email with their login credentials. Their first login presents them with an **Onboarding Checklist** guiding them to:
    *   **Configure Branding:** Confirm their logo and color scheme for their sub-account.
    *   **Invite Team Members:** Add their agents (closers) to the platform.
    *   **Review Workflows:** Get a tour of the pre-built GHL automation workflows for lead nurture and follow-up.

**Phase 2: Daily Operations & Management**
1.  **Morning Dashboard:** The Admin's dashboard is their command center, showing:
    *   **Team Performance:** A leaderboard of their agents by funded volume and deals submitted.
    *   **Aggregate Pipeline:** A view of all deals across their entire team, filterable by agent.
    *   **Revenue & Commissions:** A real-time view of total commissions earned, pending, and paid out.
2.  **Deal Oversight:** The Admin can click into any deal in their team's pipeline to view its status, read communication logs, and see underwriting notes. They have read-only access to their agents' deals by default but can be granted permission to take action.
3.  **Re-assigning Leads:** If an agent is overloaded or on vacation, the Admin can simply drag a deal card from one agent's swimlane to another in the team pipeline view.

**Phase 3: Reporting & Financials**
1.  **Commission Reports:** At the end of each payment period, the Admin can generate a detailed commission statement for each of their agents, showing every funded deal and the commission earned.
2.  **Performance Analytics:** They can access a reporting suite to analyze their business's health, including conversion rates by lead source, average time-to-fund, and funder performance.

### 2.2. The Sub-ISO Agent Journey: The Closer

This is the power-user. Their entire day is spent in the platform, and their workflow is optimized for speed and clarity.

**A Day in the Life of a Closer:**

| Time | Action | UI & Experience |
| :--- | :--- | :--- |
| **9:00 AM** | **Login & Morning Huddle** | Logs into `app.mfunding.com`. The dashboard immediately presents their **"Today View"**: a prioritized list of tasks, new leads, and unread messages in the Unified Inbox. | 
| **9:15 AM** | **Work New Leads** | Clicks into the Kanban pipeline. A new lead card is highlighted. Clicks the card, opens the Deal Detail View, and uses the communication panel to send a templated "Intro & Doc Request" SMS/email. Drags the card to "Application in Progress." | 
| **10:30 AM** | **Document Follow-up** | A task on their dashboard says "Follow up on docs for Merchant X." They see in the deal's Document tab that the merchant has uploaded bank statements but not the application. They send a quick SMS: "Thanks for the statements! Just need the application to move forward." | 
| **11:00 AM** | **Plaid Connection** | Receives a platform notification: **"Merchant Y has connected their bank account via Plaid!"** The deal card for Merchant Y automatically moves to the "Docs Received" stage. | 
| **11:05 AM** | **Underwriting Submission** | The agent opens the Merchant Y deal. The system shows a green checkmark: "Plaid data verified." The agent clicks **"Submit for Underwriting."** The deal card moves to the "Underwriting" stage and is now locked for editing. | 
| **1:30 PM** | **Offer Received** | Receives a notification: **"Offer Received for Merchant Z!"** They open the deal, go to the "Funder Submissions" tab, and see the offer: $50k, 1.35 factor. | 
| **1:35 PM** | **Presenting the Offer** | Clicks **"Present Offer."** The system generates a unique, branded **Offer Link**. The agent copies the link and sends it to the merchant via SMS directly from the platform: "Great news! Your offer is ready. Review it here: [Offer Link]" | 
| **2:15 PM** | **Offer Accepted!** | Receives a notification: **"Merchant Z has ACCEPTED the offer!"** The deal automatically moves to the "Contracts Out" stage. The system auto-generates the MCA agreement with all the correct terms. | 
| **2:20 PM** | **Sending Contracts** | The agent quickly reviews the generated contract PDF within the platform. It looks perfect. They click **"Send for Signature."** | 
| **3:00 PM** | **Contract Signed!** | Receives a final notification: **"Contract Signed by Merchant Z!"** The deal automatically moves to the **"Funded"** stage. The executed contract appears in the document vault. Their commission for the deal instantly appears in their "Pending Commissions" report. | 

---

## 3. The Merchant Journey: The End Borrower

The merchant's experience is designed for simplicity, transparency, and trust. They interact with the platform via a clean, mobile-friendly **Merchant Portal**.

**The Merchant's End-to-End Journey:**

1.  **First Contact:** The journey begins when they fill out a simple application form on the mFunding or a Sub-ISO's website.
2.  **Portal Invitation:** Immediately, they receive a professionally branded welcome email and SMS. "Welcome to mFunding. To securely track your application and upload documents, please create your portal account here."
3.  **First Login & The Dashboard:** The portal is designed to answer their primary question: "What's the status of my funding?"
    *   A large, visual **Status Tracker** at the top of the page shows exactly where they are in the process (e.g., `Application Submitted` -> `Under Review` -> `Offer Ready`).
    *   A simple **Document Checklist** shows what's needed. Each item has an "Upload" button. At the top of this list is a large, prominent button: **"Connect Bank Instantly with Plaid (Recommended)."**
    *   A **Messages** tab allows for direct, secure communication with their assigned agent.
4.  **Submitting Documents:**
    *   **The Plaid Experience:** They click the Plaid button, a secure window pops up, they select their bank, log in with their normal online banking credentials, and are done. The checklist items for "Bank Statements" are instantly marked with a green check.
    *   **The Manual Experience:** They click "Upload" next to "3 Months Bank Statements," select the PDF from their computer, and the file uploads. The item is marked as "Pending Review."
5.  **Receiving & Accepting the Offer:**
    *   They receive an SMS/email: "Your funding offer is ready to view!"
    *   They log into the portal. The Status Tracker now says **"Offer Ready!"**
    *   They click "View Offer." A clean, simple page displays the key terms: Funding Amount, Payback Amount, and Payment details. There is a large, clear **"Accept Offer"** button.
6.  **Signing the Contract:**
    *   After accepting, the Status Tracker updates to **"Contract Ready for Signature."**
    *   They click "Review & Sign." An **embedded eSignature window** appears directly within the portal. They scroll through the document and follow the prompts to apply their electronic signature.
    *   Upon completion, the status updates to **"Funded!"** and they can download a copy of the fully executed agreement.
7.  **Post-Funding Servicing:** The portal remains their go-to resource. The dashboard now shows:
    *   Their remaining balance.
    *   The date and amount of their next payment.
    *   A full history of all payments made.

---

## 4. The Internal & Stakeholder Journeys

These journeys are for the supporting roles that make the engine run.

### 4.1. The Underwriter Journey

The underwriter lives in the **Underwriting Workbench**. Their goal is to make accurate decisions as quickly as possible. Their journey is a focused loop:
1.  **Select Deal:** Pick the oldest deal from their dedicated **Underwriting Queue**.
2.  **Analyze Data:** Review the **Risk Dashboard** within the deal view. This dashboard consolidates all key data points: Plaid analysis (ADB, NSFs), credit score, and business verification data.
3.  **Make Decision:** Fill out the **Underwriting Scorecard**, which guides them through a structured risk assessment. Add qualitative notes in the "Underwriting Notes" section.
4.  **Submit or Decline:** Click **"Submit to Funders"** (which opens a modal to select specific funders) or **"Decline Deal"** (which prompts for a reason code). The deal is now out of their queue.

### 4.2. The Syndicator Journey

The syndicator's journey is a read-only experience focused on ROI.
1.  **Login:** They log into a separate, secure **Syndicator Portal**.
2.  **Portfolio Overview:** Their dashboard shows high-level portfolio metrics: Total Invested, Total Returned, Net Profit, and overall ROI.
3.  **Deal Performance:** They see a list of all deals they have invested in. They can click into any deal to see its payment history, current balance, and status (e.g., Active, Defaulted, Paid Off).
4.  **Reporting:** They can download monthly PDF or CSV statements summarizing the performance and earnings of their entire portfolio.

### 4.3. The Super Admin Journey

The Super Admin has a "god-mode" view of the entire ecosystem.
1.  **Global Monitoring:** Their dashboard aggregates data from all internal and sub-ISO accounts, showing total platform-wide funded volume, revenue, and new deals.
2.  **Sub-ISO Management:** They have a dedicated admin panel to onboard new ISOs, manage their subscription status, and view performance reports for each partner.
3.  **Platform Configuration:** They are the only ones who can access the settings to:
    *   Modify pipeline stages.
    *   Create and edit contract templates for the eSignature engine.
    *   Adjust the underwriting scorecard weights.
    *   Manage API keys for all third-party integrations.
    *   Control the global white-label branding of the platform.
