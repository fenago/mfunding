-- GHL calls self-audit every 5 minutes, viewed or not.
--
-- The panel-poll design logged a call only when someone opened the deal's card —
-- the owner dialed PRB Environmental through VibeReach and the board never heard
-- about it. Tracking that depends on being watched is not tracking. This sweep
-- syncs every open deal's GHL call records on the same cadence as the callback
-- calendar; the record-once ledger (PK = GHL message id) makes it idempotent, so
-- the sweep and the panel poll can never double-log.
select cron.schedule(
  'ghl-call-sweep-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/ghl-call-history?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := '{}'::jsonb
  );
  $$
);
