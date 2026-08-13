-- ONE definition of "has an email", plus the index that makes both polarities cheap.
--
-- DECISION (team-lead's preference, adopted): has_email means the lead is
-- REACHABLE BY EMAIL — primary OR any extra — not "the primary column is
-- populated". An email campaign can mail any address on the record, so the
-- primary-only reading would silently exclude leads the owner can actually mail.
--
-- Defined as a GENERATED COLUMN rather than repeated as a predicate, because the
-- brief was to make lead-push-ghl {action:'count'}, lead_records_search and the
-- export agree. Three hand-written copies of a predicate is three chances to
-- drift; one generated column cannot drift at all.
alter table public.lead_records
  add column if not exists has_any_email boolean
  generated always as (email is not null or jsonb_array_length(extra_emails) > 0) stored;
comment on column public.lead_records.has_any_email is
  'Reachable by email at all: primary OR any extra. THE single definition of has_email — lead-push-ghl {action:count}, lead_records_search and the export all filter on this column, so the three cannot drift. An email campaign can mail any address on the record, so "has an email" must mean "is reachable by email", not "the primary field is populated".';

-- NOT partial, and that matters. A partial index on `where has_any_email` served
-- the true case only, so has_email=false seq-scanned 249,923 rows to find 512 and
-- intermittently ABORTED on this instance. Both polarities are queried, so both
-- are indexed. (249,411 of 249,923 rows have an email — the AGED file is 100%
-- email — so "true" is the near-whole-table case and "false" is the selective one.)
drop index if exists public.lead_records_has_any_email_idx;
create index if not exists lead_records_has_any_email_idx
  on public.lead_records (has_any_email);
comment on index public.lead_records_has_any_email_idx is
  'Deliberately NOT partial. A partial index on `where has_any_email` served the true case only, so has_email=false seq-scanned 250k rows to find 512 — and intermittently aborted. Both polarities are queried, so both are indexed.';
