-- ph_ucc_23: weekly cron for the agent-masked harvest (CT/CO/OR).
-- =============================================================================
-- ph-ucc-ingest-masked pulls the fresh agent-masked slice for CT (denormalized),
-- CO (3-table join, concurrent hydration ~100s), and OR (last-month, accumulates),
-- scores + de-noises, stores ONLY survivor filings, and rebuilds the agent_masked
-- lead class. Runs sequentially in one fire (~2min); Pro edge wall-clock covers it.
-- Sunday 11:00 UTC — AFTER the named CO/CT weekly ingests (08:00/10:00) and the
-- missing-funder radar scan (10:00), so the funder dictionary + named leads (which
-- the masked rebuild reads to skip already-captured merchants) are current.
-- Standard secret + anon-bearer path from the vault (same shape as the named crons).
-- CA/FL agent-masked survivors are emitted by their file loaders, not this cron.
-- =============================================================================
select cron.unschedule('ph-ucc-ingest-masked-weekly')
where exists (select 1 from cron.job where jobname = 'ph-ucc-ingest-masked-weekly');
select cron.schedule(
  'ph-ucc-ingest-masked-weekly',
  '0 11 * * 0',
  $cron$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/ph-ucc-ingest-masked?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := jsonb_build_object('state', 'ALL'),
    timeout_milliseconds := 170000
  );
  $cron$
);
