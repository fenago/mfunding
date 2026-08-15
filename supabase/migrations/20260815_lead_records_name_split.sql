-- Name split: the vendor CSVs cram the whole name into FIRST NAME.
--
-- Verified in the raw UCC file (row 2487705771: "COREY JENKINS" in FIRST NAME,
-- LAST NAME empty). Ingest copied it faithfully, so 4,413 merchants had no
-- surname and a setter's screen greeted "COREY JENKINS" as a first name.
--
-- name_split_at records WHEN a row's name was corrected. needs_name_resync is a
-- STORED generated column because PostgREST filters compare a column to a
-- literal, never to another column — "pushed_at < name_split_at" has to live in
-- the schema for the repair pass to be able to select on it. It is also
-- self-draining: a successful re-push moves pushed_at past name_split_at.
--
-- The original string is NOT destroyed: ingest already keeps the untouched CSV
-- row in lead_records.raw, which is what made this backfill safe to run at all.
alter table public.lead_records add column if not exists name_split_at timestamptz;

alter table public.lead_records
  add column if not exists needs_name_resync boolean
  generated always as (
    name_split_at is not null and (pushed_at is null or pushed_at < name_split_at)
  ) stored;

create index if not exists lead_records_name_resync_idx
  on public.lead_records (id)
  where needs_name_resync and status = 'pushed';

-- The backfill itself ran as three passes, in this order (recorded for history;
-- re-running them is a no-op because each requires the state the previous left):
--   1. "FIRST LAST"  -> first word / remainder      (4,414 rows)
--   2. "LAST, FIRST" -> comma INVERTS the order     (333 + 38 rows)
--   3. ", PRESIDENT|OWNER|MGR|..." stripped from the surname (10 rows)
-- Generational suffixes (JR/SR/II/III) are deliberately KEPT — part of the name.
