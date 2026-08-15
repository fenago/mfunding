-- ONE-SHOT: retry the owner's UCC push rows that 429'd on the way out.
--
-- His push completed 78,596/79,942 and ran the location's daily budget to zero in
-- its final minutes; all 1,346 failures are "Too Many Requests". They are the
-- retry path's exact clientele — nothing is wrong with the leads, GHL simply
-- stopped answering.
--
-- Runs at 17:35Z, FIVE MINUTES AHEAD of the name resync, so the book is 100%
-- pushed before any enrichment pass touches it: a contact that does not exist
-- yet cannot receive corrected names or a Playbook link.
--
-- Self-draining: a successful push flips status 'error' -> 'pushed', so the row
-- leaves the selection (isCursorMode knows this, or ORDER BY id would full-scan
-- 250k rows to find 1,346).
--
-- Guarded + self-removing; STARTS a new job, never resurrects a cancelled one.
select cron.schedule(
  'oneshot-ucc-error-retry',
  '35 17 * * *',
  $cron$
  do $oneshot$
  begin
    if exists (
      select 1 from public.lead_records
       where status = 'error' and batch_id = '70b97624-cfcc-4baf-a8d0-a800b47aa588'::uuid
    ) then
      perform net.http_post(
        url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/lead-push-ghl?secret='
               || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
        ),
        body := jsonb_build_object(
          'action', 'start', 'rps', 4, 'with_count', false,
          'tags', jsonb_build_array('lm-ucc'),
          'batch_id', '70b97624-cfcc-4baf-a8d0-a800b47aa588',
          'filters', jsonb_build_object('status', jsonb_build_array('error'))
        ),
        timeout_milliseconds := 120000
      );
    end if;
    perform cron.unschedule('oneshot-ucc-error-retry');
  end
  $oneshot$;
  $cron$
);
