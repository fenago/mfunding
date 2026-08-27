-- P0 SECURITY LOCKDOWN (2026-08-27) — closes two breaches the backend audit
-- found live-exploitable with the public anon key that ships in the React bundle.
-- Already applied to prod via ad-hoc SQL the moment they were found; this file is
-- the repo record so a rebuild from supabase/migrations/ can't resurrect either.
--
-- P0-1: public.lead_records_intel was a SECURITY DEFINER view with no
-- security_invoker → ran as owner, bypassed lead_records RLS, and its ACL let
-- anon read all 249,923 purchased leads (name/phone/email/address). It was an
-- orphan (no migration, no edge fn, no src/ reference) created out-of-band and
-- used by nothing. Dropped.
drop view if exists public.lead_records_intel;

-- P0-2: get_ph_apollo_key() / get_ph_skiptrace_key() are SECURITY DEFINER vault
-- readers that never revoked Postgres's default PUBLIC EXECUTE, so anon/any
-- authenticated user could pull the billable Apollo + BatchData keys. Lock them
-- to service_role only, matching every sibling vault reader (e.g.
-- 20260812_textmagic_vault_rpc.sql). The PH skip-trace/apollo edge functions
-- call these with the service role, so they keep working.
-- NOTE: both keys were exposed ~25 days — ROTATE them at the vendor (Apollo,
-- BatchData) and re-stage in the vault; this revoke does not un-expose the value.
revoke execute on function public.get_ph_apollo_key() from public, anon, authenticated;
revoke execute on function public.get_ph_skiptrace_key() from public, anon, authenticated;
