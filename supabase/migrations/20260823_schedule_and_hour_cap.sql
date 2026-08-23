-- Expected schedule + weekly hour cap (owner request 2026-08-23): the owner sets
-- when he expects each person in the office and a weekly cap (default 40);
-- weeks over the cap without an explicit approval get flagged as unapproved OT.
-- Applied to prod via the management API on 2026-08-23.

alter table public.staff_rates
  add column if not exists expected_weekly_hours numeric(5,2),
  add column if not exists weekly_hours_cap numeric(5,2) not null default 40,
  add column if not exists schedule_note text;

-- Optional free-text context on a daily check-in, separate from the "what did
-- you work on?" note — anything the worker wants to add (owner request 8/23).
alter table public.time_entries
  add column if not exists context_note text;

-- One approval row per user per week (Monday start). approved=true means
-- "over-cap is OK for this week"; no row over a capped week = flagged OT.
create table if not exists public.weekly_hour_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  period_start date not null,
  approved boolean not null default true,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz not null default now(),
  note text,
  unique (user_id, period_start)
);
create index if not exists weekly_hour_approvals_user_idx
  on public.weekly_hour_approvals (user_id, period_start desc);

alter table public.weekly_hour_approvals enable row level security;
drop policy if exists wha_worker_read_own on public.weekly_hour_approvals;
create policy wha_worker_read_own on public.weekly_hour_approvals for select to authenticated
  using (user_id = auth.uid());
drop policy if exists wha_super_all on public.weekly_hour_approvals;
create policy wha_super_all on public.weekly_hour_approvals for all to authenticated
  using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));
