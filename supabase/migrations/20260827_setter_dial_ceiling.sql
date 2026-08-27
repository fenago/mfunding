-- Dial Ceiling: per-setter OCCUPANCY + honest-conversation diagnostic over wavv_calls.
-- Powers the "Dial Ceiling" tab on /admin/setter-performance.
--
-- DISPOSITION MAPPING (verified against real data 2026-08-27 -- do not "simplify" this):
--   wavv_calls.disposition holds BOTH machine results AND setter selections.
--     machine-written : 'Voice Message', 'No Answer', 'Call Blocked', 'Bad Number', 'None', NULL
--     setter-selected : 'Appointment Set', 'Interested', 'Callback', 'Full Application',
--                       'Not Interested', 'Do Not Contact'
--     dialer action   : 'Agent Canceled'  (0 answered, 0 seconds -- never a conversation)
--   wavv_calls.outcome is the pure telephony result (VOICEMAIL, USER_HUNG_UP, NO_ANSWER, ...).
--
--   So "dispositioned" = a SETTER picked an outcome = the honest "did she talk" signal.
--   It deliberately EXCLUDES the machine-written values. Counting every non-null disposition
--   would sweep in ~6,954 voicemails and destroy the metric.
--
--   Voicemail = outcome = 'VOICEMAIL' OR disposition = 'Voice Message'. Both are needed:
--   ~880 voicemail drops carry disposition 'Voice Message' with a non-VOICEMAIL outcome.
--   Voicemails set answered_at and often human=true, which is exactly why connect_pct and
--   human_pct are contaminated and disposition_rate is the metric to trust.

-- ---------------------------------------------------------------------------
-- RPC 1: one row per setter (per caller_id) for the window
--
-- NOTE: dropped-and-recreated rather than CREATE OR REPLACE -- the OUT parameter
-- list changed (negatives / neg_pos_ratio were added), and Postgres refuses to
-- replace a function whose return type changes. The DROP also drops the grants,
-- which is why the GRANT block at the bottom of this file is not optional.
-- ---------------------------------------------------------------------------
drop function if exists public.setter_dial_ceiling(timestamptz, timestamptz);

create or replace function public.setter_dial_ceiling(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  setter_id                uuid,
  setter_name              text,
  caller_id                text,
  caller_label             text,
  dials                    int,
  days_worked              int,
  logged_hours             numeric,
  dialing_hours            numeric,
  idle_hours               numeric,
  idle_pct                 numeric,
  gaps_over_15min          int,
  typical_start_et         text,
  typical_end_et           text,
  dials_per_dialing_hour   numeric,
  connect_pct              numeric,
  human_pct                numeric,
  human_calls              int,
  dispositioned            int,
  disposition_rate         numeric,
  appts                    int,
  positives                int,
  positives_per_1000       numeric,
  dials_per_appt           numeric,
  median_dispositioned_secs numeric,
  avg_appt_secs            numeric,
  voicemail_secs           numeric,
  connected_secs           numeric,
  voicemail_pct_of_talk    numeric,
  agent_canceled           int,
  agent_canceled_pct       numeric,
  -- Selective-logging detector: a low disposition_rate can mean "not talking" OR
  -- "talking but only logging wins". A healthy ratio logs many more rejections
  -- than positives; a ratio near the positives count means rejections go unlogged.
  negatives                int,
  neg_pos_ratio            numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with gate as (
    select (
      coalesce(auth.jwt() ->> 'role', '') = 'service_role'
      or exists (
        select 1 from public.profiles me
        where me.id = (select auth.uid())
          and me.role = any (array['closer','employee','admin','super_admin']::user_role[])
      )
    ) as ok
  ),
  base as (
    select
      v.setter_id,
      v.setter_name,
      v.caller_id,
      v.caller_label,
      v.started_at,
      v.answered_at,
      coalesce(v.seconds, 0)          as seconds,
      coalesce(v.human, false)        as human,
      v.disposition,
      v.outcome,
      (v.started_at at time zone 'America/New_York')::date as d
    from public.v_wavv_outbound_setter_calls v
    cross join gate
    where gate.ok
      and v.caller_id is not null
      and v.started_at >= p_from
      and v.started_at <  p_to
  ),
  gapped as (
    select
      b.*,
      b.started_at - lag(b.started_at) over (
        partition by b.caller_id, b.d order by b.started_at
      ) as gap
    from base b
  ),
  perday as (
    select
      caller_id,
      d,
      count(*)                                                                   as day_dials,
      extract(epoch from (max(started_at) - min(started_at))) / 3600.0           as logged_h,
      coalesce(sum(extract(epoch from gap)) filter (where gap > interval '5 minutes'), 0)
        / 3600.0                                                                 as idle_h,
      count(*) filter (where gap > interval '15 minutes')                        as g15,
      extract(epoch from (min(started_at) at time zone 'America/New_York')::time) as first_sec,
      extract(epoch from (max(started_at) at time zone 'America/New_York')::time) as last_sec
    from gapped
    group by 1, 2
  ),
  occ as (
    select
      caller_id,
      count(*)::int                                     as days_worked,
      sum(logged_h)                                     as logged_h,
      sum(idle_h)                                       as idle_h,
      sum(g15)::int                                     as g15,
      percentile_cont(0.5) within group (order by first_sec) as med_first_sec,
      percentile_cont(0.5) within group (order by last_sec)  as med_last_sec
    from perday
    group by 1
  ),
  calls as (
    select
      b.caller_id,
      min(b.setter_id::text)::uuid as setter_id,
      min(b.setter_name)           as setter_name,
      min(b.caller_label)          as caller_label,
      count(*)::int                as dials,
      count(*) filter (where b.answered_at is not null)::int as answered_n,
      count(*) filter (where b.human)::int                   as human_calls,
      count(*) filter (
        where b.disposition in ('Appointment Set','Interested','Callback',
                                'Full Application','Not Interested','Do Not Contact')
      )::int as dispositioned,
      count(*) filter (where b.disposition = 'Appointment Set')::int as appts,
      count(*) filter (
        where b.disposition in ('Appointment Set','Interested','Callback','Full Application')
      )::int as positives,
      count(*) filter (where b.disposition = 'Agent Canceled')::int  as agent_canceled,
      count(*) filter (
        where b.disposition in ('Not Interested','Do Not Contact')
      )::int as negatives,
      percentile_cont(0.5) within group (
        order by case
          when b.disposition in ('Appointment Set','Interested','Callback',
                                 'Full Application','Not Interested','Do Not Contact')
          then b.seconds end
      ) as med_disp_secs,
      avg(b.seconds) filter (where b.disposition = 'Appointment Set') as avg_appt_secs,
      coalesce(sum(b.seconds) filter (
        where b.outcome = 'VOICEMAIL' or b.disposition = 'Voice Message'
      ), 0) as voicemail_secs,
      coalesce(sum(b.seconds) filter (where b.answered_at is not null), 0) as connected_secs
    from gapped b
    group by 1
  )
  select
    c.setter_id,
    c.setter_name,
    c.caller_id,
    c.caller_label,
    c.dials,
    o.days_worked,
    round(o.logged_h::numeric, 2)                                          as logged_hours,
    round((o.logged_h - o.idle_h)::numeric, 2)                             as dialing_hours,
    round(o.idle_h::numeric, 2)                                            as idle_hours,
    round((o.idle_h / nullif(o.logged_h, 0) * 100)::numeric, 1)            as idle_pct,
    o.g15                                                                  as gaps_over_15min,
    to_char((o.med_first_sec || ' seconds')::interval, 'HH24:MI')          as typical_start_et,
    to_char((o.med_last_sec  || ' seconds')::interval, 'HH24:MI')          as typical_end_et,
    round((c.dials / nullif(o.logged_h - o.idle_h, 0))::numeric, 1)        as dials_per_dialing_hour,
    round((c.answered_n::numeric   / nullif(c.dials, 0) * 100), 1)         as connect_pct,
    round((c.human_calls::numeric  / nullif(c.dials, 0) * 100), 1)         as human_pct,
    c.human_calls,
    c.dispositioned,
    round((c.dispositioned::numeric / nullif(c.dials, 0) * 100), 2)        as disposition_rate,
    c.appts,
    c.positives,
    round((c.positives::numeric / nullif(c.dials, 0) * 1000), 2)           as positives_per_1000,
    round((c.dials::numeric / nullif(c.appts, 0)), 1)                      as dials_per_appt,
    round(c.med_disp_secs::numeric, 1)                                     as median_dispositioned_secs,
    round(c.avg_appt_secs::numeric, 1)                                     as avg_appt_secs,
    c.voicemail_secs::numeric,
    c.connected_secs::numeric,
    round((c.voicemail_secs::numeric / nullif(c.connected_secs, 0) * 100), 1) as voicemail_pct_of_talk,
    c.agent_canceled,
    round((c.agent_canceled::numeric / nullif(c.dials, 0) * 100), 2)       as agent_canceled_pct,
    c.negatives,
    round((c.negatives::numeric / nullif(c.positives, 0)), 2)              as neg_pos_ratio
  from calls c
  join occ o on o.caller_id = c.caller_id
  order by c.dials desc;
$$;

-- ---------------------------------------------------------------------------
-- RPC 2: one row per setter per day
-- ---------------------------------------------------------------------------
create or replace function public.setter_dial_ceiling_daily(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  day             date,
  setter_id       uuid,
  setter_name     text,
  caller_id       text,
  dials           int,
  dialing_hours   numeric,
  idle_pct        numeric,
  gaps_over_15min int,
  first_call_et   text,
  last_call_et    text,
  human_calls     int,
  dispositioned   int,
  appts           int,
  talk_min        numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with gate as (
    select (
      coalesce(auth.jwt() ->> 'role', '') = 'service_role'
      or exists (
        select 1 from public.profiles me
        where me.id = (select auth.uid())
          and me.role = any (array['closer','employee','admin','super_admin']::user_role[])
      )
    ) as ok
  ),
  base as (
    select
      v.setter_id,
      v.setter_name,
      v.caller_id,
      v.started_at,
      v.answered_at,
      coalesce(v.seconds, 0)   as seconds,
      coalesce(v.human, false) as human,
      v.disposition,
      (v.started_at at time zone 'America/New_York')::date as d
    from public.v_wavv_outbound_setter_calls v
    cross join gate
    where gate.ok
      and v.caller_id is not null
      and v.started_at >= p_from
      and v.started_at <  p_to
  ),
  gapped as (
    select
      b.*,
      b.started_at - lag(b.started_at) over (
        partition by b.caller_id, b.d order by b.started_at
      ) as gap
    from base b
  )
  select
    g.d as day,
    min(g.setter_id::text)::uuid as setter_id,
    min(g.setter_name)           as setter_name,
    g.caller_id,
    count(*)::int                as dials,
    round((
      extract(epoch from (max(g.started_at) - min(g.started_at)))
      - coalesce(sum(extract(epoch from g.gap)) filter (where g.gap > interval '5 minutes'), 0)
    )::numeric / 3600.0, 2)      as dialing_hours,
    round((
      coalesce(sum(extract(epoch from g.gap)) filter (where g.gap > interval '5 minutes'), 0)
      / nullif(extract(epoch from (max(g.started_at) - min(g.started_at))), 0) * 100
    )::numeric, 1)               as idle_pct,
    count(*) filter (where g.gap > interval '15 minutes')::int as gaps_over_15min,
    to_char(min(g.started_at) at time zone 'America/New_York', 'HH24:MI') as first_call_et,
    to_char(max(g.started_at) at time zone 'America/New_York', 'HH24:MI') as last_call_et,
    count(*) filter (where g.human)::int as human_calls,
    count(*) filter (
      where g.disposition in ('Appointment Set','Interested','Callback',
                              'Full Application','Not Interested','Do Not Contact')
    )::int as dispositioned,
    count(*) filter (where g.disposition = 'Appointment Set')::int as appts,
    round((coalesce(sum(g.seconds) filter (where g.answered_at is not null), 0) / 60.0)::numeric, 1) as talk_min
  from gapped g
  group by g.d, g.caller_id
  order by g.d desc, dials desc;
$$;

-- ---------------------------------------------------------------------------
-- Grants: this project's ALTER DEFAULT PRIVILEGES grants EXECUTE to anon on new
-- functions, so revoke BY NAME (a blanket revoke would not survive the default).
-- ---------------------------------------------------------------------------
revoke all on function public.setter_dial_ceiling(timestamptz, timestamptz)       from public, anon;
revoke all on function public.setter_dial_ceiling_daily(timestamptz, timestamptz) from public, anon;

grant execute on function public.setter_dial_ceiling(timestamptz, timestamptz)       to authenticated, service_role;
grant execute on function public.setter_dial_ceiling_daily(timestamptz, timestamptz) to authenticated, service_role;

comment on function public.setter_dial_ceiling(timestamptz, timestamptz) is
  'Per-setter occupancy + honest-conversation diagnostic over wavv_calls. dispositioned counts only SETTER-selected dispositions (machine values Voice Message/No Answer/Call Blocked/Bad Number/None are excluded); connect_pct and human_pct are voicemail-contaminated by design of the source data. Staff-gated.';

comment on function public.setter_dial_ceiling_daily(timestamptz, timestamptz) is
  'Daily grain of setter_dial_ceiling. talk_min = connected seconds (answered_at not null) / 60, which includes voicemail time. Staff-gated.';
