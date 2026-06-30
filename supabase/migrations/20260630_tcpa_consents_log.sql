-- Durable TCPA express-written-consent log (audit #11/#12/#13). Every lead/opt-in
-- form writes a row here with the EXACT consent text shown, the timestamp, and the
-- source page — the proof needed if a TCPA complaint ever arises.
-- Applied live via MCP 2026-06-30.
create table if not exists public.tcpa_consents (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text,
  phone text,
  consent boolean not null default true,
  consent_text text not null,
  source text,          -- e.g. apply / vcf-relief / optin
  page text,            -- the path the consent was given on
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists idx_tcpa_consents_email on public.tcpa_consents(lower(email));
create index if not exists idx_tcpa_consents_phone on public.tcpa_consents(phone);

alter table public.tcpa_consents enable row level security;

-- Public forms (anon) may RECORD consent; nobody anonymous can read it back.
drop policy if exists tcpa_consents_insert_any on public.tcpa_consents;
create policy tcpa_consents_insert_any on public.tcpa_consents for insert to anon, authenticated
  with check (consent = true and consent_text is not null);

-- Only admins/super_admins can read the consent log.
drop policy if exists tcpa_consents_admin_read on public.tcpa_consents;
create policy tcpa_consents_admin_read on public.tcpa_consents for select to authenticated
  using (is_admin_or_super((select auth.uid())));
