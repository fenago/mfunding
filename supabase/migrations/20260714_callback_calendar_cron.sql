-- Followups-calendar P1: the reliability floor for the callback → GHL calendar
-- projection. Every 5 minutes, callback-calendar-sync sweeps deals whose
-- callback_at drifted from what the GHL "Callbacks — Internal" calendar shows
-- (set / changed / cleared) and heals them. Failures are recorded per-deal in
-- deals.callback_sync_error and retried on the next pass — no queues, the DB row
-- IS the retry state. Mirrors the synergy-reconcile cron pattern exactly.
--
-- AUTH — both halves are required (see CLAUDE.md house rule #1):
--   • ?secret=<GHL_WEBHOOK_SECRET>  → unlocks the trusted-cron path IN the function
--   • Authorization: Bearer <anon>  → satisfies the API gateway (verify_jwt = true)
-- Both are read from the vault at call time, so no secret is ever written into
-- this migration or the git history.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent re-schedule.
select cron.unschedule('callback-calendar-sync-5min')
 where exists (select 1 from cron.job where jobname = 'callback-calendar-sync-5min');

select cron.schedule(
  'callback-calendar-sync-5min',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/callback-calendar-sync?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 55000
  );
  $job$
);
