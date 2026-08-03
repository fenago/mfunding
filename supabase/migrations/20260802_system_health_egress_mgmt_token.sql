-- system-health egress probe — vault-read RPC for the Supabase Management API token.
--
-- WHY: on 2026-08-02 the project hit its free-tier egress cap and returned HTTP 402
-- "exceed_egress_quota" — the entire live app (REST + edge functions) was restricted
-- until the owner upgraded to Pro. We only found out AFTER the outage. The new
-- "supabase-egress" probe inside system-health-check warns us BEFORE the cap: it
-- reads real quota usage (database size) from the Management API and detects the 402
-- restriction directly via a self-REST call.
--
-- The probe needs a Supabase Management API personal access token. Edge-function
-- SECRETS cannot use the reserved SUPABASE_ prefix, so the token lives in the
-- Postgres vault (name SUPABASE_MGMT_TOKEN) and is read through this service-role-only
-- SECURITY DEFINER accessor — the exact pattern used by get_instantly_key /
-- get_ph_skiptrace_key / get_ghl_config.
--
-- The token VALUE is NOT committed here. It is set once via vault.create_secret,
-- run out-of-band with the value pulled from .env (SUPABASE_ACCESS_TOKEN), e.g.:
--   select vault.create_secret('<mgmt-pat>', 'SUPABASE_MGMT_TOKEN',
--     'Supabase Management API PAT — system-health egress probe');

create or replace function public.get_supabase_mgmt_token()
returns text
language sql
security definer
set search_path to 'public', 'vault'
as $fn$
  select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_MGMT_TOKEN' limit 1;
$fn$;
revoke all on function public.get_supabase_mgmt_token() from public, anon, authenticated;
grant execute on function public.get_supabase_mgmt_token() to service_role;
