-- LEAD MACHINE — tag-based filtering/export + the re-tag push mode.
--
-- The admin UI exports filtered slices as CSV by querying lead_records directly
-- under RLS, and one of the filters is the TAG SET a lead was pushed with. That
-- makes lead_records.push_tags a QUERIED column, not just an audit stamp:
--   • a GIN index so `push_tags @> '{ucc-lead}'` (PostgREST `.contains()`) is an
--     index scan, not an 85k-row sequential filter;
--   • push_tags is guaranteed to hold the FULL final tag set actually sent to GHL
--     (auto type tag + batch tag + caller tags), so a tag filter here and a tag
--     search in GHL return the same population.
--
-- RE-TAG MODE. The default push drains status='loaded' rows, which is what makes
-- it un-double-pushable. Adding a NEW tag to an ALREADY-pushed slice needs the
-- opposite: revisit rows that are already 'pushed'. That mode can't use
-- drain semantics (the rows never leave the selection), so it paginates on a
-- stable id cursor kept on the job — hence cursor_id. `retag` records which mode
-- a job ran in so the history is readable.

-- ── Tag filtering / export ────────────────────────────────────────────────────
create index if not exists lead_records_push_tags_gin
  on public.lead_records using gin (push_tags);
comment on column public.lead_records.push_tags is
  'The FULL final tag set sent to GHL for this lead: the automatic <lead_type>-lead tag + the lowercased batch code + the caller''s campaign tags. On a re-tag push this becomes the UNION of what was already there and the new tags, so it always mirrors the contact''s tags in GHL. GIN-indexed for tag filtering/export.';

-- Free-text browse (name / company) over a big book — trigram beats leading-%
-- ILIKE, which cannot use a b-tree index at all.
create extension if not exists pg_trgm;
create index if not exists lead_records_company_trgm
  on public.lead_records using gin (company gin_trgm_ops);
create index if not exists lead_records_email_idx
  on public.lead_records (email) where email is not null;

-- ── Re-tag push mode ──────────────────────────────────────────────────────────
alter table public.lead_push_jobs
  add column if not exists retag     boolean not null default false,
  add column if not exists cursor_id uuid;
comment on column public.lead_push_jobs.retag is
  'true when the job revisits ALREADY-pushed rows to add tags (or retry errored ones). Such a job paginates on cursor_id because the rows never leave its selection; a normal push instead drains status=loaded and needs no cursor.';
comment on column public.lead_push_jobs.cursor_id is
  'Stable id-order resume point for a cursor-mode (retag / explicit-status) job.';
