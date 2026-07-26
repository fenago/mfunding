-- Call / Transfer Quality audit — the phone-call sibling of the email census on the
-- Campaign Audit page. Two tables:
--
--   call_audit_runs   — one row per audit run (manual button-press or weekly cron).
--                       Holds the window (date_from/date_to), scope (campaign_id null
--                       = all campaigns; all_inbound = also sweep unattached inbound
--                       calls across the location), rollup totals, and a resumable
--                       cursor so the edge function can process a long run across
--                       several self-reinvocations without losing its place.
--   call_audit_calls  — one row per call audited in a run. The transcript lives HERE
--                       (viewable in the UI), alongside the classification, the quote
--                       that triggered it, and enough call metadata to show the row
--                       without another GHL round-trip.
--
-- Writes are service-role only (the call-audit-sweep edge function). Reads are gated
-- to admin + super_admin — this exposes staff phone numbers and call content, so it
-- is NOT an is_ops_staff (which includes 'employee') surface. RLS is enabled with a
-- SELECT policy only; there is no client insert/update/delete path.

-- ── Runs ────────────────────────────────────────────────────────────────────
create table if not exists public.call_audit_runs (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid references public.campaigns(id) on delete set null, -- null = all campaigns
  date_from    date not null,
  date_to      date not null,
  all_inbound  boolean not null default false,   -- also sweep inbound calls not attached to a campaign contact
  source       text not null default 'manual' check (source in ('manual','cron')),
  status       text not null default 'queued'
                 check (status in ('queued','enumerating','running','done','error')),
  totals       jsonb not null default '{}'::jsonb, -- {calls, with_recording, by_class:{...}, ...}
  cursor       jsonb not null default '{}'::jsonb, -- {phase, processed, invocations} for resumability
  error        text,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.call_audit_runs is
  'One row per Call/Transfer Quality audit run (manual or weekly cron). Window + scope + rollup totals + resumable cursor. Written by the call-audit-sweep edge function (service-role).';

create index if not exists call_audit_runs_created_idx on public.call_audit_runs (created_at desc);
create index if not exists call_audit_runs_campaign_idx on public.call_audit_runs (campaign_id, created_at desc);

-- ── Per-call results ──────────────────────────────────────────────────────────
create table if not exists public.call_audit_calls (
  id               uuid primary key default gen_random_uuid(),
  run_id           uuid not null references public.call_audit_runs(id) on delete cascade,
  campaign_id      uuid references public.campaigns(id) on delete set null, -- null for all-inbound unattached calls
  customer_id      uuid references public.customers(id) on delete set null,
  deal_id          uuid references public.deals(id) on delete set null,
  ghl_contact_id   text,
  ghl_message_id   text not null,           -- GHL conversation message id (the call)
  conversation_id  text,
  direction        text,                    -- inbound | outbound
  call_date        timestamptz,
  duration_s       integer,
  call_status      text,                    -- completed | voicemail | no-answer | ...
  from_number      text,
  to_number        text,
  has_recording    boolean not null default false,
  transcript       text,                    -- the stored transcript (viewable in the UI); null = none
  classification   text not null default 'pending',
  matched_quote    text,                    -- the phrase window that triggered the classification
  kick_offset_hint text,                    -- rough time-into-call the kick/teardown occurred
  meta             jsonb not null default '{}'::jsonb, -- {business, transcription, model, rec_bytes, ...}
  created_at       timestamptz not null default now(),
  unique (run_id, ghl_message_id)
);

comment on table public.call_audit_calls is
  'One row per call audited in a run. Transcript + classification + matched quote + call metadata. Written by call-audit-sweep (service-role).';

create index if not exists call_audit_calls_run_idx on public.call_audit_calls (run_id, call_date desc);
create index if not exists call_audit_calls_run_class_idx on public.call_audit_calls (run_id, classification);
-- Lets the sweep pull the next batch of un-transcribed rows cheaply.
create index if not exists call_audit_calls_pending_idx on public.call_audit_calls (run_id) where classification = 'pending';

-- ── RLS: admin + super_admin read; service-role writes (bypasses RLS) ─────────
alter table public.call_audit_runs  enable row level security;
alter table public.call_audit_calls enable row level security;

create policy call_audit_runs_admin_select on public.call_audit_runs
  for select using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.role in ('admin','super_admin'))
  );

create policy call_audit_calls_admin_select on public.call_audit_calls
  for select using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.role in ('admin','super_admin'))
  );
