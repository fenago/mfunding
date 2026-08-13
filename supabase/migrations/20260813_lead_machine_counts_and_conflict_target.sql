-- LEAD MACHINE — two corrections the edge functions need.
--
-- 1) ON CONFLICT INFERENCE. The in-batch phone dedupe index was PARTIAL
--    (`where phone is not null`). Postgres can only infer a partial unique index
--    as an ON CONFLICT target if the statement repeats the index predicate, and
--    PostgREST's `on_conflict=` cannot express one — so the streaming insert would
--    have failed with "no unique or exclusion constraint matching the ON CONFLICT
--    specification". A PLAIN unique index gives identical behaviour here: under
--    Postgres NULLS-DISTINCT semantics every phone-less row is still unique, so
--    unusable rows are all kept (as status 'skipped') while a repeated phone
--    inside one file is dropped.
--
-- 2) A single set-based counter refresh both edge functions call, so
--    lead_batches' denormalized tallies can never drift from lead_records.

drop index if exists public.lead_records_batch_phone_uidx;
create unique index if not exists lead_records_batch_phone_uidx
  on public.lead_records (batch_id, phone);
comment on index public.lead_records_batch_phone_uidx is
  'In-batch phone dedupe AND the ON CONFLICT target for the streaming ingest. Deliberately NOT partial so PostgREST can infer it; NULL phones stay unique-by-NULL so every unusable row is still stored.';

create or replace function public.lead_batch_refresh_counts(p_batch_id uuid)
returns table (ingested_rows integer, dup_rows integer, pushed_rows integer)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ingested integer;
  v_pushed   integer;
  v_total    integer;
begin
  select count(*)::int, count(*) filter (where status = 'pushed')::int
    into v_ingested, v_pushed
    from public.lead_records where batch_id = p_batch_id;

  select total_rows into v_total from public.lead_batches where id = p_batch_id;

  update public.lead_batches b
     set ingested_rows = v_ingested,
         pushed_rows   = v_pushed,
         -- rows the file contained that did NOT land = in-file phone duplicates
         dup_rows      = greatest(coalesce(v_total, 0) - v_ingested, 0)
   where b.id = p_batch_id;

  return query select v_ingested, greatest(coalesce(v_total, 0) - v_ingested, 0), v_pushed;
end;
$fn$;
comment on function public.lead_batch_refresh_counts(uuid) is
  'Recomputes lead_batches.ingested_rows / dup_rows / pushed_rows from lead_records. Called at ingest finalize and at push-job finalize so the batch tallies never drift.';
