-- Data Hygiene feature — backend schema.
--
-- Greenfield (verified nothing existed 2026-08-30). Adds:
--   1) smart_lists         — a saved audience: a name + the filter (criteria jsonb)
--                            + which store(s) it draws from + a cached member_count.
--   2) smart_list_members  — the materialized membership (polymorphic into
--                            ph_ucc_leads / lead_records / customers) with a
--                            denormalized snapshot for fast render AND the
--                            phone-VALIDATION columns the phone-validate edge fn
--                            writes back (line type / carrier / reachable / …).
--   3) ph_ucc_leads phone-validation write-back columns (optional target; customers
--                            + lead_records already carry equivalents — untouched here).
--   4) get_phone_validation_key() — vault read for the Twilio credential pair,
--                            service_role only. The vault entries don't exist yet, so
--                            it returns null until the owner adds them (that IS the gate).
--
-- RLS mirrors the sibling admin-table pattern (deal_doc_requests): staff read/write via
-- is_ops_staff(); closers included so the Data Hygiene UI works for the whole floor.
-- Edge functions write with the service role, which bypasses RLS.

-- ── 1. smart_lists ──────────────────────────────────────────────────────────────
create table if not exists public.smart_lists (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  description        text,
  source             text check (source in ('ph_ucc','lead_records','customers','mixed')),
  criteria           jsonb,                          -- the saved filter that (re)builds membership
  created_by         uuid,                           -- profiles.id of the staff member who saved it
  member_count       int default 0,                  -- cached count, refreshed on (re)build
  last_refreshed_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.smart_lists is
  'Data Hygiene saved audience: name + criteria (the filter) + source store(s). member_count/last_refreshed_at are cached on (re)build.';

alter table public.smart_lists enable row level security;
drop policy if exists smart_lists_staff_all on public.smart_lists;
create policy smart_lists_staff_all on public.smart_lists
  for all to authenticated
  using (public.is_ops_staff(auth.uid()) or public.is_closer(auth.uid()))
  with check (public.is_ops_staff(auth.uid()) or public.is_closer(auth.uid()));

-- ── 2. smart_list_members ───────────────────────────────────────────────────────
-- source_id is polymorphic (id into ph_ucc_leads / lead_records / customers), so it
-- carries no FK. snapshot denormalizes business/contact/phone/email for fast render.
-- The validation_* columns are written LATER by the phone-validate edge fn.
create table if not exists public.smart_list_members (
  id                  uuid primary key default gen_random_uuid(),
  smart_list_id       uuid not null references public.smart_lists(id) on delete cascade,
  source              text not null,                 -- which store this member came from
  source_id           uuid not null,                 -- polymorphic id into that source table
  snapshot            jsonb,                          -- {business,contact,phone,email,...} for fast render
  -- phone-validation write-back (phone-validate edge fn) ------------------------
  line_type           text,                          -- mobile | landline | voip (provider's type)
  carrier             text,
  phone_reachable     boolean,                        -- Twilio: = valid (see phone-validate header caveat)
  phone_disconnected  boolean,                        -- provider-specific; Twilio leaves this null
  phone_validated_at  timestamptz,
  validation_provider text,                           -- twilio | realphonevalidation | ipqs
  validation_cost     numeric,
  created_at          timestamptz not null default now(),
  unique (smart_list_id, source, source_id)
);
create index if not exists smart_list_members_list_idx on public.smart_list_members (smart_list_id);
comment on table public.smart_list_members is
  'Materialized membership of a smart_list. (source, source_id) is a polymorphic pointer into ph_ucc_leads/lead_records/customers (no FK). validation_* columns are written by the phone-validate edge fn.';

alter table public.smart_list_members enable row level security;
drop policy if exists smart_list_members_staff_all on public.smart_list_members;
create policy smart_list_members_staff_all on public.smart_list_members
  for all to authenticated
  using (public.is_ops_staff(auth.uid()) or public.is_closer(auth.uid()))
  with check (public.is_ops_staff(auth.uid()) or public.is_closer(auth.uid()));

-- ── 3. ph_ucc_leads phone-validation write-back columns (optional target) ────────
-- customers + lead_records already have equivalents — deliberately NOT touched here.
alter table public.ph_ucc_leads
  add column if not exists line_type          text,
  add column if not exists carrier            text,
  add column if not exists phone_reachable    boolean,
  add column if not exists phone_validated_at timestamptz;

-- ── 4. Vault read for the Twilio credential PAIR — service_role only ──────────────
-- Mirrors get_ph_skiptrace_key / get_textmagic_creds. The secrets
-- (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) are NOT in the vault yet, so both members
-- come back null → the phone-validate fn treats null creds as { gated:true }. Adding
-- the two vault entries is the owner-controlled gate that lights the stage.
create or replace function public.get_phone_validation_key()
returns jsonb
language sql
security definer
set search_path to 'public', 'vault'
as $fn$
  select jsonb_build_object(
    'account_sid', (select decrypted_secret from vault.decrypted_secrets where name = 'TWILIO_ACCOUNT_SID' limit 1),
    'auth_token',  (select decrypted_secret from vault.decrypted_secrets where name = 'TWILIO_AUTH_TOKEN'  limit 1)
  );
$fn$;

revoke execute on function public.get_phone_validation_key() from public, anon, authenticated;
grant execute on function public.get_phone_validation_key() to service_role;

comment on function public.get_phone_validation_key() is
  'Vault read for the Twilio credential PAIR (TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN) used by the phone-validate edge fn. service_role only. Returns nulls until the owner adds the vault entries — that null is the gate.';

-- ── 5. Data Hygiene settings flag (owner-controlled enable gate, default off) ─────
-- phone_validate_enabled joins the other ph_settings enrich gates (skiptrace_enabled,
-- apollo_enrich_enabled). Default false so the stage is paused until the owner flips it.
update public.platform_settings
set value = value || jsonb_build_object('phone_validate_enabled', false)
where key = 'ph_settings'
  and not (value ? 'phone_validate_enabled');
