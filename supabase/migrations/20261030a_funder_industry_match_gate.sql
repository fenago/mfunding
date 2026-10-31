-- ─────────────────────────────────────────────────────────────────────────────
-- Industry-classification match gate (built for Bitty Advance, 2026-10-30)
--
-- Bitty's own New Applications page: "Selecting accurate Industry
-- classification affects your approval. If you enter an inaccurate Industry
-- classification, it can hurt your customer experience or incorrectly decline
-- a deal that should be approved." And: "Industry can be the difference
-- between 16% commission and an auto-decline." Their worked example — a
-- business with "Excavation" in the name filed as "Construction - Residential
-- Remodeler" instead of "Site prep contractor" — "Deal gets 1.65 paying 10%
-- instead of 1.55 paying 16%."
--
-- So the industry pick is not a form field, it is a priced term. This makes it
-- a HARD STOP: submit-to-funders refuses a funder whose profile asks for a
-- match until a human has written down the NAICS code, the activity it was
-- derived from, and the exact label they will choose in that funder's own
-- dropdown.
-- ─────────────────────────────────────────────────────────────────────────────

-- (a) The data-driven switch. Bitty's lender id is NOT hard-coded in the edge
--     function: the function reads this flag, so turning the gate on for
--     another funder is a one-row update, not a deploy.
alter table public.funder_submission_profiles
  add column if not exists requires_industry_match boolean not null default false;

comment on column public.funder_submission_profiles.requires_industry_match is
  'When true, submit-to-funders REFUSES this funder (blocked reason "industry_match") until a confirmed public.deal_industry_classification row exists for (deal, lender). Set for funders who price the deal off the industry classification we select in their application — Bitty Advance states the wrong pick can mean 10% commission instead of 16%, or an auto-decline on a fundable file.';

-- (b) The human confirmation itself. One row per deal × funder, because the
--     label belongs to THAT funder's dropdown.
create table if not exists public.deal_industry_classification (
  deal_id uuid not null references public.deals(id) on delete cascade,
  lender_id uuid not null references public.lenders(id) on delete cascade,
  naics_code text not null,
  naics_title text not null,
  activity text not null,
  funder_category text not null,
  confirmed_by uuid not null references public.profiles(id),
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (deal_id, lender_id),
  -- A blank string must not satisfy the gate. The gate's whole value is that
  -- somebody looked; an empty box is nobody looking.
  constraint deal_industry_classification_naics_code_format
    check (naics_code ~ '^[0-9]{6}$'),
  constraint deal_industry_classification_naics_title_nonempty
    check (btrim(naics_title) <> ''),
  constraint deal_industry_classification_activity_nonempty
    check (btrim(activity) <> ''),
  constraint deal_industry_classification_funder_category_nonempty
    check (btrim(funder_category) <> '')
);

comment on table public.deal_industry_classification is
  'A human''s confirmed industry classification for one deal at one funder — the record that satisfies funder_submission_profiles.requires_industry_match. Per (deal, lender) and not per deal, because funder_category is the label in THAT funder''s own application dropdown.';
comment on column public.deal_industry_classification.deal_id is
  'The deal being classified.';
comment on column public.deal_industry_classification.lender_id is
  'The funder whose application this classification will be typed into. The row does not transfer to another funder.';
comment on column public.deal_industry_classification.naics_code is
  'Six-digit NAICS code, digits only. The shared, checkable anchor — a funder label is theirs, a NAICS code is everyone''s.';
comment on column public.deal_industry_classification.naics_title is
  'The official NAICS title for naics_code, copied as published, so a wrong code is visible as a wrong title instead of hiding behind six digits.';
comment on column public.deal_industry_classification.activity is
  'What the merchant actually does, in OUR words — the basis for the pick. Bitty''s example turns on exactly this: a name containing "Excavation" is site prep, not residential remodeling, and only the activity says which.';
comment on column public.deal_industry_classification.funder_category is
  'The value EXACTLY as it appears in THAT funder''s own dropdown. Deliberately free text, not a foreign key or an enum: Bitty''s APPLICATION dropdown and their October 2026 underwriting guide do not use identical labels. Their own example names "Construction - Commercial" and "Construction - Residential Remodeler", and neither of those appears in the guide list we transcribed into src/components/admin/funder/bittyIndustries.ts. Constraining this column to our transcription would block the real pick.';
comment on column public.deal_industry_classification.confirmed_by is
  'The person who confirmed it. The gate is satisfied by an accountable human, never by a derived or inferred value.';
comment on column public.deal_industry_classification.confirmed_at is
  'When it was confirmed.';
comment on column public.deal_industry_classification.updated_at is
  'Last edit to this row.';

create index if not exists deal_industry_classification_lender_idx
  on public.deal_industry_classification (lender_id);

drop trigger if exists update_deal_industry_classification_updated_at
  on public.deal_industry_classification;
create trigger update_deal_industry_classification_updated_at
  before update on public.deal_industry_classification
  for each row execute function public.update_updated_at();

-- (c) RLS — mirrored policy-for-policy from public.deal_submissions, the
--     existing per-(deal, lender) table. Same helper predicates
--     (is_ops_staff / is_closer + closer_owns_deal / is_processor), same
--     commands, nothing new and nothing widened: whoever may submit the deal
--     to a funder may record the classification that submission needs.
alter table public.deal_industry_classification enable row level security;

drop policy if exists "Admins manage deal_industry_classification" on public.deal_industry_classification;
create policy "Admins manage deal_industry_classification"
  on public.deal_industry_classification for all to authenticated
  using ((select public.is_ops_staff((select auth.uid()))))
  with check ((select public.is_ops_staff((select auth.uid()))));

drop policy if exists closer_select_own_industry_classification on public.deal_industry_classification;
create policy closer_select_own_industry_classification
  on public.deal_industry_classification for select to authenticated
  using (
    (select public.is_closer((select auth.uid())))
    and public.closer_owns_deal((select auth.uid()), deal_id)
  );

drop policy if exists closer_insert_own_industry_classification on public.deal_industry_classification;
create policy closer_insert_own_industry_classification
  on public.deal_industry_classification for insert to authenticated
  with check (
    (select public.is_closer((select auth.uid())))
    and public.closer_owns_deal((select auth.uid()), deal_id)
  );

drop policy if exists closer_update_own_industry_classification on public.deal_industry_classification;
create policy closer_update_own_industry_classification
  on public.deal_industry_classification for update to authenticated
  using (
    (select public.is_closer((select auth.uid())))
    and public.closer_owns_deal((select auth.uid()), deal_id)
  )
  with check (
    (select public.is_closer((select auth.uid())))
    and public.closer_owns_deal((select auth.uid()), deal_id)
  );

drop policy if exists processor_select_all_industry_classification on public.deal_industry_classification;
create policy processor_select_all_industry_classification
  on public.deal_industry_classification for select to authenticated
  using (public.is_processor((select auth.uid())));

drop policy if exists processor_insert_all_industry_classification on public.deal_industry_classification;
create policy processor_insert_all_industry_classification
  on public.deal_industry_classification for insert to authenticated
  with check (public.is_processor((select auth.uid())));

drop policy if exists processor_update_all_industry_classification on public.deal_industry_classification;
create policy processor_update_all_industry_classification
  on public.deal_industry_classification for update to authenticated
  using (public.is_processor((select auth.uid())))
  with check (public.is_processor((select auth.uid())));

-- (d) Turn it on for Bitty Advance — the funder whose own page says the pick
--     is worth six commission points.
update public.funder_submission_profiles
   set requires_industry_match = true
 where lender_id = '46bcc237-2837-4316-8afc-6939542411e6';
