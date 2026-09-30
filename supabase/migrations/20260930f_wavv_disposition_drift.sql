-- wavv_disposition_drift — the aggregate behind the weekly disposition-drift check.
--
-- WHY THIS EXISTS
--
-- wavv-disposition-sync's MAPPING turns a WAVV disposition into a pipeline
-- action. WAVV's disposition list is edited in their UI, by people who do not
-- read our code, and the 2026-08-28 correction in that file records what happens:
-- WAVV ADDS values and keeps the old ones, so the mapping silently falls behind
-- and nobody finds out until someone asks an unrelated question.
--
-- Found exactly that way on 2026-09-30: `Partial Application` (12 calls, median
-- 294s, every one over 30 seconds) had no mapping at all, and `Follow Up` had
-- appeared five days earlier. Both were real setter work the pipeline never saw.
--
-- THE DISTINCTION THIS HAS TO CARRY
--
-- An unmapped value is not automatically a bug. `None` (1,360 calls) is
-- deliberately unmapped and must stay that way — we cannot guess what happened
-- on a call nobody dispositioned. So the detector compares against BOTH the
-- mapping and an explicit ignore-list, and only the residue is drift. That
-- decision lives in the edge function next to MAPPING, not here; this function
-- just reports the facts.
--
-- It returns volume and shape, not just a name, because "a new disposition
-- appeared" is a notification while "12 calls, median 294s, none under 30
-- seconds" is a decision.
--
-- Read-only. SECURITY INVOKER on purpose: wavv_calls is already admin-gated and
-- this must not widen that.

create or replace function public.wavv_disposition_drift(p_days integer default 90)
returns table (
  disposition   text,
  calls         bigint,
  median_sec    double precision,
  under_30s     bigint,
  pct_human     integer,
  first_seen    date,
  last_seen     date
)
language sql
stable
set search_path to 'public'
as $$
  select
    -- NULL is a real, distinct case (calls WAVV never dispositioned at all), so
    -- it gets its own labelled row rather than being dropped by the group by.
    coalesce(w.disposition, '(unset)')                                      as disposition,
    count(*)                                                                as calls,
    percentile_cont(0.5) within group (order by w.seconds)                  as median_sec,
    count(*) filter (where coalesce(w.seconds, 0) < 30)                     as under_30s,
    round(100.0 * count(*) filter (where w.human) / nullif(count(*), 0))::int as pct_human,
    min(w.started_at)::date                                                 as first_seen,
    max(w.started_at)::date                                                 as last_seen
  from public.wavv_calls w
  where w.started_at >= now() - make_interval(days => greatest(p_days, 1))
  group by 1
  order by count(*) desc;
$$;

comment on function public.wavv_disposition_drift(integer) is
  'Per-disposition volume/shape over the last N days, for the weekly drift check in wavv-disposition-sync (action:"drift"). Reports facts only — what counts as drift is decided against MAPPING + IGNORED_DISPOSITIONS in that function.';

grant execute on function public.wavv_disposition_drift(integer) to authenticated;
