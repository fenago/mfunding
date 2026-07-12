-- =============================================================================
-- FIX: merchant ownership policies broke when merchant SELECT on customers
-- was dropped (20260712_merchant_column_leak_lockdown.sql).
--
-- RLS policy subqueries run with the CALLING user's permissions, so every
-- merchant policy that checked ownership via `select .. from customers where
-- user_id = auth.uid()` started returning zero rows the moment merchants lost
-- direct SELECT on customers. Symptom: signed-in merchants saw "We couldn't
-- find this document", an empty docs checklist, and could not upload.
--
-- Fix: a SECURITY DEFINER ownership helper (mirrors closer_owns_customer),
-- and every merchant policy rewritten to use it.
-- =============================================================================

create or replace function public.merchant_owns_customer(cust_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.customers c
    where c.id = cust_id and c.user_id = auth.uid()
  );
$$;

revoke all on function public.merchant_owns_customer(uuid) from public;
revoke all on function public.merchant_owns_customer(uuid) from anon;
grant execute on function public.merchant_owns_customer(uuid) to authenticated;
grant execute on function public.merchant_owns_customer(uuid) to service_role;

-- ---- customer_documents ----------------------------------------------------
drop policy if exists user_select_own_customer_docs on public.customer_documents;
create policy user_select_own_customer_docs on public.customer_documents
  for select to authenticated
  using (public.merchant_owns_customer(customer_id));

drop policy if exists user_insert_own_customer_docs on public.customer_documents;
create policy user_insert_own_customer_docs on public.customer_documents
  for insert to authenticated
  with check (public.merchant_owns_customer(customer_id));

-- ---- deal_doc_requests -----------------------------------------------------
drop policy if exists deal_doc_requests_merchant_select on public.deal_doc_requests;
create policy deal_doc_requests_merchant_select on public.deal_doc_requests
  for select to authenticated
  using (public.merchant_owns_customer(customer_id));

-- ---- merchant_documents ----------------------------------------------------
drop policy if exists merchant_documents_self_read on public.merchant_documents;
create policy merchant_documents_self_read on public.merchant_documents
  for select to authenticated
  using (public.merchant_owns_customer(customer_id));

-- ---- merchant_document_signatures -------------------------------------------
-- (subquery on merchant_documents now passes its fixed RLS for the merchant)
drop policy if exists merchant_doc_sig_self_read on public.merchant_document_signatures;
create policy merchant_doc_sig_self_read on public.merchant_document_signatures
  for select to authenticated
  using (exists (
    select 1 from public.merchant_documents md
    where md.id = document_id
      and public.merchant_owns_customer(md.customer_id)
  ));

-- ---- storage: customer-documents bucket -------------------------------------
drop policy if exists merchant_select_own_customer_documents on storage.objects;
create policy merchant_select_own_customer_documents on storage.objects
  for select to authenticated
  using (
    bucket_id = 'customer-documents'
    and public.merchant_owns_customer(public.storage_path_customer_id(name))
  );

drop policy if exists merchant_insert_own_customer_documents on storage.objects;
create policy merchant_insert_own_customer_documents on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'customer-documents'
    and public.merchant_owns_customer(public.storage_path_customer_id(name))
  );
