-- Nightly lead-score sweep: rescore every non-VCF deal once a day.
--
-- WHY A SWEEP WHEN THERE ARE EVENT-DRIVEN HOOKS: the hooks (intake, underwriting,
-- funder responses, email health) are fire-and-forget by design — scoring must
-- never block a lead. Fire-and-forget means an occasional miss is EXPECTED, and
-- the sweep is what makes the miss harmless. It also picks up time-driven drift
-- (stage odds change as deals move) and rescores everything after a
-- score_version bump.
--
-- AUTH — both halves required (CLAUDE.md house rule #1):
--   • ?secret=<GHL_WEBHOOK_SECRET>  → unlocks the trusted-cron path IN the function
--   • Authorization: Bearer <anon>  → satisfies the API gateway (verify_jwt = true)
-- Both read from the vault at call time — no secret in this migration or git.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('score-lead-nightly')
 where exists (select 1 from cron.job where jobname = 'score-lead-nightly');

select cron.schedule(
  'score-lead-nightly',
  '20 7 * * *',   -- 07:20 UTC daily (overnight US)
  $job$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/score-lead?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := jsonb_build_object('all', true, 'trigger', 'sweep'),
    timeout_milliseconds := 55000
  );
  $job$
);
