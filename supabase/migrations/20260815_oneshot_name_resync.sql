-- ONE-SHOT: repair the GHL contacts that were pushed under the vendor's combined
-- name, after tomorrow's quota reset.
--
-- The vendor CSVs cram the whole name into FIRST NAME ("COREY JENKINS", and
-- inverted behind a comma "MARTIN, DONALD RICHARD III"). 4,413 rows were split
-- locally; 1,666 of them had already been pushed, so their GHL contacts still
-- carry the combined string as a first name. This re-pushes exactly those.
--
-- Ordering: names run FIRST (small, ~1,666 calls, owner priority) and the link
-- tail follows at 18:00 — two passes competing for the same GHL burst window
-- would only slow each other down.
--
-- Selector is the STORED generated column needs_name_resync (pushed_at is null
-- or pushed_at < name_split_at). It is self-draining: a successful re-push moves
-- pushed_at past name_split_at, so the row leaves the set and a resumed pass
-- never redoes work.
--
-- Guarded + self-removing, exactly like the link one-shot; STARTS a new job and
-- never resurrects a cancelled one.
do $mig$
begin
  perform cron.unschedule(jobid) from cron.job
   where jobname in ('oneshot-playbook-link-finish', 'oneshot-name-resync');
end
$mig$;

select cron.schedule(
  'oneshot-name-resync',
  '40 17 * * *',
  $cron$
  do $oneshot$
  begin
    if exists (select 1 from public.lead_records where needs_name_resync and status = 'pushed') then
      perform net.http_post(
        url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/lead-push-ghl?secret='
               || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
        ),
        body := jsonb_build_object(
          'action', 'start', 'rps', 4, 'with_count', false,
          'tags', jsonb_build_array('lm-aged'),
          'filters', jsonb_build_object('status', jsonb_build_array('pushed'), 'resplit_pending', true)
        ),
        timeout_milliseconds := 120000
      );
    end if;
    perform cron.unschedule('oneshot-name-resync');
  end
  $oneshot$;
  $cron$
);

-- The link tail, moved behind the name repair.
select cron.schedule(
  'oneshot-playbook-link-finish',
  '0 18 * * *',
  $cron$
  do $oneshot$
  begin
    if exists (
      select 1 from public.lead_records
       where status = 'pushed' and playbook_link_at is null
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
          'action', 'start', 'rps', 4, 'with_count', false,
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
