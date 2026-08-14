-- ghl-email-doc-sweep scheduling: cadence cut 3x, plus a nightly exhaustive safety net.
--
-- WHY THE CADENCE CHANGED. Measured 2026-08-14: one run cost 223 GHL API calls
-- and 59 seconds to sweep 117 open deals and find nothing. At */5 that is
-- 64,224 calls/day — a THIRD of the location's 200,000/day cap — spent
-- re-asking about emails already in the ledger. The function now gates on a
-- single location-wide conversations/search (1 call/run), and */15 with a
-- 60-minute lookback gives 4x overlap so a missed cycle self-heals.
-- Off-minutes (8,23,38,53) keep it off the top-of-hour cron pile-up.
--
-- WHY THE NIGHTLY FULL RUN EXISTS. The activity gate only looks back
-- LOOKBACK_MS (60 min). If the sweep is down longer than that — a paused cron,
-- a deploy gap, a rate-limit wall — nothing ever revisits a quiet contact and
-- those emails are lost permanently, silently. ?full=1 sweeps every open deal
-- exhaustively for 223 calls (0.1% of the daily cap), which is a cheap price
-- for closing a permanent-loss hole. Off-peak (06:50 UTC = 02:50 ET).
--
-- The secrets are resolved from the vault INSIDE the command, so nothing
-- sensitive is ever written into cron.job by this migration.

do $mig$
begin
  -- Old names/cadences, whatever state they are in.
  perform cron.unschedule(jobid) from cron.job
   where jobname in ('ghl-email-doc-sweep-5min',
                     'ghl-email-doc-sweep-15min',
                     'ghl-email-doc-sweep-nightly-full');
end
$mig$;

select cron.schedule(
  'ghl-email-doc-sweep-15min',
  '8,23,38,53 * * * *',
  $cron$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/ghl-email-doc-sweep?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

select cron.schedule(
  'ghl-email-doc-sweep-nightly-full',
  '50 6 * * *',
  $cron$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/ghl-email-doc-sweep?full=1&secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
