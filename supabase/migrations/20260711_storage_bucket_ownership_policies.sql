-- 0.1 — Lock down customer-documents and lender-documents storage buckets.
--
-- BEFORE: storage.objects granted SELECT/INSERT/UPDATE/DELETE to role
-- `authenticated` gated ONLY on bucket_id — any logged-in user could list, read,
-- or delete every merchant's bank statements (audit finding #1, CRITICAL).
--
-- AFTER: ownership-scoped access.
--   customer-documents:
--     - ops staff (is_ops_staff) -> ALL
--     - the owning merchant       -> SELECT + INSERT (no UPDATE/DELETE; re-upload = new object)
--     - the owning closer         -> SELECT + INSERT
--   lender-documents:
--     - ops staff only -> ALL   (merchants never touch it)
--
-- Object path conventions in this bucket are BOTH of:
--   staff / edge functions:  customer/<customerId>/<file>   (foldername[1]='customer', [2]=uuid)
--   merchant portal upload:  <customerId>/<file>            (foldername[1]=uuid)
-- storage_path_customer_id() resolves the customer id from either.
-- Service-role edge functions bypass RLS entirely and are unaffected.

-- Resolve the owning customer id from a customer-documents object path,
-- handling both the `customer/<uuid>/...` and `<uuid>/...` conventions.
create or replace function public.storage_path_customer_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
declare
  parts text[];
  candidate text;
begin
  parts := storage.foldername(object_name);
  if parts is null or array_length(parts, 1) is null then
    return null;
  end if;
  candidate := parts[1];
  if candidate = 'customer' and array_length(parts, 1) >= 2 then
    candidate := parts[2];
  end if;
  begin
    return candidate::uuid;
  exception when others then
    return null;
  end;
end;
$$;

-- Drop the permissive any-authenticated policies.
drop policy if exists "Authenticated users can view customer documents"   on storage.objects;
drop policy if exists "Authenticated users can upload customer documents" on storage.objects;
drop policy if exists "Authenticated users can update customer documents" on storage.objects;
drop policy if exists "Authenticated users can delete customer documents" on storage.objects;
drop policy if exists "Authenticated users can view lender documents"     on storage.objects;
drop policy if exists "Authenticated users can upload lender documents"   on storage.objects;
drop policy if exists "Authenticated users can update lender documents"   on storage.objects;
drop policy if exists "Authenticated users can delete lender documents"   on storage.objects;

-- ---- customer-documents -----------------------------------------------------

create policy "ops_all_customer_documents"
  on storage.objects for all to authenticated
  using (bucket_id = 'customer-documents' and public.is_ops_staff(auth.uid()))
  with check (bucket_id = 'customer-documents' and public.is_ops_staff(auth.uid()));

create policy "merchant_select_own_customer_documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'customer-documents'
    and exists (
      select 1 from public.customers c
      where c.id = public.storage_path_customer_id(name)
        and c.user_id = auth.uid()
    )
  );

create policy "merchant_insert_own_customer_documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'customer-documents'
    and exists (
      select 1 from public.customers c
      where c.id = public.storage_path_customer_id(name)
        and c.user_id = auth.uid()
    )
  );

create policy "closer_select_customer_documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'customer-documents'
    and public.is_closer(auth.uid())
    and public.closer_owns_customer(auth.uid(), public.storage_path_customer_id(name))
  );

create policy "closer_insert_customer_documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'customer-documents'
    and public.is_closer(auth.uid())
    and public.closer_owns_customer(auth.uid(), public.storage_path_customer_id(name))
  );

-- ---- lender-documents (ops staff only) --------------------------------------

create policy "ops_all_lender_documents"
  on storage.objects for all to authenticated
  using (bucket_id = 'lender-documents' and public.is_ops_staff(auth.uid()))
  with check (bucket_id = 'lender-documents' and public.is_ops_staff(auth.uid()));
