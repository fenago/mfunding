-- RLS initplan hoist: wrap auth.<fn>() / auth-helper calls in scalar subqueries
-- so Postgres evaluates them ONCE per query (InitPlan) instead of once per row.
-- Semantics are unchanged: every wrapped span is column-free, so the subquery is
-- uncorrelated and returns the identical value the bare call returned per row.
-- Generated from pg_policies; applied with ALTER POLICY so cmd/roles/permissive
-- are preserved exactly. Silences Supabase advisor lint 0003_auth_rls_initplan.

ALTER POLICY "Admins can insert activity_log" ON public."activity_log"
  WITH CHECK (( SELECT is_ops_staff(auth.uid())));

ALTER POLICY "Admins can update activity_log" ON public."activity_log"
  USING (( SELECT is_ops_staff(auth.uid())));

ALTER POLICY "Admins can view activity_log" ON public."activity_log"
  USING (( SELECT is_ops_staff(auth.uid())));

ALTER POLICY "closer_insert_own_activity" ON public."activity_log"
  WITH CHECK ((( SELECT is_closer(( SELECT auth.uid() AS uid))) AND (entity_type = 'customer'::text) AND closer_owns_customer(( SELECT auth.uid() AS uid), entity_id)));

ALTER POLICY "closer_insert_own_deal_activity" ON public."activity_log"
  WITH CHECK ((( SELECT is_closer(( SELECT auth.uid() AS uid))) AND (entity_type = 'deal'::text) AND closer_owns_deal(( SELECT auth.uid() AS uid), entity_id)));

ALTER POLICY "closer_select_own_activity" ON public."activity_log"
  USING ((( SELECT is_closer(( SELECT auth.uid() AS uid))) AND (entity_type = 'customer'::text) AND closer_owns_customer(( SELECT auth.uid() AS uid), entity_id)));

ALTER POLICY "closer_select_own_deal_activity" ON public."activity_log"
  USING ((( SELECT is_closer(( SELECT auth.uid() AS uid))) AND (entity_type = 'deal'::text) AND closer_owns_deal(( SELECT auth.uid() AS uid), entity_id)));

ALTER POLICY "Admins manage bank_analyses" ON public."bank_analyses"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "Super admins manage posts" ON public."blog_posts"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role)))));

ALTER POLICY "Closers read enrichment on own deals" ON public."business_enrichment"
  USING ((( SELECT is_closer(( SELECT auth.uid() AS uid))) AND (deal_id IS NOT NULL) AND closer_owns_deal(( SELECT auth.uid() AS uid), deal_id)));

ALTER POLICY "call_audit_calls_admin_select" ON public."call_audit_calls"
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid())) AND (p.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "call_audit_runs_admin_select" ON public."call_audit_runs"
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid())) AND (p.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "Staff can view campaign analyses" ON public."campaign_analyses"
  USING (( SELECT is_staff(auth.uid())));

ALTER POLICY "Super admins can manage campaign analyses" ON public."campaign_analyses"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role)))));

ALTER POLICY "Staff can view campaigns" ON public."campaigns"
  USING (( SELECT is_staff(auth.uid())));

ALTER POLICY "Super admins can manage campaigns" ON public."campaigns"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role)))));

ALTER POLICY "closer_doc_templates_staff_read" ON public."closer_doc_templates"
  USING (( SELECT is_staff(( SELECT auth.uid() AS uid))));

ALTER POLICY "closer_doc_templates_super_manage" ON public."closer_doc_templates"
  USING (( SELECT is_super_admin(( SELECT auth.uid() AS uid))))
  WITH CHECK (( SELECT is_super_admin(( SELECT auth.uid() AS uid))));

ALTER POLICY "closer_doc_sig_staff_read" ON public."closer_document_signatures"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid() AS uid))));

ALTER POLICY "closer_documents_staff_manage" ON public."closer_documents"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid() AS uid))))
  WITH CHECK (( SELECT is_admin_or_super(( SELECT auth.uid() AS uid))));

ALTER POLICY "Admins can view closers" ON public."closers"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "Closers can view own record" ON public."closers"
  USING ((user_id = ( SELECT auth.uid())));

ALTER POLICY "Super admins can manage closers" ON public."closers"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role)))));

ALTER POLICY "Admins can view commissions" ON public."commissions"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "Super admins can manage commissions" ON public."commissions"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role)))));

ALTER POLICY "Super admins can manage company documents" ON public."company_documents"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role)))));

ALTER POLICY "Super admins manage disclosures" ON public."compliance_disclosures"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role)))));

ALTER POLICY "Admins can view contact submissions" ON public."contact_submissions"
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid())) AND (p.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "cron_job_run_summary_admin_read" ON public."cron_job_run_summary"
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid())) AND (p.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "admin_all_customer_docs" ON public."customer_documents"
  USING (( SELECT is_ops_staff(auth.uid())))
  WITH CHECK (( SELECT is_ops_staff(auth.uid())));

ALTER POLICY "closer_insert_own_customer_docs" ON public."customer_documents"
  WITH CHECK ((( SELECT is_closer(( SELECT auth.uid() AS uid))) AND closer_owns_customer(( SELECT auth.uid() AS uid), customer_id)));

ALTER POLICY "closer_select_own_customer_docs" ON public."customer_documents"
  USING ((( SELECT is_closer(( SELECT auth.uid() AS uid))) AND closer_owns_customer(( SELECT auth.uid() AS uid), customer_id)));

ALTER POLICY "admin_all_interactions" ON public."customer_interactions"
  USING (( SELECT is_admin_or_super(auth.uid())))
  WITH CHECK (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "admin_all_customers" ON public."customers"
  USING (( SELECT is_ops_staff(auth.uid())))
  WITH CHECK (( SELECT is_ops_staff(auth.uid())));

ALTER POLICY "closer_insert_customers" ON public."customers"
  WITH CHECK (( SELECT is_closer(( SELECT auth.uid() AS uid))));

ALTER POLICY "closer_select_all_customers" ON public."customers"
  USING ((( SELECT is_closer(( SELECT auth.uid() AS uid))) OR ( SELECT has_closer_row(( SELECT auth.uid() AS uid)))));

ALTER POLICY "closer_update_own_customers" ON public."customers"
  USING ((( SELECT is_closer(( SELECT auth.uid() AS uid))) AND closer_owns_customer(( SELECT auth.uid() AS uid), id)))
  WITH CHECK ((( SELECT is_closer(( SELECT auth.uid() AS uid))) AND closer_owns_customer(( SELECT auth.uid() AS uid), id)));

ALTER POLICY "deal_doc_requests_closer_all" ON public."deal_doc_requests"
  USING (closer_owns_customer(( SELECT auth.uid()), customer_id))
  WITH CHECK (closer_owns_customer(( SELECT auth.uid()), customer_id));

ALTER POLICY "deal_doc_requests_staff_all" ON public."deal_doc_requests"
  USING (( SELECT is_ops_staff(auth.uid())))
  WITH CHECK (( SELECT is_ops_staff(auth.uid())));

ALTER POLICY "Admins manage deal_submissions" ON public."deal_submissions"
  USING (( SELECT is_ops_staff(auth.uid())))
  WITH CHECK (( SELECT is_ops_staff(auth.uid())));

ALTER POLICY "closer_insert_own_submissions" ON public."deal_submissions"
  WITH CHECK ((( SELECT is_closer(( SELECT auth.uid() AS uid))) AND closer_owns_deal(( SELECT auth.uid() AS uid), deal_id)));

ALTER POLICY "closer_select_own_submissions" ON public."deal_submissions"
  USING ((( SELECT is_closer(( SELECT auth.uid() AS uid))) AND closer_owns_deal(( SELECT auth.uid() AS uid), deal_id)));

ALTER POLICY "closer_update_own_submissions" ON public."deal_submissions"
  USING ((( SELECT is_closer(( SELECT auth.uid() AS uid))) AND closer_owns_deal(( SELECT auth.uid() AS uid), deal_id)))
  WITH CHECK ((( SELECT is_closer(( SELECT auth.uid() AS uid))) AND closer_owns_deal(( SELECT auth.uid() AS uid), deal_id)));

ALTER POLICY "deal_uw_select" ON public."deal_underwriting"
  USING ((( SELECT is_admin_or_super(( SELECT auth.uid() AS uid))) OR closer_owns_deal(( SELECT auth.uid() AS uid), deal_id)));

ALTER POLICY "Admins manage deals" ON public."deals"
  USING (( SELECT is_ops_staff(auth.uid())))
  WITH CHECK (( SELECT is_ops_staff(auth.uid())));

ALTER POLICY "closer_claim_unassigned_deals" ON public."deals"
  USING (((( SELECT is_closer(( SELECT auth.uid() AS uid))) OR ( SELECT has_closer_row(( SELECT auth.uid() AS uid)))) AND (assigned_closer_id IS NULL)))
  WITH CHECK (((( SELECT is_closer(( SELECT auth.uid() AS uid))) OR ( SELECT has_closer_row(( SELECT auth.uid() AS uid)))) AND (assigned_closer_id = ( SELECT auth.uid() AS uid))));

ALTER POLICY "closer_insert_deals" ON public."deals"
  WITH CHECK (( SELECT is_closer(( SELECT auth.uid() AS uid))));

ALTER POLICY "closer_select_all_deals" ON public."deals"
  USING ((( SELECT is_closer(( SELECT auth.uid() AS uid))) OR ( SELECT has_closer_row(( SELECT auth.uid() AS uid)))));

ALTER POLICY "closer_update_own_deals" ON public."deals"
  USING ((( SELECT is_closer(( SELECT auth.uid() AS uid))) AND closer_owns_deal(( SELECT auth.uid() AS uid), id)))
  WITH CHECK ((( SELECT is_closer(( SELECT auth.uid() AS uid))) AND closer_owns_deal(( SELECT auth.uid() AS uid), id)));

ALTER POLICY "Users can delete their own chunks" ON public."document_chunks"
  USING ((( SELECT auth.uid()) = user_id));

ALTER POLICY "Users can insert their own chunks" ON public."document_chunks"
  WITH CHECK ((( SELECT auth.uid()) = user_id));

ALTER POLICY "Users can view their own chunks" ON public."document_chunks"
  USING ((( SELECT auth.uid()) = user_id));

ALTER POLICY "Admins read document_embeddings" ON public."document_embeddings"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "Users can delete their own documents" ON public."documents"
  USING ((( SELECT auth.uid()) = user_id));

ALTER POLICY "Users can insert their own documents" ON public."documents"
  WITH CHECK ((( SELECT auth.uid()) = user_id));

ALTER POLICY "Users can update their own documents" ON public."documents"
  USING ((( SELECT auth.uid()) = user_id));

ALTER POLICY "Users can view their own documents" ON public."documents"
  USING ((( SELECT auth.uid()) = user_id));

ALTER POLICY "email_domains_ops_all" ON public."email_domains"
  USING (( SELECT is_ops_staff(( SELECT auth.uid() AS uid))))
  WITH CHECK (( SELECT is_ops_staff(( SELECT auth.uid() AS uid))));

ALTER POLICY "admin_select_email_open_events" ON public."email_open_events"
  USING (( SELECT is_ops_staff(auth.uid())));

ALTER POLICY "Admins manage follow_up_sequences" ON public."follow_up_sequences"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "admin_manage_fdh" ON public."funder_directory_hidden"
  USING (( SELECT is_admin_or_super(auth.uid())))
  WITH CHECK (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "funder_directory_notes_ops" ON public."funder_directory_notes"
  USING ((( SELECT is_ops_staff(( SELECT auth.uid() AS uid))) OR ( SELECT is_super_admin(( SELECT auth.uid() AS uid)))))
  WITH CHECK ((( SELECT is_ops_staff(( SELECT auth.uid() AS uid))) OR ( SELECT is_super_admin(( SELECT auth.uid() AS uid)))));

ALTER POLICY "Ops staff manage funder_replies" ON public."funder_replies"
  USING (( SELECT is_ops_staff(auth.uid())))
  WITH CHECK (( SELECT is_ops_staff(auth.uid())));

ALTER POLICY "admin_manage_funder_profiles" ON public."funder_submission_profiles"
  USING (( SELECT is_admin_or_super(auth.uid())))
  WITH CHECK (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "employee_read_funder_profiles" ON public."funder_submission_profiles"
  USING (( SELECT is_employee(auth.uid())));

ALTER POLICY "Admins can view applications" ON public."funding_applications"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "staff_select_ghl_call_log" ON public."ghl_call_log"
  USING (( SELECT is_ops_staff(auth.uid())));

ALTER POLICY "admin_select_ghl_doc_completions" ON public."ghl_doc_completions"
  USING (( SELECT is_ops_staff(auth.uid())));

ALTER POLICY "Admins read webhook events" ON public."ghl_webhook_events"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "hotprospector_account_daily_admin_read" ON public."hotprospector_account_daily"
  USING (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "hotprospector_agent_daily_admin_read" ON public."hotprospector_agent_daily"
  USING (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "hotprospector_disposition_daily_admin_read" ON public."hotprospector_disposition_daily"
  USING (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "hotprospector_number_health_admin_read" ON public."hotprospector_number_health"
  USING (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "inbound_lead_sources_ops" ON public."inbound_lead_sources"
  USING ((( SELECT is_ops_staff(( SELECT auth.uid() AS uid))) OR ( SELECT is_super_admin(( SELECT auth.uid() AS uid)))))
  WITH CHECK ((( SELECT is_ops_staff(( SELECT auth.uid() AS uid))) OR ( SELECT is_super_admin(( SELECT auth.uid() AS uid)))));

ALTER POLICY "Admins can view categories" ON public."kanban_categories"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "Super admins can manage categories" ON public."kanban_categories"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role)))));

ALTER POLICY "Admins can view phases" ON public."kanban_phases"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "Super admins can manage phases" ON public."kanban_phases"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role)))));

ALTER POLICY "Admins can insert tasks" ON public."kanban_tasks"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "Admins can update tasks" ON public."kanban_tasks"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "Admins can view all tasks" ON public."kanban_tasks"
  USING ((( SELECT is_admin_or_super(auth.uid())) OR ((( SELECT is_employee(auth.uid())) OR ( SELECT is_closer(auth.uid()))) AND (status <> 'backlog'::text))));

ALTER POLICY "Assignees can update own tasks" ON public."kanban_tasks"
  USING (((assigned_to = ( SELECT auth.uid() AS uid)) AND (( SELECT is_employee(auth.uid())) OR ( SELECT is_closer(auth.uid()))) AND (status <> 'backlog'::text)))
  WITH CHECK (((( SELECT is_employee(auth.uid())) OR ( SELECT is_closer(auth.uid()))) AND (status <> 'backlog'::text)));

ALTER POLICY "Super admins can delete tasks" ON public."kanban_tasks"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role)))));

ALTER POLICY "lead_assignment_state_admin_read" ON public."lead_assignment_state"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid() AS uid))));

ALTER POLICY "lead_batches_admin_all" ON public."lead_batches"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super))
  WITH CHECK (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "lead_import_batches_ops" ON public."lead_import_batches"
  USING ((( SELECT is_ops_staff(( SELECT auth.uid() AS uid))) OR ( SELECT is_super_admin(( SELECT auth.uid() AS uid)))))
  WITH CHECK ((( SELECT is_ops_staff(( SELECT auth.uid() AS uid))) OR ( SELECT is_super_admin(( SELECT auth.uid() AS uid)))));

ALTER POLICY "lead_intake_log_ops" ON public."lead_intake_log"
  USING ((( SELECT is_ops_staff(( SELECT auth.uid() AS uid))) OR ( SELECT is_super_admin(( SELECT auth.uid() AS uid)))))
  WITH CHECK ((( SELECT is_ops_staff(( SELECT auth.uid() AS uid))) OR ( SELECT is_super_admin(( SELECT auth.uid() AS uid)))));

ALTER POLICY "lead_push_jobs_admin_all" ON public."lead_push_jobs"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super))
  WITH CHECK (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "lead_records_admin_all" ON public."lead_records"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super))
  WITH CHECK (( SELECT is_admin_or_super(( SELECT auth.uid())) AS is_admin_or_super));

ALTER POLICY "Admins can view lead_sources" ON public."lead_sources"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "Super admins can manage lead_sources" ON public."lead_sources"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role)))));

ALTER POLICY "Admins manage lead tools" ON public."lead_tools"
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid())) AND (p.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid())) AND (p.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "admin_delete_lender_docs" ON public."lender_documents"
  USING (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "admin_insert_lender_docs" ON public."lender_documents"
  WITH CHECK (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "admin_update_lender_docs" ON public."lender_documents"
  USING (( SELECT is_admin_or_super(auth.uid())))
  WITH CHECK (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "admin_view_lender_docs" ON public."lender_documents"
  USING (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "super_admin_all_lender_docs" ON public."lender_documents"
  USING (( SELECT is_super_admin(auth.uid())))
  WITH CHECK (( SELECT is_super_admin(auth.uid())));

ALTER POLICY "lp_del" ON public."lender_programs"
  USING (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "lp_ins" ON public."lender_programs"
  WITH CHECK (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "lp_read" ON public."lender_programs"
  USING (( SELECT is_ops_staff(( SELECT auth.uid() AS uid))));

ALTER POLICY "lp_upd" ON public."lender_programs"
  USING (( SELECT is_admin_or_super(auth.uid())))
  WITH CHECK (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "admin_insert_lenders" ON public."lenders"
  WITH CHECK (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "admin_update_lenders" ON public."lenders"
  USING (( SELECT is_admin_or_super(auth.uid())))
  WITH CHECK (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "admin_view_lenders" ON public."lenders"
  USING (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "employee_read_lenders" ON public."lenders"
  USING (( SELECT is_employee(auth.uid())));

ALTER POLICY "super_admin_all_lenders" ON public."lenders"
  USING (( SELECT is_super_admin(auth.uid())))
  WITH CHECK (( SELECT is_super_admin(auth.uid())));

ALTER POLICY "Super admins manage llm_settings" ON public."llm_settings"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role)))));

ALTER POLICY "admin_view_marketing" ON public."marketing_vendors"
  USING (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "super_admin_all_marketing" ON public."marketing_vendors"
  USING (( SELECT is_super_admin(auth.uid())))
  WITH CHECK (( SELECT is_super_admin(auth.uid())));

ALTER POLICY "closer_insert_own_mca_applications" ON public."mca_applications"
  WITH CHECK ((( SELECT is_closer(( SELECT auth.uid() AS uid))) AND closer_owns_deal(( SELECT auth.uid() AS uid), deal_id)));

ALTER POLICY "closer_select_own_mca_applications" ON public."mca_applications"
  USING ((( SELECT is_closer(( SELECT auth.uid() AS uid))) AND closer_owns_deal(( SELECT auth.uid() AS uid), deal_id)));

ALTER POLICY "closer_update_own_mca_applications" ON public."mca_applications"
  USING ((( SELECT is_closer(( SELECT auth.uid() AS uid))) AND closer_owns_deal(( SELECT auth.uid() AS uid), deal_id)))
  WITH CHECK ((( SELECT is_closer(( SELECT auth.uid() AS uid))) AND closer_owns_deal(( SELECT auth.uid() AS uid), deal_id)));

ALTER POLICY "ops_all_mca_applications" ON public."mca_applications"
  USING (( SELECT is_ops_staff(( SELECT auth.uid() AS uid))))
  WITH CHECK (( SELECT is_ops_staff(( SELECT auth.uid() AS uid))));

ALTER POLICY "bank_link_tokens_staff_read" ON public."merchant_bank_link_tokens"
  USING (( SELECT is_ops_staff(auth.uid())));

ALTER POLICY "merchant_doc_templates_staff_manage" ON public."merchant_doc_templates"
  USING (( SELECT is_ops_staff(( SELECT auth.uid() AS uid))))
  WITH CHECK (( SELECT is_ops_staff(( SELECT auth.uid() AS uid))));

ALTER POLICY "merchant_doc_sig_staff_read" ON public."merchant_document_signatures"
  USING (( SELECT is_ops_staff(( SELECT auth.uid() AS uid))));

ALTER POLICY "merchant_documents_staff_manage" ON public."merchant_documents"
  USING (( SELECT is_ops_staff(( SELECT auth.uid() AS uid))))
  WITH CHECK (( SELECT is_ops_staff(( SELECT auth.uid() AS uid))));

ALTER POLICY "admin_all_messages" ON public."messages"
  USING (( SELECT is_admin_or_super(auth.uid())))
  WITH CHECK (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "user_own_messages" ON public."messages"
  USING (((( SELECT auth.uid()) = to_user_id) OR (( SELECT auth.uid()) = from_user_id)));

ALTER POLICY "user_send_messages" ON public."messages"
  WITH CHECK (((( SELECT auth.uid()) = from_user_id) AND (is_ops_staff(from_user_id) OR is_ops_staff(to_user_id))));

ALTER POLICY "user_update_received" ON public."messages"
  USING ((( SELECT auth.uid()) = to_user_id))
  WITH CHECK ((( SELECT auth.uid()) = to_user_id));

ALTER POLICY "Staff read ops alert state" ON public."ops_alert_state"
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid())) AND (p.role = ANY (ARRAY['closer'::user_role, 'admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "payout insert own" ON public."payout_profiles"
  WITH CHECK ((profile_id = ( SELECT auth.uid())));

ALTER POLICY "payout read own or super" ON public."payout_profiles"
  USING (((profile_id = ( SELECT auth.uid())) OR ( SELECT is_super_admin())));

ALTER POLICY "payout update own" ON public."payout_profiles"
  USING ((profile_id = ( SELECT auth.uid())))
  WITH CHECK ((profile_id = ( SELECT auth.uid())));

ALTER POLICY "payout update super" ON public."payout_profiles"
  USING (( SELECT is_super_admin()))
  WITH CHECK (( SELECT is_super_admin()));

ALTER POLICY "ph_setter_scorecards_admin_all" ON public."ph_setter_scorecards"
  USING (( SELECT is_admin_or_super(auth.uid())))
  WITH CHECK (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "ph_ucc_agents_admin_read" ON public."ph_ucc_agents"
  USING (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "ph_ucc_agents_super_write" ON public."ph_ucc_agents"
  USING (( SELECT is_super_admin(auth.uid())))
  WITH CHECK (( SELECT is_super_admin(auth.uid())));

ALTER POLICY "ph_ucc_contacts_admin_read" ON public."ph_ucc_contacts"
  USING (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "ph_ucc_filings_admin_read" ON public."ph_ucc_filings"
  USING (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "ph_ucc_funder_aliases_admin_read" ON public."ph_ucc_funder_aliases"
  USING (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "ph_ucc_funder_aliases_admin_write" ON public."ph_ucc_funder_aliases"
  USING (( SELECT is_admin_or_super(auth.uid())))
  WITH CHECK (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "ph_ucc_ingest_jobs_admin_read" ON public."ph_ucc_ingest_jobs"
  USING (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "ph_ucc_ingest_matches_admin_read" ON public."ph_ucc_ingest_matches"
  USING (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "ph_ucc_leads_admin_read" ON public."ph_ucc_leads"
  USING (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "ph_ucc_leads_admin_update" ON public."ph_ucc_leads"
  USING (( SELECT is_admin_or_super(auth.uid())))
  WITH CHECK (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "ph_ucc_sources_admin_read" ON public."ph_ucc_sources"
  USING (( SELECT is_admin_or_super(auth.uid())));

ALTER POLICY "ph_ucc_unmatched_parties_super_read" ON public."ph_ucc_unmatched_parties"
  USING (( SELECT is_super_admin(auth.uid())));

ALTER POLICY "ph_ucc_unmatched_parties_super_write" ON public."ph_ucc_unmatched_parties"
  USING (( SELECT is_super_admin(auth.uid())))
  WITH CHECK (( SELECT is_super_admin(auth.uid())));

ALTER POLICY "Admins manage plaid_connections" ON public."plaid_connections"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "plaid_events_staff_read" ON public."plaid_events"
  USING (( SELECT is_ops_staff(auth.uid())));

ALTER POLICY "plaid_items_merchant_read" ON public."plaid_items"
  USING ((customer_id IN ( SELECT customers.id
   FROM customers
  WHERE (customers.user_id = ( SELECT auth.uid())))));

ALTER POLICY "plaid_items_staff_read" ON public."plaid_items"
  USING (( SELECT is_ops_staff(auth.uid())));

ALTER POLICY "plaid_tx_merchant_read" ON public."plaid_transactions"
  USING ((customer_id IN ( SELECT customers.id
   FROM customers
  WHERE (customers.user_id = ( SELECT auth.uid())))));

ALTER POLICY "plaid_tx_staff_read" ON public."plaid_transactions"
  USING (( SELECT is_ops_staff(auth.uid())));

ALTER POLICY "Sensitive settings readable by staff only" ON public."platform_settings"
  USING (((key <> 'company_voice'::text) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid())) AND (p.role = ANY (ARRAY['closer'::user_role, 'admin'::user_role, 'super_admin'::user_role, 'employee'::user_role])))))));

ALTER POLICY "Super admins write platform settings" ON public."platform_settings"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role)))));

ALTER POLICY "Allow insert for authenticated users" ON public."profiles"
  WITH CHECK ((( SELECT auth.uid()) = id));

ALTER POLICY "Super admins can read all profiles" ON public."profiles"
  USING (( SELECT is_super_admin()));

ALTER POLICY "Super admins can update all profiles" ON public."profiles"
  USING (( SELECT is_super_admin()))
  WITH CHECK (( SELECT is_super_admin()));

ALTER POLICY "Users can read own profile" ON public."profiles"
  USING ((( SELECT auth.uid()) = id));

ALTER POLICY "Users can update own profile" ON public."profiles"
  USING ((( SELECT auth.uid()) = id));

ALTER POLICY "Admins manage referral partners" ON public."referral_partners"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "Admins manage rnd_items" ON public."rnd_items"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "Admins can view sub_isos" ON public."sub_isos"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "Sub-ISOs can view own record" ON public."sub_isos"
  USING ((user_id = ( SELECT auth.uid())));

ALTER POLICY "Super admins can manage sub_isos" ON public."sub_isos"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role)))));

ALTER POLICY "Staff read synergy intake log" ON public."synergy_intake_log"
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid())) AND (p.role = ANY (ARRAY['closer'::user_role, 'admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "Admins read system_health_checks" ON public."system_health_checks"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "Admins read system_health_incidents" ON public."system_health_incidents"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "Admins read system_health_state" ON public."system_health_state"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "Admins can insert activity" ON public."task_activity"
  WITH CHECK ((( SELECT is_ops_staff(auth.uid())) OR ( SELECT is_closer(auth.uid()))));

ALTER POLICY "Admins can view activity" ON public."task_activity"
  USING ((( SELECT is_ops_staff(auth.uid())) OR ( SELECT is_closer(auth.uid()))));

ALTER POLICY "Admins can delete own comments" ON public."task_comments"
  USING ((user_id = ( SELECT auth.uid())));

ALTER POLICY "Admins can insert comments" ON public."task_comments"
  WITH CHECK ((( SELECT is_ops_staff(auth.uid())) OR ( SELECT is_closer(auth.uid()))));

ALTER POLICY "Admins can update own comments" ON public."task_comments"
  USING ((user_id = ( SELECT auth.uid())));

ALTER POLICY "Admins can view comments" ON public."task_comments"
  USING ((( SELECT is_ops_staff(auth.uid())) OR ( SELECT is_closer(auth.uid()))));

ALTER POLICY "tcpa_consents_admin_read" ON public."tcpa_consents"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid() AS uid))));

ALTER POLICY "Admins manage underwriting_assessments" ON public."underwriting_assessments"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "Admins read scorecards" ON public."underwriting_scorecards"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "Super admins manage scorecards" ON public."underwriting_scorecards"
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role)))));

ALTER POLICY "uw_settings_select" ON public."underwriting_settings"
  USING (( SELECT is_admin_or_super(( SELECT auth.uid() AS uid))));

ALTER POLICY "uw_settings_update" ON public."underwriting_settings"
  USING (( SELECT is_super_admin(( SELECT auth.uid() AS uid))))
  WITH CHECK (( SELECT is_super_admin(( SELECT auth.uid() AS uid))));

ALTER POLICY "Admins manage vendor docs" ON public."vendor_documents"
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid())) AND (p.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid())) AND (p.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));

ALTER POLICY "Admins view vendor docs" ON public."vendor_documents"
  USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid())) AND (p.role = ANY (ARRAY['admin'::user_role, 'super_admin'::user_role]))))));
