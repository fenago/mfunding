-- LEAD MACHINE — the delete-safety flag, and the watchdog cron.
--
-- Both close hazards found during the first real load.

-- ── 1. matched_existing — never delete a contact we did not create ────────────
-- GHL's /contacts/upsert dedupes on phone OR email, so pushing a purchased lead
-- can silently ATTACH to a real merchant's existing contact rather than create a
-- new one. A cleanup routine that deletes by ghl_contact_id would then destroy
-- genuine business data — a test tidying up after itself by deleting a customer.
--
-- The upsert response distinguishes the two cases. Verified against the live API:
-- upserting the same contact twice returns {"new":true,...} then {"new":false,...}
-- with the SAME contact id.
--
-- FAIL-SAFE BY DESIGN: nullable, and cleanup must delete ONLY where
-- matched_existing IS FALSE. TRUE (we attached to theirs) and NULL (we don't know)
-- both block deletion, so an unknown can never become a deletion.
alter table public.lead_records add column if not exists matched_existing boolean;
comment on column public.lead_records.matched_existing is
  'How the GHL upsert resolved: FALSE = GHL returned new:true, this push CREATED the contact (safe for cleanup to delete). TRUE = new:false, the push ATTACHED to a contact that already existed (deleting it would destroy real business data). NULL = unknown (never pushed, or GHL omitted the flag). Deliberately nullable and fail-safe: cleanup must delete ONLY where matched_existing IS FALSE, so both TRUE and NULL block deletion.';

-- ── 2. The sweep watchdog cron ────────────────────────────────────────────────
-- lead-file-ingest advances by self-reinvoke. That chain has one fatal weakness:
-- if the runtime KILLS a worker (HTTP 546 WORKER_LIMIT, OOM, a deploy landing
-- mid-flight) no catch block runs, so nothing marks the batch failed and nothing
-- schedules the next window — the batch sits in 'ingesting' forever, looking alive
-- while being dead. This happened for real on the trigger file.
--
-- The sweep restarts any batch with no progress for 150s, from its last
-- checkpoint. It is a no-op when everything is healthy ({"restarted":0}).
--
-- Off-minute schedule (2,6,10,...) so it does not pile onto the :00/:05 crowd that
-- every other job in this project already lands on.
select cron.schedule(
  'lead-file-ingest-sweep-4min',
  '2,6,10,14,18,22,26,30,34,38,42,46,50,54,58 * * * *',
  $cmd$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/lead-file-ingest?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := jsonb_build_object('action', 'sweep', 'source', 'pg_cron'),
    timeout_milliseconds := 55000
  );
  $cmd$
);
