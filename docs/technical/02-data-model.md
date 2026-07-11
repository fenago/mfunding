# 02 — Data Model

All statements below were read from the **live database** (`ehibjeonqpqskhcvizow`, public schema) on 2026-07-11. 58 tables, **RLS enabled on every one**. All PKs are UUID except `platform_settings` (text key), `closer_doc_templates` (text `slug`), `inbound_lead_sources` (text `key`), `llm_settings` (int `id`, singleton), `llm_provider_keys` (text `provider`), `lead_assignment_state` (uuid `closer_user_id`).

---

## ⚠️ READ THIS FIRST — the closer split-brain

There are **two different identifiers for "the closer"**, and they are not interchangeable:

| Column | FK target | Holds |
|--------|-----------|-------|
| `deals.assigned_closer_id` | **`profiles(id)`** | the closer's **auth user / profile id** |
| `commissions.closer_id` | **`closers(id)`** | the closer's **comp-record id** |
| `lead_assignment_state.closer_user_id` | **`profiles(id)`** | profile id (round-robin rotation state) |
| `closers.user_id` | `profiles(id)` | the bridge between the two worlds (nullable!) |

**This has already caused two production bugs.** Rules:

1. Any UI that assigns a closer to a deal must submit `closers.user_id` (the **profile id**), never `closers.id`. Writing `closers.id` is an FK violation that silently fails the save. `src/services/dealService.ts` exposes `CloserOption { closerId, profileId }` precisely so callers cannot confuse them — `listActiveCloserOptions()` filters out closers with a null `user_id` (they have no profile to attribute a deal to).
2. Any code that goes from a deal to a commission must **map** profile → closer row:
   `select id from closers where user_id = deal.assigned_closer_id` (see `autoCreateCommissionForFundedDeal`, `dealService.ts:461`).
3. Legacy rows may hold either value. `getMyProjectedPipeline` (`commissionService.ts:489`) still defensively queries
   `.or("assigned_closer_id.eq.<closers.id>,assigned_closer_id.eq.<profiles.id>")`, and the RLS helpers
   `closer_owns_deal` / `closer_owns_customer` accept **both** forms:
   ```sql
   d.assigned_closer_id = uid
   or d.assigned_closer_id in (select c.id from closers c where c.user_id = uid)
   ```
   Treat that tolerance as a compatibility shim, not a licence to write `closers.id`.
4. `closers` rows with `user_id IS NULL` exist (a closer can be on the comp roster before they have a login). Such a closer can hold commissions but **cannot own a deal** and cannot sign documents.

---

## Enums (`pg_type`)

| Enum | Values |
|------|--------|
| `user_role` | `user \| closer \| admin \| super_admin \| employee` |
| `customer_status` | `lead \| contacted \| application_submitted \| in_review \| approved \| funded \| renewed \| declined \| follow_up` |
| `lead_source` | `website \| referral \| live_transfer \| aged_lead \| ucc_lead \| cold_call \| cold_email \| sms_campaign \| social_media \| google_ads \| facebook_ads \| partner_referral \| repeat_customer \| other` |
| `customer_document_type` | `bank_statement \| application \| tax_return \| id \| business_license \| voided_check \| credit_authorization \| personal_guarantee \| other` |
| `document_review_status` | `pending \| reviewed \| approved \| rejected` |
| `interaction_type` | `call \| email \| sms \| note \| document_uploaded \| status_change \| application_submitted \| meeting \| voicemail \| follow_up_scheduled` |
| `lender_type` | `mca \| line_of_credit \| invoice_factoring \| sba \| equipment \| term_loan \| revenue_based \| startup \| working_capital \| other` |
| `lender_status` | `potential \| application_submitted \| processing \| approved \| live_vendor \| rejected \| inactive \| affiliate_referral` |
| `lender_document_type` | `agreement \| terms \| rate_sheet \| commission_schedule \| application_template \| marketing_material \| other` |
| `marketing_lead_type` | `live_transfer \| appointment \| aged_lead \| ucc_lead \| web_lead \| callback_lead \| exclusive_lead \| shared_lead \| other` |
| `marketing_vendor_status` | `researching \| testing \| active \| paused \| discontinued` |
| `message_status` | `unread \| read \| archived` |

Note: **`deals.status` and `deals.deal_type` are `text` with CHECK constraints**, not enums. `commissions.payment_status` and `deal_submissions.status` likewise.

---

## `deals` — the core entity

`deal_type` (CHECK `deals_deal_type_check`): `mca | term_loan | line_of_credit | sba | equipment_financing | vcf`.

### Both stage sets (CHECK `deals_status_check` — 23 values, one column)

**MCA / general pipeline — 11 ordered stages** (`DEAL_STAGES` in `src/types/deals.ts:238`), *not* the 9 stages described in `CLAUDE.md`:

| # | `status` | Label | Stamped timestamp |
|---|----------|-------|-------------------|
| 1 | `new` | New Lead | — (`created_at`) |
| 2 | `contacted` | Contacted | `contacted_at` |
| 3 | `qualifying` | Qualifying | `qualified_at` |
| 4 | `application_sent` | App Sent | `application_sent_at` |
| 5 | `docs_collected` | Docs Collected | `docs_collected_at` |
| 6 | `bank_statements` | Bank Statements | `bank_statements_at` |
| 7 | `submitted_to_funder` | Submitted to Funders | `submitted_at` |
| 8 | `offer_received` | Offer Received | `offer_received_at` |
| 9 | `offer_presented` | Offer Presented | `offer_presented_at` |
| 10 | `offer_accepted` | Offer Accepted | `offer_accepted_at` |
| 11 | `funded` | Funded | `funded_at` |

Post-funnel: `renewal_eligible`.

**VCF (debt-relief) pipeline — 8 stages:** `new_distressed` → `hardship_consult` → `positions_analysis` → `strategy_proposal` → `agreement_sent` → `submitted_to_vcf` → `restructure_executed` → `servicing`.

**Shared terminal / parked states (either product):** `nurture`, `declined`, `dead` (+ `declined_at`, `nurture_at`).

`deals.lost_reason` CHECK: `no_contact | disqualified | docs_not_provided | bank_data_fail | funders_declined_all | merchant_declined | offer_expired | funding_fell_through | routed_to_vcf | duplicate | opted_out | prohibited_industry | other`.

### Notable columns

| Column | Type | Meaning |
|--------|------|---------|
| `deal_number` | text | `MF-YYYY-NNNN`, auto-set by trigger `set_deal_number` → `generate_deal_number()` when NULL |
| `customer_id` | uuid → `customers` | required |
| `assigned_closer_id` | uuid → **`profiles`** | see split-brain above; auto-filled by round-robin trigger |
| `campaign_id` | uuid → `campaigns` | attribution |
| `previous_status`, `closed_reason`, `closed_note` | text | park/close bookkeeping |
| `doc_checklist`, `playbook_checklist`, `lead_qual` | jsonb (NOT NULL, `{}`) | closer-driven state used by the Revenue Playbook / funder availability |
| `ai_lender_recommendations`, `ai_recommended_at`, `ai_business_summary` | jsonb/text | written by `recommend-lenders` |
| `merchant_reply_at`, `merchant_reply_summary` | | written by the reply poller/webhook |
| `first_call_due_at`, `stips_promised_by`, `temperature` | | speed-to-lead SLA + closer follow-up |
| `paydown_percentage`, `renewal_eligible_date`, `is_renewal`, `original_deal_id`, `renewal_count` | | renewal engine |
| `vcf_active_positions`, `vcf_total_balance`, `vcf_daily_debit`, `vcf_current_funders`, `vcf_hardship_reason` | | VCF-only fields |
| `ghl_contact_id`, `ghl_opportunity_id` | text | the GHL seam (no unique index — see [08](./08-security-posture.md)) |

---

## Relationship map (real FKs)

```
profiles(id) ─┬─< deals.assigned_closer_id      ⚠ profile id
              ├─< deals.created_by / customers.created_by / customers.assigned_to
              ├─< closers.user_id  (nullable bridge)
              ├─< sub_isos.user_id
              ├─< commissions.approved_by
              ├─< closer_documents.sent_by / .recorded_by
              ├─< closer_document_signatures.signer_user_id
              ├─< lead_assignment_state.closer_user_id
              └─< activity_log.logged_by, *_documents.uploaded_by, …

customers(id) ─┬─< deals.customer_id
               ├─< customer_documents.customer_id
               ├─< customer_interactions.customer_id
               ├─< mca_applications.customer_id
               ├─< bank_analyses.customer_id
               └─< plaid_connections.customer_id

deals(id) ─┬─< deal_submissions.deal_id ─> lenders(id)
           ├─< commissions.deal_id            (UNIQUE — one commission per deal)
           ├─< commissions.deal_submission_id -> deal_submissions(id)
           ├─< deal_underwriting.deal_id
           ├─< underwriting_assessments.deal_id
           ├─< mca_applications.deal_id
           ├─< bank_analyses.deal_id
           └─< deals.original_deal_id (self — renewals)

closers(id) ─┬─< commissions.closer_id        ⚠ closer id
             ├─< closer_documents.closer_id
             └─< closer_document_signatures.closer_id

closer_doc_templates(slug) ─< closer_document_signatures.doc_slug
lenders(id) ─┬─< lender_programs.lender_id
             ├─< lender_documents.lender_id
             └─< funder_submission_profiles.lender_id
marketing_vendors(id) ─┬─< campaigns.vendor_id ├─< lead_sources.vendor_id
                       ├─< customers.vendor_id └─< vendor_documents.vendor_id
campaigns(id) ─┬─< deals.campaign_id  └─< campaign_analyses.campaign_id
inbound_lead_sources(key) ─< lead_import_batches.source_key ─< lead_intake_log.batch_id
```

`activity_log` is a **polymorphic** audit trail (`entity_type` text + `entity_id` uuid, no FK) — `entity_type` values in use include `customer`, `deal`, `lender`. It is also the substrate for email-marker reconciliation (`[emsg:<id>]` markers embedded in `content`).

---

## Table catalogue

### Pipeline & CRM
| Table | Purpose |
|-------|---------|
| `customers` | Merchant/lead record. `status` = `customer_status` enum (**separate lifecycle from `deals.status`**). Holds `ghl_contact_id`, `do_not_contact`, `lead_qual` jsonb, `import_batch_id`. |
| `deals` | See above. |
| `deal_submissions` | One row per (deal, funder) submission. `status` CHECK: `pending \| submitted \| under_review \| approved \| declined \| offer_made \| offer_accepted \| offer_declined \| funded \| withdrawn`. Offer terms (`offer_amount`, `factor_rate`, `term_months`, `daily_payment`…), reply intelligence (`response_type`, `response_summary`, `response_data`, `classified_at`), open tracking (`opened_at`, `open_count`), `courtesy_sent_at`, `withdrawn_at`, `sent_payload` jsonb. |
| `customer_documents` | Merchant docs; `document_type` = `customer_document_type`; storage bucket `customer-documents`. |
| `customer_interactions`, `activity_log` | Interaction history / audit trail. |
| `mca_applications` | The full MCA application a closer fills in (business, owner incl. `owner_ssn`, bank routing/account, financials). Pushed to GHL custom fields for the e-sign merge. |
| `messages` | In-app messaging (used for commission notifications). |
| `tcpa_consents` | Consent capture log. |

### Money
| Table | Purpose |
|-------|---------|
| `closers` | Comp roster. `company_lead_split` **default 30**, `self_gen_split` default 70, `renewal_split` default 35, `draw_*`, `max_leads_per_month` (default 50), `status` (`active\|inactive\|terminated`), `renewals_enabled` (gates `/admin/renewals`), `user_id` → profiles. |
| `commissions` | One per funded deal (`commissions_deal_id_unique`). `gross_commission`, `commission_points`, `closer_id`→closers, `closer_split_percentage`, `closer_amount`, `company_amount`, `sub_iso_id`, `override_points/amount`, `manager_override_*`, `payment_status`, `approved_at/by`, `hold_reason`, `clawback_amount/reason`. |
| `sub_isos` | Sub-ISO partner roster (0 rows live). |
| `lead_sources`, `campaigns`, `campaign_analyses` | Spend/ROI. `campaigns.code` auto-minted by trigger `trg_set_campaign_code` → `next_campaign_code(partner, channel, year)`. |

### Funder network
| Table | Purpose |
|-------|---------|
| `lenders` (121 rows) | Funder records. |
| `lender_programs` (107) | Per-product terms + **structured doc requirements** (`doc_bank_statement_months`, `doc_application`, `doc_photo_id`, `doc_voided_check`, `doc_cc_processing`, `doc_mtd_statement`, `doc_proof_of_ownership`, `doc_ar_aging`, `doc_tax_financials`, `doc_conditions`, `doc_other`) — consumed by `src/services/funderAvailability.ts` and `lenderMatch.ts`. |
| `funder_submission_profiles` (35) | Per-funder submission **recipe** executed by `submit-to-funders`: `method`, `to_email`, `cc_emails`, `subject_template`, `body_template`, `attach_docs` (slugs from `customer_document_type`), `attachment_mode`, `max_statement_months`, `portal_*`, `required_stips`, `special_instructions`, `active`. |
| `lender_documents`, `funder_directory_notes`, `funder_directory_hidden` | Agreements/rate sheets + directory UX state. |

### Underwriting
| Table | Purpose |
|-------|---------|
| `deal_underwriting` (14) | Output of the AI underwriter: `version`, `run_mode` (`manual\|auto`), `docs_hash` (dedup), `per_statement` jsonb, `metrics`, `flags`, `assumptions`, `risk_rating`, `affordability_rating`, `ai_narrative`, `settings_snapshot`, `extraction_model`, `judge_model`. |
| `underwriting_settings` (1) | Admin-tunable thresholds + models: `padding_categories`, `revenue_quality_flag_pct`, `holdback_ceiling_pct`, `nsf_monthly_cap`, `negative_days_flag`, `debt_service_flag_pct`, `min_avg_daily_balance`, `owner_payroll_treatment`, `max_payment_pct_of_revenue`, `balance_buffer_pct`, `affordability_factor_rate`, `term_daily_biz_days`, `term_weekly_weeks`, `extraction_model`, `judge_model`. |
| `bank_analyses`, `plaid_connections`, `underwriting_assessments`, `underwriting_scorecards` | Older manual/Plaid workbench (all **0 rows** — see [09](./09-doc-drift.md)). |

### Closer onboarding & e-signature
| Table | Purpose |
|-------|---------|
| `closer_doc_templates` (6) | Authoritative doc text (`body_md`), `action` ∈ `sign\|collect\|complete`, `esignable`, `version`. |
| `closer_documents` (27) | Per-closer tracker. `status` ∈ `not_sent\|sent\|signed\|na`; `merged_content` + `merged_sha256` freeze exactly what was sent. Seeded automatically by trigger `closers_seed_documents` on closer INSERT. |
| `closer_document_signatures` | **Append-only ledger.** No UPDATE and no DELETE policy exists for any role, by design. Stores `content_snapshot`, `content_sha256`, `signer_name`, `consent_text`, `ip_address`, `user_agent`. |

### Lead intake & ops
`inbound_lead_sources` (routing config: `feed_type`, `creates_deal`, `default_status`, `first_call_sla_seconds`, `match_rule`, `unit_cost`), `lead_import_batches`, `lead_intake_log`, `lead_assignment_state`, `lead_tools`, `marketing_vendors`, `vendor_documents`, `referral_partners`, `follow_up_sequences`, `compliance_disclosures` (10 states), `ghl_webhook_events` (inbound webhook log), `contact_submissions`, `funding_applications`, `email_domains`.

### Platform
`profiles`, `platform_settings` (kv jsonb — live keys: `lead_assignment`, `closer_docs`), `llm_settings` (singleton `id=1`), `llm_provider_keys`, `kanban_tasks`/`task_comments`/`task_activity`/`kanban_phases`/`kanban_categories`, `blog_posts`, `company_documents`, `documents`/`document_chunks`/`document_embeddings` (pgvector RAG scaffolding, 0 rows).

## Storage buckets

| Bucket | Public |
|--------|--------|
| `avatars` | ✅ public |
| `customer-documents` | private |
| `lender-documents` | private |
| `company-documents` | private |
| `vendor-documents` | private |

⚠️ Bucket **object policies are not owner-scoped** — see [08 — Security posture](./08-security-posture.md), finding #1.

## Analytics views

`v_closer_performance`, `v_lender_approval_rates`, `v_market_performance`, `v_monthly_revenue`, `v_pipeline_velocity` — consumed by `src/services/analyticsService.ts`.
