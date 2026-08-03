-- PH UCC — add Connecticut as a FREE, AUTOMATED (api_cron) UCC source.
--
-- CT is the cleanest integration type: data.ct.gov Socrata dataset xfev-8smz
-- ("UCC Lien Filings (4.0 Revised)"), one row per filing×party already carrying
-- BOTH debtor and secured-party name+address. Nightly-refreshed, active liens.
-- ph-ucc-ingest ingests ORIG FIN STMT / Active / non-lapsed inside the 540d
-- window (dt_accept = true origination date) → ph_ucc_filings (state='CT') →
-- the state-agnostic matcher (ph_ucc_rebuild_leads) with the shared funder-alias
-- match + bank blocklist. skiptrace stays OFF; ingest only.
--
-- Renders in ph-ucc-machine exactly like CO/OR (fetch_mode='api_cron' → "auto —
-- weekly" pull card). Cron uses the standard secret + anon-bearer path from the
-- vault (same shape as ph-ucc-ingest-co-weekly). Idempotent.

-- ── Source row (insert once, then reconcile fields) ─────────────────────────────
insert into public.ph_ucc_sources (state, name, kind, fetch_mode, endpoint, cadence, status)
select 'CT',
       'Connecticut SOS — data.ct.gov (Socrata)',
       'api', 'api_cron',
       'https://data.ct.gov/resource/xfev-8smz.json',
       'weekly', 'active'
where not exists (select 1 from public.ph_ucc_sources where state = 'CT');

update public.ph_ucc_sources set
  name       = 'Connecticut SOS — data.ct.gov (Socrata)',
  kind       = 'api',
  fetch_mode = 'api_cron',
  endpoint   = 'https://data.ct.gov/resource/xfev-8smz.json',
  cadence    = 'weekly',
  status     = 'active',
  updated_at = now()
where state = 'CT';

-- ── CT — weekly, Sunday 10:00 UTC (offset from CO 08:00 / OR to spread load) ────
-- The function self-reinvokes (ct_cursor chain) so this single fire pages the
-- whole in-window slice across as many child invocations as it takes.
select cron.unschedule('ph-ucc-ingest-ct-weekly')
where exists (select 1 from cron.job where jobname = 'ph-ucc-ingest-ct-weekly');
select cron.schedule(
  'ph-ucc-ingest-ct-weekly',
  '0 10 * * 0',
  $$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/ph-ucc-ingest?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := jsonb_build_object('state', 'CT', 'ct_cursor', 0),
    timeout_milliseconds := 120000
  );
  $$
);
