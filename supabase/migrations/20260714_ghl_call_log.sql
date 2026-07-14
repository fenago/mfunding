-- GHL/VibeReach call auditing — record-once ledger + atomic telemetry stamp.
--
-- Closers dial merchants through GHL's phone system (LeadConnector). Those calls
-- live only in GHL Conversations as TYPE_CALL messages — the app never saw them,
-- so the board couldn't tell "closer called at 10:05" from "nobody called".
-- The ghl-call-history edge function polls the contact's GHL conversations
-- whenever staff open the deal's system card, and for every OUTBOUND call it:
--   (a) inserts a row here (PK-deduped by GHL's message id — a poll re-run,
--       overlapping panel loads, or a future webhook can never double-log),
--   (b) writes a deal activity_log entry ("GHL call: outbound, 3m12s, answered
--       — by Carlos Marquez"),
--   (c) stamps the deal's call telemetry via ghl_apply_call_telemetry() below.
--
-- No workflow/webhook in GHL carries call events today (verified 2026-07-14:
-- no Call Status workflow exists, and the workflows API is read-only), so the
-- poll is the ingestion path; the ledger keys on ghl_message_id so a real-time
-- webhook can be added later without double-logging anything already seen.

create table if not exists public.ghl_call_log (
  ghl_message_id   text primary key,                 -- GHL conversation message id (unique per call)
  deal_id          uuid not null references public.deals(id) on delete cascade,
  ghl_contact_id   text not null,
  direction        text not null,                    -- inbound | outbound
  call_status      text,                             -- completed | voicemail | no-answer | busy | failed | canceled
  duration_seconds integer,                          -- meta.call.duration (null for voicemail/no-answer)
  ghl_user_id      text,                             -- GHL user who placed/took the call
  ghl_user_name    text,
  from_number      text,
  to_number        text,
  called_at        timestamptz not null,             -- message dateAdded (call start)
  created_at       timestamptz not null default now()
);

comment on table public.ghl_call_log is
  'Record-once ledger of GHL/VibeReach TYPE_CALL messages the ghl-call-history poller has audited into a deal (activity_log + telemetry). PK = GHL message id, so re-polls never double-log.';

create index if not exists ghl_call_log_deal_idx on public.ghl_call_log (deal_id, called_at desc);

-- RLS on, no policies: only the service-role edge function reads/writes this.
-- Staff see call history through the ghl-call-history function response, and the
-- audit trail through activity_log — no direct client access needed.
alter table public.ghl_call_log enable row level security;

-- Atomic telemetry stamp for a batch of newly-seen outbound calls. Called once
-- per sync by the ghl-call-history edge function (service-role only).
--
--   first_attempt_at  ← earliest of (existing, batch's earliest call) — an older
--                       real dial always wins; never moves later.
--   last_attempt_at   ← latest of (existing, batch's latest call).
--   contact_attempts  ← incremented by the number of NEW outbound calls only
--                       (the ledger PK guarantees each call increments once ever).
--   contacted_at      ← set ONLY if currently null, and only when the batch had a
--                       call that was actually ANSWERED with meaningful duration
--                       (status=completed AND duration ≥ 30s, decided caller-side).
--                       Rationale for 30s: LeadConnector marks a call "completed"
--                       whenever it connects — a voicemail-box pickup or an
--                       instant hang-up also reads completed. 30+ seconds of
--                       connected time is a human conversation, not a machine;
--                       voicemail/no-answer are attempts, never contact. An
--                       existing contacted_at is never rewritten — the closer's
--                       manually-logged outcome is history we keep.
--
-- Deliberately NEVER touches deals.status or deals.callback_at (callback
-- settling rules are owned by the callback wave — integration point for later).
create or replace function public.ghl_apply_call_telemetry(
  p_deal_id      uuid,
  p_first_at     timestamptz,   -- earliest new outbound call in the batch
  p_last_at      timestamptz,   -- latest new outbound call in the batch
  p_new_attempts integer,       -- count of NEW outbound calls (ledger-deduped)
  p_contacted_at timestamptz    -- earliest ANSWERED(≥30s) call, or null
) returns void
language sql security definer set search_path = public as $$
  update public.deals set
    first_attempt_at = least(coalesce(first_attempt_at, p_first_at), p_first_at),
    last_attempt_at  = greatest(coalesce(last_attempt_at, p_last_at), p_last_at),
    contact_attempts = coalesce(contact_attempts, 0) + greatest(p_new_attempts, 0),
    contacted_at     = coalesce(contacted_at, p_contacted_at)
  where id = p_deal_id;
$$;

revoke all on function public.ghl_apply_call_telemetry(uuid, timestamptz, timestamptz, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.ghl_apply_call_telemetry(uuid, timestamptz, timestamptz, integer, timestamptz) to service_role;
