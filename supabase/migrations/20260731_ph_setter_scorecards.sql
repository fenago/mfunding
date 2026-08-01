-- PH (Setter operation) — daily per-setter scorecards.
--
-- The PH setter team dials UCC-sourced merchants, tries to run the application on
-- the call, gets it signed, and gets the merchant to connect their bank (Plaid) or,
-- failing that, books a fallback appointment for a closer. This table is the daily
-- activity ledger for each setter, one row per setter per day.
--
-- MANUAL-ENTRY-FIRST: phase 1 is a human entry form (built by the UI teammate).
-- Dialer sync is phase 2, so every counter is a plain integer a manager/setter types
-- in. A setter is identified by `setter_name` (always present) and optionally linked
-- to a `profiles` row via `user_id` once the setter has a login.
--
-- NAMING LAW: every PH asset is prefixed `ph` (table ph_setter_scorecards, view
-- ph_scorecard_weekly). This touches NOTHING in the MCA/VCF pipelines.

create table if not exists public.ph_setter_scorecards (
  id                   uuid primary key default gen_random_uuid(),
  setter_name          text not null,                                   -- display name (always set)
  user_id              uuid references public.profiles(id) on delete set null, -- linked login once they have one
  date                 date not null,                                   -- the activity day
  dials                integer not null default 0 check (dials >= 0),
  live_conversations   integer not null default 0 check (live_conversations >= 0),
  application_attempts  integer not null default 0 check (application_attempts >= 0),
  signed               integer not null default 0 check (signed >= 0),
  plaid_connected      integer not null default 0 check (plaid_connected >= 0),
  fallback_appointments integer not null default 0 check (fallback_appointments >= 0),
  notes                text,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.ph_setter_scorecards is
  'PH setter operation: one row per setter per day of dialing activity (manual entry, phase 1). Dials → live conversations → application attempts → signed → plaid connected / fallback appointments. Admin/super_admin managed via RLS; service-role bypasses.';

-- One daily row per setter. Keyed by user_id when linked, else by name — so both
-- a logged-in setter and a name-only setter get exactly one row per day.
create unique index if not exists ph_setter_scorecards_user_date_uniq
  on public.ph_setter_scorecards (user_id, date) where user_id is not null;
create unique index if not exists ph_setter_scorecards_name_date_uniq
  on public.ph_setter_scorecards (setter_name, date) where user_id is null;
create index if not exists ph_setter_scorecards_date_idx
  on public.ph_setter_scorecards (date desc);

-- keep updated_at honest
create or replace function public.ph_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists ph_setter_scorecards_touch on public.ph_setter_scorecards;
create trigger ph_setter_scorecards_touch
  before update on public.ph_setter_scorecards
  for each row execute function public.ph_touch_updated_at();

-- ── Weekly rollup ─────────────────────────────────────────────────────────────
-- Aggregates each setter's daily rows into ISO weeks (Mon-anchored). Conversion
-- ratios are computed defensively (null when the denominator is 0).
create or replace view public.ph_scorecard_weekly
with (security_invoker = true) as
select
  coalesce(user_id::text, 'name:' || setter_name)      as setter_key,
  setter_name,
  user_id,
  date_trunc('week', date)::date                        as week_start,
  count(*)                                              as days_reported,
  sum(dials)                                            as dials,
  sum(live_conversations)                               as live_conversations,
  sum(application_attempts)                             as application_attempts,
  sum(signed)                                           as signed,
  sum(plaid_connected)                                  as plaid_connected,
  sum(fallback_appointments)                            as fallback_appointments,
  round(sum(live_conversations)::numeric
        / nullif(sum(dials), 0), 4)                     as contact_rate,      -- live convos / dials
  round(sum(signed)::numeric
        / nullif(sum(application_attempts), 0), 4)      as sign_rate,         -- signed / app attempts
  round(sum(plaid_connected)::numeric
        / nullif(sum(signed), 0), 4)                    as plaid_rate         -- plaid connected / signed
from public.ph_setter_scorecards
group by 1, 2, 3, 4;

comment on view public.ph_scorecard_weekly is
  'Weekly (ISO week, Mon-anchored) aggregation of ph_setter_scorecards per setter, with contact/sign/plaid conversion ratios. security_invoker so the caller''s RLS applies.';

-- ── RLS: admin/super_admin full control; service-role bypasses ────────────────
-- Closers reading their OWN rows is a phase-2 addition (add a SELECT policy on
-- user_id = auth.uid() when setters get logins) — left out on purpose for now.
alter table public.ph_setter_scorecards enable row level security;

drop policy if exists ph_setter_scorecards_admin_all on public.ph_setter_scorecards;
create policy ph_setter_scorecards_admin_all on public.ph_setter_scorecards
  for all to authenticated
  using (is_admin_or_super(auth.uid()))
  with check (is_admin_or_super(auth.uid()));
