-- ============================================================================
-- Closer Onboarding & Documents — per-closer signing tracker
-- Applied live via MCP 2026-07-11.
--
-- WHAT THIS IS: one row per (closer, document) for the 9 Phase-0 onboarding
-- documents in research/legal/closer-onboarding-checklist-sop.md. It tracks
-- ONLY the *status* of paperwork (sent / signed / n-a) — it does not store,
-- generate, or execute any legal document. The document text itself stays in
-- the markdown files under research/legal/ and is rendered read-only in-app.
--
-- ⚠ The underlying legal templates are DRAFTS pending attorney review. Nothing
--   here should be read as "these documents are ready to execute."
--
-- ACCESS MODEL:
--   super_admin / admin → full manage (they are the ones recording signatures)
--   closer              → SELECT on their OWN rows only (they must be able to
--                         see what they still owe; they must never see another
--                         closer's paperwork status). No write — a closer cannot
--                         mark their own document signed.
-- ============================================================================

create table if not exists public.closer_documents (
  id           uuid primary key default gen_random_uuid(),
  closer_id    uuid not null references public.closers(id) on delete cascade,
  doc_slug     text not null,
  status       text not null default 'not_sent'
                 check (status in ('not_sent', 'sent', 'signed', 'na')),
  signed_at    timestamptz,
  recorded_by  uuid references public.profiles(id) on delete set null,
  notes        text,
  file_url     text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (closer_id, doc_slug)
);

create index if not exists closer_documents_closer_id_idx on public.closer_documents (closer_id);
create index if not exists closer_documents_status_idx    on public.closer_documents (status);

comment on table public.closer_documents is
  'Per-closer onboarding paperwork tracker (status only). Document text lives in research/legal/*.md and is DRAFT pending attorney review.';

-- updated_at ---------------------------------------------------------------
create or replace function public.touch_closer_documents_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists closer_documents_touch_updated_at on public.closer_documents;
create trigger closer_documents_touch_updated_at
  before update on public.closer_documents
  for each row execute function public.touch_closer_documents_updated_at();

-- ---------------------------------------------------------------------------
-- The 9 Phase-0 doc slugs. Kept in one function so the backfill and the
-- new-closer trigger can never drift apart. Mirrors CLOSER_DOCS in
-- src/data/closerDocs.ts (that file carries the human-readable metadata).
-- ---------------------------------------------------------------------------
create or replace function public.closer_doc_slugs()
returns text[] language sql immutable as $$
  select array[
    'ic-commission-agreement',        -- SIGN    (v2 .docx — sent manually)
    'schedule-a-rate-sheet',          -- SIGN
    'nda-confidentiality',            -- SIGN
    'tcpa-compliance-acknowledgment', -- SIGN
    'code-of-conduct',                -- SIGN
    'clawback-policy-acknowledgment', -- SIGN
    'w9',                             -- COLLECT (external IRS form)
    'direct-deposit-authorization',   -- COMPLETE
    'state-licensing-proof'           -- COLLECT if applicable (external)
  ]::text[];
$$;

-- Seed the checklist for one closer (idempotent).
create or replace function public.seed_closer_documents(c_id uuid)
returns void language sql security definer set search_path to 'public' as $$
  insert into public.closer_documents (closer_id, doc_slug)
  select c_id, s from unnest(public.closer_doc_slugs()) as s
  on conflict (closer_id, doc_slug) do nothing;
$$;

-- Every new closer gets the full checklist automatically.
create or replace function public.seed_closer_documents_on_insert()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.seed_closer_documents(new.id);
  return new;
end;
$$;

drop trigger if exists closers_seed_documents on public.closers;
create trigger closers_seed_documents
  after insert on public.closers
  for each row execute function public.seed_closer_documents_on_insert();

-- Backfill every closer that already exists.
insert into public.closer_documents (closer_id, doc_slug)
select c.id, s
from public.closers c
cross join unnest(public.closer_doc_slugs()) as s
on conflict (closer_id, doc_slug) do nothing;

-- RLS ----------------------------------------------------------------------
alter table public.closer_documents enable row level security;

-- admin + super_admin: full manage (record who signed what).
drop policy if exists closer_documents_staff_manage on public.closer_documents;
create policy closer_documents_staff_manage on public.closer_documents
  for all to authenticated
  using ( is_admin_or_super((select auth.uid())) )
  with check ( is_admin_or_super((select auth.uid())) );

-- closer: read ONLY their own rows. No insert/update/delete — a closer can see
-- what they still owe, but cannot mark their own paperwork complete, and cannot
-- see any other closer's status.
drop policy if exists closer_documents_self_read on public.closer_documents;
create policy closer_documents_self_read on public.closer_documents
  for select to authenticated
  using (
    closer_id in (select c.id from public.closers c where c.user_id = (select auth.uid()))
  );
