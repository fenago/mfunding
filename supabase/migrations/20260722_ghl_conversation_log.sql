-- Relationship conversation sync — record-once ledger + 15-minute sweep cron.
--
-- The lender detail page (/admin/lenders/:id) and vendor detail page each carry an
-- Activity Log tab. The owner wants it to be ONE PANE OF GLASS: every GHL/VibeReach
-- conversation message with that lender/vendor's contacts (emails in/out, SMS,
-- calls) continuously merged into the same activity_log the doc-uploads and notes
-- already live in, so the whole relationship reads in one place.
--
-- The GHL contact ids are ALREADY stored app-side — lenders.ghl_contact_id plus
-- each lenders.contacts[].ghl_contact_id (multi-person funders), and
-- marketing_vendors.ghl_contact_id — so the sweep never has to search GHL by email
-- to find them; it reads the ids and walks each contact's conversations.
--
-- This ledger is the record-once dedupe (PK = GHL conversation-message id), CLAIMED
-- before the activity_log row is written, so overlapping sweeps (the 15-min cron and
-- an inline "Sync now" click) can never double-log a message — the exact pattern as
-- ghl_call_log (calls) and ghl_email_doc_log (inbound-email docs).
--
-- NOTE: entity_id is polymorphic (a lenders.id OR a marketing_vendors.id), so there
-- is deliberately no FK on it — same choice activity_log itself makes.

create table if not exists public.ghl_conversation_log (
  ghl_message_id      text primary key,            -- GHL conversation-message id (unique per message)
  entity_type         text not null,               -- 'lender' | 'marketing_vendor'
  entity_id           uuid not null,               -- lenders.id or marketing_vendors.id
  ghl_contact_id      text not null,               -- the contact the message belongs to
  ghl_conversation_id text,                         -- for the deep-link back into GHL
  direction           text,                         -- inbound | outbound
  channel             text,                         -- email | sms | call
  message_at          timestamptz,                  -- message dateAdded (the real event time)
  activity_log_id     uuid,                         -- the activity_log row this produced (traceability)
  created_at          timestamptz not null default now()
);

comment on table public.ghl_conversation_log is
  'Record-once ledger of GHL/VibeReach conversation messages the vendor-conversation-sweep has mirrored onto a lender/marketing_vendor activity_log. PK = GHL message id, claimed before the activity row is written so a sweep re-run / inline Sync now never double-logs a message.';

create index if not exists ghl_conversation_log_entity_idx
  on public.ghl_conversation_log (entity_type, entity_id, message_at desc);

-- RLS on, no policies: only the service-role edge function reads/writes this. Staff
-- see the mirrored messages through the activity_log timeline — no direct client
-- access to the ledger is needed.
alter table public.ghl_conversation_log enable row level security;

-- Every 15 minutes, mirror new lender/vendor conversation messages into the
-- activity log, viewed or not. Same secret/anon cron pattern as
-- ghl-email-doc-sweep-5min; the ledger makes it idempotent. Offset off the :00/:15
-- marks so it doesn't stack on the other 15-min jobs.
select cron.schedule(
  'vendor-conversation-sweep-15min',
  '4,19,34,49 * * * *',
  $$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/vendor-conversation-sweep?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
