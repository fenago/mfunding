-- Inbound-email document scraping — record-once ledger + 5-minute sweep cron.
--
-- Merchants routinely REPLY to our email with their bank statements / ID /
-- application attached instead of using the upload form (Kanthaka Group forwarded
-- 25 statement PDFs straight to sales@send.mfunding.net). Those attachments live
-- only on the GHL email record, so the form-upload bridge (ingestGhlDocuments)
-- never saw them. The ghl-email-doc-sweep function walks every open deal's inbound
-- emails and, for each email genuinely from the merchant, pulls the attachments
-- into customer_documents, content-classifies them, and writes one activity_log
-- note per email. New bank statements fire the auto-underwrite hook.
--
-- This ledger is the record-once dedupe (PK = GHL email-record id), CLAIMED before
-- processing so overlapping sweeps / a future inbound-email webhook can reuse the
-- same shared module and never double-log or double-note an email — the exact
-- pattern as ghl_call_log for calls.

create table if not exists public.ghl_email_doc_log (
  ghl_email_message_id  text primary key,               -- GHL email-record id (unique per email)
  deal_id               uuid not null references public.deals(id) on delete cascade,
  customer_id           uuid,
  ghl_contact_id        text,
  direction             text,                            -- inbound | outbound
  from_email            text,                            -- parsed sender address
  subject               text,
  email_at              timestamptz,                     -- email record dateAdded
  outcome               text not null default 'processing',
  -- processing | scraped | skipped_outbound | skipped_not_merchant |
  -- skipped_robot_domain | skipped_no_attachments | skipped_no_new_docs | error
  detail                text,
  attachments_found     integer,
  docs_synced           integer,
  bank_statements_added integer,
  created_at            timestamptz not null default now()
);

comment on table public.ghl_email_doc_log is
  'Record-once ledger of GHL inbound email records the ghl-email-doc-sweep has evaluated. PK = GHL email-record id, claimed before processing so a sweep re-run / future webhook never double-scrapes or double-notes an email.';

create index if not exists ghl_email_doc_log_deal_idx on public.ghl_email_doc_log (deal_id, created_at desc);

-- RLS on, no policies: only the service-role edge function reads/writes this.
-- Staff see the scraped docs through customer_documents and the audit note through
-- activity_log — no direct client access needed.
alter table public.ghl_email_doc_log enable row level security;

-- Merchant-emailed docs self-attach every 5 minutes, viewed or not. Same cadence
-- and secret/anon pattern as ghl-call-sweep-5min; the ledger makes it idempotent.
select cron.schedule(
  'ghl-email-doc-sweep-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/ghl-email-doc-sweep?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := '{}'::jsonb
  );
  $$
);
