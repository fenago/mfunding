-- Restore attempts_since_arrival to realtime_lead_call_history — it was dropped
-- by a rebuild, and everything that asks "is this lead being worked NOW" has been
-- silently answering with the merchant's LIFETIME count ever since.
--
-- ═══ WHAT HAPPENED ══════════════════════════════════════════════════════════
--
-- 20260916m added a second count to this function. `attempts` is LIFETIME — has
-- anyone ever called this merchant — and is the only count NEVER DIALED may be
-- judged on. `attempts_since_arrival` counts dials at or after deals.created_at,
-- and it alone may drive pace, the blazing tier and the 5-minute speed-to-lead
-- badge, because expectedAttempts() is a pace over the lead's AGE and the
-- numerator has to cover the same interval.
--
-- 20260918d then added disposition_source to this function by rewriting it from
-- the 20260916a-era body. The `arrival` CTE and the `attempts_since_arrival` key
-- were not in that body, so both vanished. Nothing failed: the key simply stopped
-- appearing in the JSON, the TypeScript type still declared it REQUIRED, and
-- every reader got `undefined`.
--
-- This is the `recreate-a-function-from-the-catalog` rule, paid for a second
-- time. pg_get_functiondef first, always — a migration file is what the function
-- looked like once, not what it looks like now. The body below IS the live
-- catalog definition (disposition_source and all) with the arrival cut put back.
--
-- ═══ WHAT IT COST, WHICH IS NOT JUST A BADGE ════════════════════════════════
--
-- leadHeat() falls back to the lifetime count when attempts_since_arrival is
-- absent. So since 2026-09-18 the pace deficit has been measured against every
-- dial we ever made to that merchant, which is precisely the regression 20260916m
-- was written to fix: MF-2026-0349 scoring 5 attempts instead of 1, and a
-- brand-new untouched transfer sliding from BURNING down to COOL because we
-- happened to call the same business off a purchased list last month. The
-- "blazing" tier — untouched in its first hour, the loudest alarm this panel has
-- — could not fire for any merchant with prior history at all.
--
-- And in HotLeadsPanel the 5-minute window badge is gated on
-- `attempts_since_arrival === 0`. `undefined === 0` is false, so that badge has
-- never once appeared.
--
-- ═══ WHY THE CUT IS MADE HERE AND NOT INSIDE deal_call_events ═══════════════
--
-- deal_call_events' window scopes the WAVV branch ONLY, because WAVV is
-- phone-keyed and has to be attributed to a deal. ghl_call_log and activity_log
-- rows are deal-keyed and pass through unwindowed, so they routinely predate the
-- deal — 91 deals carried deal-keyed call rows older than the deal itself when
-- this was measured. Cutting inside the window would have looked right and fixed
-- none of them. The cut belongs on the unified stream, which is here.

create or replace function public.realtime_lead_call_history(p_deal_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
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
  v_proc := public.is_processor(v_uid);

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
             -- count(*) filter over a LEFT JOIN is 0 for a deal with no calls at
             -- all, which is the correct answer and not a missing read: absence
             -- from the returned map is what means unreadable.
             'attempts_since_arrival', count(*) filter (where n.since_arrival),
             'last_at',          (array_agg(n.at          order by n.rn))[1],
             'last_disposition', (array_agg(n.disposition order by n.rn))[1],
             'last_disposition_source',
                                 (array_agg(n.disposition_source order by n.rn))[1],
             'last_by',          (array_agg(n.who         order by n.rn))[1],
             'last_source',      (array_agg(n.source      order by n.rn))[1],
             'calls', coalesce(
               jsonb_agg(
                 jsonb_build_object(
                   'at', n.at,
                   'source', n.source,
                   'disposition', n.disposition,
                   'disposition_source', n.disposition_source,
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

comment on function public.realtime_lead_call_history(uuid[]) is
  'Hot Leads call history, money-walled (own book + unassigned for a plain closer; ops and processors see any deal). Returns TWO counts per deal and they are not interchangeable: `attempts` is LIFETIME — "has anyone ever called this merchant", what the row displays and the only count NEVER DIALED may be judged on; `attempts_since_arrival` counts events at or after deals.created_at — "is this lead being worked NOW", and it alone drives the pace deficit, the blazing tier and the 5-minute speed-to-lead badge, because expectedAttempts() is a pace over the lead''s age and the numerator must cover the same interval. The arrival cut is applied to the unified event stream on purpose: deal-keyed GHL rows routinely predate the deal, so cutting inside deal_call_events'' window would have missed them entirely. RESTORED 20260930b after 20260918d rebuilt this body from a stale migration and silently dropped the key — pg_get_functiondef before any rewrite.';
