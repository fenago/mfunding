-- The aged-lead lookback, and the heat fix that has to ship with it. ═════════
--
-- PART 1 — win_lo loses its time cap.
--
-- The lower bound was `created_at - 8 hours`, one working shift. That is
-- calibrated on the live-transfer shape, where the record is made minutes after
-- the call. It is wrong for a purchased list, where the lead is dialed for days
-- before anyone writes a deal: MF-2026-0272 is a ucc_list lead dialed 12 times
-- across 8 days before its record existed, and MF-2026-0255 the same.
--
-- There is no threshold to pick, and the distribution is why. Across the 87
-- deals with dialing before their record existed:
--
--     p50    9 hours          <- the 8h cap sits essentially AT the median
--     p90  102 hours
--     p99  336 hours
--     max  337 hours
--     88 such calls inside the 8h cap, 94 outside it and invisible
--
-- Smooth from hours to 14 days with no knee — nothing like the sibling-gap
-- distribution, where 14 minutes against 37 days made the 24h cut obvious. Any
-- hour count here is arbitrary and wrong for the next list. So: no time cap. The
-- lookback is bounded only by the previous genuine re-entry, which is already
-- computed and is the one principled stop — within its own engagement, the deal
-- is the only record that can hold that merchant's history, so it holds all of it.
--
-- Measured: +94 events across 44 deals, ZERO lost, no deal gaining more than 20.
--
-- The objection that this would pollute TouchTracker's 14-day grid is closed and
-- was checked, not assumed: MiniTracker does `if (idx === -1) idx = 0;` then
-- `if (idx >= 0 && idx < TRACKER_DAYS)`, so a call 8 days before the deal lands
-- at idx -8 and the grid drops it itself. A wider win_lo cannot reach it.
--
-- PART 2 — and this is why it could not ship alone.
--
-- HotLeadsPanel feeds `hist.attempts` — the LIFETIME dial count — into leadHeat,
-- which computes `deficit = expectedAttempts(ageMs) - attempts` where ageMs is
-- the lead's age SINCE ARRIVAL. Numerator and denominator cover different
-- intervals. Widening win_lo adds pre-arrival dials to the numerator only, so a
-- brand-new untouched transfer would read as adequately worked because the same
-- merchant was dialed on a UCC list last month. Measured on the live 7-day hot
-- window: MF-2026-0349 would go from 1 attempt to 5, MF-2026-0351 from 2 to 3.
-- Against a 0/1/2/3/5/6 ladder, four phantom attempts moves a lead from burning
-- to cool. Fixing under-reporting by inventing under-prioritising is not a trade
-- worth making — it is the "those are getting buried" complaint that started all
-- of this.
--
-- So realtime_lead_call_history now returns BOTH counts, and the panel uses the
-- right one for each question:
--
--   attempts               lifetime. "Has anyone ever called this merchant?"
--                          Keeps the NEVER DIALED chip honest — if we have ever
--                          dialed them, never call them un-dialed.
--   attempts_since_arrival dials at or after deals.created_at. "Is this lead
--                          being worked since it arrived?" Drives the pace
--                          deficit, the blazing tier and the 5-minute badge.
--
-- The cut is `at >= created_at` exactly, with no grace, so the numerator covers
-- precisely the interval ageMs measures. A grace period was considered for the
-- originating dial of a live transfer and rejected on evidence: of 224 real-time
-- deals, ZERO have a WAVV call in the 30 minutes before their record exists — the
-- transfer is routed and recorded without one — so a grace would have been a
-- magic number guarding nothing.

drop function if exists public.deal_call_events(uuid[]);

create function public.deal_call_events(p_deal_ids uuid[])
returns table (
  deal_id         uuid,
  at              timestamptz,
  source          text,
  src_rank        int,
  disposition     text,
  seconds         int,
  who             text,
  note            text,
  is_conversation boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with windowed as (
    select d.id, d.customer_id, d.created_at, c.phone,
           -- No time cap. Bounded only by the previous genuine RE-ENTRY: within
           -- one engagement this deal is the only record that can hold the
           -- merchant's history, so it holds all of it. A duplicate record
           -- minutes earlier is the same engagement and does not bound anything.
           (select max(d0.created_at) - interval '30 minutes'
              from public.deals d0
             where d0.customer_id = d.customer_id
               and d0.created_at < d.created_at - interval '24 hours') as win_lo,
           -- Up to the next genuine re-entry's claim.
           (select min(d2.created_at) - interval '30 minutes'
              from public.deals d2
             where d2.customer_id = d.customer_id
               and d2.created_at > d.created_at + interval '24 hours') as win_hi
      from public.deals d
      join public.customers c on c.id = d.customer_id
     where d.id = any (p_deal_ids)
  ),
  raw_calls as (
    -- 1. WAVV — the primary dialer. Phone-keyed, so attributed by the window.
    select x.id                                           as deal_id,
           w.started_at                                   as at,
           'wavv'::text                                   as source,
           1                                              as src_rank,
           -- WAVV writes the literal string 'None' when the setter hung up
           -- without picking a disposition row. Rendering "— None" next to a
           -- call reads as a result; falling through to the outcome says what
           -- actually happened.
           coalesce(
             nullif(nullif(btrim(w.disposition), ''), 'None'),
             initcap(replace(lower(coalesce(w.outcome, 'call')), '_', ' '))
           )                                              as disposition,
           w.seconds                                      as seconds,
           coalesce(
             nullif(btrim(w.agent_name), ''),
             nullif(btrim(concat_ws(' ', wc.first_name, wc.last_name)), '')
           )                                              as who,
           nullif(btrim(coalesce(w.note, '')), '')        as note,
           (    w.direction = 'outbound'
            and coalesce(w.seconds, 0) >= 120
            and upper(coalesce(w.outcome, '')) <> 'VOICEMAIL') as is_conversation
      from windowed x
      join public.wavv_calls w
        on x.phone is not null
       and right(regexp_replace(w.phone, '[^0-9]', '', 'g'), 10)
         = right(regexp_replace(x.phone, '[^0-9]', '', 'g'), 10)
       and right(regexp_replace(x.phone, '[^0-9]', '', 'g'), 10) <> ''
       and (x.win_lo is null or w.started_at >= x.win_lo)
       and (x.win_hi is null or w.started_at < x.win_hi)
      left join public.closers wc on wc.ghl_user_id = w.agent_key

    union all

    -- 2. GHL / LeadConnector calls, already keyed to the deal.
    select x.id, g.called_at, 'ghl', 2,
           coalesce(nullif(btrim(g.disposition), ''),
                    initcap(nullif(btrim(g.call_status), ''))),
           g.duration_seconds,
           coalesce(
             nullif(btrim(g.ghl_user_name), ''),
             nullif(btrim(concat_ws(' ', gc.first_name, gc.last_name)), '')
           ),
           null::text,
           -- spokeCall() in _shared/ghlCallSync.ts, restated. Keep in lockstep.
           (g.call_status = 'completed' and coalesce(g.duration_seconds, 0) >= 120)
      from windowed x
      join public.ghl_call_log g on g.deal_id = x.id
      left join public.closers gc on gc.ghl_user_id = g.ghl_user_id

    union all

    -- 3. activity_log call rows: every hand-logged dial (log_contact_attempt)
    --    plus the GHL hook's own mirror of (2), which the dedupe removes.
    select x.id, al.created_at, 'activity', 3,
           nullif(btrim(al.subject), ''),
           null::int,
           coalesce(
             nullif(btrim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
             (regexp_match(al.subject, '— by (.+)$'))[1]
           ),
           nullif(btrim(left(coalesce(al.content, ''), 160)), ''),
           -- A hand-logged row carries no duration, so it cannot meet the
           -- 2-minute bar. The other half of the badge's promise — "a human
           -- confirmed it" — is an open policy question, not plumbing.
           false
      from windowed x
      join public.activity_log al
        on al.entity_type = 'deal' and al.entity_id = x.id
       and al.interaction_type = 'call'
      left join public.profiles ap on ap.id = al.logged_by
  )
  -- THE canonical dedupe: a row dies only to a STRICTLY higher-ranked row on the
  -- same deal within 180s plus the keeper's own duration. Never within a source.
  select r.deal_id, r.at, r.source, r.src_rank, r.disposition, r.seconds, r.who,
         r.note, r.is_conversation
    from raw_calls r
   where not exists (
     select 1
       from raw_calls k
      where k.deal_id = r.deal_id
        and k.src_rank < r.src_rank
        and abs(extract(epoch from (k.at - r.at))) <= 180 + coalesce(k.seconds, 0)
   );
$function$;

revoke all on function public.deal_call_events(uuid[]) from public, anon, authenticated;
grant execute on function public.deal_call_events(uuid[]) to service_role;

comment on function public.deal_call_events(uuid[]) is
  'THE definition of the calls on a deal: wavv_calls (phone-matched inside the deal''s window) + ghl_call_log + activity_log ''call'' rows, deduped rank wavv>ghl>activity by 180s + the keeper''s duration, never within a source. Window: the deal''s whole ENGAGEMENT — no time cap backwards or forwards, bounded only by the previous and next genuine re-entry. A sibling deal for the same customer within 24 HOURS is a DUPLICATE, not a re-entry: it does not partition, so both records carry the one history. is_conversation marks a real two-way conversation per source (WAVV: outbound, >=120s, outcome <> VOICEMAIL; GHL: completed and >=120s; hand-logged: never). NO VISIBILITY CHECK — callers must authorise and filter the deal ids first, hence service_role only.';

-- ── realtime_lead_call_history returns BOTH counts ──────────────────────────

create or replace function public.realtime_lead_call_history(p_deal_ids uuid[])
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_ops   boolean;
  v_proc  boolean;
  v_ids   uuid[];
  v_out   jsonb;
  c_max_deals constant int := 200;
  c_max_calls constant int := 60;
begin
  if v_uid is null or not public.is_staff_reader(v_uid) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if p_deal_ids is null or array_length(p_deal_ids, 1) is null then
    return '{}'::jsonb;
  end if;
  if array_length(p_deal_ids, 1) > c_max_deals then
    raise exception 'Too many deals requested (max %)', c_max_deals using errcode = '22023';
  end if;

  v_ops := public.is_ops_staff(v_uid);
  -- A PROCESSOR works the WHOLE board (owner ruling; same exemption the deals
  -- RLS and the processor_* RPCs already carry).
  v_proc := public.is_processor(v_uid);

  -- The money wall's own SELECT predicate, re-stated. Ops staff see everything;
  -- a setter sees their own book plus unassigned.
  select array_agg(d.id) into v_ids
    from public.deals d
   where d.id = any (p_deal_ids)
     and (
       v_ops
       or v_proc
       or d.assigned_closer_id is null
       or d.assigned_closer_id = v_uid
       or d.created_by = v_uid
       or d.assigned_closer_id = any (public.my_closer_ids(v_uid))
     );

  if v_ids is null then
    return '{}'::jsonb;
  end if;

  with arrival as (
    select d.id, d.created_at from public.deals d where d.id = any (v_ids)
  ),
  numbered as (
    select e.*,
           -- Did this dial happen at or after the lead ARRIVED? The pace
           -- expectation is measured over the lead's age, so the attempts it is
           -- compared against must cover the same interval — a dial from a prior
           -- campaign is history, not work on this lead.
           (e.at >= a.created_at)                                        as since_arrival,
           row_number() over (partition by e.deal_id order by e.at desc) as rn,
           count(*)      over (partition by e.deal_id)                   as total
      from public.deal_call_events(v_ids) e
      join arrival a on a.id = e.deal_id
  )
  select coalesce(jsonb_object_agg(g.deal_id, g.payload), '{}'::jsonb)
    into v_out
  from (
    select w.id::text as deal_id,
           jsonb_build_object(
             -- LIFETIME. "Has anyone ever called this merchant?" — the count the
             -- row displays and the NEVER DIALED chip is judged on.
             'attempts', coalesce(max(n.total), 0),
             -- SINCE ARRIVAL. "Is this lead being worked?" — the pace deficit,
             -- the blazing tier and the 5-minute badge all read this one.
             'attempts_since_arrival', count(*) filter (where n.since_arrival),
             'last_at',          (array_agg(n.at          order by n.rn))[1],
             'last_disposition', (array_agg(n.disposition order by n.rn))[1],
             'last_by',          (array_agg(n.who         order by n.rn))[1],
             'last_source',      (array_agg(n.source      order by n.rn))[1],
             'calls', coalesce(
               jsonb_agg(
                 jsonb_build_object(
                   'at', n.at,
                   'source', n.source,
                   'disposition', n.disposition,
                   'seconds', n.seconds,
                   'who', n.who
                 ) order by n.rn
               ) filter (where n.rn <= c_max_calls),
               '[]'::jsonb)
           ) as payload
      from unnest(v_ids) as w(id)
      left join numbered n on n.deal_id = w.id
     group by w.id
  ) g;

  return v_out;
end;
$function$;

revoke all on function public.realtime_lead_call_history(uuid[]) from public, anon;
grant execute on function public.realtime_lead_call_history(uuid[]) to authenticated, service_role;

-- Re-derive spoke_at over the widened window.
select public.apply_spoke_at_from_calls(array(
  select distinct d.id
    from public.deals d
    join public.customers c on c.id = d.customer_id
    join public.wavv_calls w
      on c.phone is not null
     and right(regexp_replace(w.phone, '[^0-9]', '', 'g'), 10)
       = right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10)
     and right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10) <> ''
   where w.direction = 'outbound'
     and coalesce(w.seconds, 0) >= 120
     and upper(coalesce(w.outcome, '')) <> 'VOICEMAIL'
)) as deals_restamped;
