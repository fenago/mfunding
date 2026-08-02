-- PH UCC skip-trace stage — schema.
-- Provider: BatchData.io (token in vault as PH_SKIPTRACE_API_KEY). This migration
-- adds the person/number child table, the lead-level trace summary columns, the
-- vault-read RPC, and flips the settings so the pipeline & UI know skip-trace is live.
-- Nothing here dials or loads to GHL; the DNC rule is enforced by the edge fn
-- (dnc numbers are stored, flagged suppressed_dnc, and NEVER written to
-- ph_ucc_leads.phone / exported to a dial CSV).

-- ── 1. Lead-level trace summary (keeps the existing UI + CSV export working) ────
-- phone/email already exist on ph_ucc_leads; phone ONLY ever receives a non-DNC
-- number (see the edge fn). These columns record who/when/cost/hit.
alter table public.ph_ucc_leads
  add column if not exists person_name text,
  add column if not exists traced_at   timestamptz,
  add column if not exists trace_cost  numeric,
  add column if not exists trace_match boolean;

comment on column public.ph_ucc_leads.phone is
  'Best DIALABLE (non-DNC) number from skip-trace, or null. DNC numbers never land here — they live in ph_ucc_contacts.phones flagged suppressed_dnc.';

-- ── 2. ph_ucc_contacts — person-level skip-trace results (one row per person) ───
-- A single filing address can trace to several persons, each with several numbers.
-- phones jsonb: [{number,type,dnc,score,suppressed_dnc}]; emails jsonb: [{email,type}].
create table if not exists public.ph_ucc_contacts (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.ph_ucc_leads(id) on delete cascade,
  person_name  text,
  is_primary   boolean not null default false,   -- the person chosen for the lead summary
  phones       jsonb not null default '[]'::jsonb,
  emails       jsonb not null default '[]'::jsonb,
  trace_match  boolean not null default true,    -- this person came back from the provider
  trace_cost   numeric,                          -- per-lead cost estimate (run spend / traced count)
  provider     text not null default 'batchdata',
  raw          jsonb not null default '{}'::jsonb,
  traced_at    timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists ph_ucc_contacts_lead_idx on public.ph_ucc_contacts (lead_id);
comment on table public.ph_ucc_contacts is
  'Person-level skip-trace results for a ph_ucc_lead. phones[].suppressed_dnc=true numbers are stored for the record but are NEVER dialed/exported. emails feed the cold-email channel when a lead is email_only.';

-- RLS: admin/super_admin read; edge fns write via service role (bypasses RLS).
alter table public.ph_ucc_contacts enable row level security;
drop policy if exists ph_ucc_contacts_admin_read on public.ph_ucc_contacts;
create policy ph_ucc_contacts_admin_read on public.ph_ucc_contacts
  for select to authenticated using (is_admin_or_super(auth.uid()));

-- ── 3. Vault-read RPC for the BatchData token (mirror of get_instantly_key) ─────
create or replace function public.get_ph_skiptrace_key()
returns text
language sql
security definer
set search_path to 'public', 'vault'
as $fn$
  select decrypted_secret from vault.decrypted_secrets where name = 'PH_SKIPTRACE_API_KEY' limit 1;
$fn$;
grant execute on function public.get_ph_skiptrace_key() to service_role;

-- ── 4. Settings: record the provider + flip the UI/matcher skip-trace gate ──────
-- ph_settings gets the provider name (task requirement). The UI gate lives under
-- key 'ph_ucc' — flip skiptrace_provider_configured=true so the "parked at
-- needs_skiptrace" banner clears and the matcher stamps the honest reason.
-- ucc_load_enabled and scrub_provider_configured stay FALSE (TCPA scrub unbuilt;
-- master load switch is owner-controlled).
update public.platform_settings
set value = value || jsonb_build_object('skiptrace_provider', 'batchdata')
where key = 'ph_settings';

update public.platform_settings
set value = value || jsonb_build_object('skiptrace_provider_configured', true)
where key = 'ph_ucc';
