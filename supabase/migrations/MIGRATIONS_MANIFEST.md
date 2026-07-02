# Migration history — drift notice & manifest (audit #16)

**Status (2026-06-30):** the **live** database has **67** applied migrations; this
repo's `supabase/migrations/` directory has **~38** `.sql` files with ad-hoc names.
The two sets do not line up 1:1 (repo files predate the CLI-managed naming).

**The live database is the source of truth.** Every schema change this session was
applied via MCP and the corresponding `.sql` was also committed here, but the
historical gap (changes made directly in the dashboard / earlier sessions) remains.

## Proper fix (requires CLI auth)
Once a fresh Supabase access token is in place (see audit #1 — the old `sbp_` token
is dead), reconcile the repo to match live:

```bash
supabase login                      # with a NEW personal access token
supabase link --project-ref ehibjeonqpqskhcvizow
supabase db pull                    # writes the canonical migration history locally
git add supabase/migrations && git commit -m "Reconcile migration history with live (db pull)"
```

That regenerates the full, correctly-named migration set from the live
`supabase_migrations.schema_migrations` table (which stores each migration's SQL),
ending the drift. Until then, treat live as canonical and keep adding new migrations
both via MCP **and** as committed files (as done this session).

## Live migration manifest (67) — version  name
```
20260115011104  create_roles_and_profiles
20260115011449  add_comprehensive_profile_fields
20260115011956  fix_profiles_rls_policies
20260127003834  create_avatars_bucket
20260127005735  enable_pgvector_and_create_rag_tables
20260201023755  create_funding_applications_table
20260201163724  add_ein_column_to_funding_applications
20260201172553  create_kanban_tasks
20260201175511  add_task_notes_and_activity
20260201182125  create_kanban_settings
20260201200144  create_crm_tables
20260201205048  add_company_fields_to_profiles
20260201224419  add_paper_types_to_lenders
20260201231521  add_storage_policies_for_documents
20260202003305  change_lender_documents_default_status
20260202012414  create_company_documents
20260202131554  enhanced_vendor_lender_fields
20260202165511  fix_minimum_order_column_type
20260203141523  create_activity_log
20260213025725  customer_analytics_columns
20260213025730  customer_renewal_status
20260213025736  analytics_views
20260214040423  add_renewed_status_enum
20260626015634  ghl_integration_foundation
20260626144146  create_deals_pipeline
20260626144213  create_commissions_engine
20260626144304  create_analytics_views
20260626144349  harden_deals_rls
20260626151037  follow_up_sequences_and_webhook_config
20260626194913  bank_analyses_and_plaid
20260626202655  add_bank_statements_stage
20260626203400  add_offer_accepted_stage
20260626204415  add_deal_lost_reason
20260626204537  add_dead_and_dnc_handling
20260626210514  add_nurture_stage
20260626211450  underwriting_assessments
20260627235318  commission_on_funded_trigger
20260628010159  lender_ghl_tag_slug
20260628010802  vcf_deal_type_and_stages
20260628024623  security_hardening
20260628025244  compliance_disclosures
20260628030149  fill_disclosure_templates
20260628031316  referral_partners
20260628031658  ghl_webhook_events
20260628033722  underwriting_scorecards
20260628033938  platform_settings
20260628034601  blog_posts
20260628040042  create_contact_submissions
20260628232646  add_closer_role
20260628232701  create_lead_tools_registry
20260628235536  profiles_super_admin_management
20260628235607  refine_role_escalation_guard
20260629004746  campaigns_with_deal_attribution
20260629014150  staff_can_manage_customers_deals
20260629014518  add_vendor_buyer_reqs_and_ghl
20260629014842  add_vendor_list_pricing
20260629014927  add_vendor_rank
20260629022945  add_vendor_scoring
20260629023704  add_vendor_reputation_score
20260629024007  add_vendor_payment_and_scorecard
20260629025446  create_vendor_documents
20260629192807  admin_can_manage_lenders
20260629202217  add_ghl_business_and_contact_ids
20260629204002  closer_company_lead_split_default_35
20260630020603  closer_rls_lockdown_and_funder_read
20260630020756  closer_scoped_access_activity_docs_submissions
20260630030346  tcpa_consents_log
20260702000001  add_employee_role
20260702000002  employee_role_helpers_and_policies
20260702000003  kanban_backlog_admin_only
```
