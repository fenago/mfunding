-- ── funder validation pass — the setter rings all 76 funders ────────────────
--
-- Everything we hold on a funder was true on the day somebody wrote it down.
-- Phone numbers rot, reps leave, submission inboxes get retired. This is the
-- schema for the pass that goes and CHECKS, funder by funder, on the phone.
--
-- Four tables:
--   funder_validation_items         the checklist TEMPLATE (data, not code)
--   funder_validations              one row per PASS per funder
--   funder_validation_checks        the answers for that pass
--   funder_contact_verifications    per-ENDPOINT result (feeds the Call buttons)
--
-- ⚠️ HARD RULE — a setter's captured submission address NEVER writes to
-- `lenders.submission_email`, `lenders.primary_contact_*`, or any other column
-- on `lenders`. What the setter records here is a CLAIM, promoted — if ever —
-- by a human looking at it. This project already forbids auto-applying a
-- submission address from an inbound reply, for the reason that matters more
-- than tidiness: that address receives merchants' full bank statements, so a
-- redirected one is a data breach, not a stale field. A phone call is a
-- WEAKER source than a reply from the funder's own domain, not a stronger one.
-- Setters hold role='closer', and `lenders` grants that role SELECT only
-- (closer_read_lenders) — this migration does not widen it and must not.

-- ── 1. the checklist template ───────────────────────────────────────────────
--
-- Data-driven so the checklist can change without a deploy: add a row, the
-- next call asks the question. `key` is the stable slug the answers join on,
-- so renaming a LABEL never orphans the answers already collected under it.
create table if not exists public.funder_validation_items (
  key         text primary key,
  section     text not null,
  label       text not null,
  help        text,
  -- 'none' = a pure tick with no captured value.
  answer_type text not null check (answer_type in
    ('none','text','longtext','phone','email','url','money','number','bool','date','choice')),
  choices     text[],
  -- null = ask it of every funder. Otherwise only when we run that product.
  product     text check (product in ('mca','term_loan','line_of_credit','sba','equipment')),
  is_required boolean not null default false,
  sort        integer not null default 0,
  is_active   boolean not null default true
);

create index if not exists funder_validation_items_sort_idx
  on public.funder_validation_items (sort);

alter table public.funder_validation_items enable row level security;

drop policy if exists staff_read_funder_validation_items on public.funder_validation_items;
create policy staff_read_funder_validation_items
  on public.funder_validation_items for select
  using (
    (select public.is_admin_or_super((select auth.uid())))
    or (select public.is_employee((select auth.uid())))
    or (select public.is_processor((select auth.uid())))
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'closer')
  );

drop policy if exists super_admin_all_funder_validation_items on public.funder_validation_items;
create policy super_admin_all_funder_validation_items
  on public.funder_validation_items for all
  using ((select public.is_super_admin((select auth.uid()))))
  with check ((select public.is_super_admin((select auth.uid()))));

comment on table public.funder_validation_items is
  'Checklist TEMPLATE for a funder validation call. Data-driven so the checklist changes without a deploy. key is stable and answers join on it; relabel freely, never re-key.';

-- ── 2. one row per validation PASS ──────────────────────────────────────────
--
-- Re-validating a funder INSERTS a new row. It never overwrites the last one.
-- The history is the point: "this number was good in March and dead in
-- October" is the fact that tells you the book is rotting, and an upsert
-- destroys it. `validated_on` is user-editable because the call often gets
-- logged the morning after.
create table if not exists public.funder_validations (
  id                 uuid primary key default gen_random_uuid(),
  lender_id          uuid not null references public.lenders(id) on delete cascade,
  validated_on       date not null default current_date,
  -- the "Validated" checkbox: a pass can be saved half-finished and resumed.
  is_complete        boolean not null default false,
  validated_by       uuid not null default auth.uid() references auth.users(id),
  -- denormalised on purpose: records who it was AT THE TIME, survives a
  -- rename, and renders without a join the reader may not be able to make.
  validated_by_label text,
  outcome            text check (outcome in
    ('reached','voicemail','no_answer','bad_number','refused','other')),
  summary            text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists funder_validations_lender_idx
  on public.funder_validations (lender_id, validated_on desc);

alter table public.funder_validations enable row level security;

-- ── 3. the answers ──────────────────────────────────────────────────────────
create table if not exists public.funder_validation_checks (
  id            uuid primary key default gen_random_uuid(),
  validation_id uuid not null references public.funder_validations(id) on delete cascade,
  item_key      text not null references public.funder_validation_items(key),
  checked       boolean not null default false,
  value         text,
  note          text,
  updated_at    timestamptz not null default now(),
  unique (validation_id, item_key)
);

alter table public.funder_validation_checks enable row level security;

-- ── 4. per-endpoint verification ────────────────────────────────────────────
--
-- The high-value table: it is what turns a Call button green or amber. A
-- funder record holds several numbers and addresses; this says which of them a
-- human actually got through on, and who picked up.
create table if not exists public.funder_contact_verifications (
  id             uuid primary key default gen_random_uuid(),
  lender_id      uuid not null references public.lenders(id) on delete cascade,
  -- null when verified outside a formal pass (someone just dialled it).
  validation_id  uuid references public.funder_validations(id) on delete set null,
  endpoint_kind  text not null check (endpoint_kind in ('phone','email')),
  -- Phones are stored DIGITS ONLY. The UI matches a verification to a button
  -- by digits; '(212) 555-0100' and '2125550100' are the same line but not the
  -- same string, and a row that never matches is a verification that silently
  -- does nothing. The check constraint makes that failure loud at write time
  -- instead of invisible at read time.
  endpoint_value text not null check (
    endpoint_kind <> 'phone' or endpoint_value ~ '^[0-9]+$'
  ),
  endpoint_label text,
  result         text not null check (result in
    ('works','dead','wrong_party','no_answer','bounced','unknown')),
  -- who actually answered — often not who the record says owns the line.
  reaches        text,
  note           text,
  verified_by    uuid default auth.uid() references auth.users(id),
  verified_at    timestamptz not null default now()
);

create index if not exists funder_contact_verifications_endpoint_idx
  on public.funder_contact_verifications (lender_id, endpoint_kind, endpoint_value);

alter table public.funder_contact_verifications enable row level security;

-- ── RLS for 2, 3 and 4 ──────────────────────────────────────────────────────
--
-- Read: every staff role that can see the Funder Contact tab.
-- Write: the same audience, but authorship is enforced in WITH CHECK rather
-- than trusted from the client — nobody files a validation under someone
-- else's name. Authors edit and delete their own; super_admin anything.

drop policy if exists staff_read_funder_validations on public.funder_validations;
create policy staff_read_funder_validations
  on public.funder_validations for select
  using (
    (select public.is_admin_or_super((select auth.uid())))
    or (select public.is_employee((select auth.uid())))
    or (select public.is_processor((select auth.uid())))
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'closer')
  );

drop policy if exists staff_add_funder_validations on public.funder_validations;
create policy staff_add_funder_validations
  on public.funder_validations for insert
  with check (
    validated_by = auth.uid()
    and (
      (select public.is_admin_or_super((select auth.uid())))
      or (select public.is_employee((select auth.uid())))
      or (select public.is_processor((select auth.uid())))
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'closer')
    )
  );

drop policy if exists author_edit_funder_validations on public.funder_validations;
create policy author_edit_funder_validations
  on public.funder_validations for update
  using (validated_by = auth.uid())
  with check (validated_by = auth.uid());

drop policy if exists author_delete_funder_validations on public.funder_validations;
create policy author_delete_funder_validations
  on public.funder_validations for delete
  using (validated_by = auth.uid());

drop policy if exists super_admin_all_funder_validations on public.funder_validations;
create policy super_admin_all_funder_validations
  on public.funder_validations for all
  using ((select public.is_super_admin((select auth.uid()))))
  with check ((select public.is_super_admin((select auth.uid()))));

-- Checks carry no author column of their own; the parent validation owns them.
-- Writing a check therefore requires owning the pass it belongs to, which is
-- the same guarantee one step up the FK.
drop policy if exists staff_read_funder_validation_checks on public.funder_validation_checks;
create policy staff_read_funder_validation_checks
  on public.funder_validation_checks for select
  using (
    (select public.is_admin_or_super((select auth.uid())))
    or (select public.is_employee((select auth.uid())))
    or (select public.is_processor((select auth.uid())))
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'closer')
  );

drop policy if exists author_add_funder_validation_checks on public.funder_validation_checks;
create policy author_add_funder_validation_checks
  on public.funder_validation_checks for insert
  with check (exists (
    select 1 from public.funder_validations v
    where v.id = validation_id and v.validated_by = auth.uid()
  ));

drop policy if exists author_edit_funder_validation_checks on public.funder_validation_checks;
create policy author_edit_funder_validation_checks
  on public.funder_validation_checks for update
  using (exists (
    select 1 from public.funder_validations v
    where v.id = validation_id and v.validated_by = auth.uid()
  ))
  with check (exists (
    select 1 from public.funder_validations v
    where v.id = validation_id and v.validated_by = auth.uid()
  ));

drop policy if exists author_delete_funder_validation_checks on public.funder_validation_checks;
create policy author_delete_funder_validation_checks
  on public.funder_validation_checks for delete
  using (exists (
    select 1 from public.funder_validations v
    where v.id = validation_id and v.validated_by = auth.uid()
  ));

drop policy if exists super_admin_all_funder_validation_checks on public.funder_validation_checks;
create policy super_admin_all_funder_validation_checks
  on public.funder_validation_checks for all
  using ((select public.is_super_admin((select auth.uid()))))
  with check ((select public.is_super_admin((select auth.uid()))));

drop policy if exists staff_read_funder_contact_verifications on public.funder_contact_verifications;
create policy staff_read_funder_contact_verifications
  on public.funder_contact_verifications for select
  using (
    (select public.is_admin_or_super((select auth.uid())))
    or (select public.is_employee((select auth.uid())))
    or (select public.is_processor((select auth.uid())))
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'closer')
  );

drop policy if exists staff_add_funder_contact_verifications on public.funder_contact_verifications;
create policy staff_add_funder_contact_verifications
  on public.funder_contact_verifications for insert
  with check (
    verified_by = auth.uid()
    and (
      (select public.is_admin_or_super((select auth.uid())))
      or (select public.is_employee((select auth.uid())))
      or (select public.is_processor((select auth.uid())))
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'closer')
    )
  );

drop policy if exists author_edit_funder_contact_verifications on public.funder_contact_verifications;
create policy author_edit_funder_contact_verifications
  on public.funder_contact_verifications for update
  using (verified_by = auth.uid())
  with check (verified_by = auth.uid());

drop policy if exists author_delete_funder_contact_verifications on public.funder_contact_verifications;
create policy author_delete_funder_contact_verifications
  on public.funder_contact_verifications for delete
  using (verified_by = auth.uid());

drop policy if exists super_admin_all_funder_contact_verifications on public.funder_contact_verifications;
create policy super_admin_all_funder_contact_verifications
  on public.funder_contact_verifications for all
  using ((select public.is_super_admin((select auth.uid()))))
  with check ((select public.is_super_admin((select auth.uid()))));

-- ── updated_at kept by the server ───────────────────────────────────────────
-- A client-supplied updated_at is a claim about when something changed; this
-- one is a fact.
create or replace function public.touch_funder_validation_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_funder_validations_updated_at on public.funder_validations;
create trigger touch_funder_validations_updated_at
  before update on public.funder_validations
  for each row execute function public.touch_funder_validation_updated_at();

drop trigger if exists touch_funder_validation_checks_updated_at on public.funder_validation_checks;
create trigger touch_funder_validation_checks_updated_at
  before update on public.funder_validation_checks
  for each row execute function public.touch_funder_validation_updated_at();

comment on table public.funder_validations is
  'One row per validation PASS per funder. Re-validation INSERTS a new row and never overwrites: phone numbers rot, and the history of when a line went dead is the point. Nothing here writes to lenders.* — a captured submission address is a claim a human promotes, never a backfill.';

comment on table public.funder_validation_checks is
  'Answers for one validation pass, keyed to funder_validation_items.key. Authorship comes from the parent validation.';

comment on table public.funder_contact_verifications is
  'Per-endpoint result of actually dialling or emailing a funder contact — feeds the green/amber Call buttons. Phones stored DIGITS ONLY (enforced); a formatted string would never match the button it was meant to colour.';
