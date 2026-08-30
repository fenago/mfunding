-- Data Hygiene — add GoHighLevel contacts as a smart-list source.
--
-- The owner's PRIMARY use case: search the GHL book by TAG (and other fields),
-- materialize the matches into a smart_list, then enrich/validate them. GHL is the
-- CRM system of record, so it joins ph_ucc / lead_records / customers as a source.
--
-- Two schema changes, both backward-compatible and applied against EMPTY tables
-- (verified 2026-08-30: smart_lists = 0 rows, smart_list_members = 0 rows):
--
--   1) smart_lists.source check — allow 'ghl'.
--   2) smart_list_members.source_id — widen uuid → text.
--      GHL contact ids are NOT uuids (e.g. "oDH3nkemtZvNM40WrY6X"), so a uuid
--      column cannot hold them. The frontend already inserts String(r.id) and the
--      TS types (hygiene.ts) already treat source_id as string, so widening to text
--      aligns the column with the code that was already written against it. The
--      uuid sources (ph_ucc/lead_records/customers) keep storing their uuids — now
--      as their text representation, which is lossless. Keeping source_id as the
--      real id (not a synthetic uuid) preserves the unique(smart_list_id, source,
--      source_id) key, so re-running `materialize` for a GHL list is idempotent
--      (a contact already captured is skipped, not duplicated).

-- ── 1. Allow 'ghl' as a smart_lists.source ──────────────────────────────────────
alter table public.smart_lists
  drop constraint if exists smart_lists_source_check;
alter table public.smart_lists
  add constraint smart_lists_source_check
  check (source in ('ph_ucc','lead_records','customers','mixed','ghl'));

-- ── 2. Widen smart_list_members.source_id uuid → text (holds GHL contact ids) ────
-- Lossless: every existing uuid casts to its canonical text form. The
-- unique(smart_list_id, source, source_id) constraint and the list index are
-- preserved automatically across the type change (0 rows today regardless).
alter table public.smart_list_members
  alter column source_id type text using source_id::text;

comment on column public.smart_list_members.source_id is
  'Polymorphic id into the source store, stored as TEXT: a uuid (as text) for ph_ucc_leads/lead_records/customers, or a GoHighLevel contact id (non-uuid) for source=''ghl''. No FK.';
