-- ── funder_web_contacts — contact details FOUND ON THE WEB, never merged ─────
--
-- The owner asked for "everything" on every active funder, including whatever
-- Firecrawl can find on the open web. That data does NOT go into
-- `lenders.primary_contact_*` or `lenders.contacts`, and this table is the
-- reason why.
--
-- Those columns are the ones submit-to-funders and the submission recipes read.
-- A merchant's full financial package is emailed to whatever address wins that
-- lookup, so a scraped string that turns out to be stale, a reseller's
-- lead-capture inbox, or an SEO directory's guess is not a cosmetic error — it
-- is a redirect of someone's bank statements. The same reasoning that forbids
-- auto-applying a submission address from an inbound reply forbids it here,
-- and a web page is a WEAKER source than a reply from the funder's own domain.
--
-- So: every row here carries `source_url`, and the UI prints it. There is no
-- row without a provenance URL — the NOT NULL is the whole point. Promotion to
-- `lenders` is a human decision made against that URL, never a backfill.
--
-- `verified_at` stays NULL until someone actually reaches the person. A row
-- that has never been dialled is not a contact we have; it is a contact we
-- read somewhere.
create table if not exists public.funder_web_contacts (
  id          uuid primary key default gen_random_uuid(),
  lender_id   uuid not null references public.lenders(id) on delete cascade,
  -- what this row IS: a named person, a switchboard, a department inbox, a
  -- portal/apply link, a street address. Kept as free text with a check rather
  -- than an enum so a research pass can't fail on an unforeseen shape.
  kind        text not null check (kind in ('person','phone','email','portal','address','social','other')),
  name        text,
  title       text,
  email       text,
  phone       text,
  url         text,
  note        text,
  -- WHERE it was read. Required. A row with no URL cannot be checked by the
  -- person about to dial it, which makes it worse than no row.
  source_url  text not null,
  -- Which pass wrote it, so a bad sweep can be deleted as a unit.
  found_by    text,
  found_at    timestamptz not null default now(),
  -- Set by a human who actually reached this person/line. Until then the UI
  -- says "found on the web — not verified by us".
  verified_at timestamptz,
  verified_by uuid references auth.users(id)
);

create index if not exists funder_web_contacts_lender_idx
  on public.funder_web_contacts (lender_id);

-- Re-running a research pass must update, not duplicate. Dedupe on the
-- identity the row actually carries; coalesce so a phone-only and an
-- email-only row for the same person stay distinct instead of colliding.
create unique index if not exists funder_web_contacts_dedupe_idx
  on public.funder_web_contacts (
    lender_id,
    kind,
    lower(coalesce(email, '')),
    regexp_replace(coalesce(phone, ''), '\D', '', 'g'),
    lower(coalesce(name, '')),
    lower(coalesce(url, ''))
  );

alter table public.funder_web_contacts enable row level security;

-- Read mirrors `lenders` exactly — including processor_read_lenders, because
-- the processor is the person who actually dials these numbers. Four separate
-- policies rather than one OR, matching how lenders is already written, so a
-- future change to one role does not silently move the others.
drop policy if exists super_admin_all_funder_web_contacts on public.funder_web_contacts;
create policy super_admin_all_funder_web_contacts
  on public.funder_web_contacts for all
  using ((select public.is_super_admin((select auth.uid()))));

drop policy if exists admin_view_funder_web_contacts on public.funder_web_contacts;
create policy admin_view_funder_web_contacts
  on public.funder_web_contacts for select
  using ((select public.is_admin_or_super((select auth.uid()))));

drop policy if exists employee_read_funder_web_contacts on public.funder_web_contacts;
create policy employee_read_funder_web_contacts
  on public.funder_web_contacts for select
  using ((select public.is_employee((select auth.uid()))));

drop policy if exists closer_read_funder_web_contacts on public.funder_web_contacts;
create policy closer_read_funder_web_contacts
  on public.funder_web_contacts for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'closer'));

drop policy if exists processor_read_funder_web_contacts on public.funder_web_contacts;
create policy processor_read_funder_web_contacts
  on public.funder_web_contacts for select
  using ((select public.is_processor((select auth.uid()))));

comment on table public.funder_web_contacts is
  'Contact details found on the open web by a research pass. NEVER merged into lenders.* — every row carries source_url and the UI prints it. Promotion to the funder record is a human decision.';
