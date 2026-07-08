-- MCA_APPLICATIONS (2026-07-07)
-- The closer fills the merchant's MCA application IN-APP while they're on the
-- phone (pre-filled from the customer + deal), then sends it to the merchant to
-- e-sign. Previously the "Send the application" step just opened the GHL contact
-- — no structured application data was ever captured in our own system. This
-- table is that missing store: ONE row per deal, holding the 7-section application
-- (business, owner, banking, funding request) as structured columns.
--
-- The formal embedded e-signature is still handled by GHL Documents & Contracts
-- (fired by the application_sent stage move); this table is the source-of-truth
-- for the DATA the closer collected, and records when it was sent to the merchant.

create table if not exists public.mca_applications (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,

  -- ── Business ──
  business_legal_name    text,
  business_dba           text,
  business_type          text,          -- LLC, Corp, Sole Prop…
  ein                    text,
  business_start_date    date,
  business_phone         text,
  business_email         text,
  business_address       text,
  business_city          text,
  business_state         text,
  business_zip           text,
  industry               text,

  -- ── Owner / guarantor ──
  owner_first_name       text,
  owner_last_name        text,
  owner_title            text,
  owner_ownership_pct     numeric,
  owner_ssn              text,          -- sensitive; RLS-gated to owning staff
  owner_dob              date,
  owner_email            text,
  owner_phone            text,
  owner_home_address     text,
  owner_home_city        text,
  owner_home_state       text,
  owner_home_zip         text,
  owner_dl_number        text,          -- driver's license
  owner_dl_state         text,

  -- ── Banking ──
  bank_name              text,
  bank_routing_number    text,
  bank_account_number    text,

  -- ── Funding request ──
  amount_requested       numeric,
  use_of_funds           text,
  monthly_revenue        numeric,
  average_daily_balance  numeric,
  existing_positions     integer,       -- # of open advances (stacking)
  existing_balance       numeric,

  notes                  text,

  -- ── Workflow ──
  status                 text not null default 'draft',   -- draft | sent | signed
  sent_to_merchant_at    timestamptz,
  sent_by                uuid references public.profiles(id),

  created_by             uuid default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- One live application per deal (upsert target).
create unique index if not exists mca_applications_deal_id_key
  on public.mca_applications (deal_id);

alter table public.mca_applications enable row level security;

-- Ops staff (admin / super_admin / employee) — full access.
drop policy if exists ops_all_mca_applications on public.mca_applications;
create policy ops_all_mca_applications on public.mca_applications
  for all to authenticated
  using (is_ops_staff((select auth.uid())))
  with check (is_ops_staff((select auth.uid())));

-- Closers — read + write the application for their OWN deals only (same helper
-- the deal_submissions / activity policies use).
drop policy if exists closer_select_own_mca_applications on public.mca_applications;
create policy closer_select_own_mca_applications on public.mca_applications
  for select to authenticated
  using (is_closer((select auth.uid())) and closer_owns_deal((select auth.uid()), deal_id));

drop policy if exists closer_insert_own_mca_applications on public.mca_applications;
create policy closer_insert_own_mca_applications on public.mca_applications
  for insert to authenticated
  with check (is_closer((select auth.uid())) and closer_owns_deal((select auth.uid()), deal_id));

drop policy if exists closer_update_own_mca_applications on public.mca_applications;
create policy closer_update_own_mca_applications on public.mca_applications
  for update to authenticated
  using (is_closer((select auth.uid())) and closer_owns_deal((select auth.uid()), deal_id))
  with check (is_closer((select auth.uid())) and closer_owns_deal((select auth.uid()), deal_id));

-- Keep updated_at fresh on every write (reuse the shared trigger fn).
drop trigger if exists set_updated_at_mca_applications on public.mca_applications;
create trigger set_updated_at_mca_applications
  before update on public.mca_applications
  for each row execute function public.update_updated_at_column();
