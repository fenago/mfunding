-- wavv-disposition-sync-10min — WAVV call dispositions → opportunity moves.
--
-- WHY A CRON AND NOT A WORKFLOW. WAVV stamps each disposition onto the GHL
-- contact as a `wavv-*` tag; native tag-triggered workflows would be the clean
-- wiring but cannot be created via API and the builder UI resists automation.
-- This sweep applies the same mapping (not-interested → Contacted,
-- bad-number → lost, do-not-contact → DND+lost, future positive dispositions →
-- Qualifying/Contacted) and then REMOVES the processed tag, so each run touches
-- only newly dispositioned contacts — the ledger-approved drain shape, not
-- per-record polling. Standing cost ≈ 1-6 searches/run + ~3 GHL calls per new
-- disposition; the function parks below 60k daily-remaining.
--
-- SAFETY: the function can never move an opportunity INTO New Lead (compile-time
-- guard) — that stage triggers MCA 01 Speed-to-Lead.
--
-- Offset minutes (3,13,...) so it does not stack on wavv-sync (0,10,...).

do $mig$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'wavv-disposition-sync-10min';
end
$mig$;

select cron.schedule(
  'wavv-disposition-sync-10min',
  '3,13,23,33,43,53 * * * *',
  $cron$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/wavv-disposition-sync?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);
