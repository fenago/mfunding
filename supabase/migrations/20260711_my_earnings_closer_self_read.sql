-- ============================================================================
-- My Earnings — closer self-service read access
-- Applied live via MCP 2026-07-11.
--
-- VERIFIED ALREADY PRESENT (left as-is, re-asserted below for idempotency):
--   commissions: "Closers can view own commissions" (SELECT)
--     using ( closer_id in (select id from closers where user_id = auth.uid()) )
--   closers:     "Closers can view own record" (SELECT) using ( user_id = auth.uid() )
--   Closers have NO update/insert/delete policy on commissions — only
--   "Super admins can manage commissions" (ALL). No self-approve, no self-pay.
--
-- WHAT THIS ADDS: the "On the table" projection reads `deals` + `customers`.
-- Today the only closer-scoped SELECT policies on those tables are gated on
-- is_closer() (profiles.role = 'closer'). A person who holds a closers row but
-- whose profile role is something else (we have one today: role = 'user') can
-- read their commissions but NOT the deals behind them — the page would show
-- money with no deal context. These policies key off the closers row itself,
-- which is the actual source of truth for "is this my deal".
-- Additive SELECT only. Nothing is widened for anyone without a closers row.
-- ============================================================================

-- Does this auth user hold a closers row at all? (SECURITY DEFINER — bypasses
-- RLS on closers so the policy can't recurse.)
create or replace function public.has_closer_row(uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.closers c where c.user_id = uid);
$$;

-- Is this deal assigned to (or created by) the person behind this closers row?
-- Mirrors closer_owns_deal()'s handling of the profiles<->closers split-brain:
-- assigned_closer_id may hold either the auth user id or the closers.id.
create or replace function public.closer_row_owns_deal(uid uuid, d_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.deals d
    where d.id = d_id
      and ( d.created_by = uid
            or d.assigned_closer_id = uid
            or d.assigned_closer_id in (select c.id from public.closers c where c.user_id = uid) )
  );
$$;

create or replace function public.closer_row_owns_customer(uid uuid, cust_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.deals d
    where d.customer_id = cust_id
      and ( d.assigned_closer_id = uid
            or d.assigned_closer_id in (select c.id from public.closers c where c.user_id = uid) )
  );
$$;

-- deals: a closers-row holder can SELECT their own deals (for the projection).
drop policy if exists closer_row_select_own_deals on public.deals;
create policy closer_row_select_own_deals on public.deals for select to authenticated
  using ( has_closer_row((select auth.uid())) and closer_row_owns_deal((select auth.uid()), id) );

-- customers: same, so the deal's business name renders on My Earnings.
drop policy if exists closer_row_select_own_customers on public.customers;
create policy closer_row_select_own_customers on public.customers for select to authenticated
  using ( has_closer_row((select auth.uid())) and closer_row_owns_customer((select auth.uid()), id) );

-- Re-assert the self-scoped commissions read (idempotent; matches what's live).
drop policy if exists "Closers can view own commissions" on public.commissions;
create policy "Closers can view own commissions" on public.commissions for select to authenticated
  using ( closer_id in (select c.id from public.closers c where c.user_id = (select auth.uid())) );

-- Belt-and-braces: make sure no stray write policy ever let a closer touch
-- their own commission row (approve/pay/release stays super-admin-only).
drop policy if exists closer_update_own_commissions on public.commissions;
drop policy if exists closer_insert_commissions on public.commissions;
