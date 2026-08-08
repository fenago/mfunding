-- Cron health: stop the false alarms, and stop the table that causes them.
--
-- Two real bugs, both in the MONITOR (the cron jobs themselves were healthy —
-- 0 failures in 3 days) that between them opened 11 bogus incidents:
--
--   1. FALSE "stalled (overdue)". system_cron_health() returned only
--      minutes_since_last, and the edge fn's cadence guess looked at the minute +
--      hour fields ONLY — day-of-week / day-of-month were ignored. So every
--      weekly job ('0 3 * * 0') and the monthly one ('0 9 1 * *') were treated as
--      DAILY, and were "overdue" ~3 days after a perfectly on-time run.
--
--   2. FALSE "down". cron.job_run_details had grown to 52,848 rows / 52 MB and is
--      never pruned by pg_cron. The old per-job LATERAL did a full seq scan of the
--      table PER JOB (19 jobs x 2 laterals = ~38 scans, 123k buffers, ~2 s and
--      climbing) until it tripped the statement timeout, which the probe reported
--      as "cron is down". We cannot index cron.job_run_details (owned by
--      supabase_admin — CREATE INDEX errors 42501), so the fix is a single bounded
--      pass plus a durable per-job summary.
--
-- What this migration adds:
--   • public.cron_job_run_summary — durable last-run memory per job, so history
--     survives pruning (a MONTHLY job's last run is older than the retention
--     window; without this it would look like it never ran).
--   • system_cron_health(p_window_days) — ONE bounded aggregate scan that refreshes
--     the summary, then reads from it. Also returns last_success_at, so staleness
--     is measured against the last SUCCESSFUL run.
--   • prune_cron_run_details(keep_days) + a daily cron job — bounded growth, so the
--     query stays fast permanently.

-- ── Durable per-job last-run memory ──────────────────────────────────────────
create table if not exists public.cron_job_run_summary (
  jobid              bigint primary key,
  jobname            text not null,
  last_start         timestamptz,
  last_status        text,
  last_success_at    timestamptz,
  first_seen_at      timestamptz not null default now(),  -- when the monitor first saw this job
  failures_last_hour int not null default 0,
  failures_as_of     timestamptz,
  updated_at         timestamptz not null default now()
);

comment on table public.cron_job_run_summary is
  'Durable last-run/last-success memory per pg_cron job, refreshed by system_cron_health() from a bounded window of cron.job_run_details. Exists so infrequent jobs (weekly/monthly/quarterly) keep a usable last-run timestamp after job_run_details is pruned.';

-- (idempotent: the table may predate the first_seen_at column)
alter table public.cron_job_run_summary
  add column if not exists first_seen_at timestamptz not null default now();

alter table public.cron_job_run_summary enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'cron_job_run_summary'
      and policyname = 'cron_job_run_summary_admin_read'
  ) then
    create policy cron_job_run_summary_admin_read on public.cron_job_run_summary
      for select to authenticated
      using (exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role in ('admin', 'super_admin')
      ));
  end if;
end $$;

-- ── Health probe: one bounded scan, schedule-agnostic, success-aware ─────────
drop function if exists public.system_cron_health();
drop function if exists public.system_cron_health(int);

create or replace function public.system_cron_health(p_window_days int default 14)
returns table (
  jobname               text,
  schedule              text,
  last_status           text,
  last_start            timestamptz,
  minutes_since_last    numeric,
  last_success_at       timestamptz,
  minutes_since_success numeric,
  minutes_since_first_seen numeric,
  failures_last_hour    bigint,
  window_days           int
)
language plpgsql
security definer
set search_path = public, cron
as $$
declare
  v_cut timestamptz := now() - make_interval(days => greatest(1, p_window_days));
begin
  -- 0) Remember every active job the moment it appears. A job created five minutes
  --    ago has not had its turn yet — first_seen_at is what tells the probe to give
  --    a brand-new job its full cadence of grace instead of calling it stalled.
  insert into public.cron_job_run_summary (jobid, jobname, first_seen_at, updated_at)
  select j.jobid, j.jobname, now(), now() from cron.job j where j.active
  on conflict (jobid) do nothing;

  -- 1) ONE pass over the bounded window; merge into the durable summary.
  --    GREATEST() ignores NULLs in Postgres, so an empty window never erases
  --    an older remembered timestamp.
  insert into public.cron_job_run_summary
    (jobid, jobname, last_start, last_status, last_success_at, failures_last_hour, failures_as_of, updated_at)
  select
    a.jobid,
    j.jobname,
    a.last_start,
    a.last_status,
    a.last_success_at,
    a.failures_last_hour,
    now(),
    now()
  from (
    select
      d.jobid,
      max(d.start_time)                                          as last_start,
      max(d.start_time) filter (where d.status = 'succeeded')    as last_success_at,
      (array_agg(d.status order by d.start_time desc))[1]        as last_status,
      count(*) filter (
        where d.status = 'failed' and d.start_time > now() - interval '1 hour'
      )::int                                                     as failures_last_hour
    from cron.job_run_details d
    where d.start_time >= v_cut
    group by d.jobid
  ) a
  join cron.job j on j.jobid = a.jobid
  on conflict (jobid) do update set
    jobname            = excluded.jobname,
    last_start         = greatest(cron_job_run_summary.last_start, excluded.last_start),
    last_status        = case
                           when excluded.last_start >= coalesce(cron_job_run_summary.last_start, '-infinity'::timestamptz)
                           then excluded.last_status
                           else cron_job_run_summary.last_status
                         end,
    last_success_at    = greatest(cron_job_run_summary.last_success_at, excluded.last_success_at),
    failures_last_hour = excluded.failures_last_hour,
    failures_as_of     = now(),
    updated_at         = now();

  -- 2) A job absent from the window had no runs at all, so it cannot have failed
  --    in the last hour — expire any stale count rather than re-reporting it.
  -- (alias required: the RETURNS TABLE columns are plpgsql variables of the same name)
  update public.cron_job_run_summary s
     set failures_last_hour = 0, failures_as_of = now()
   where s.failures_last_hour <> 0
     and s.failures_as_of < now() - interval '1 hour';

  -- 3) Report from the summary (19 rows) — no further scan of job_run_details.
  return query
  select
    j.jobname::text,
    j.schedule::text,
    s.last_status,
    s.last_start,
    round(extract(epoch from (now() - s.last_start)) / 60.0, 1),
    s.last_success_at,
    round(extract(epoch from (now() - s.last_success_at)) / 60.0, 1),
    round(extract(epoch from (now() - s.first_seen_at)) / 60.0, 1),
    coalesce(s.failures_last_hour, 0)::bigint,
    greatest(1, p_window_days)
  from cron.job j
  left join public.cron_job_run_summary s on s.jobid = j.jobid
  where j.active
  order by j.jobname;
end;
$$;

comment on function public.system_cron_health(int) is
  'Per active pg_cron job: schedule, last run + last SUCCESSFUL run, minutes since each, and failed runs in the last hour. Makes exactly one bounded pass over cron.job_run_details (p_window_days) and caches it in cron_job_run_summary, so it stays fast as job_run_details grows and still remembers runs older than the retention window. SECURITY DEFINER because the cron schema is not PostgREST-exposed.';

revoke all on function public.system_cron_health(int) from public, anon, authenticated;

-- ── Retention: keep job_run_details bounded so the probe stays fast forever ──
create or replace function public.prune_cron_run_details(
  p_keep_days int default 14,
  p_batch     int default 20000
)
returns bigint
language plpgsql
security definer
set search_path = cron, public
as $$
declare
  v_cut     timestamptz := now() - make_interval(days => greatest(1, p_keep_days));
  v_deleted bigint := 0;
  v_n       bigint;
begin
  -- Refresh the durable summary FIRST so pruning never loses a job's last run.
  perform count(*) from public.system_cron_health(greatest(1, p_keep_days));

  loop
    delete from cron.job_run_details
     where runid in (
       select d.runid
         from cron.job_run_details d
        where d.start_time < v_cut          -- never touches an in-flight run
        limit greatest(1000, p_batch)
     );
    get diagnostics v_n = row_count;
    v_deleted := v_deleted + v_n;
    exit when v_n = 0 or v_deleted >= 1000000;
  end loop;

  return v_deleted;
end;
$$;

comment on function public.prune_cron_run_details(int, int) is
  'Deletes cron.job_run_details rows older than p_keep_days in batches, after refreshing cron_job_run_summary so no job loses its last-run timestamp. pg_cron never prunes this table itself; unbounded growth is what made the cron health probe time out (52,848 rows / 52 MB by Aug 2026) and report a false "down".';

revoke all on function public.prune_cron_run_details(int, int) from public, anon, authenticated;

-- Seed the summary from everything currently on disk BEFORE the first prune,
-- so weekly/monthly jobs start with a real last-run timestamp.
select count(*) from public.system_cron_health(90);

-- Daily prune, off-peak.
do $$
begin
  perform cron.unschedule('prune-cron-run-details-daily')
    where exists (select 1 from cron.job where jobname = 'prune-cron-run-details-daily');
  perform cron.schedule(
    'prune-cron-run-details-daily',
    '35 4 * * *',
    $cron$select public.prune_cron_run_details(14)$cron$
  );
end $$;
