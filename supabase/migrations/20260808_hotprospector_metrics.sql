-- HotProspector (hookscall.com PowerDialer) — daily metrics snapshots.
-- =============================================================================
-- WHAT: two append-by-day snapshot tables that back /admin/dialer, the per-rep
-- DIALER ACTIVITY scorecard for the PH setters/processors/closers. This is effort
-- and efficiency only (calls, talk time, answer rate, idle gap, convos, appts,
-- speed-to-lead). Pipeline and revenue live in GHL + public.deals — the two are
-- deliberately NOT merged here.
--
-- SOURCE OF TRUTH: HotProspector's own dashboard. getMemberDashboardData is a
-- report HotProspector calculates per day ("The report has not been calculated
-- yet." for days it hasn't processed), so we snapshot it rather than recompute it.
-- Every row keeps the untouched API object in `raw` so a field we didn't model
-- (or a field whose type drifts) is never lost.
--
-- HONESTY LAW: a metric HotProspector did not return stays NULL. Nothing in this
-- schema defaults a missing metric to 0 — the UI must be able to tell "this rep
-- made zero calls" apart from "HotProspector didn't report this". The one
-- exception is agents_returned on the account table, which is a genuine count.
-- =============================================================================

-- ── 1. Per-agent daily scorecard ──────────────────────────────────────────────
create table if not exists public.hotprospector_agent_daily (
  id            uuid primary key default gen_random_uuid(),
  stat_date     date not null,
  member_id     text not null,              -- agentId
  agent_name    text,
  agent_email   text,

  -- Shift shape. HotProspector returns these as display strings, verified live:
  -- firstCall/lastCall are clock times ("10:13 PM") and hours/gapTime are
  -- durations in HP's own "00m :14s" format. All four are stored VERBATIM as
  -- text; the *_seconds columns are the best-effort numeric parse used for
  -- sorting and thresholds, and are NULL when the string could not be parsed.
  first_call        text,
  last_call         text,
  gap_time          text,                   -- idle time between calls
  gap_time_seconds  numeric,
  hours             text,                   -- logged time on the dialer ("01h :22m :10s")
  hours_seconds     numeric,

  -- Volume
  outbound_calls    integer,
  inbound_calls     integer,
  answered_calls    integer,
  hangups           integer,
  sms               integer,

  -- Efficiency
  acg               numeric,                -- avg calls per group/hour (HP's ACG)
  aod               numeric,                -- avg outbound duration
  aid               numeric,                -- avg inbound duration
  talk_min          numeric,
  avg_min           numeric,
  ans_per_hour      numeric,
  answer_rate       numeric,                -- percent as returned by HP

  -- Outcomes
  convos            integer,
  conversion_rate   numeric,                -- HP's `cr`, percent
  prospects         integer,
  prospects_weekly  integer,
  appts             integer,
  appts_weekly      integer,
  abr               numeric,                -- appointment booking rate

  -- Speed-to-lead, computed from FetchUserCallLog (HP does not put it on the
  -- dashboard object). NULL when no call rows for this agent carried a usable
  -- speed_to_lead — never 0-filled.
  avg_speed_to_lead numeric,                -- seconds
  speed_to_lead_samples integer,

  raw           jsonb not null default '{}'::jsonb,
  synced_at     timestamptz not null default now(),
  unique (stat_date, member_id)
);
create index if not exists hotprospector_agent_daily_date_idx
  on public.hotprospector_agent_daily (stat_date desc);
comment on table public.hotprospector_agent_daily is
  'Per-agent per-day HotProspector PowerDialer scorecard (dialer ACTIVITY only — pipeline/revenue live in GHL/deals). Snapshotted by the hotprospector-sync edge function; unique on (stat_date, member_id). Missing metrics stay NULL, never 0.';

-- ── 2. Account-level daily snapshot (credits, seats, sync heartbeat) ───────────
-- Written on EVERY sync run even when zero agents came back, so the page can
-- distinguish "the poller ran and HotProspector has no active agents" from
-- "the poller never ran".
create table if not exists public.hotprospector_account_daily (
  stat_date        date primary key,
  credits          integer,
  seats_total      integer,
  seats_active     integer,
  seats_remaining  integer,
  campaign_count   integer,
  agents_returned  integer not null default 0,   -- how many agent rows the API returned
  calls_logged     integer,                      -- call-log rows seen for the day
  dashboard_last_updated text,                   -- HP's own "last_updated" stamp
  dashboard_message      text,                   -- e.g. "The report has not been calculated yet."
  raw              jsonb not null default '{}'::jsonb,
  synced_at        timestamptz not null default now()
);
comment on table public.hotprospector_account_daily is
  'Account-level HotProspector snapshot per day: dialer credits, seat usage, campaign count, and the sync heartbeat. Always upserted by hotprospector-sync, including on days with zero agent activity.';

-- ── 3. RLS — admin + super_admin read; writes are service-role only ───────────
-- (No write policy: the poller uses the service role, which bypasses RLS. Staff
-- never hand-edit dialer stats — they are a mirror of HotProspector.)
alter table public.hotprospector_agent_daily   enable row level security;
alter table public.hotprospector_account_daily enable row level security;

drop policy if exists hotprospector_agent_daily_admin_read   on public.hotprospector_agent_daily;
drop policy if exists hotprospector_account_daily_admin_read on public.hotprospector_account_daily;

create policy hotprospector_agent_daily_admin_read on public.hotprospector_agent_daily
  for select to authenticated using (is_admin_or_super(auth.uid()));
create policy hotprospector_account_daily_admin_read on public.hotprospector_account_daily
  for select to authenticated using (is_admin_or_super(auth.uid()));

-- ── 4. Cron — refresh "today" during business hours ───────────────────────────
-- Hourly 13:00–01:00 UTC covers 6am–6pm PST (HotProspector reports in PST). The
-- run is lean: one auth + 5 bounded API calls. The trailing 01:00 pass captures
-- the final numbers for the day after the last shift ends.
-- Standard trusted-cron path: ?secret=<GHL webhook secret> + anon-key bearer.
select cron.unschedule('hotprospector-sync-hourly')
where exists (select 1 from cron.job where jobname = 'hotprospector-sync-hourly');
select cron.schedule(
  'hotprospector-sync-hourly',
  '7 13-23,0-1 * * *',
  $cron$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/hotprospector-sync?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);

-- Yesterday's final pass at 09:10 UTC (~1am PST): HotProspector finishes
-- calculating a day's report after it closes, so re-snapshot the previous day
-- once more to lock in the settled numbers.
select cron.unschedule('hotprospector-sync-yesterday')
where exists (select 1 from cron.job where jobname = 'hotprospector-sync-yesterday');
select cron.schedule(
  'hotprospector-sync-yesterday',
  '10 9 * * *',
  $cron$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/hotprospector-sync?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := jsonb_build_object('days_back', 1),
    timeout_milliseconds := 120000
  );
  $cron$
);
