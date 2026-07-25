-- Every 10 minutes, run the system-health-check edge function so an outage is caught
-- within ~10 min and alerted on the state transition. Same secret-in-URL + anon-key
-- Bearer gateway pattern as email-verify-sweep-hourly / vendor-conversation-sweep.
-- Offset to :03,:13,… so it doesn't stack on the :00/:05/:10 jobs. Idempotent.
select cron.unschedule('system-health-check-10min')
where exists (select 1 from cron.job where jobname = 'system-health-check-10min');

select cron.schedule(
  'system-health-check-10min',
  '3,13,23,33,43,53 * * * *',
  $$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/system-health-check?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 120000
  );
  $$
);
