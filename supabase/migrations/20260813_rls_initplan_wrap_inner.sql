-- RLS initplan hoist, pass 2 (cosmetic / linter-clean).
-- The outer helper call on these policies was already hoisted into an InitPlan by
-- 20260813_rls_initplan_wrap.sql, so the inner auth.uid() already ran once per query.
-- Wrapping it too changes nothing semantically or in the plan; it clears the last
-- 62 Supabase advisor auth_rls_initplan warnings so future audits start clean.

ALTER POLICY "Admins can insert activity_log" ON public."activity_log"
  WITH CHECK (( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff));

ALTER POLICY "Admins can update activity_log" ON public."activity_log"
  USING (( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff));

ALTER POLICY "Admins can view activity_log" ON public."activity_log"
  USING (( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff));

ALTER POLICY "Staff can view campaign analyses" ON public."campaign_analyses"
  USING (( SELECT is_staff(( SELECT auth.uid())) AS is_staff));

ALTER POLICY "Staff can view campaigns" ON public."campaigns"
  USING (( SELECT is_staff(( SELECT auth.uid())) AS is_staff));

ALTER POLICY "admin_all_customer_docs" ON public."customer_documents"
  USING (( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff))
  WITH CHECK (( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff));

ALTER POLICY "admin_all_interactions" ON public."customer_interactions"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super))
  WITH CHECK (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "admin_all_customers" ON public."customers"
  USING (( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff))
  WITH CHECK (( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff));

ALTER POLICY "deal_doc_requests_staff_all" ON public."deal_doc_requests"
  USING (( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff))
  WITH CHECK (( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff));

ALTER POLICY "Admins manage deal_submissions" ON public."deal_submissions"
  USING (( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff))
  WITH CHECK (( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff));

ALTER POLICY "Admins manage deals" ON public."deals"
  USING (( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff))
  WITH CHECK (( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff));

ALTER POLICY "admin_select_email_open_events" ON public."email_open_events"
  USING (( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff));

ALTER POLICY "admin_manage_fdh" ON public."funder_directory_hidden"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super))
  WITH CHECK (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "Ops staff manage funder_replies" ON public."funder_replies"
  USING (( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff))
  WITH CHECK (( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff));

ALTER POLICY "admin_manage_funder_profiles" ON public."funder_submission_profiles"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super))
  WITH CHECK (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "employee_read_funder_profiles" ON public."funder_submission_profiles"
  USING (( SELECT is_employee(( SELECT auth.uid())) AS is_employee));

ALTER POLICY "staff_select_ghl_call_log" ON public."ghl_call_log"
  USING (( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff));

ALTER POLICY "admin_select_ghl_doc_completions" ON public."ghl_doc_completions"
  USING (( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff));

ALTER POLICY "hotprospector_account_daily_admin_read" ON public."hotprospector_account_daily"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "hotprospector_agent_daily_admin_read" ON public."hotprospector_agent_daily"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "hotprospector_disposition_daily_admin_read" ON public."hotprospector_disposition_daily"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "hotprospector_number_health_admin_read" ON public."hotprospector_number_health"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "Admins can view all tasks" ON public."kanban_tasks"
  USING ((( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super) OR ((( SELECT is_employee(( SELECT auth.uid())) AS is_employee) OR ( SELECT is_closer(( SELECT auth.uid())) AS is_closer)) AND (status <> 'backlog'::text))));

ALTER POLICY "Assignees can update own tasks" ON public."kanban_tasks"
  USING (((assigned_to = ( SELECT auth.uid() AS uid)) AND (( SELECT is_employee(( SELECT auth.uid())) AS is_employee) OR ( SELECT is_closer(( SELECT auth.uid())) AS is_closer)) AND (status <> 'backlog'::text)))
  WITH CHECK (((( SELECT is_employee(( SELECT auth.uid())) AS is_employee) OR ( SELECT is_closer(( SELECT auth.uid())) AS is_closer)) AND (status <> 'backlog'::text)));

ALTER POLICY "admin_delete_lender_docs" ON public."lender_documents"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "admin_insert_lender_docs" ON public."lender_documents"
  WITH CHECK (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "admin_update_lender_docs" ON public."lender_documents"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super))
  WITH CHECK (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "admin_view_lender_docs" ON public."lender_documents"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "super_admin_all_lender_docs" ON public."lender_documents"
  USING (( SELECT is_super_admin(( SELECT auth.uid())) AS is_super_admin))
  WITH CHECK (( SELECT is_super_admin(( SELECT auth.uid())) AS is_super_admin));

ALTER POLICY "lp_del" ON public."lender_programs"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "lp_ins" ON public."lender_programs"
  WITH CHECK (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "lp_upd" ON public."lender_programs"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super))
  WITH CHECK (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "admin_insert_lenders" ON public."lenders"
  WITH CHECK (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "admin_update_lenders" ON public."lenders"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super))
  WITH CHECK (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "admin_view_lenders" ON public."lenders"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "employee_read_lenders" ON public."lenders"
  USING (( SELECT is_employee(( SELECT auth.uid())) AS is_employee));

ALTER POLICY "super_admin_all_lenders" ON public."lenders"
  USING (( SELECT is_super_admin(( SELECT auth.uid())) AS is_super_admin))
  WITH CHECK (( SELECT is_super_admin(( SELECT auth.uid())) AS is_super_admin));

ALTER POLICY "admin_view_marketing" ON public."marketing_vendors"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "super_admin_all_marketing" ON public."marketing_vendors"
  USING (( SELECT is_super_admin(( SELECT auth.uid())) AS is_super_admin))
  WITH CHECK (( SELECT is_super_admin(( SELECT auth.uid())) AS is_super_admin));

ALTER POLICY "bank_link_tokens_staff_read" ON public."merchant_bank_link_tokens"
  USING (( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff));

ALTER POLICY "admin_all_messages" ON public."messages"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super))
  WITH CHECK (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "ph_setter_scorecards_admin_all" ON public."ph_setter_scorecards"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super))
  WITH CHECK (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "ph_ucc_agents_admin_read" ON public."ph_ucc_agents"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "ph_ucc_agents_super_write" ON public."ph_ucc_agents"
  USING (( SELECT is_super_admin(( SELECT auth.uid())) AS is_super_admin))
  WITH CHECK (( SELECT is_super_admin(( SELECT auth.uid())) AS is_super_admin));

ALTER POLICY "ph_ucc_contacts_admin_read" ON public."ph_ucc_contacts"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "ph_ucc_filings_admin_read" ON public."ph_ucc_filings"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "ph_ucc_funder_aliases_admin_read" ON public."ph_ucc_funder_aliases"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "ph_ucc_funder_aliases_admin_write" ON public."ph_ucc_funder_aliases"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super))
  WITH CHECK (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "ph_ucc_ingest_jobs_admin_read" ON public."ph_ucc_ingest_jobs"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "ph_ucc_ingest_matches_admin_read" ON public."ph_ucc_ingest_matches"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "ph_ucc_leads_admin_read" ON public."ph_ucc_leads"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "ph_ucc_leads_admin_update" ON public."ph_ucc_leads"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super))
  WITH CHECK (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "ph_ucc_sources_admin_read" ON public."ph_ucc_sources"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "ph_ucc_unmatched_parties_super_read" ON public."ph_ucc_unmatched_parties"
  USING (( SELECT is_super_admin(( SELECT auth.uid())) AS is_super_admin));

ALTER POLICY "ph_ucc_unmatched_parties_super_write" ON public."ph_ucc_unmatched_parties"
  USING (( SELECT is_super_admin(( SELECT auth.uid())) AS is_super_admin))
  WITH CHECK (( SELECT is_super_admin(( SELECT auth.uid())) AS is_super_admin));

ALTER POLICY "plaid_events_staff_read" ON public."plaid_events"
  USING (( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff));

ALTER POLICY "plaid_items_staff_read" ON public."plaid_items"
  USING (( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff));

ALTER POLICY "plaid_tx_staff_read" ON public."plaid_transactions"
  USING (( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff));

ALTER POLICY "Admins can insert activity" ON public."task_activity"
  WITH CHECK ((( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff) OR ( SELECT is_closer(( SELECT auth.uid())) AS is_closer)));

ALTER POLICY "Admins can view activity" ON public."task_activity"
  USING ((( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff) OR ( SELECT is_closer(( SELECT auth.uid())) AS is_closer)));

ALTER POLICY "Admins can insert comments" ON public."task_comments"
  WITH CHECK ((( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff) OR ( SELECT is_closer(( SELECT auth.uid())) AS is_closer)));

ALTER POLICY "Admins can view comments" ON public."task_comments"
  USING ((( SELECT is_ops_staff(( SELECT auth.uid())) AS is_ops_staff) OR ( SELECT is_closer(( SELECT auth.uid())) AS is_closer)));
