-- Opens don't need 15-min freshness and the webhook push stream is dead (zero events
-- ever arrived), so the poll is the PRIMARY collector — move it to a 30-min cadence
-- to halve GHL API load. Same function, same vault-secret invocation.
do $$
begin
  perform cron.unschedule('ghl-email-open-sweep-15min');
exception when others then null; -- job may not exist in some environments
end $$;

select cron.schedule(
  'ghl-email-open-sweep-30min',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/ghl-email-open-sweep?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := '{"limit":40}'::jsonb
  );
  $$
);
