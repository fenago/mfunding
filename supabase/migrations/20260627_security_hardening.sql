-- Clear ERROR-level security advisor findings + pin search_path on key functions.
ALTER VIEW IF EXISTS public.v_funnel_summary SET (security_invoker = true);
ALTER VIEW IF EXISTS public.v_vendor_performance SET (security_invoker = true);

ALTER TABLE public.document_embeddings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read document_embeddings" ON public.document_embeddings;
CREATE POLICY "Admins read document_embeddings" ON public.document_embeddings
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin')));

ALTER FUNCTION public.handle_new_user() SET search_path = public;
ALTER FUNCTION public.update_updated_at() SET search_path = public;
ALTER FUNCTION public.is_super_admin(uuid) SET search_path = public;
ALTER FUNCTION public.is_admin_or_super(uuid) SET search_path = public;
