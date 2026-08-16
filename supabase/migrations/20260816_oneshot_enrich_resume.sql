-- ONE-SHOT: resume the enrichment PUT after tomorrow's quota reset.
--
-- Measured: ~2.16 GHL calls per contact (a single contact PUT costs ~1.6-1.7
-- against the daily counter — an update is worth more than one unit), and
-- ~109,900 contacts genuinely need one after 28,723 no-op rows are skipped. That
-- is ~237,000 calls against 140,000 usable per day, so the job legitimately
-- spans two windows and pauses itself at the 60k floor in between.
--
-- Server-side so the second window does not depend on a human being awake — the
-- same reason the name-resync and link-tail one-shots were scheduled rather than
-- queued. Guarded (fires only if work remains), self-removing, and it STARTS a
-- new job: cancel-wins semantics mean a canceled job is never resurrected.
do $mig$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'oneshot-enrich-resume';
end
$mig$;

select cron.schedule(
  'oneshot-enrich-resume',
  '40 17 * * *',
  $cron$
  do $oneshot$
  begin
    if exists (
      select 1 from public.lead_records
       where enriched_at is null and status = 'pushed' and ghl_contact_id is not null
    ) then
      perform net.http_post(
        url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/lead-enrich-ghl?secret='
               || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
        ),
        body := jsonb_build_object('action', 'start', 'rps', 4),
        timeout_milliseconds := 120000
      );
    end if;
    perform cron.unschedule('oneshot-enrich-resume');
  end
  $oneshot$;
  $cron$
);
