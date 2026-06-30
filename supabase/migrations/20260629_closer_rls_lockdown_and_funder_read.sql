-- ============================================================================
-- Closer RLS lockdown (audit #5/#14) + Funder Guide read for closers (#17)
-- Applied live via MCP 2026-06-29.
-- Closers previously had full CRUD on ALL customers & deals via is_staff().
-- This scopes them to their OWN records (assigned or created), removes DELETE,
-- and grants read-only access to lenders so the Funder Guide works.
-- Admins / super_admins are unaffected (separate admin_all / "Admins manage" policies).
-- ============================================================================

create or replace function public.is_closer(uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.profiles where id = uid and role = 'closer');
$$;

-- Stamp created_by = auth.uid() on insert when not provided, so a closer's own
-- inserts (PlaybookCapture, New Deal) are reliably visible to them via RLS.
-- Edge functions use the service role (auth.uid() is null) -> created_by stays null.
create or replace function public.set_created_by()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.created_by is null then new.created_by := auth.uid(); end if;
  return new;
end; $$;

drop trigger if exists set_created_by_customers on public.customers;
create trigger set_created_by_customers before insert on public.customers
  for each row execute function public.set_created_by();
drop trigger if exists set_created_by_deals on public.deals;
create trigger set_created_by_deals before insert on public.deals
  for each row execute function public.set_created_by();

-- Ownership resolvers (SECURITY DEFINER) bypass RLS on deals/closers and handle
-- the profiles<->closers split-brain: a deal belongs to a closer whether
-- assigned_closer_id holds the profile id OR the closers.id, or if they created it.
create or replace function public.closer_owns_deal(uid uuid, d_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.deals d
    where d.id = d_id
      and ( d.created_by = uid
            or d.assigned_closer_id = uid
            or d.assigned_closer_id in (select c.id from public.closers c where c.user_id = uid) )
  );
$$;

create or replace function public.closer_owns_customer(uid uuid, cust_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.customers c
    where c.id = cust_id and (c.created_by = uid or c.assigned_to = uid)
  ) or exists (
    select 1 from public.deals d
    where d.customer_id = cust_id
      and ( d.assigned_closer_id = uid
            or d.assigned_closer_id in (select c.id from public.closers c where c.user_id = uid) )
  );
$$;

-- customers: drop the over-permissive staff-all policy, add scoped closer policies
drop policy if exists "Staff manage customers" on public.customers;

drop policy if exists closer_select_own_customers on public.customers;
create policy closer_select_own_customers on public.customers for select to authenticated
  using ( is_closer((select auth.uid())) and closer_owns_customer((select auth.uid()), id) );

drop policy if exists closer_insert_customers on public.customers;
create policy closer_insert_customers on public.customers for insert to authenticated
  with check ( is_closer((select auth.uid())) );

drop policy if exists closer_update_own_customers on public.customers;
create policy closer_update_own_customers on public.customers for update to authenticated
  using ( is_closer((select auth.uid())) and closer_owns_customer((select auth.uid()), id) )
  with check ( is_closer((select auth.uid())) and closer_owns_customer((select auth.uid()), id) );

-- deals: same treatment
drop policy if exists "Staff manage deals" on public.deals;

drop policy if exists closer_select_own_deals on public.deals;
create policy closer_select_own_deals on public.deals for select to authenticated
  using ( is_closer((select auth.uid())) and closer_owns_deal((select auth.uid()), id) );

drop policy if exists closer_insert_deals on public.deals;
create policy closer_insert_deals on public.deals for insert to authenticated
  with check ( is_closer((select auth.uid())) );

drop policy if exists closer_update_own_deals on public.deals;
create policy closer_update_own_deals on public.deals for update to authenticated
  using ( is_closer((select auth.uid())) and closer_owns_deal((select auth.uid()), id) )
  with check ( is_closer((select auth.uid())) and closer_owns_deal((select auth.uid()), id) );

-- lenders: read-only access for closers so the Funder Guide loads (#17)
drop policy if exists closer_read_lenders on public.lenders;
create policy closer_read_lenders on public.lenders for select to authenticated
  using ( is_closer((select auth.uid())) );
