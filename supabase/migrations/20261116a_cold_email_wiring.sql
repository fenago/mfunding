-- 20261116a_cold_email_wiring — GHL <-> Instantly ledgers, settings and the
-- Momentum Micro campaign record (phase 3 of the "Momentum Micro" cold-email build).
--
-- instantly-enroll      → instantly_enroll_log  (every decision, one row per call)
-- instantly-event-hook  → instantly_event_log   (raw receipt FIRST, then processing)
--
-- Both are service-role only (RLS on, no policies) except a read policy for
-- admin/super_admin so an admin page can show them later.

-- ── Send side ledger ────────────────────────────────────────────────────────
create table if not exists public.instantly_enroll_log (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  ghl_contact_id       text,
  email                text,                       -- lower-cased
  instantly_campaign_id text,
  is_test              boolean not null default false,
  decision             text not null check (decision in (
                         'pending_verification', -- accepted, verifying in the background
                         'enrolled',             -- added to Instantly
                         'already_enrolled',     -- a prior call already enrolled it (idempotent no-op)
                         'refused_no_campaign',  -- settings carry no campaign id yet
                         'refused_no_email',
                         'refused_invalid',      -- mailbox does not exist → GHL tagged email-invalid
                         'refused_bounced',
                         'refused_unverifiable', -- catch_all / risky / unresolved
                         'refused_suppressed',   -- DND / unsubscribed / prior bounce event
                         'error')),
  verification_health  text,                       -- EmailHealth vocabulary (_shared/instantly.ts)
  verification_source  text,                       -- where the verdict came from
  instantly_lead_id    text,
  industry_fallback    boolean,
  detail               jsonb not null default '{}'::jsonb,
  error                text
);
create index if not exists instantly_enroll_log_email_idx on public.instantly_enroll_log (email, created_at desc);
create index if not exists instantly_enroll_log_contact_idx on public.instantly_enroll_log (ghl_contact_id, created_at desc);
-- At most one 'enrolled' row per (address, campaign): the race between two
-- concurrent webhook firings loses on this index, not in Instantly.
create unique index if not exists instantly_enroll_once
  on public.instantly_enroll_log (email, instantly_campaign_id) where decision = 'enrolled';

-- ── Return side receipt log ─────────────────────────────────────────────────
create table if not exists public.instantly_event_log (
  id                   uuid primary key default gen_random_uuid(),
  received_at          timestamptz not null default now(),
  -- Instantly sends no event id; this is a derived key (see _shared/coldEmail.ts
  -- eventKey). UNIQUE = a redelivery is recorded as a duplicate, never re-processed.
  event_key            text not null unique,
  event_type           text,
  lead_email           text,
  instantly_campaign_id text,
  payload              jsonb,                      -- the raw body (or {_raw: text} when unparseable)
  status               text not null default 'received' check (status in (
                         'received', 'processed', 'parked', 'error', 'ignored')),
  action               text,                       -- reply | click | unsubscribe | bounce | park
  reason               text,
  outcome              jsonb not null default '{}'::jsonb,
  error                text,
  processed_at         timestamptz,
  customer_id          uuid references public.customers(id) on delete set null,
  deal_id              uuid references public.deals(id) on delete set null,
  ghl_contact_id       text
);
create index if not exists instantly_event_log_email_idx on public.instantly_event_log (lead_email, received_at desc);
create index if not exists instantly_event_log_status_idx on public.instantly_event_log (status, received_at desc);

alter table public.instantly_enroll_log enable row level security;
alter table public.instantly_event_log  enable row level security;

drop policy if exists instantly_enroll_log_admin_read on public.instantly_enroll_log;
create policy instantly_enroll_log_admin_read on public.instantly_enroll_log
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','super_admin')));

drop policy if exists instantly_event_log_admin_read on public.instantly_event_log;
create policy instantly_event_log_admin_read on public.instantly_event_log
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','super_admin')));

-- ── The Momentum Micro campaign record (attribution for funded deals) ───────
-- code is minted by set_campaign_code (HOU-EM-2026-NNN) — never hand-written.
insert into public.campaigns (name, channel, status, partner, notes, start_date)
select 'Momentum Micro — Bitty (Cold Email Pilot)', 'email', 'planned', 'House',
       'Instantly pilot "Momentum Micro — Bitty (Pilot)". Replies/interested leads are created as cold_email deals by instantly-event-hook and attributed here. Funder: Bitty Advance (micro MCAs $2k–$100k).',
       current_date
where not exists (select 1 from public.campaigns where name = 'Momentum Micro — Bitty (Cold Email Pilot)');

-- ── Settings ────────────────────────────────────────────────────────────────
-- micro_bitty_campaign_id stays NULL until the pilot is approved; instantly-enroll
-- REFUSES to enroll while it is null. enroll_test_campaign_id is the harness
-- campaign ("TEST — enroll harness (never activate)"); only payloads carrying
-- test=true may use it.
insert into public.platform_settings (key, value)
select 'cold_email', jsonb_build_object(
  'micro_bitty_campaign_id', null,
  'enroll_test_campaign_id', null,
  'campaign_record_id', (select id from public.campaigns where name = 'Momentum Micro — Bitty (Cold Email Pilot)' limit 1),
  'reply_task_assignee_ghl_user_id', null,
  'reply_first_call_sla_minutes', 5
)
where not exists (select 1 from public.platform_settings where key = 'cold_email');
