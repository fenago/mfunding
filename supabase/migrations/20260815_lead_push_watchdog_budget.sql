-- Restart budget for the lead-push-ghl watchdog.
--
-- The watchdog added earlier today restarts any 'running' job whose chain has
-- gone quiet. That is right when the chain DIED and catastrophic when the chain
-- is dying because its work is too expensive: on 2026-08-14 the (d) drain hit a
-- cost cliff, every window timed out, and the 3-minute watchdog faithfully
-- resurrected it — each resurrection running the same expensive query and
-- holding a connection until it timed out. Auth went down. A watchdog without a
-- restart budget is not a watchdog, it is an amplifier.
--
-- The budget makes it give up and say so, instead of retrying forever:
-- WATCHDOG_MAX_RESTARTS within WATCHDOG_BUDGET_MIN, then the job is failed with
-- an explicit reason a human can act on.
alter table public.lead_push_jobs
  add column if not exists watchdog_restarts integer not null default 0,
  add column if not exists watchdog_window_started_at timestamptz;

comment on column public.lead_push_jobs.watchdog_restarts is
  'How many times the watchdog has resurrected this job inside the current '
  'budget window. Reset when the window rolls over; exhausting it fails the job.';
comment on column public.lead_push_jobs.watchdog_window_started_at is
  'Start of the current restart-budget window.';
