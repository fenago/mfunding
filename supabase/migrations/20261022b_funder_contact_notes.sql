-- ── funder_contact_notes — what staff learn by actually calling ─────────────
--
-- The Funder Contact tab shows two kinds of fact: what the funder record holds,
-- and what a research pass read on the web. Neither captures the third kind —
-- what the person who just rang the number found out. "Sean's line is dead, ask
-- for Charles after 3pm", "they want statements as one merged PDF", "this rep
-- left in August". That knowledge currently lives in somebody's head.
--
-- An append-only LOG, deliberately not a single shared textarea. A funder has
-- several people working it; a blob that two of them edit loses whoever saved
-- second, with no sign that anything was lost. Rows carry their author and
-- timestamp so a stale note reads as stale instead of as current fact.
--
-- `created_by_label` is denormalised on purpose: it records who wrote it AT THE
-- TIME, survives a profile rename, and means the note renders without a join
-- through a table the reader may not be on the RLS policy for.
--
-- This is NOT a route for changing a submission address. Nothing here is read
-- by submit-to-funders; it is prose for humans, exactly like lenders.notes, and
-- the same rule applies — a note saying "they moved to a new inbox" is a reason
-- to verify, never an instruction the system acts on.
create table if not exists public.funder_contact_notes (
  id               uuid primary key default gen_random_uuid(),
  lender_id        uuid not null references public.lenders(id) on delete cascade,
  body             text not null check (btrim(body) <> ''),
  -- Optional: which person at the funder this is about, free text because the
  -- people worth noting are often not rows in `contacts` yet.
  about_person     text,
  created_by       uuid not null default auth.uid() references auth.users(id),
  created_by_label text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz
);

create index if not exists funder_contact_notes_lender_idx
  on public.funder_contact_notes (lender_id, created_at desc);

alter table public.funder_contact_notes enable row level security;

-- Read: every staff role that can see the tab, processors included — they are
-- the ones making the calls that produce these notes.
drop policy if exists staff_read_funder_contact_notes on public.funder_contact_notes;
create policy staff_read_funder_contact_notes
  on public.funder_contact_notes for select
  using (
    (select public.is_admin_or_super((select auth.uid())))
    or (select public.is_employee((select auth.uid())))
    or (select public.is_processor((select auth.uid())))
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'closer')
  );

-- Write: same audience, but `created_by = auth.uid()` is enforced in the policy
-- rather than trusted from the client, so nobody can file a note under someone
-- else's name.
drop policy if exists staff_add_funder_contact_notes on public.funder_contact_notes;
create policy staff_add_funder_contact_notes
  on public.funder_contact_notes for insert
  with check (
    created_by = auth.uid()
    and (
      (select public.is_admin_or_super((select auth.uid())))
      or (select public.is_employee((select auth.uid())))
      or (select public.is_processor((select auth.uid())))
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'closer')
    )
  );

drop policy if exists author_edit_funder_contact_notes on public.funder_contact_notes;
create policy author_edit_funder_contact_notes
  on public.funder_contact_notes for update
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists author_delete_funder_contact_notes on public.funder_contact_notes;
create policy author_delete_funder_contact_notes
  on public.funder_contact_notes for delete
  using (created_by = auth.uid());

drop policy if exists super_admin_all_funder_contact_notes on public.funder_contact_notes;
create policy super_admin_all_funder_contact_notes
  on public.funder_contact_notes for all
  using ((select public.is_super_admin((select auth.uid()))))
  with check ((select public.is_super_admin((select auth.uid()))));

comment on table public.funder_contact_notes is
  'Free-text notes staff add about a funder or one of its people, from the Funder Contact tab. An append-only log, not a shared textarea: a single editable blob loses whoever saved second. Authors edit and delete their own; super_admin anything.';
