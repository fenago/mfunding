-- ── PER-RECIPIENT email delivery ledger ──────────────────────────────────────
--
-- WHY THIS TABLE EXISTS. Funders told the owner they never received submissions
-- our system records as "sent". Every channel by which that could have reached
-- us was closed:
--
--   * No email webhook event was subscribed at all. Of 657,029 rows in
--     ghl_webhook_events the only types ever received are OpportunityStageUpdate,
--     OpportunityCreate and three types WE insert ourselves.
--   * Return-Path on our outbound mail is Mailgun's own address, so the bounce
--     NDR goes to Mailgun and never to us.
--   * GHL's email RECORD carries ONE aggregate `status` across to + cc + bcc. A
--     permanent failure to the funder's `to:` address is therefore masked by
--     successful delivery to our own CC copies — the record reads healthy for a
--     submission that reached nobody at the funder. That masking is the whole
--     reason a per-RECIPIENT ledger is needed and a per-message status is not
--     enough.
--
-- So this table stores one row per RECIPIENT per EVENT, never an aggregate. The
-- unit of truth is "this address did/did not accept this message", because that
-- is the only unit in which the funder's inbox can be said to have failed.
--
-- WHAT IS AND IS NOT TRUSTWORTHY HERE. `delivered` and the failure events are
-- the remote SMTP server's own words and are trustworthy. `opened` is NOT: all
-- five messages ever sent to submissions@highlandhillcap.com read `opened`,
-- including three plain-text follow-ups with no attachments, from a team that
-- says it received nothing — Microsoft EOP prefetches tracking pixels. Opens are
-- recorded here as what they are (a pixel loaded by someone, possibly a machine)
-- and nothing downstream may present one as "the funder read this".
create table if not exists public.email_delivery_events (
  id uuid primary key default gen_random_uuid(),

  -- Normalized event class. `event_raw` keeps whatever the provider actually
  -- said, so a provider renaming an event can never be silently reclassified.
  event text not null check (event in (
    'delivered','failed','rejected','opened','clicked','complained','unsubscribed','other'
  )),
  event_raw text,
  -- 'permanent' | 'temporary' | null. A TEMPORARY failure is Mailgun still
  -- retrying and must never be reported as a non-delivery; only a permanent one
  -- means the message is dead.
  severity text,

  -- The ONE address this event is about.
  recipient text not null,
  -- Where that address sat on OUR message: 'to' (the funder's submission inbox),
  -- 'cc'/'bcc' (our own copies), or 'unknown'. This is the column that unmasks
  -- the aggregate-status problem: a 550 with recipient_role='to' means the funder
  -- got nothing, while the same code on a 'cc' row means our audit copy bounced.
  recipient_role text,
  header_to text,                 -- message.headers.to (our To: header)

  -- The remote server's actual response. The single most actionable fact in the
  -- whole investigation and, before this table, it had nowhere to land.
  smtp_code integer,
  smtp_enhanced_code text,        -- e.g. '5.1.10'
  smtp_message text,              -- e.g. '550 5.1.10 RESOLVER.ADR.RecipientNotFound'
  mx_host text,

  smtp_message_id text,           -- message.headers.message-id — the message identity
  provider_event_id text,         -- webhookPayload.id (Mailgun's event id) — dedupe key
  occurred_at timestamptz not null,

  -- Correlation. Null deal_submission_id is NORMAL and must stay readable as
  -- "we could not place it", never as "no failure happened".
  deal_submission_id uuid references public.deal_submissions(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  lender_id uuid references public.lenders(id) on delete set null,
  ghl_contact_id text,

  -- HOW it was correlated, recorded on every row so no reader has to assume the
  -- match was exact. 'unplaced_ambiguous' rows carry their candidates.
  match_rung text not null check (match_rung in (
    'smtp_message_id','recipient_unique','contact_unique',
    'unplaced_none','unplaced_ambiguous','not_a_submission'
  )),
  candidates jsonb,

  payload jsonb not null,
  created_at timestamptz not null default now()
);

-- Mailgun/GHL redeliver on a non-2xx, so the provider's event id is the dedupe
-- key. Partial: a workflow-shaped payload has no event id and must still insert.
create unique index if not exists email_delivery_events_provider_event_uidx
  on public.email_delivery_events (provider_event_id)
  where provider_event_id is not null;

create index if not exists email_delivery_events_submission_idx
  on public.email_delivery_events (deal_submission_id) where deal_submission_id is not null;
create index if not exists email_delivery_events_recipient_idx
  on public.email_delivery_events (lower(recipient), occurred_at desc);
create index if not exists email_delivery_events_msgid_idx
  on public.email_delivery_events (smtp_message_id) where smtp_message_id is not null;
-- The query a human actually runs: "what failed, newest first".
create index if not exists email_delivery_events_failures_idx
  on public.email_delivery_events (occurred_at desc)
  where event in ('failed','rejected','complained');

alter table public.email_delivery_events enable row level security;

-- Ops staff read; all writes are service-role (the ghl-webhook function).
drop policy if exists admin_select_email_delivery_events on public.email_delivery_events;
create policy admin_select_email_delivery_events
  on public.email_delivery_events for select using (public.is_ops_staff((select auth.uid())));

comment on table public.email_delivery_events is
  'One row per RECIPIENT per email delivery event (GHL LCEmailStats / Email Events). '
  'Exists because GHL''s email record carries a single aggregate status across to+cc+bcc, '
  'which masks a permanent failure to a funder''s submission inbox behind successful '
  'delivery to our own CC copies. `opened` rows are pixel loads and are NOT evidence a '
  'human read anything (Microsoft EOP prefetches them).';
comment on column public.email_delivery_events.recipient_role is
  'to = the funder''s own submission inbox (a permanent failure here means the funder got '
  'NOTHING); cc/bcc = our own copies (a failure here does not affect the submission).';
comment on column public.email_delivery_events.match_rung is
  'How this event was tied to a submission. unplaced_* means we deliberately refused to '
  'guess — read it as "needs a human", never as "nothing happened".';

-- ── The POSITIVE truth, which we also never had ──────────────────────────────
-- `opened_at` was the only engagement-ish column on a submission and it is both
-- never-written (0 of 38) and untrustworthy when it is (pixel prefetch). What a
-- processor actually wants to know is whether the funder's MAIL SERVER accepted
-- the message — a fact the remote server states and cannot fake. That is this
-- column. It is stamped ONLY from a `delivered` event whose recipient is the
-- submission's `to:` address, never from a CC copy.
alter table public.deal_submissions
  add column if not exists delivered_at timestamptz,
  add column if not exists delivered_to text;

comment on column public.deal_submissions.delivered_at is
  'When the RECIPIENT''s mail server accepted the message (LCEmailStats event=delivered '
  'for the submission''s to: address). Not an open and not a read — an SMTP 250. Null '
  'means we have no delivery event, NOT that delivery failed.';

-- ── And the negative, which had nowhere to land at all ───────────────────────
-- A permanent failure to the funder's submission inbox must be VISIBLE, and
-- neither existing state could express it:
--
--   * leave status='submitted' → stateOf() renders a grey "⏳ Awaiting" and the
--     bounce is invisible, which is the bug we are fixing, not a fix.
--   * clear submitted_at (what the 8-second post-send verify does) → isLive()
--     goes false and the row DISAPPEARS from the chase board. A hidden failure
--     is worse than a mislabelled one.
--
-- So the failure gets its own column and its own state. submitted_at is kept
-- deliberately: we really did send it, and "never stamped" would be a second
-- false statement. What changed is that the recipient refused it.
alter table public.deal_submissions
  add column if not exists delivery_failed_at timestamptz,
  add column if not exists delivery_error text;

comment on column public.deal_submissions.delivery_failed_at is
  'When the recipient''s mail server PERMANENTLY refused the message (5xx / explicit '
  'permanent severity) for the submission''s to: address. A temporary deferral never '
  'sets this — Mailgun is still retrying. Null means no proven failure, NOT success.';
comment on column public.deal_submissions.delivery_error is
  'The receiving server''s own words, e.g. "550 5.1.10 RESOLVER.ADR.RecipientNotFound". '
  'A processor needs the actual SMTP reply, not the word "undeliverable".';
