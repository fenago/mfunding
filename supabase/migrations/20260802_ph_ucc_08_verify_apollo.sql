-- PH UCC skip-trace stage — email VERIFICATION + optional Apollo enrichment.
--
-- Additive follow-on to ph_ucc_07 (BatchData skip-trace core). This migration is
-- OWNED separately from the ph-ucc-skiptrace edge fn: it only ADDS lead columns and
-- ph_settings flags. It does NOT dial, does NOT load to GHL, and does NOT change the
-- DNC rule (dnc numbers are still stored+flagged by the trace fn and never dialed).
--
-- WHY email verification: BatchData returns CONSUMER/person emails. Syntactically
-- valid ≠ deliverable (see deal MF-2026-0029, a dead yahoo mailbox that hard-bounced
-- through the whole app). We run every traced email through Instantly BEFORE the
-- cold-email channel can use it, exactly like the merchant intake path. Only a
-- 'verified' address becomes a lead's usable best email.
--
-- WHY Apollo is OFF by default: Apollo is a SECONDARY, business-email enrichment with
-- a low hit rate on these UCC merchants (it missed the Aurora merchant BatchData
-- found). Build it, flag it, leave it off — the owner opts in per run.

-- ── 1. Lead-level verification + Apollo columns (nullable, additive) ───────────
alter table public.ph_ucc_leads
  -- Instantly verdict on the lead's best email. One of the _shared/instantly.ts
  -- EmailHealth values: verified | catch_all | risky | invalid | bounced | unknown.
  add column if not exists email_verify_status text,
  add column if not exists email_verified_at   timestamptz,
  -- Apollo SECONDARY enrichment (optional pass; null unless apollo_enrich_enabled run).
  add column if not exists apollo_business_email text,
  add column if not exists apollo_owner_title    text,
  add column if not exists apollo_checked_at     timestamptz;

comment on column public.ph_ucc_leads.email_verify_status is
  'Instantly verification verdict on the best email (verified/catch_all/risky/invalid/bounced/unknown). Only a verified address is promoted to email and considered sendable.';
comment on column public.ph_ucc_leads.apollo_business_email is
  'Optional Apollo-sourced BUSINESS email (secondary enrichment). Null unless the off-by-default apollo pass ran. Distinct from the BatchData consumer email in ph_ucc_leads.email.';

-- ── 1b. Vault-read RPC for the Apollo token (mirror of get_ph_skiptrace_key) ───
-- Used only by the OPTIONAL, off-by-default ph-ucc-apollo-enrich pass.
create or replace function public.get_ph_apollo_key()
returns text
language sql
security definer
set search_path to 'public', 'vault'
as $fn$
  select decrypted_secret from vault.decrypted_secrets where name = 'PH_APOLLO_API_KEY' limit 1;
$fn$;
grant execute on function public.get_ph_apollo_key() to service_role;

-- ── 2. ph_settings flags for the skip-trace / verify / apollo stages ───────────
-- Merge: defaults on the LEFT so any value a human already set on the RIGHT wins.
-- Does not touch skiptrace_provider (set to 'batchdata' by ph_ucc_07).
update public.platform_settings
set value = jsonb_build_object(
      'skiptrace_enabled',       true,   -- key exists + live-tested → tracing is on
      'instantly_verify_emails', true,   -- owner wants traced emails verified (toggleable)
      'apollo_enrich_enabled',   false,  -- SECONDARY, low hit rate → off until opted in
      'max_skiptrace_batch',     300,    -- hard cap on leads traced per run (budget guard)
      'skiptrace_dnc_policy',
        'BatchData returns a per-number dnc flag. DNC numbers are stored on '
        || 'ph_ucc_contacts.phones (suppressed_dnc=true) for the record but are NEVER '
        || 'written to ph_ucc_leads.phone and NEVER exported to a dial CSV. A lead whose '
        || 'only numbers are all DNC routes to email_only. TCPA cell-scrub still gates '
        || 'dialing before any number is called.'
    ) || value
where key = 'ph_settings';
