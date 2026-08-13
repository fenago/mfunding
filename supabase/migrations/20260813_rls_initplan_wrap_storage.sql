-- RLS initplan hoist for storage.objects (same fix as 20260813_rls_initplan_wrap.sql).
-- storage.objects is owned by supabase_storage_admin but the postgres role is allowed
-- to ALTER its policies; search_path is pinned so the unqualified profiles/helper
-- references resolve to public exactly as they do today.
-- Semantics unchanged: only column-free auth/helper calls are wrapped;
-- closer_owns_customer(..., storage_path_customer_id(name)) keeps its per-row form
-- because it reads the object's name column.

set local search_path = public;

ALTER POLICY "Super admins can delete company documents" ON storage.objects
  USING (((bucket_id = 'company-documents'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role))))));

ALTER POLICY "Super admins can update company documents" ON storage.objects
  USING (((bucket_id = 'company-documents'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role))))));

ALTER POLICY "Super admins can upload company documents" ON storage.objects
  WITH CHECK (((bucket_id = 'company-documents'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role))))));

ALTER POLICY "Super admins can view company documents" ON storage.objects
  USING (((bucket_id = 'company-documents'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = ( SELECT auth.uid())) AND (profiles.role = 'super_admin'::user_role))))));

ALTER POLICY "closer_insert_customer_documents" ON storage.objects
  WITH CHECK (((bucket_id = 'customer-documents'::text) AND ( SELECT is_closer(( SELECT auth.uid()))) AND closer_owns_customer(( SELECT auth.uid()), storage_path_customer_id(name))));

ALTER POLICY "closer_select_customer_documents" ON storage.objects
  USING (((bucket_id = 'customer-documents'::text) AND ( SELECT is_closer(( SELECT auth.uid()))) AND closer_owns_customer(( SELECT auth.uid()), storage_path_customer_id(name))));

ALTER POLICY "lead_uploads_admin_delete" ON storage.objects
  USING (((bucket_id = 'lead-uploads'::text) AND ( SELECT is_admin_or_super(( SELECT auth.uid())))));

ALTER POLICY "lead_uploads_admin_insert" ON storage.objects
  WITH CHECK (((bucket_id = 'lead-uploads'::text) AND ( SELECT is_admin_or_super(( SELECT auth.uid())))));

ALTER POLICY "lead_uploads_admin_select" ON storage.objects
  USING (((bucket_id = 'lead-uploads'::text) AND ( SELECT is_admin_or_super(( SELECT auth.uid())))));

ALTER POLICY "lead_uploads_admin_update" ON storage.objects
  USING (((bucket_id = 'lead-uploads'::text) AND ( SELECT is_admin_or_super(( SELECT auth.uid())))));

ALTER POLICY "ops_all_customer_documents" ON storage.objects
  USING (((bucket_id = 'customer-documents'::text) AND ( SELECT is_ops_staff(( SELECT auth.uid())))))
  WITH CHECK (((bucket_id = 'customer-documents'::text) AND ( SELECT is_ops_staff(( SELECT auth.uid())))));

ALTER POLICY "ops_all_lender_documents" ON storage.objects
  USING (((bucket_id = 'lender-documents'::text) AND ( SELECT is_ops_staff(( SELECT auth.uid())))))
  WITH CHECK (((bucket_id = 'lender-documents'::text) AND ( SELECT is_ops_staff(( SELECT auth.uid())))));

ALTER POLICY "ops_all_vendor_documents" ON storage.objects
  USING (((bucket_id = 'vendor-documents'::text) AND ( SELECT is_ops_staff(( SELECT auth.uid())))))
  WITH CHECK (((bucket_id = 'vendor-documents'::text) AND ( SELECT is_ops_staff(( SELECT auth.uid())))));

ALTER POLICY "ph_ucc_uploads_admin_delete" ON storage.objects
  USING (((bucket_id = 'ph-ucc-uploads'::text) AND ( SELECT is_admin_or_super(( SELECT auth.uid())))));

ALTER POLICY "ph_ucc_uploads_admin_insert" ON storage.objects
  WITH CHECK (((bucket_id = 'ph-ucc-uploads'::text) AND ( SELECT is_admin_or_super(( SELECT auth.uid())))));

ALTER POLICY "ph_ucc_uploads_admin_select" ON storage.objects
  USING (((bucket_id = 'ph-ucc-uploads'::text) AND ( SELECT is_admin_or_super(( SELECT auth.uid())))));

ALTER POLICY "ph_ucc_uploads_admin_update" ON storage.objects
  USING (((bucket_id = 'ph-ucc-uploads'::text) AND ( SELECT is_admin_or_super(( SELECT auth.uid())))));
