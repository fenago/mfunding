-- PH UCC ingest crons + per-source freshness view.
--
-- CADENCE follows what the portals actually publish:
--   • CO  weekly — data.colorado.gov refreshes daily, but a weekly re-pull of the
--     funder-targeted set is plenty (new positions surface within a week). The
--     function self-reinvokes (co_cursor chain) so this single fire finishes all
--     alias terms.
--   • OR  monthly — the dataset is literally "filings entered LAST MONTH", so it
--     only makes sense to sweep it once a month.
--
-- AUTH is the standard cron path: ?secret=<GHL webhook secret> in the URL +
-- anon-key Bearer for the gateway, both read from the vault so nothing is
-- hardcoded. Same shape as call-audit-weekly / email-verify-sweep-hourly.
-- Idempotent: unschedule-if-exists then schedule.

-- ── CO — weekly, Sunday 08:00 UTC ──────────────────────────────────────────────
select cron.unschedule('ph-ucc-ingest-co-weekly')
where exists (select 1 from cron.job where jobname = 'ph-ucc-ingest-co-weekly');
select cron.schedule(
  'ph-ucc-ingest-co-weekly',
  '0 8 * * 0',
  $$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/ph-ucc-ingest?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := jsonb_build_object('state', 'CO', 'co_cursor', 0),
    timeout_milliseconds := 120000
  );
  $$
);

-- ── OR — monthly, 1st at 09:00 UTC ─────────────────────────────────────────────
select cron.unschedule('ph-ucc-ingest-or-monthly')
where exists (select 1 from cron.job where jobname = 'ph-ucc-ingest-or-monthly');
select cron.schedule(
  'ph-ucc-ingest-or-monthly',
  '0 9 1 * *',
  $$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/ph-ucc-ingest?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := jsonb_build_object('state', 'OR'),
    timeout_milliseconds := 120000
  );
  $$
);

-- ── Per-source freshness / health view (admin-readable via base-table RLS) ──────
create or replace view public.ph_ucc_source_health
with (security_invoker = true) as
select
  s.state, s.name, s.kind, s.cadence, s.status,
  s.last_pull_at,
  case when s.last_pull_at is null then null
       else (now() - s.last_pull_at) end                          as time_since_pull,
  s.last_rows,
  (select count(*) from public.ph_ucc_filings f where f.state = s.state) as filings_total,
  (select count(*) from public.ph_ucc_leads l where l.state = s.state)   as leads_total,
  (select max(f.filed_date) from public.ph_ucc_filings f where f.state = s.state) as latest_filed_date,
  s.notes
from public.ph_ucc_sources s
order by s.state;

comment on view public.ph_ucc_source_health is
  'Per-source freshness: last pull, age, rows, filing/lead counts, newest filing date. security_invoker so admin RLS on the base tables applies.';
