-- The push drain's working-set index. This is a root-cause fix, not a tune-up.
--
-- WHAT BROKE: the first real 85k push died at 50,677/85,600 with
-- "canceling statement due to statement timeout". Not a fluke, and not random —
-- the drain got quadratically slower as it progressed.
--
-- WHY: each window fetched the next 250 rows with
--     where batch_id = ? and status = 'loaded' and phone is not null
--     order by created_at asc limit 250
-- The ORDER BY put the planner on (batch_id, created_at), where the already-pushed
-- rows sit at the FRONT of the scan. So every fetch walked past all of them:
--     Index Scan Backward using lead_records_batch_created_idx
--       Rows Removed by Filter: 50,678        <- measured at the failure point
--       Execution Time: 4,268 ms
-- Cost per chunk is O(pushed), so cost over a run is O(n^2). It survived to 59%
-- only because that is where the curve crossed the 8s statement timeout.
--
-- THE FIX, two parts:
--   1. This partial index contains EXACTLY the rows the drain wants, so it finds
--      its 250 immediately — and it SHRINKS as the push progresses instead of
--      being scanned past. 4,268 ms -> 2.4 ms, zero rows removed by filter.
--   2. The drain query dropped its ORDER BY (see lead-push-ghl). Ordering was
--      meaningless there anyway: a pushed row leaves the selection, so every row
--      is visited exactly once whatever the sequence — and the ordering was the
--      only thing keeping the planner off this index.
create index if not exists lead_records_drain_idx
  on public.lead_records (batch_id)
  where status = 'loaded' and phone is not null;
comment on index public.lead_records_drain_idx is
  'The push drain''s working set: only rows still waiting to be pushed. Contains exactly the rows the drain selects, so a chunk fetch finds its 250 immediately and the index SHRINKS as the push progresses. Without it the drain re-scanned every already-pushed row on every fetch — O(pushed) per chunk, O(n^2) overall — which killed the 85k job at 59% with a statement timeout (4.3s per fetch and climbing).';
