-- Staff time tracking + weekly pay runs.
--
-- Business rules (owner spec):
--   * Staff check in daily under their own profile: they enter the hours they
--     worked for a work_date + optional note. The DB independently stamps
--     checked_in_at (default now()) so the owner can compare CLAIMED hours
--     against WHEN the person actually logged them. checked_in_at is never
--     supplied by the client.
--   * Pay weeks run MONDAY through SUNDAY.
--   * Super admin sets an hourly rate per person, sees everyone's weekly
--     hours x rate = cost, and marks weeks paid.
--   * Workers see their own hours and their own pay history.
--
-- RLS conventions followed from the existing schema:
--   * auth.uid() is wrapped as (select auth.uid()) and is_super_admin() as
--     (select is_super_admin()) so they evaluate once per query (initplan),
--     not once per row. See the 20260813_rls_initplan_* migrations.
--   * Role gating goes through a STABLE SECURITY DEFINER helper rather than a
--     subquery on profiles, so the policy does not depend on the caller's
--     ability to read profiles.

-- ---------------------------------------------------------------------------
-- Role helper
-- ---------------------------------------------------------------------------
-- public.is_staff(uid) already exists but covers only closer/admin/super_admin.
-- Time tracking must also include 'employee' (a valid user_role enum value).
-- is_staff is load-bearing for campaigns / campaign_analyses /
-- closer_doc_templates policies, so it is deliberately NOT widened here.
create or replace function public.is_time_staff(uid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles
    where id = uid
      and role = any (array['closer','employee','admin','super_admin']::user_role[])
  );
$$;

comment on function public.is_time_staff(uuid) is
  'True when the profile is staff who may log time (closer/employee/admin/super_admin). Merchants (role user) are excluded.';

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null default current_date,
  hours numeric(5,2) not null check (hours > 0 and hours <= 24),
  note text,
  checked_in_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, work_date)
);

comment on column public.time_entries.hours is 'Hours CLAIMED by the worker for work_date.';
comment on column public.time_entries.checked_in_at is 'Server-stamped time the worker submitted/last re-submitted. Never client-supplied.';

create table if not exists public.staff_rates (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  hourly_rate numeric(8,2) not null default 0,
  currency text not null default 'USD',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

create table if not exists public.pay_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  hours numeric(7,2) not null,
  hourly_rate numeric(8,2) not null,
  amount numeric(10,2) not null,
  currency text not null default 'USD',
  status text not null default 'pending' check (status in ('pending','paid')),
  paid_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, period_start, period_end)
);

comment on column public.pay_runs.period_start is 'MONDAY of the pay week.';
comment on column public.pay_runs.period_end is 'SUNDAY of the pay week.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists time_entries_user_date_idx
  on public.time_entries (user_id, work_date desc);
-- Super-admin weekly roll-up scans by date range across all staff.
create index if not exists time_entries_work_date_idx
  on public.time_entries (work_date desc);
create index if not exists pay_runs_user_period_idx
  on public.pay_runs (user_id, period_start desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers (per-table touch fn, matching payout_profiles_touch_updated_at)
-- ---------------------------------------------------------------------------
create or replace function public.touch_time_entries_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  -- Re-submitting a day's hours re-stamps the check-in, so the owner always
  -- sees when the CURRENT claim was made.
  new.checked_in_at = now();
  return new;
end;
$$;

drop trigger if exists time_entries_touch_updated_at on public.time_entries;
create trigger time_entries_touch_updated_at
  before update on public.time_entries
  for each row execute function public.touch_time_entries_updated_at();

create or replace function public.touch_staff_rates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists staff_rates_touch_updated_at on public.staff_rates;
create trigger staff_rates_touch_updated_at
  before update on public.staff_rates
  for each row execute function public.touch_staff_rates_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.time_entries enable row level security;
alter table public.staff_rates  enable row level security;
alter table public.pay_runs     enable row level security;

-- time_entries -------------------------------------------------------------
drop policy if exists "time_entries read own or super" on public.time_entries;
create policy "time_entries read own or super"
  on public.time_entries for select
  using (
    user_id = (select auth.uid())
    or (select public.is_super_admin())
  );

-- Staff insert only their OWN rows. Merchants (role 'user') are blocked by
-- is_time_staff even though they are authenticated.
drop policy if exists "time_entries insert own staff" on public.time_entries;
create policy "time_entries insert own staff"
  on public.time_entries for insert
  with check (
    user_id = (select auth.uid())
    and public.is_time_staff((select auth.uid()))
  );

drop policy if exists "time_entries update own staff" on public.time_entries;
create policy "time_entries update own staff"
  on public.time_entries for update
  using (
    user_id = (select auth.uid())
    and public.is_time_staff((select auth.uid()))
  )
  with check (
    user_id = (select auth.uid())
    and public.is_time_staff((select auth.uid()))
  );

-- No worker DELETE policy: a logged day can be corrected but not erased.
-- Super admin gets full access (including delete) via this policy.
drop policy if exists "time_entries super all" on public.time_entries;
create policy "time_entries super all"
  on public.time_entries for all
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

-- staff_rates --------------------------------------------------------------
-- Worker may READ their own rate so their tab can compute expected pay.
drop policy if exists "staff_rates read own or super" on public.staff_rates;
create policy "staff_rates read own or super"
  on public.staff_rates for select
  using (
    user_id = (select auth.uid())
    or (select public.is_super_admin())
  );

-- ALL writes are super_admin only. No worker insert/update/delete policy.
drop policy if exists "staff_rates super all" on public.staff_rates;
create policy "staff_rates super all"
  on public.staff_rates for all
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

-- pay_runs -----------------------------------------------------------------
drop policy if exists "pay_runs read own or super" on public.pay_runs;
create policy "pay_runs read own or super"
  on public.pay_runs for select
  using (
    user_id = (select auth.uid())
    or (select public.is_super_admin())
  );

drop policy if exists "pay_runs super all" on public.pay_runs;
create policy "pay_runs super all"
  on public.pay_runs for all
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

-- ---------------------------------------------------------------------------
-- Grants (RLS still governs row visibility)
-- ---------------------------------------------------------------------------
grant select, insert, update on public.time_entries to authenticated;
grant select on public.staff_rates to authenticated;
grant insert, update, delete on public.staff_rates to authenticated;
grant select, insert, update, delete on public.pay_runs to authenticated;
