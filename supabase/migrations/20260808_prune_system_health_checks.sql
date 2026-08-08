-- Retention for system_health_checks — the same unbounded-log shape that made the
-- cron probe time out (see 20260808_cron_health_schedule_aware_and_prune.sql).
--
-- system_health_checks is append-only: the health check writes ONE row per service
-- per run, and nothing ever deleted them. At 9 services x 6 runs/hour that is ~1,300
-- rows/day (16,782 rows in its first 14 days). Left alone it reaches ~475k rows/year
-- for a page that only ever reads the last 7 days.
--
-- Retention: 30 days — 4x the window SystemHealthPage queries
-- (`.gte("checked_at", sevenDaysAgo)`), so incident forensics keep plenty of runway.
--
-- Deliberately scoped to system_health_checks ONLY. system_health_state (one row per
-- service) and system_health_incidents (one row per outage) are small and are the
-- durable record — they are never pruned.

create or replace function public.prune_system_health_checks(
  p_keep_days int default 30,
  p_batch     int default 20000
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cut     timestamptz := now() - make_interval(days => greatest(1, p_keep_days));
  v_deleted bigint := 0;
  v_n       bigint;
begin
  loop
    delete from public.system_health_checks
     where id in (
       select c.id
         from public.system_health_checks c
        where c.checked_at < v_cut
        limit greatest(1000, p_batch)
     );
    get diagnostics v_n = row_count;
    v_deleted := v_deleted + v_n;
    exit when v_n = 0 or v_deleted >= 1000000;
  end loop;

  return v_deleted;
end;
$$;

comment on function public.prune_system_health_checks(int, int) is
  'Deletes public.system_health_checks probe rows older than p_keep_days, in batches. The table is append-only (~1,300 rows/day) and had no retention; /admin/system only reads the last 7 days, so 30 days is kept. Never touches system_health_state or system_health_incidents.';

revoke all on function public.prune_system_health_checks(int, int) from public, anon, authenticated;

-- Own daily job rather than folding into prune-cron-run-details-daily: each job name
-- states exactly what it trims, and one failing prune cannot block the other.
do $$
begin
  perform cron.unschedule('prune-system-health-checks-daily')
    where exists (select 1 from cron.job where jobname = 'prune-system-health-checks-daily');
  perform cron.schedule(
    'prune-system-health-checks-daily',
    '40 4 * * *',
    $cron$select public.prune_system_health_checks(30)$cron$
  );
end $$;
