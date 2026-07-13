-- check-stage-monotonicity.sql
--
-- Regression guard for the funnel-integrity bug: deals were being advanced to a
-- later stage without the earlier stages ever being stamped (e.g. application_sent_at
-- set while contacted_at was still NULL). The funnel report counts a stage as
-- "reached" by asking whether its timestamp is non-null, so a hole above a filled
-- rung makes the lower bucket SMALLER than the higher one — and stage conversion
-- prints rates above 100%.
--
-- public.deals_stamp_stage_timestamps_trg now enforces this on every status write.
-- This query is the audit that proves it: it must return ZERO rows.
--
-- Run:  psql "$DATABASE_URL" -f scripts/check-stage-monotonicity.sql
-- Cron it and alert on any output.
--
-- It reports two distinct kinds of breakage:
--   HOLE        — a later rung is stamped but an earlier one is NULL. This is the
--                 original bug and the thing that inflates conversion above 100%.
--   OUT_OF_ORDER— every rung is stamped, but an earlier one is LATER in time than a
--                 rung above it. Doesn't break the counts, but poisons every
--                 stage-duration / velocity metric. Its most likely source is a code
--                 path that writes a stage timestamp WITHOUT changing status (the
--                 trigger is `BEFORE INSERT OR UPDATE OF status`, so it cannot see
--                 those writes).

with rungs as (
  select
    d.id,
    d.deal_number,
    d.status,
    d.created_at,
    -- The stage ladder, in order. Index i in this array is rung i+1.
    array[
      d.contacted_at,        -- 1
      d.qualified_at,        -- 2
      d.application_sent_at, -- 3
      d.docs_collected_at,   -- 4
      d.bank_statements_at,  -- 5
      d.submitted_at,        -- 6
      d.offer_received_at,   -- 7
      d.offer_presented_at,  -- 8
      d.offer_accepted_at,   -- 9
      d.funded_at            -- 10
    ] as ts,
    array[
      'contacted_at','qualified_at','application_sent_at','docs_collected_at',
      'bank_statements_at','submitted_at','offer_received_at','offer_presented_at',
      'offer_accepted_at','funded_at'
    ] as nm
  from public.deals d
  where d.deal_type = 'mca'
),
pairs as (
  select r.id, r.deal_number, r.status, r.ts, r.nm,
         lo.i as lo_i, hi.i as hi_i
  from rungs r
  cross join lateral generate_series(1, 10) as lo(i)
  cross join lateral generate_series(1, 10) as hi(i)
  where hi.i > lo.i
)
select
  p.deal_number,
  p.id           as deal_id,
  p.status,
  case when p.ts[p.lo_i] is null then 'HOLE' else 'OUT_OF_ORDER' end as violation,
  p.nm[p.lo_i]   as earlier_column,
  p.ts[p.lo_i]   as earlier_at,
  p.nm[p.hi_i]   as later_column,
  p.ts[p.hi_i]   as later_at
from pairs p
where p.ts[p.hi_i] is not null
  and (
    p.ts[p.lo_i] is null                 -- HOLE: later rung stamped, earlier one missing
    or p.ts[p.lo_i] > p.ts[p.hi_i]       -- OUT_OF_ORDER: earlier rung stamped after a later one
  )
order by p.deal_number, p.lo_i, p.hi_i;
