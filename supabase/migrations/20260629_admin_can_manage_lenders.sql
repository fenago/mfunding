-- Let admins (not just super_admins) build out the funder network: add & edit
-- lenders and their documents. Applied live via MCP 2026-06-29.
-- Lender row DELETE stays super_admin-only (destructive / owner-level);
-- document delete is allowed for admins. The lender-documents storage bucket is
-- already open to authenticated users, so file uploads work for admins as-is.

-- (Carlos Marquez was promoted closer → admin in the same migration.)

-- lenders: admin insert + update
drop policy if exists "admin_insert_lenders" on public.lenders;
create policy "admin_insert_lenders" on public.lenders
  for insert to authenticated
  with check (is_admin_or_super(auth.uid()));

drop policy if exists "admin_update_lenders" on public.lenders;
create policy "admin_update_lenders" on public.lenders
  for update to authenticated
  using (is_admin_or_super(auth.uid()))
  with check (is_admin_or_super(auth.uid()));

-- lender_documents: admin insert + update + delete
drop policy if exists "admin_insert_lender_docs" on public.lender_documents;
create policy "admin_insert_lender_docs" on public.lender_documents
  for insert to authenticated
  with check (is_admin_or_super(auth.uid()));

drop policy if exists "admin_update_lender_docs" on public.lender_documents;
create policy "admin_update_lender_docs" on public.lender_documents
  for update to authenticated
  using (is_admin_or_super(auth.uid()))
  with check (is_admin_or_super(auth.uid()));

drop policy if exists "admin_delete_lender_docs" on public.lender_documents;
create policy "admin_delete_lender_docs" on public.lender_documents
  for delete to authenticated
  using (is_admin_or_super(auth.uid()));
