-- 0.5 (documentation-as-migration) — capture the LIVE merchant RLS policies.
--
-- These policies already exist in the live DB (created outside repo migrations).
-- This file records them for the repo so a fresh rebuild reproduces merchant
-- access. Each CREATE is guarded so this migration is a NO-OP against the live
-- database — it only creates a policy if that exact name is absent.
--
-- Column-level protection for deals is provided separately by
-- public.get_my_portal_deals() (see 20260711_get_my_portal_deals_rpc.sql);
-- the row-level "Customers view own deals" policy below is intentionally the
-- unsanitized live policy, captured as-is.

do $$
begin
  -- customers: a merchant sees only their own linked customer row.
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='customers' and policyname='user_view_own_customer'
  ) then
    create policy "user_view_own_customer" on public.customers
      for select using (auth.uid() = user_id);
  end if;

  -- customer_documents: a merchant fully manages docs on their own customer.
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='customer_documents' and policyname='user_own_customer_docs'
  ) then
    create policy "user_own_customer_docs" on public.customer_documents
      for all
      using (exists (
        select 1 from public.customers
        where customers.id = customer_documents.customer_id and customers.user_id = auth.uid()
      ))
      with check (exists (
        select 1 from public.customers
        where customers.id = customer_documents.customer_id and customers.user_id = auth.uid()
      ));
  end if;

  -- deals: a merchant sees their own deal rows (row-level; columns sanitized via RPC).
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='deals' and policyname='Customers view own deals'
  ) then
    create policy "Customers view own deals" on public.deals
      for select to authenticated
      using (customer_id in (
        select customers.id from public.customers where customers.user_id = auth.uid()
      ));
  end if;

  -- messages: a merchant reads threads addressed to/from them.
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='messages' and policyname='user_own_messages'
  ) then
    create policy "user_own_messages" on public.messages
      for select using ((auth.uid() = to_user_id) or (auth.uid() = from_user_id));
  end if;

  -- messages: a merchant may send as themselves.
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='messages' and policyname='user_send_messages'
  ) then
    create policy "user_send_messages" on public.messages
      for insert with check (auth.uid() = from_user_id);
  end if;

  -- messages: a merchant may update messages they received (mark read, etc).
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='messages' and policyname='user_update_received'
  ) then
    create policy "user_update_received" on public.messages
      for update using (auth.uid() = to_user_id) with check (auth.uid() = to_user_id);
  end if;
end $$;
