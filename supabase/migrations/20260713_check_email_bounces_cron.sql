-- Schedule the email-deliverability watchdog: every 15 minutes, forever.
--
-- WHY IT MUST BE A SWEEP AND NOT A CHECK-AT-SEND: by the time a closer clicks
-- "send", the damage is already done — they have spent the call and the whole
-- application on a merchant they can never deliver a document to. The bounce is
-- knowable SECONDS after the lead lands (GHL's own welcome email hard-bounces),
-- so we go and look, and the deal wears a red "Email bounced" chip before anyone
-- opens it. (Deal MF-2026-0029: dead vendor-supplied mailbox, discovered only
-- after the application was filled out and 6 orphan e-sign docs were minted.)
--
-- We CANNOT do this with a GHL bounce webhook: we have no authority to change GHL
-- automations/workflows in this account. Polling the email records we already have
-- read access to needs nobody's permission and cannot be switched off by accident.
--
-- AUTH — both halves are required (see CLAUDE.md house rule #1):
--   • ?secret=<GHL_WEBHOOK_SECRET>  → unlocks the trusted-cron path IN the function
--   • Authorization: Bearer <anon>  → satisfies the API gateway (verify_jwt = true)
-- Both are read from the vault at call time, so no secret is written into this
-- migration or the git history.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent re-schedule.
select cron.unschedule('check-email-bounces-15min')
 where exists (select 1 from cron.job where jobname = 'check-email-bounces-15min');

select cron.schedule(
  'check-email-bounces-15min',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/check-email-bounces?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := jsonb_build_object('source', 'pg_cron', 'limit', 25),
    timeout_milliseconds := 55000
  );
  $job$
);
