-- P0 (2026-08-27) — lock anon/authenticated out of dangerous SECURITY DEFINER
-- writer RPCs the security audit found publicly callable via the anon key.
-- Same PUBLIC-EXECUTE-default class as 20260827_p0_security_lockdown.sql.
-- Worst was notify_merchant() — anon could inject a message into ANY merchant's
-- portal inbox attributed to their closer/super_admin (turn-key phishing into a
-- Plaid-linked portal). Applied to prod immediately + verified anon now 401/404s.
--
-- Scope is surgical on purpose: a blanket "revoke on all functions" would strip
-- EXECUTE that RLS-predicate helpers (is_closer/has_closer_row/closer_owns_deal/
-- is_admin_or_super) and the 19 client-called RPCs need — breaking the app. These
-- 13 are internal (edge/trigger-invoked via service_role), none client-called,
-- none RLS helpers. service_role keeps EXECUTE, so edge functions still work.
-- FOLLOW-UP (not done here — needs testing): `alter default privileges in schema
-- public revoke execute on functions from public` + re-grant the client set, to
-- stop the next migration re-introducing this; and add is_super_admin() guards
-- inside notify_merchant / ghl_apply_call_telemetry / the ph_ucc_* writers.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname in (
      'notify_merchant','ghl_apply_call_telemetry','ph_ucc_rebuild_masked_leads',
      'ph_ucc_upsert_unmatched','ph_ucc_enrich_matches','ph_ucc_finalize_file_job',
      'record_lead_email_open','sync_email_open_status','lead_batch_mark_dups',
      'next_lead_batch_code','stamp_lead_assignment','next_lead_closer','seed_closer_documents')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
  -- ph_ucc_rebuild_leads IS client-called (admin UI) — kill anon, keep authenticated.
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='ph_ucc_rebuild_leads'
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
