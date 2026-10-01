-- The nightly safety net for standing funder instructions.
--
-- Standing-instruction detection normally runs inside captureFunderReply(), so
-- the poller, the live webhook, the vendor sweep and the decline-intel backfill
-- all do it on arrival. That hook is deliberately wrapped so a detection
-- failure can never break the reply path — which means a detection failure is
-- POSSIBLE, and nothing else would ever retry it. This is the retry.
--
-- WHY THIS FILE EXISTS SEPARATELY FROM THE FUNCTION. funder-directive-scan's
-- own header says "run nightly". A comment that claims a schedule with no
-- scheduler behind it is the same kind of lie as the 'other' bucket it was
-- written to fix, so the schedule is in source control next to the claim.
--
-- COST: zero GHL calls. It re-reads rows we already hold in funder_replies and
-- re-runs a pure regex over them, so it does not spend against the 200k/day
-- location cap and does not need to justify itself against the
-- ghl-standing-consumers-ledger. 160 replies, ~530ms.
--
-- AUTH: ?secret= (GHL webhook secret, from the vault via get_ghl_config) AND an
-- anon-key Bearer. BOTH are required — verify_jwt is left at its secure default,
-- so the gateway rejects the call before the function sees it if the Bearer is
-- missing, and the function's own gate rejects it if the secret is wrong. A
-- service_role bearer deliberately fails the in-code role check; that is the
-- house rule, verified live (403 on a bad secret, 401 with no header, 401 on a
-- service_role bearer).
--
-- 07:50 UTC sits after vendor-conversation-sweep (06:45) and the GHL doc sweeps
-- (06:50 / 07:35), so anything those paths captured overnight is scanned the
-- same morning.

select cron.unschedule('funder-directive-scan-nightly')
where exists (select 1 from cron.job where jobname = 'funder-directive-scan-nightly');

select cron.schedule(
  'funder-directive-scan-nightly',
  '50 7 * * *',
  $CRON$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/funder-directive-scan?secret='
           || (public.get_ghl_config()->>'webhook_secret'),
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='SUPABASE_ANON_KEY')
    ),
    body := '{}'::jsonb
  );
  $CRON$
);

-- Fired by hand before committing, so the schedule is not the first thing to
-- find out whether the command works:
--   net request 108804 → 200
--   {"ok":true,"scanned":160,"repliesWithADirective":4,"rowsOnFile":7,
--    "repliesWhoseRowsCouldNotBeCounted":0,"openDirectives":7}
