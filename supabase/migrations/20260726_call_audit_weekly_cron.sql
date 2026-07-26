-- Weekly Call/Transfer Quality sweep. Runs Monday 11:00 UTC (= 7:00 AM ET / EDT) for
-- the trailing 7 days across ALL campaigns (campaignId null) WITH the location-wide
-- inbound scan (all_inbound), so the owner's "answered then kicked" incidents are
-- caught even on numbers never linked to a deal. Same auth as email-verify-sweep-hourly:
-- secret in-URL + anon-key Bearer for the gateway. The function self-reinvokes to finish
-- long runs, so this single fire kicks off the whole run. Idempotent re-schedule.
select cron.unschedule('call-audit-weekly')
where exists (select 1 from cron.job where jobname = 'call-audit-weekly');

select cron.schedule(
  'call-audit-weekly',
  '0 11 * * 1',
  $$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/call-audit-sweep?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := jsonb_build_object(
      'campaignId', null,
      'dateFrom', (current_date - 7)::text,
      'dateTo', current_date::text,
      'allInbound', true,
      'source', 'cron'
    ),
    timeout_milliseconds := 120000
  );
  $$
);
