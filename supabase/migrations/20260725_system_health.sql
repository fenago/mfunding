-- System Health monitoring — watch every external dependency and ALERT on outages
-- so a silent lapse (Instantly's plan returning 402 for ~8 days, unnoticed) can
-- never happen again.
--
-- Three tables + one SECURITY DEFINER cron-liveness reader:
--   system_health_checks    — append-only time series (one row per service per run);
--                             powers the uptime strips + latency history.
--   system_health_state     — current state per service; the alert-dedup ledger
--                             (last_transition_at + alerted) so a persistent outage
--                             is emailed ONCE, not every 10 minutes.
--   system_health_incidents — one row per bad-state transition (opened_at) closed on
--                             recovery (closed_at); powers the incidents list + duration.
--   system_cron_health()    — reads cron.job / cron.job_run_details (not PostgREST-
--                             exposed) so the edge function can dead-man-switch every
--                             scheduled job uniformly.
--
-- The system-health-check edge function (service role) is the only writer; staff read
-- via RLS. Same admin role-check pattern as activity_log / ghl_webhook_events.

-- ── Time series: one row per service per run ─────────────────────────────────
create table if not exists public.system_health_checks (
  id          uuid primary key default gen_random_uuid(),
  service     text not null,
  status      text not null check (status in ('up', 'degraded', 'down')),
  http_status int,
  latency_ms  int,
  detail      text,                       -- short human-readable OK/error note
  checked_at  timestamptz not null default now()
);

create index if not exists system_health_checks_service_time_idx
  on public.system_health_checks (service, checked_at desc);

comment on table public.system_health_checks is
  'Append-only health probe results, one row per monitored service per run. Powers the /admin/system uptime strips and latency history. Written only by the system-health-check edge function (service role).';

-- ── Current state per service (alert dedup) ──────────────────────────────────
create table if not exists public.system_health_state (
  service            text primary key,
  status             text not null check (status in ('up', 'degraded', 'down')),
  http_status        int,
  latency_ms         int,
  detail             text,
  last_transition_at timestamptz not null default now(),  -- when status last CHANGED
  alerted            boolean not null default false,       -- did we already email this state?
  updated_at         timestamptz not null default now()    -- every run touches this (liveness)
);

comment on table public.system_health_state is
  'Latest known state per service + the alert-dedup ledger. last_transition_at moves only when status changes; alerted flips true once an email is sent for the current state, so a persistent outage is alerted ONCE.';

-- ── Incidents: one row per bad-state transition, closed on recovery ──────────
create table if not exists public.system_health_incidents (
  id         uuid primary key default gen_random_uuid(),
  service    text not null,
  status     text not null check (status in ('degraded', 'down')),  -- severity when opened
  detail     text,
  opened_at  timestamptz not null default now(),
  closed_at  timestamptz                                            -- null = still open
);

create index if not exists system_health_incidents_open_idx
  on public.system_health_incidents (service, opened_at desc);

comment on table public.system_health_incidents is
  'One row per transition into a bad (degraded/down) state, closed (closed_at) on recovery. Powers the recent-incidents list with duration on /admin/system.';

-- ── RLS: admin + super_admin SELECT; service role (edge fn) bypasses RLS ─────
alter table public.system_health_checks    enable row level security;
alter table public.system_health_state     enable row level security;
alter table public.system_health_incidents enable row level security;

do $$
begin
  -- system_health_checks
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='system_health_checks' and policyname='Admins read system_health_checks') then
    create policy "Admins read system_health_checks" on public.system_health_checks for select
      using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role in ('admin','super_admin')));
  end if;
  -- system_health_state
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='system_health_state' and policyname='Admins read system_health_state') then
    create policy "Admins read system_health_state" on public.system_health_state for select
      using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role in ('admin','super_admin')));
  end if;
  -- system_health_incidents
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='system_health_incidents' and policyname='Admins read system_health_incidents') then
    create policy "Admins read system_health_incidents" on public.system_health_incidents for select
      using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role in ('admin','super_admin')));
  end if;
end$$;

-- ── Cron liveness reader (dead-man switch for every scheduled job) ───────────
-- cron.job / cron.job_run_details are NOT exposed to PostgREST, so the edge function
-- (service role) reads them through this SECURITY DEFINER function. Returns, per ACTIVE
-- job: its schedule, the last run's status + time, and how many runs FAILED in the last
-- hour — enough for the edge fn to mark the whole cron subsystem up / degraded / down.
create or replace function public.system_cron_health()
returns table (
  jobname            text,
  schedule           text,
  last_status        text,
  last_start         timestamptz,
  minutes_since_last numeric,
  failures_last_hour bigint
)
language sql
security definer
set search_path = cron, public
as $$
  select
    j.jobname,
    j.schedule,
    latest.status                                              as last_status,
    latest.start_time                                          as last_start,
    round(extract(epoch from (now() - latest.start_time)) / 60.0, 1) as minutes_since_last,
    coalesce(fails.n, 0)                                       as failures_last_hour
  from cron.job j
  left join lateral (
    select d.status, d.start_time
    from cron.job_run_details d
    where d.jobid = j.jobid
    order by d.start_time desc
    limit 1
  ) latest on true
  left join lateral (
    select count(*) as n
    from cron.job_run_details d
    where d.jobid = j.jobid
      and d.status = 'failed'
      and d.start_time > now() - interval '1 hour'
  ) fails on true
  where j.active
  order by j.jobname;
$$;

comment on function public.system_cron_health() is
  'Per active pg_cron job: schedule, last run status/time, minutes since last run, and failed-run count in the last hour. SECURITY DEFINER so the system-health-check edge function can dead-man-switch scheduled jobs (cron schema is not PostgREST-exposed).';

revoke all on function public.system_cron_health() from public, anon, authenticated;
