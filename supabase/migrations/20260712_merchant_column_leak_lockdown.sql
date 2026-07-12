-- Close-audit CRITICAL + medium/low findings: merchant column-leak lockdown.
--
-- BEFORE: the authenticated role has table-wide SELECT on customers and deals,
-- and the merchant SELECT policies (customers.user_view_own_customer,
-- deals."Customers view own deals") are ROW-level only. A signed-in merchant
-- could `GET /rest/v1/customers?select=*` / `/rest/v1/deals?select=*` on their
-- own row and receive EVERY column -- commission_earned, funded_by_lender_id
-- (funder identity), notes, follow_up_notes, ai_* fields, assigned_to,
-- lead_source, temperature, etc. RLS cannot hide columns and column GRANTs are
-- not viable (staff share the authenticated role).
--
-- AFTER: merchant reads flow ONLY through SECURITY DEFINER RPCs that project a
-- portal-safe column set:
--   * deals    -> public.get_my_portal_deals()  (already shipped)
--   * customers-> public.get_my_customer()       (new, below)
-- The two merchant row-level SELECT policies are dropped, so a raw
-- customers/deals select returns ZERO rows for a merchant. Staff policies
-- (is_ops_staff / is_closer) are untouched.
--
-- Also folds in the medium/low audit items:
--   * vendor-documents storage bucket -> ops-only (was any-authenticated).
--   * messages INSERT -> merchant may only message staff (no merchant->merchant).
--   * customer_documents merchant policy -> SELECT + INSERT only (no UPDATE/DELETE).
--   * revoke stray anon EXECUTE on three portal RPCs.

-- ============================================================================
-- 1) get_my_customer() -- portal-safe projection of the caller's customer row.
-- ============================================================================
-- Returns ONLY identity/contact fields the portal renders. Deliberately EXCLUDES
-- every internal/financial field: commission_earned, funded_by_lender_id, notes,
-- follow_up_notes, assigned_to, created_by, source/source_details, vendor_id,
-- lead_qual, temperature, has_bankruptcies, has_tax_liens, credit_score_range,
-- amount_funded, status, etc.
create or replace function public.get_my_customer()
returns table (
  id uuid,
  first_name text,
  last_name text,
  business_name text,
  email text,
  phone text,
  address_city text,
  address_state text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id, c.first_name, c.last_name, c.business_name,
    c.email, c.phone, c.address_city, c.address_state
  from public.customers c
  where c.user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.get_my_customer() from public, anon;
grant execute on function public.get_my_customer() to authenticated;

-- ============================================================================
-- 2) Drop the merchant row-level SELECT policies on customers + deals.
-- ============================================================================
-- After this, the ONLY merchant path to this data is the SECURITY DEFINER RPCs.
drop policy if exists "user_view_own_customer" on public.customers;
drop policy if exists "Customers view own deals" on public.deals;

-- ============================================================================
-- 3) vendor-documents storage bucket -> ops staff only (all verbs).
-- ============================================================================
-- Was open to ALL authenticated (a merchant could read/DELETE internal vendor
-- docs). Mirror the lender-documents ops-only pattern.
drop policy if exists "Auth view vendor documents"   on storage.objects;
drop policy if exists "Auth upload vendor documents"  on storage.objects;
drop policy if exists "Auth update vendor documents"  on storage.objects;
drop policy if exists "Auth delete vendor documents"  on storage.objects;

create policy "ops_all_vendor_documents"
  on storage.objects for all to authenticated
  using (bucket_id = 'vendor-documents' and public.is_ops_staff(auth.uid()))
  with check (bucket_id = 'vendor-documents' and public.is_ops_staff(auth.uid()));

-- ============================================================================
-- 4) messages INSERT -> block merchant->merchant / arbitrary recipients.
-- ============================================================================
-- Old: with_check (auth.uid() = from_user_id) -- a merchant could insert to ANY
-- to_user_id (including another merchant). New predicate keeps staff->anyone
-- (is_ops_staff sender) and merchant->staff (is_ops_staff recipient), blocks
-- merchant->merchant. Admin/super are additionally covered by admin_all_messages;
-- merchant->advisor sends go through the SECURITY DEFINER send_message_to_advisor
-- RPC (bypasses this policy). Note is_ops_staff = admin/super_admin/employee
-- (closers are NOT ops_staff and do not insert messages directly in code).
drop policy if exists "user_send_messages" on public.messages;
create policy "user_send_messages" on public.messages
  for insert to authenticated
  with check (
    auth.uid() = from_user_id
    and (public.is_ops_staff(from_user_id) or public.is_ops_staff(to_user_id))
  );

-- ============================================================================
-- 5) customer_documents merchant policy -> SELECT + INSERT only.
-- ============================================================================
-- Was FOR ALL (merchant could UPDATE/DELETE own doc rows). The portal only
-- selects and inserts; re-upload = new row. Staff policies
-- (admin_all_customer_docs, closer_*) are untouched.
drop policy if exists "user_own_customer_docs" on public.customer_documents;

create policy "user_select_own_customer_docs" on public.customer_documents
  for select to authenticated
  using (exists (
    select 1 from public.customers
    where customers.id = customer_documents.customer_id
      and customers.user_id = auth.uid()
  ));

create policy "user_insert_own_customer_docs" on public.customer_documents
  for insert to authenticated
  with check (exists (
    select 1 from public.customers
    where customers.id = customer_documents.customer_id
      and customers.user_id = auth.uid()
  ));

-- ============================================================================
-- 6) Revoke stray anon EXECUTE on portal RPCs (keep authenticated).
-- ============================================================================
revoke execute on function public.express_renewal_interest(uuid) from anon;
revoke execute on function public.send_message_to_advisor(uuid, text, text) from anon;
revoke execute on function public.get_my_portal_deals() from anon;
