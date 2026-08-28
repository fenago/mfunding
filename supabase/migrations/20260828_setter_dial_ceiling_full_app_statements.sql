-- Setter Performance P0: teach the Dial Ceiling RPCs the "Full App + Statements"
-- disposition, and consolidate the disposition vocabulary so it cannot drift again.
--
-- ALREADY APPLIED TO PROD (project ehibjeonqpqskhcvizow) on 2026-08-28 as
-- migration `setter_dial_ceiling_full_app_statements`. This file is the exact
-- SQL that was applied, committed so the repo reproduces prod on a rebuild.
-- It supersedes the function bodies in 20260827_setter_dial_ceiling.sql and
-- must run after it (the DROP + GRANT block lives in that earlier file; this one
-- uses CREATE OR REPLACE, which preserves grants, and re-asserts them at the
-- bottom anyway so the file stands on its own).
--
-- ── WHAT WAS BROKEN ─────────────────────────────────────────────────────────
-- The owner's 8/22 outcome ladder added "Full App + Statements" as the TOP
-- outcome a setter can produce — `wavv-disposition-sync` maps its tag
-- (wavv-full-app-statements) to DOCS COLLECTED, the deepest rung any disposition
-- reaches. But the value was never added to ANY disposition list in these two
-- functions, so the best call a setter can make scored:
--   0 dispositioned · 0 positive · excluded from median talk length.
-- Measured 2026-08-28: adding it moves line 9543354964 from 3 to 4 positives and
-- line 9542450661 from 0 to 1 on the 8/28 Eastern day.
--
-- ── WHY THE LISTS ARE NOW A CTE ─────────────────────────────────────────────
-- The vocabulary was hardcoded FOUR times: three lists inside setter_dial_ceiling
-- (dispositioned / positives / median-talk) and one inside the daily twin. That
-- repetition is exactly how one value went missing from all of them at once, so
-- each function now holds a single `dispo` CTE with `pos` and `neg` arrays and
-- every filter reads from it. The frontend twins are POSITIVE_DISPOSITIONS and
-- CONVERSATION_DISPOSITIONS in src/pages/admin/SetterPerformancePage.tsx —
-- change both together.
--
-- ── WHY "None" IS DELIBERATELY EXCLUDED ─────────────────────────────────────
-- WAVV ships a literal "None" disposition and it is NOT a retired value: over the
-- 14 days to 2026-08-28 the mirror holds 466 of them, every one on an ANSWERED
-- call. (The 8/22 change ADDED the new ladder values and kept the old ones —
-- "None" and "Interested" were not repurposed, which is what the header of
-- wavv-disposition-sync used to claim.) Among those 466 is a 7-minute live call
-- to H&R Logistic Services that produced a deal, a qualification and a SENT
-- APPLICATION.
--
-- "None" is therefore UN-DISPOSITIONED, not neutral and not positive:
--   • not in `pos` — nothing was achieved as far as the dial record knows;
--   • not in `neg` — nothing was rejected either;
--   • not in `pos || neg` — so it is not "dispositioned", because the entire
--     basis of that metric is that a HUMAN CHOSE the value after speaking to
--     someone. Folding "None" in would convert a logging gap into a performance
--     number and destroy the one honest signal on the dial side.
-- DO NOT add it to either array. Those calls have a home: the Disposition Review
-- tab on /admin/setter-performance, which pairs each of them with what the
-- PIPELINE says actually happened, so a real talk that was never dispositioned is
-- visible to a manager instead of silently scoring zero.
--
-- Nothing else about these functions changed: same signatures, same
-- SECURITY DEFINER + `SET search_path TO 'public'`, same in-function role gate.
-- get_advisors(security) after the change shows no new warning — both keep only
-- the pre-existing 0029 lint that 60 SECURITY DEFINER functions in this project
-- carry, and appear under neither 0011 (mutable search_path) nor the anon variant.

-- ---------------------------------------------------------------------------
-- RPC 1: one row per setter (per caller_id) for the window
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.setter_dial_ceiling(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(setter_id uuid, setter_name text, caller_id text, caller_label text, dials integer, days_worked integer, logged_hours numeric, dialing_hours numeric, idle_hours numeric, idle_pct numeric, gaps_over_15min integer, typical_start_et text, typical_end_et text, dials_per_dialing_hour numeric, connect_pct numeric, human_pct numeric, human_calls integer, dispositioned integer, disposition_rate numeric, appts integer, positives integer, positives_per_1000 numeric, dials_per_appt numeric, median_dispositioned_secs numeric, avg_appt_secs numeric, voicemail_secs numeric, connected_secs numeric, voicemail_pct_of_talk numeric, agent_canceled integer, agent_canceled_pct numeric, negatives integer, neg_pos_ratio numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- THE disposition vocabulary for this function. One place, on purpose.
  dispo as (
    select
      array['Appointment Set','Interested','Callback',
            'Full Application','Full App + Statements']::text[] as pos,
      array['Not Interested','Do Not Contact']::text[]          as neg
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
      count(*) filter (where b.disposition = any (dp.pos || dp.neg))::int as dispositioned,
      count(*) filter (where b.disposition = 'Appointment Set')::int      as appts,
      count(*) filter (where b.disposition = any (dp.pos))::int           as positives,
      count(*) filter (where b.disposition = 'Agent Canceled')::int       as agent_canceled,
      count(*) filter (where b.disposition = any (dp.neg))::int           as negatives,
      percentile_cont(0.5) within group (
        order by case when b.disposition = any (dp.pos || dp.neg) then b.seconds end
      ) as med_disp_secs,
      avg(b.seconds) filter (where b.disposition = 'Appointment Set') as avg_appt_secs,
      coalesce(sum(b.seconds) filter (
        where b.outcome = 'VOICEMAIL' or b.disposition = 'Voice Message'
      ), 0) as voicemail_secs,
      coalesce(sum(b.seconds) filter (where b.answered_at is not null), 0) as connected_secs
    from gapped b
    cross join dispo dp
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
$function$;

-- ---------------------------------------------------------------------------
-- RPC 2: one row per setter (per caller_id) PER DAY for the window
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.setter_dial_ceiling_daily(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(day date, setter_id uuid, setter_name text, caller_id text, dials integer, dialing_hours numeric, idle_pct numeric, gaps_over_15min integer, first_call_et text, last_call_et text, human_calls integer, dispositioned integer, appts integer, talk_min numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Same vocabulary as setter_dial_ceiling. Kept as its own CTE rather than
  -- inlined three times; "None" is deliberately absent (see the header note).
  dispo as (
    select
      array['Appointment Set','Interested','Callback',
            'Full Application','Full App + Statements']::text[] as pos,
      array['Not Interested','Do Not Contact']::text[]          as neg
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
    count(*) filter (where g.disposition = any (dp.pos || dp.neg))::int as dispositioned,
    count(*) filter (where g.disposition = 'Appointment Set')::int as appts,
    round((coalesce(sum(g.seconds) filter (where g.answered_at is not null), 0) / 60.0)::numeric, 1) as talk_min
  from gapped g
  cross join dispo dp
  group by g.d, g.caller_id
  order by g.d desc, dials desc;
$function$;

-- ---------------------------------------------------------------------------
-- Grants. CREATE OR REPLACE preserves the grants set by
-- 20260827_setter_dial_ceiling.sql, so these are a re-assertion, not a fix — but
-- they keep this file correct if it is ever run standalone. Revoke BY NAME: this
-- project's ALTER DEFAULT PRIVILEGES grants EXECUTE to anon on new functions, so
-- a blanket revoke would not survive the default.
-- ---------------------------------------------------------------------------
revoke all on function public.setter_dial_ceiling(timestamptz, timestamptz)       from public, anon;
revoke all on function public.setter_dial_ceiling_daily(timestamptz, timestamptz) from public, anon;

grant execute on function public.setter_dial_ceiling(timestamptz, timestamptz)       to authenticated, service_role;
grant execute on function public.setter_dial_ceiling_daily(timestamptz, timestamptz) to authenticated, service_role;
