-- LEAD MACHINE — make the batches overview O(batches), not O(rows).
--
-- THE BUG: /admin/lead-machine failed to load with "canceling statement due to
-- statement timeout". lead_batch_overview aggregated lead_records live, once per
-- batch, on every page load.
--
-- MEASURED on the real 249,923 rows:
--   • as `authenticated`            : 15,792 ms  (statement timeout territory)
--   • same aggregate without RLS    :  9,395 ms
--
-- So it was TWO costs stacked, and the plan named both:
--   1. scanning 249,923 rows to count them (~9.4s), and
--   2. the RLS predicate `is_admin_or_super(auth.uid())` applied as a per-row
--      Filter on lead_records — ~250k function calls per page load (~6.4s more).
--
-- WHY NOT INDEXES (the tempting fix): no index makes this fast. A partial or
-- composite index could serve the count predicates, but RLS still forces a
-- per-row function call that no index can satisfy, and 250k rows is 250k calls
-- however they are reached. Index-only aggregation cannot get under 100ms here.
--
-- WHY NOT A MATVIEW: a materialized view does not respect RLS at all, so it would
-- quietly become a way for any role that can read it to see batch counts. Wrong
-- trade for a fix to a performance bug.
--
-- THE FIX: the counts are already produced by the two writers that own this data
-- (lead-file-ingest at finalize, lead-push-ghl per chunk), and both already scan
-- the batch. So maintain them ON lead_batches and make the view a pure PROJECTION
-- of that 3-row table. The page load stops touching lead_records entirely: RLS now
-- runs 3 times instead of 249,923, and cost is independent of how many leads exist.
--
-- THE TRADE, stated plainly: denormalized counters can drift if anything writes
-- lead_records outside the two writers (a manual PATCH from the UI or a script —
-- which already happened once when 24 test rows were reset by hand). Drift is
-- therefore made VISIBLE (counts_refreshed_at) and FIXABLE on demand
-- (lead_batch_refresh_counts, exposed for the UI to call), rather than silent.

-- ── 1. The maintained counters ────────────────────────────────────────────────
-- total_rows / ingested_rows / dup_rows / pushed_rows already exist.
alter table public.lead_batches
  add column if not exists dialable_rows      integer not null default 0,
  add column if not exists skipped_rows       integer not null default 0,
  add column if not exists errored_rows       integer not null default 0,
  add column if not exists dup_of_prior_rows  integer not null default 0,
  add column if not exists counts_refreshed_at timestamptz;

comment on column public.lead_batches.dialable_rows is
  'Maintained counter: rows with a usable phone. Recomputed by lead_batch_refresh_counts(), never aggregated at read time.';
comment on column public.lead_batches.counts_refreshed_at is
  'When the maintained counters were last recomputed from lead_records. If a write bypassed the ingest/push writers the counters can be stale — this is how the UI can tell, and lead_batch_refresh_counts() is how it is fixed.';

-- ── 2. One pass computes every counter ────────────────────────────────────────
-- Called at ingest finalize and at push-job finalize (both already scan the
-- batch), and callable on demand. Single scan of one batch, not of the table.
create or replace function public.lead_batch_refresh_counts(p_batch_id uuid)
returns table (ingested_rows integer, dup_rows integer, pushed_rows integer)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ingested integer; v_pushed integer; v_dialable integer;
  v_skipped integer;  v_errored integer; v_dup_prior integer;
  v_total integer;
begin
  select
    count(*)::int,
    count(*) filter (where status = 'pushed')::int,
    count(*) filter (where phone is not null)::int,
    count(*) filter (where status = 'skipped')::int,
    count(*) filter (where status = 'error')::int,
    count(*) filter (where is_dup_of_prior)::int
  into v_ingested, v_pushed, v_dialable, v_skipped, v_errored, v_dup_prior
  from public.lead_records where batch_id = p_batch_id;

  select total_rows into v_total from public.lead_batches where id = p_batch_id;

  update public.lead_batches b
     set ingested_rows      = v_ingested,
         pushed_rows        = v_pushed,
         dialable_rows      = v_dialable,
         skipped_rows       = v_skipped,
         errored_rows       = v_errored,
         dup_of_prior_rows  = v_dup_prior,
         -- rows the file contained that did NOT land = in-file phone duplicates
         dup_rows           = greatest(coalesce(v_total, 0) - v_ingested, 0),
         counts_refreshed_at = now()
   where b.id = p_batch_id;

  return query select v_ingested, greatest(coalesce(v_total, 0) - v_ingested, 0), v_pushed;
end;
$fn$;
comment on function public.lead_batch_refresh_counts(uuid) is
  'Recomputes every maintained counter on lead_batches from lead_records in ONE pass over a single batch. Called at ingest finalize and push finalize; also the repair path when a manual write drifts the counters. Safe to call any time — idempotent.';

-- Let the UI trigger a repair itself (admin/super_admin only — the function is
-- SECURITY DEFINER, so the grant is the access control).
revoke all on function public.lead_batch_refresh_counts(uuid) from public, anon;
grant execute on function public.lead_batch_refresh_counts(uuid) to authenticated;

-- ── 3. The view becomes a projection — no lead_records at read time ───────────
-- Column names are UNCHANGED so the UI keeps working as-is.
create or replace view public.lead_batch_overview as
select
  b.id, b.batch_code, b.lead_type, b.label, b.file_name, b.file_size, b.status,
  b.total_rows, b.ingested_rows, b.dup_rows, b.message, b.error,
  b.byte_offset, b.bytes_total, b.created_at, b.finished_at,
  -- Cast to bigint so the view's output types are UNCHANGED (they were bigint
  -- when produced by count()). Keeps CREATE OR REPLACE legal -- Postgres refuses
  -- to change a view column's type -- and means the UI's parsing is untouched.
  b.ingested_rows::bigint     as records,
  b.dialable_rows::bigint     as dialable,
  b.pushed_rows::bigint       as pushed,
  b.errored_rows::bigint      as errored,
  b.skipped_rows::bigint      as skipped,
  b.dup_of_prior_rows::bigint as dup_of_prior,
  b.counts_refreshed_at
from public.lead_batches b;
comment on view public.lead_batch_overview is
  'Per-batch roll-up for the Lead Machine UI, served from MAINTAINED counters on lead_batches — it never touches lead_records, so its cost is independent of how many leads exist. Aggregating live cost 15.8s under the authenticated role at 250k rows (statement timeout). security_invoker keeps RLS, now evaluated over 3 batch rows instead of 250k lead rows.';
alter view public.lead_batch_overview set (security_invoker = on);

-- ── 4. Backfill every existing batch ──────────────────────────────────────────
select public.lead_batch_refresh_counts(id) from public.lead_batches;
