-- ghl_event_hook_log — proof that PUSH events are actually arriving from GHL.
--
-- WHY. Today the only way a completed call or a merchant reply reaches Supabase
-- is a cron sweep that POLLS GHL per record (~89k calls/day for calls + emails
-- combined). The replacement is push: GHL workflows POST to the `ghl-event-hook`
-- edge function the moment something happens, and the hook does one TARGETED
-- fetch for that single contact. Before any sweep cadence can be reduced, we
-- have to be able to answer "are the workflows actually firing, for which
-- contacts, and did the mirror succeed?" — that is this table, and nothing else.
--
-- It is a HOOK RECEIPT LOG, not a data mirror. The mirrored data itself still
-- lands exactly where the sweeps put it (ghl_call_log / ghl_email_doc_log /
-- customer_documents / activity_log), keyed on the same GHL ids, so a
-- hook-written row and a sweep-written row are indistinguishable and can never
-- duplicate each other. This table only records that an event was received and
-- what the hook did about it.
--
-- ok = false is a NORMAL, EXPECTED outcome, not an error: a webhook that
-- error-retry-storms is worse than one that reports "nothing to do". The
-- `actions` payload carries the reason (no contact id, no deal for contact,
-- budget floor, GHL failure) so an ok:false row is always readable.

create table if not exists public.ghl_event_hook_log (
  id          uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  type        text,                       -- call | email | generic (query ?type=)
  contact_id  text,                       -- GHL contact id extracted from the body
  actions     jsonb not null default '{}'::jsonb,
  ok          boolean not null default false
);

comment on table public.ghl_event_hook_log is
  'Receipt log for inbound GHL workflow webhooks handled by the ghl-event-hook edge function. One row per POST. Proves push events are flowing before any polling sweep cadence is reduced. ok=false is an expected outcome (nothing to do), not a failure — see actions.reason.';
comment on column public.ghl_event_hook_log.actions is
  'What the hook did: {reason} when it short-circuited, otherwise the mirror counts (deal_id, calls_synced, emails_scraped, docs_synced, ...) and any GHL error.';
comment on column public.ghl_event_hook_log.ok is
  'true = the targeted mirror ran to completion for this event. false = the hook deliberately did nothing (no contact id / no deal / budget floor) or the mirror errored. Always paired with actions.reason.';

-- The only query this table serves is "show me the last N events, newest first",
-- optionally narrowed to one contact while debugging a specific workflow.
create index if not exists ghl_event_hook_log_received_idx on public.ghl_event_hook_log (received_at desc);
create index if not exists ghl_event_hook_log_contact_idx  on public.ghl_event_hook_log (contact_id, received_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Admin-read, service-role-write, matching the other observability tables
-- (wavv_calls, ghl_webhook_events). No policy grants insert/update/delete to
-- `authenticated`, and service_role bypasses RLS, so the edge function is the
-- only writer. auth.uid() is wrapped in a scalar subselect per the RLS initplan
-- convention (20260813_rls_initplan_wrap.sql).
alter table public.ghl_event_hook_log enable row level security;

drop policy if exists ghl_event_hook_log_admin_read on public.ghl_event_hook_log;
create policy ghl_event_hook_log_admin_read on public.ghl_event_hook_log
  for select to authenticated
  using ((select is_admin_or_super((select auth.uid()))));
