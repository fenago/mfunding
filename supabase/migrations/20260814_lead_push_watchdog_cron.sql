-- Watchdog for lead-push-ghl, mirroring lead-file-ingest-sweep-4min.
--
-- A self-reinvoke chain dies silently when the runtime kills a worker (HTTP 546
-- WORKER_LIMIT, OOM, a deploy landing mid-flight): no catch block runs, so the
-- job keeps status='running' with a frozen updated_at and NOTHING schedules the
-- next window. It looks alive. lead-file-ingest already had this watchdog; the
-- push side did not, and on 2026-08-14 the lt-landline retag pass stopped dead
-- at 18,613 of 24,437 with the database, GHL and the drain query all measurably
-- healthy — only a human noticed, 13 minutes later.
--
-- {action:'sweep'} restarts any 'running' job whose updated_at is older than
-- PUSH_STALL_MS (3 min). It is a no-op when everything is healthy, and it only
-- ever touches status='running', so cancelling a job still wins — a canceled job
-- is not running and is never resurrected.
--
-- Off-minutes (1,4,7,...) keep it clear of the top-of-hour cron pile-up.
-- Explicit pg_net timeout because the default is 5s and fails silently.

do $mig$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'lead-push-ghl-sweep-3min';
end
$mig$;

select cron.schedule(
  'lead-push-ghl-sweep-3min',
  '1,4,7,10,13,16,19,22,25,28,31,34,37,40,43,46,49,52,55,58 * * * *',
  $cron$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/lead-push-ghl?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := '{"action":"sweep"}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);
