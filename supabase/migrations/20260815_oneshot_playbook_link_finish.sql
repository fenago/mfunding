-- ONE-SHOT: start the playbook_link finish pass after tomorrow's GHL quota reset.
--
-- Tonight's budget cannot cover both the owner's 79,942-lead UCC push and the
-- 34,943 aged contacts still missing their Playbook link (91,145 calls remained
-- against 114,885 needed). The backfill stands down so his push completes in
-- full; this fires the remainder once the daily window rolls at ~17:33Z.
--
-- Scheduled server-side ON PURPOSE. The resume logic previously lived in an
-- agent session, which meant "it resumes after his push" was only true while
-- that session was alive. Here it is the database's job, so no session needs to
-- exist tomorrow for the work to happen.
--
-- CANCEL-WINS IS PRESERVED: this STARTS A NEW JOB. It never resurrects a
-- cancelled one — that distinction is what keeps a cancel authoritative.
--
-- Self-removing, and guarded: it fires only if rows are actually still missing
-- the link, then unschedules itself, so it cannot become a daily no-op that
-- mints an empty job row forever.
select cron.schedule(
  'oneshot-playbook-link-finish',
  '40 17 * * *',
  $cron$
  do $oneshot$
  begin
    if exists (
      select 1 from public.lead_records
       where status = 'pushed'
         and playbook_link_at is null
         and pushed_at < timestamptz '2026-08-14 17:45:00+00'
    ) then
      perform net.http_post(
        url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/lead-push-ghl?secret='
               || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
        ),
        body := jsonb_build_object(
          'action', 'start',
          'rps', 4,
          'with_count', false,
          'tags', jsonb_build_array('lm-aged'),
          'filters', jsonb_build_object(
            'status', jsonb_build_array('pushed'),
            'playbook_link_missing', true,
            'pushed_before', '2026-08-14T17:45:00Z'
          )
        ),
        timeout_milliseconds := 120000
      );
    end if;
    perform cron.unschedule('oneshot-playbook-link-finish');
  end
  $oneshot$;
  $cron$
);
