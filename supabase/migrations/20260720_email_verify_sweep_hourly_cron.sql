-- Hourly sweep: verify campaign-attributed merchant emails against Instantly. Mirrors
-- the check-email-bounces cron (secret in-URL + anon-key Bearer for the gateway). The
-- sweep is self-limiting (small batch cap + time budget + rate-limit backoff), so hourly
-- steadily drains any backlog without ever hammering Instantly. Idempotent re-schedule.
select cron.unschedule('email-verify-sweep-hourly')
where exists (select 1 from cron.job where jobname = 'email-verify-sweep-hourly');

select cron.schedule(
  'email-verify-sweep-hourly',
  '7 * * * *',
  $$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/email-verify-sweep?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := jsonb_build_object('source', 'pg_cron', 'limit', 8),
    timeout_milliseconds := 90000
  );
  $$
);
