-- Schedule the Synergy reconciliation sweep: every 15 minutes, forever.
--
-- The sweep (synergy-reconcile) compares "vendor lead emails received in GHL"
-- against synergy_intake_log, auto-recovers anything that never became a deal, and
-- digests what still needs a human. It must run WITHOUT a human, which is the whole
-- point: the July 13 miss was caught only because the owner happened to look.
--
-- Why pg_cron (and not another GitHub Action like funder-reply-poll): this watchdog
-- must not depend on the same CI that could itself be broken/disabled, and 15-minute
-- resolution inside the database is free. pg_net makes the HTTP call asynchronously.
--
-- AUTH — both halves are required (see CLAUDE.md house rule #1):
--   • ?secret=<GHL_WEBHOOK_SECRET>  → unlocks the trusted-cron path IN the function
--   • Authorization: Bearer <anon>  → satisfies the API gateway (verify_jwt = true)
-- Both are read from the vault at call time, so no secret is ever written into this
-- migration or the git history. Requires vault secrets GHL_WEBHOOK_SECRET and
-- SUPABASE_ANON_KEY (the anon key is public by design — it is in the frontend bundle).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent re-schedule.
select cron.unschedule('synergy-reconcile-15min')
 where exists (select 1 from cron.job where jobname = 'synergy-reconcile-15min');

select cron.schedule(
  'synergy-reconcile-15min',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/synergy-reconcile?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := jsonb_build_object('source', 'pg_cron', 'hours', 48),
    timeout_milliseconds := 55000
  );
  $job$
);
