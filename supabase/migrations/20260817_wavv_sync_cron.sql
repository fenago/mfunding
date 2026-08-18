-- wavv-sync-10min — keep the WAVV call mirror fresh for /admin/setter-performance.
--
-- CADENCE. Every 10 minutes, on an offset minute so it does not pile onto the
-- top-of-hour crons. A manager watching the floor mid-shift wants numbers that
-- are minutes old, not hours; the sync is incremental (watermark + 10-minute
-- overlap) so a run on a quiet floor is one small WAVV page and nothing else.
-- WAVV's API is NOT on the GHL 200k/day quota, so this cron spends no GHL
-- budget — it is not a standing consumer against that cap.
--
-- TIMEOUT. pg_net's default is 5 SECONDS, which would silently abandon any run
-- that actually has pages to pull (and would look like a healthy fire-and-forget
-- while the mirror went stale). Set explicitly to 55s, just under the function's
-- own 50s work budget plus overhead.
--
-- The function reports an invalid WAVV key into platform_settings.wavv_sync
-- rather than throwing, so a bad key surfaces as a banner on the page instead of
-- a cron that fails invisibly.

do $mig$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'wavv-sync-10min';
end
$mig$;

select cron.schedule(
  'wavv-sync-10min',
  '*/10 * * * *',
  $cron$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/wavv-sync?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := '{"action":"sync"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);
