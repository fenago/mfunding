-- 20260916a — the HOT real-time leads panel tells the truth about who was called.
--
-- WHY. Owner report 2026-09-16: the 🔥 HOT panel in Setter Operations accused a
-- setter of never dialing a merchant they had actually called.
--
--   MF-2026-0337 (The Goldberg Group) — panel said "0 attempts — NEVER DIALED".
--   Reality: Kristine Gidoc dialed +1 702 354 5626 on 2026-09-15 18:13:29Z,
--   disposition "Voice Message", 7 seconds. Measured, in wavv_calls, today.
--
--   MF-2026-0330 (Lmt of San Diego) — panel said "1 attempt, last 9/14 22:37".
--   Reality: three real dials — one GHL/LeadConnector call by Ernesto Lee on
--   9/14 22:37, plus two WAVV dials on 9/15 at 19:59:58 and 20:00:28.
--
--   MF-2026-0334 (Garden View Townhomes) — panel's last-attempt stamp said
--   9/15 15:01; the newest real dial was 9/15 21:29.
--
-- The panel reads deals.contact_attempts / deals.last_attempt_at. Those columns
-- are fed by the GHL call telemetry path (ghl_apply_call_telemetry) and by the
-- processor's manual log buttons. They are NOT fed by WAVV — and WAVV is the
-- primary dialer. wavv_calls is keyed by PHONE, not deal_id, so nothing joined it
-- to the deal. Same misleading-surface class as the 14-day tracker bug fixed in
-- 20260904c_tracker_counts_wavv_calls.sql, which is this function's template.
--
-- A false "NEVER DIALED" is worse than no alarm at all: it teaches the team that
-- the flames are noise, and then the genuinely untouched live transfer — the most
-- expensive, most perishable lead MFunding buys — gets ignored with the rest.
--
-- WHAT THIS ADDS. realtime_lead_call_history(uuid[]) returns, per deal, the union
-- of every real call source, deduped across sources, with the individual calls so
-- the UI can render an absolute timestamp, who dialed, and a 14-day tracker.
--
-- ── SOURCE ATTRIBUTION (the multi-deal trap) ────────────────────────────────
-- ghl_call_log, activity_log and processor_touches are all keyed by deal_id, so
-- they attribute themselves. wavv_calls is keyed by phone, and a phone belongs to
-- a CUSTOMER, who may hold several deals — the customer_documents trap, where a
-- second deal inherits the first deal's history and both surfaces lie.
--
-- RULE: a WAVV dial is attributed to exactly ONE deal — the newest deal of that
-- customer that already existed when the call was placed, with a 30-minute
-- pre-birth grace. The grace exists because a WAVV call frequently CREATES the
-- deal (an "Appointment Set" disposition mints the opportunity after the call
-- ends), so the call legitimately precedes its own deal row by minutes; the same
-- allowance TouchTracker already makes for its day -1 cell. Each customer's
-- timeline is partitioned at every (created_at - 30 min) boundary, so the windows
-- neither overlap nor leave gaps: no call is double-counted and none is orphaned
-- onto a deal that did not exist yet. Measured 2026-09-16: 0 of the 20 real-time
-- deals in the live 7-day window sit on a customer with more than one deal, so
-- this rule currently changes nothing — it is here so that the first merchant who
-- comes back for a second advance does not poison both rows.
--
-- ── DEDUPE (two sources, one phone call) ────────────────────────────────────
-- The GHL event hook writes BOTH a ghl_call_log row and an activity_log
-- interaction_type='call' row for the same physical call: measured DB-wide today,
-- 763 of 776 activity_log call rows have a ghl_call_log twin. WAVV dials can also
-- be mirrored into ghl_call_log (3 such collisions live). Counting them twice
-- would replace a panel that undercounts with one that overcounts.
--
-- RULE: sources are ranked wavv(1) > ghl_call_log(2) > activity_log(3) >
-- processor_touches(4) — richest and closest to the dialer first. A row is dropped
-- when a row of STRICTLY BETTER rank on the same deal describes the same call.
-- "Same call" = timestamps within 180 seconds, widened by the keeper's duration,
-- because a mirror row is stamped when the call ENDS while ghl_call_log.called_at
-- is when it STARTS (Octave Consultancy: ghl_call_log 14:40:52 + 66s duration →
-- activity_log 14:42:13, an 81-second gap that a naive 60-second window misses).
-- Dedupe never applies WITHIN a source: two wavv_calls rows 30 seconds apart are
-- two genuine redials by a dialer, not one call written twice, and collapsing them
-- would recreate the undercount from the other direction.
--
-- ── AUTHORIZATION ───────────────────────────────────────────────────────────
-- SECURITY DEFINER, so it must re-derive visibility itself rather than trust the
-- deal ids it is handed. Gate is is_staff_reader() — the same gate get_deal_lite()
-- and find_customer_deals_lite() use. Beyond that, a plain setter gets history
-- only for deals the money wall (20260827_setter_deal_money_wall.sql) already lets
-- them SELECT: their own book plus the unassigned claim pool. Ops staff get all.
-- A deal the caller may not see is simply ABSENT from the result — never present
-- with a zero — so the UI can say "unreadable" instead of libelling a setter with
-- a "NEVER DIALED" it only invented because the row was hidden.

drop function if exists public.realtime_lead_call_history(uuid[]);

create function public.realtime_lead_call_history(p_deal_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_ops   boolean;
  v_out   jsonb;
  -- Matches ROW_CAP in HotLeadsPanel.tsx. A caller asking for more than the panel
  -- can render is not the panel.
  c_max_deals constant int := 200;
  -- Individual calls returned per deal. `attempts` is always the TRUE total, even
  -- when the array is capped — the count is never silently truncated.
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

  with visible as (
    -- The money wall's own SELECT predicate, re-stated. Ops staff see everything;
    -- a setter sees their own book plus unassigned. Anything else drops out here
    -- and therefore never appears in the result at all.
    select d.id, d.customer_id, d.created_at, c.phone
      from public.deals d
      join public.customers c on c.id = d.customer_id
     where d.id = any (p_deal_ids)
       and (
         v_ops
         or d.assigned_closer_id is null
         or d.assigned_closer_id = v_uid
         or d.created_by = v_uid
         or d.assigned_closer_id = any (public.my_closer_ids(v_uid))
       )
  ),
  -- Where this deal's claim on the customer's phone history ends: the next deal
  -- the same customer opened. Calls from then on belong to THAT deal.
  windowed as (
    select v.*,
           (select min(d2.created_at)
              from public.deals d2
             where d2.customer_id = v.customer_id
               and d2.created_at > v.created_at) as next_deal_at
      from visible v
  ),
  raw_calls as (
    -- 1. WAVV — the primary dialer. Phone-keyed, so attributed by the window above.
    select w.started_at                                   as at,
           'wavv'::text                                   as source,
           1                                              as rank,
           -- WAVV writes the literal string 'None' when the setter hung up
           -- without picking a disposition row. Rendering "— None" next to a call
           -- reads as a result; falling through to the outcome ("No Answer",
           -- "User Hung Up") says what actually happened.
           coalesce(
             nullif(nullif(btrim(w.disposition), ''), 'None'),
             initcap(replace(lower(coalesce(w.outcome, 'call')), '_', ' '))
           )                                              as disposition,
           w.seconds                                      as seconds,
           -- agent_name is NULL on every one of the 34,715 live wavv_calls rows,
           -- so closers.ghl_user_id is the ONLY way this row can say who dialed.
           coalesce(
             nullif(btrim(w.agent_name), ''),
             nullif(btrim(concat_ws(' ', wc.first_name, wc.last_name)), '')
           )                                              as who,
           x.id                                           as deal_id
      from windowed x
      join public.wavv_calls w
        on x.phone is not null
       and right(regexp_replace(w.phone, '[^0-9]', '', 'g'), 10)
         = right(regexp_replace(x.phone, '[^0-9]', '', 'g'), 10)
       and w.started_at >= x.created_at - interval '30 minutes'
       and (x.next_deal_at is null
            or w.started_at < x.next_deal_at - interval '30 minutes')
      left join public.closers wc on wc.ghl_user_id = w.agent_key

    union all

    -- 2. GHL / LeadConnector calls, already keyed to the deal.
    select g.called_at, 'ghl', 2,
           coalesce(nullif(btrim(g.disposition), ''),
                    initcap(nullif(btrim(g.call_status), ''))),
           g.duration_seconds,
           coalesce(
             nullif(btrim(g.ghl_user_name), ''),
             nullif(btrim(concat_ws(' ', gc.first_name, gc.last_name)), '')
           ),
           x.id
      from windowed x
      join public.ghl_call_log g on g.deal_id = x.id
      left join public.closers gc on gc.ghl_user_id = g.ghl_user_id

    union all

    -- 3. activity_log call rows. Mostly the GHL hook's own mirror of (2) and
    --    deduped away below, but 12 rows live have no ghl_call_log twin, so the
    --    source has to stay in the union or those calls vanish.
    select al.created_at, 'activity', 3,
           nullif(btrim(al.subject), ''),
           null::int,
           coalesce(
             nullif(btrim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
             (regexp_match(al.subject, '— by (.+)$'))[1]
           ),
           x.id
      from windowed x
      join public.activity_log al
        on al.entity_type = 'deal' and al.entity_id = x.id
       and al.interaction_type = 'call'
      left join public.profiles ap on ap.id = al.logged_by

    union all

    -- 4. The processor drawer's manual "log a contact" buttons. A logged
    --    "No answer" is an attempt — the tracker measures effort, not pickups.
    select t.touched_at, 'manual', 4,
           nullif(btrim(t.outcome), ''),
           null::int,
           nullif(btrim(concat_ws(' ', tp.first_name, tp.last_name)), ''),
           x.id
      from windowed x
      join public.processor_touches t on t.deal_id = x.id
      left join public.profiles tp on tp.id = t.touched_by
  ),
  deduped as (
    select r.*
      from raw_calls r
     where not exists (
       select 1
         from raw_calls k
        where k.deal_id = r.deal_id
          and k.rank < r.rank
          and abs(extract(epoch from (k.at - r.at)))
              <= 180 + coalesce(k.seconds, 0)
     )
  ),
  numbered as (
    select d.*,
           row_number() over (partition by d.deal_id order by d.at desc) as rn,
           count(*)      over (partition by d.deal_id)                   as total
      from deduped d
  )
  select coalesce(jsonb_object_agg(g.deal_id, g.payload), '{}'::jsonb)
    into v_out
  from (
    select w.id::text as deal_id,
           jsonb_build_object(
             'attempts', coalesce(max(n.total), 0),
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
      from windowed w
      left join numbered n on n.deal_id = w.id
     group by w.id
  ) g;

  return v_out;
end;
$function$;

revoke all on function public.realtime_lead_call_history(uuid[]) from public, anon;
grant execute on function public.realtime_lead_call_history(uuid[]) to authenticated, service_role;

comment on function public.realtime_lead_call_history(uuid[]) is
  'TRUE call history for a set of deals: wavv_calls (phone-matched, attributed to the newest deal alive at call time with a 30-min pre-birth grace) unioned with ghl_call_log, activity_log call rows and processor_touches, deduped across sources (wavv > ghl > activity > manual, 180s + duration window) but never within one. Returns {deal_id: {attempts, last_at, last_disposition, last_by, last_source, calls[]}}. Feeds the HOT real-time leads panel, which used to read deals.contact_attempts and therefore missed every WAVV dial. Gated on is_staff_reader(); a deal the caller may not see is ABSENT from the result, never present with a zero.';
