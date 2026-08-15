-- Hourly, on an off-minute. The steady state is a handful of new deals an hour,
-- so a run costs one indexed query and does nothing; hourly (not daily) means a
-- live-transfer merchant carries the link before the setter finishes the call.
do $mig$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'playbook-link-sweep-hourly';
end
$mig$;

select cron.schedule(
  'playbook-link-sweep-hourly',
  '17 * * * *',
  $cron$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/playbook-link-sweep?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
