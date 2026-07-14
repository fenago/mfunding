-- Followups-calendar P1 (research/PLAN_followups_calendar.md §7):
-- deals.callback_at is the single source of truth; the GHL "Callbacks — Internal"
-- calendar is a one-way DB→GHL projection of it. These columns carry the
-- projection state so the 5-minute sweeper (callback-calendar-sync) can detect
-- drift, retry failures, and never double-book.

alter table public.deals
  -- The GHL appointment currently projecting this deal's callback (null = none).
  add column if not exists callback_ghl_event_id text,
  -- ⚠️ SEMANTICS: this holds the callback_at INSTANT the GHL event currently
  -- reflects — not "when the sync ran". That makes drift detection a pure column
  -- comparison (callback_at IS DISTINCT FROM callback_synced_at → needs sync) and
  -- lets the UI show "📅 on calendar" only when the tick is actually true for the
  -- CURRENT time, not for a since-rescheduled one.
  add column if not exists callback_synced_at timestamptz,
  -- Last sync failure, verbatim (null = healthy). Recorded, never thrown: a GHL
  -- outage must never lose a callback — My Day reads callback_at directly.
  add column if not exists callback_sync_error text;

comment on column public.deals.callback_ghl_event_id is
  'GHL appointment id on the "Callbacks — Internal" calendar projecting callback_at. One-way DB→GHL; the sweeper overwrites GHL-side edits.';
comment on column public.deals.callback_synced_at is
  'The callback_at instant the GHL event currently reflects (NOT a sync timestamp). Drift = callback_at IS DISTINCT FROM callback_synced_at.';
comment on column public.deals.callback_sync_error is
  'Last callback-calendar-sync failure for this deal (null = healthy). The 5-min sweeper retries until it heals.';

-- The sweeper's scan: deals with a callback to project, a stale projection, or a
-- lingering event to cancel. Partial index keeps it free on the other 99% of rows.
create index if not exists deals_callback_sync_scan_idx
  on public.deals (callback_at, callback_synced_at)
  where (callback_at is not null or callback_ghl_event_id is not null);

-- Closer → GHL user mapping, for assignedUserId on the appointment. Nullable on
-- purpose: an unmapped closer (today: the owner, whose login is agency-level)
-- still gets the event booked, just unassigned — never block on the mapping.
alter table public.closers
  add column if not exists ghl_user_id text;

comment on column public.closers.ghl_user_id is
  'GHL location user id for appointment assignment (assignedUserId). NULL = book unassigned (email fallback lands in P2).';

-- Carlos Marquez is the one closer who exists as a GHL location user (verified
-- live 2026-07-13, PLAN_followups_calendar.md §1). Ernesto is agency-level and
-- stays NULL by design.
update public.closers
   set ghl_user_id = 'UW2IiJjoAK1pTDRdeLz2'
 where first_name = 'Carlos' and last_name = 'Marquez' and ghl_user_id is null;

-- The "Callbacks — Internal" calendar (created + configured via the GHL API on
-- 2026-07-14: contact notifications none, assignedUser inApp+email reminder 15m
-- before, google invitation emails OFF). Config, not code — the sync fn reads it.
insert into public.platform_settings (key, value, updated_at)
values (
  'callback_calendar',
  jsonb_build_object('internal_calendar_id', 'AylxRmWspFl9hFIyNzlj'),
  now()
)
on conflict (key) do update
  set value = excluded.value, updated_at = now();
