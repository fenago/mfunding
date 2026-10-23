-- ── What the funder's OWN documents say ──────────────────────────────────────
--
-- 67 documents sit in `lender-documents` — 58 signed ISO agreements plus
-- guideline sheets, compensation schedules and product summaries. Almost none
-- of their contents reached a structured column: of 76 active funders we hold
-- commission points for 8 and max-positions for 7, while UCS's own
-- "ISO Compensation.pdf" has been in the bucket since February.
--
-- These facts land HERE and not in `lender_programs`, for the same reason
-- `funder_web_contacts` exists: an extracted value is a reading of a document,
-- and a reading can be wrong. Promotion into the funder record is a human
-- decision made against the quote. The difference from the web table is
-- trust level, not process — these are primary sources the funder signed or
-- sent us, so most of this SHOULD get promoted. It just does not promote
-- itself.
--
-- `quote` is NOT optional padding. A number with no sentence around it cannot
-- be checked, and "the agreement says 12 points" is worth nothing when the
-- agreement says 12 points on first-position deals under $100k only.
create table if not exists public.funder_doc_facts (
  id           uuid primary key default gen_random_uuid(),
  lender_id    uuid not null references public.lenders(id) on delete cascade,
  document_id  uuid references public.lender_documents(id) on delete set null,
  source_file  text not null,
  field_key    text not null,
  value        text not null,
  quote        text not null check (btrim(quote) <> ''),
  page         text,
  product      text,
  confidence   text not null default 'medium' check (confidence in ('high','medium','low')),
  conflicts_with_record text,
  extracted_by text,
  extracted_at timestamptz not null default now(),
  promoted_at  timestamptz,
  promoted_by  uuid references auth.users(id)
);

create unique index if not exists funder_doc_facts_dedupe_idx
  on public.funder_doc_facts (lender_id, field_key, coalesce(product,''), md5(value), md5(source_file));
create index if not exists funder_doc_facts_lender_idx on public.funder_doc_facts (lender_id, field_key);

alter table public.funder_doc_facts enable row level security;

drop policy if exists super_admin_all_funder_doc_facts on public.funder_doc_facts;
create policy super_admin_all_funder_doc_facts on public.funder_doc_facts for all
  using ((select public.is_super_admin((select auth.uid()))))
  with check ((select public.is_super_admin((select auth.uid()))));

drop policy if exists staff_read_funder_doc_facts on public.funder_doc_facts;
create policy staff_read_funder_doc_facts on public.funder_doc_facts for select
  using (
    (select public.is_admin_or_super((select auth.uid())))
    or (select public.is_employee((select auth.uid())))
    or (select public.is_processor((select auth.uid())))
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'closer')
  );

comment on table public.funder_doc_facts is
  'Facts read out of a funder''s own documents, each with the quote it came from. Never auto-promoted into lenders/lender_programs — a human promotes against the quote.';
