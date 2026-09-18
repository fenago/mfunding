-- Derive the disposition a setter forgot to type — from the artifact, never from the stage.
--
-- OWNER QUESTION (2026-09-18): "Even if she didn't disposition the call, if you
-- already know that she was on a call with him and an application was sent, how
-- can we fix that gap? Assume that she does forget."
--
-- THE CASE. MF-2026-0385, Miami Concierge Network / Rafael Badia. Catherine
-- dialled 17:59:37Z and the application went out 18:11:24Z — twelve minutes
-- later, by her, recorded. wavv_calls.disposition is NULL, so the funnel scored
-- that conversation as nothing and the owner went looking for a merchant the
-- board said didn't exist.
--
-- You cannot send someone an application without having talked to them. The
-- application IS the evidence. This layer reads that evidence back onto the
-- call — and marks forever that it did.
--
-- ═══ WHAT COUNTS AS EVIDENCE, AND WHAT DOES NOT ══════════════════════════════
--
-- An evidence class needs TWO things: a MOMENT the artifact was created, and an
-- AUTHOR who created it. Without an author, rule 5 — attribute to the setter who
-- actually made the call — cannot be checked, and the derivation degenerates into
-- a gift to whoever happens to own the deal.
--
--   application_sent  moment = deals.application_sent_at
--                     author = deals.application_sent_by, and ONLY at the
--                              'recorded' / 'inferred' (±10 min) rungs of the
--                              attribution ladder. 'inferred_same_day' is a ±24 h
--                              guess and NULL falls back to the deal's owner
--                              ('assumed_owner'), which is ownership restated,
--                              not evidence. Both are refused here.
--   appointment       moment = deals.appointment_synced_at — when the booking was
--                              RECORDED. Deliberately NOT appointment_at, which is
--                              when the meeting HAPPENS: that is a FUTURE
--                              timestamp, and using it would date the conversation
--                              to next Tuesday. Measured: 0 deals carry either
--                              column today, so this class is inert but correctly
--                              specified for the day it starts being used.
--                     author = deals.appointment_owner_user_id.
--
-- ── qualified_at IS NOT EVIDENCE, AND THIS IS THE MEASUREMENT ────────────────
-- The brief named qualified_at as a third class. Live data refuses it:
--
--   • It has NO author column anywhere in the schema, so rule 5 is uncheckable.
--   • It is the stage-move stamp for 'qualifying' — the very thing the brief
--     said not to derive from ("stages get moved for many reasons, including by
--     the GHL mirror").
--   • It is very often not even a move. deals_stamp_stage_timestamps() BACKFILLS
--     every lower rung when a deal lands on a higher one, using one `ts` for all
--     of them. Of 94 non-null qualified_at values: 44 are byte-identical to
--     contacted_at (both written by one trigger run) and 14 are byte-identical to
--     application_sent_at (a shadow of the send, not independent of it).
--   • On the four deals the brief offered as proof, it is an artifact every time:
--       MF-2026-0237  qualified_at 13 MILLISECONDS before created_at
--       MF-2026-0261  qualified_at 13 MILLISECONDS before created_at  (and the
--                     deal was created by the GHL mirror — 'lead:auto-assigned'
--                     + 'ghl:OpportunityStageUpdate:created', no human in it)
--       MF-2026-0267  qualified_at = contacted_at exactly
--       MF-2026-0385  qualified_at = application_sent_at exactly
--     Deriving from those would credit a setter for a deal having been CREATED,
--     by the mirror, at the qualifying stage. That is deriving from nothing.
--
-- So this layer drops qualified_at. MF-2026-0237, 0261 and 0267 therefore do NOT
-- gain a derived disposition: there is no artifact and no author behind them.
--
-- ═══ THE WINDOW: 45 MINUTES, CHOSEN FROM THE DATA ════════════════════════════
--
-- Every (undispositioned call → author-bearing outcome) gap in 90 days, minutes:
--
--     11.8  14.9  17.1  29.1  29.3  │  153.4  │  1388.8
--     └──────── one cluster ────────┘   ↑          ↑
--                                    2h 33m      23h
--
-- The cluster ends at 29.3 and the next observation is 5.2× further out. Any cut
-- between 30 and 153 selects exactly the same five pairs, so the choice is about
-- margin, not about which rows survive:
--   • 30 would sit 0.7 min from the largest true positive — one slow send and a
--     real conversation drops out.
--   • 120 (the 2 h used to scope the problem) sits only 33 min from the nearest
--     non-adjacent pair. Thin.
--   • 45 sits inside the empty band with ~15 min of headroom above the cluster
--     and a 3.4× margin below the nearest false positive. It also means something
--     in the real world: a setter sends the application from the same seat at the
--     end of the call. 45 minutes is the outer edge of one sitting, and it is
--     shorter than a lunch break, so a post-break send cannot inherit a pre-break
--     dial.
--
-- ═══ THE NEAREST-CALL RULE (this is what makes it safe) ══════════════════════
--
-- An outcome attaches to THE SINGLE MOST RECENT DIAL BEFORE IT — from EITHER
-- dialer, WAVV or a GHL click-to-call — inside the window. Then:
--   • that call already has a typed disposition  → derive NOTHING. The setter
--     already answered; the typed value stands and the outcome is accounted for.
--   • that call is a GHL row                     → derive NOTHING. ghl_call_log
--     has no disposition a human ever fills (2 of 521 rows), so there is no hole
--     to fill and inventing one would fabricate a concept GHL does not have. It
--     still BLOCKS, which is the point: a GHL call nearer the send must not let
--     an older WAVV hole claim the credit.
--   • the dialer and the author are different people → derive NOTHING.
--   • otherwise                                  → derive.
--
-- THIS RULE VALIDATES ITSELF ON THE LIVE DATA. Run it over 90 days and 7 of the
-- 11 outcomes land on a call the setter DID disposition — as "Full Application"
-- (×4), "Partial Application", "Appointment Set", "Voice Message". Where the
-- setter answered, the rule independently picks exactly the call they answered
-- about. That is why it can be trusted where they didn't.
--
-- Two live examples of it refusing:
--   MF-2026-0256  the send is 14.0 min after a 787-second call typed "Full
--                 Application" and 14.9 min after a 'None' stub 52 seconds
--                 earlier. The typed call is nearer; nothing is derived.
--   MF-2026-0366  the send is 4.3 min after a call typed "Partial Application".
--                 Without this rule the 23-hour-old 'None' row would have stolen
--                 credit from a disposition the setter actually typed.
--   MF-2026-0336  Kristine dialled, Catherine sent the application 29 min later.
--                 Crediting either of them would be a gift. Nothing is derived,
--                 and the pair is visible in v_setter_dial_calls_derivation_audit.
--
-- ═══ 'None' IS A HOLE, NOT A TYPED VALUE ═════════════════════════════════════
-- WAVV writes the literal string 'None' when the setter hangs up without picking
-- a row — deal_call_events() has always treated it that way. So the hole set is
-- {NULL, '', 'None'} and a derivation may fill it. 'Agent Canceled' is NOT in the
-- set: the setter chose it.
--
-- ═══ WHAT THE DERIVED VALUE SAYS ═════════════════════════════════════════════
-- 'Application Sent'. WAVV has never written that string — verified across all of
-- wavv_calls.disposition and disposition_original — so the VALUE ITSELF is a
-- second, independent guarantee that the row is derived, on top of
-- disposition_source. It is deliberately weaker than 'Full Application': the
-- evidence says an application went out, not that a complete one came back, and
-- the Applications rung already counts these deals from application_sent_at
-- directly. Claiming 'Full Application' here would double-count the same send in
-- two different rungs.
-- The appointment class derives 'Appointment Set', which is exactly what a
-- booking is; it is an existing WAVV value, so there it is disposition_source
-- alone that marks it (the class has no rows today).
--
-- ═══ WHAT THIS DOES NOT TOUCH ════════════════════════════════════════════════
--   • wavv_calls.disposition — NEVER written. It is the setter's own record and
--     stays exactly what they typed, including empty. This is all views.
--   • deals.spoke_at — NOT derived. It has its own duration rule and a
--     merchant-facing meaning (memory: call-telemetry-is-four-sources).
--   • v_setter_dial_calls.disposition — UNCHANGED passthrough, 'None' included.
--     Every existing reader returns the same number after this migration. The
--     derived value lives in the NEW column disposition_effective, so no surface
--     can start printing a derived value without someone choosing to read it.

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. THE ONE CANONICAL DERIVATION
-- ════════════════════════════════════════════════════════════════════════════
-- security_invoker: deals/customers RLS still governs which outcomes are
-- visible. An admin (the only role that can open Setter Performance) reads all
-- of them. Inside the SECURITY DEFINER deal_call_events() it runs as the
-- function owner, which is how that helper already reads these tables.

drop view if exists public.v_wavv_derived_dispositions cascade;

create view public.v_wavv_derived_dispositions
with (security_invoker = true) as
with deal_phone as (
  select
    d.id                                                                  as deal_id,
    d.deal_number,
    d.created_at,
    right(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'), 10)   as ph10,
    -- Where this deal's claim on the customer's phone history ends — the same
    -- window deal_call_events() uses, so the two cannot disagree about which
    -- deal a dial belongs to.
    (select min(d2.created_at)
       from public.deals d2
      where d2.customer_id = d.customer_id
        and d2.created_at > d.created_at)                                 as next_deal_at,
    d.application_sent_at, d.application_sent_by, d.application_sent_attribution,
    d.appointment_synced_at, d.appointment_owner_user_id
  from public.deals d
  join public.customers c on c.id = d.customer_id
),
outcome as (
  select
    dp.deal_id, dp.deal_number, dp.ph10, dp.created_at, dp.next_deal_at,
    e.kind, e.at, e.author
  from deal_phone dp
  cross join lateral (values
    ('application_sent', dp.application_sent_at,   dp.application_sent_by,
       (dp.application_sent_attribution in ('recorded', 'inferred'))),
    ('appointment',      dp.appointment_synced_at, dp.appointment_owner_user_id, true)
  ) as e(kind, at, author, rung_ok)
  where e.at is not null
    and e.author is not null
    and e.rung_ok
    and dp.ph10 <> ''
),
-- THE NEAREST PRECEDING DIAL, from either dialer.
paired as (
  select
    o.deal_id, o.deal_number, o.kind, o.at as outcome_at, o.author,
    n.call_key, n.src, n.call_at, n.typed, n.setter_id,
    extract(epoch from (o.at - n.call_at)) / 60.0 as gap_min
  from outcome o
  join lateral (
    select a.call_key, a.src, a.call_at, a.typed, a.setter_id
    from (
      select w.wavv_call_id                                          as call_key,
             'wavv'::text                                            as src,
             w.started_at                                            as call_at,
             nullif(nullif(btrim(w.disposition), ''), 'None')        as typed,
             m.setter_id
        from public.wavv_calls w
        left join public.wavv_caller_setters m on m.caller_id = w.caller_id
       where w.direction = 'outbound'
         and w.phone is not null
         and right(regexp_replace(w.phone, '[^0-9]', '', 'g'), 10) = o.ph10
         and w.started_at >= o.created_at - interval '30 minutes'
         and (o.next_deal_at is null
              or w.started_at < o.next_deal_at - interval '30 minutes')

      union all

      -- GHL click-to-calls. Present ONLY so they can block: a GHL dial nearer
      -- the outcome must stop an older WAVV hole from claiming it.
      select 'ghl:' || g.ghl_message_id, 'ghl', g.called_at,
             nullif(btrim(g.disposition), ''), cl.user_id
        from public.ghl_call_log g
        left join public.closers cl on cl.ghl_user_id = g.ghl_user_id
       where g.direction = 'outbound'
         and g.deal_id = o.deal_id
         and g.called_at is not null
    ) a
    where a.call_at <= o.at
      and a.call_at >= o.at - interval '45 minutes'
    order by a.call_at desc
    limit 1
  ) n on true
)
-- distinct on (call_key): one call can be the nearest dial before BOTH an
-- application and an appointment. Without this the left join downstream would
-- emit that dial twice and inflate every count built on it. Nearest outcome wins.
select distinct on (p.call_key)
  p.call_key                              as wavv_call_id,
  p.deal_id,
  p.deal_number,
  p.kind                                  as evidence_kind,
  p.outcome_at                            as disposition_derived_at,
  p.setter_id,
  case p.kind
    when 'appointment' then 'Appointment Set'
    else 'Application Sent'
  end                                     as derived_disposition,
  -- Reads as a full sentence in a tooltip, and always names the artifact, the
  -- delay and the person — never just "derived".
  'derived from the '
    || case p.kind when 'appointment' then 'appointment booked ' else 'application sent ' end
    || case
         when p.gap_min < 1 then 'moments'
         else round(p.gap_min)::text || ' minute' || case when round(p.gap_min) = 1 then '' else 's' end
       end
    || ' later'
    || coalesce(' — ' || nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''), '')
                                          as disposition_derived_reason,
  round(p.gap_min::numeric, 1)            as disposition_derived_gap_min
from paired p
left join public.profiles pr on pr.id = p.author
where p.src = 'wavv'            -- only WAVV rows have a disposition to fill
  and p.typed is null           -- rule 3: NEVER overwrite a typed disposition
  and p.setter_id is not null   -- an unattributed dial cannot be matched to an author
  and p.setter_id = p.author    -- rule 5: the outcome must belong to the dialer
order by p.call_key, p.gap_min asc;

revoke all on public.v_wavv_derived_dispositions from public, anon;
grant select on public.v_wavv_derived_dispositions to authenticated, service_role;

comment on view public.v_wavv_derived_dispositions is
  'THE canonical derivation: a WAVV dial with no typed disposition (NULL, empty, or WAVV''s literal ''None'') earns a DERIVED one when it is the most recent dial — from either dialer — within 45 minutes before an author-bearing outcome on the same deal, and the outcome''s author is the same person who dialled. Evidence classes: application_sent (moment application_sent_at, author application_sent_by at the recorded/inferred rungs only) and appointment (moment appointment_synced_at — NOT appointment_at, which is in the future — author appointment_owner_user_id). qualified_at is deliberately NOT an evidence class: it has no author column and 58 of 94 values are trigger back-stamps identical to contacted_at or application_sent_at. Never writes wavv_calls.disposition. One row per call (distinct on), so joining it can never duplicate a dial.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. AUDIT — why a near-miss was refused
-- ════════════════════════════════════════════════════════════════════════════
-- The brief: "If a setter typed 'No Answer' and an application went out an hour
-- later, the typed value wins and the contradiction is worth surfacing, not
-- silently resolving." Every outcome that found a preceding dial appears here
-- with the verdict, so a refusal is visible rather than absent.

drop view if exists public.v_setter_dial_calls_derivation_audit cascade;

create view public.v_setter_dial_calls_derivation_audit
with (security_invoker = true) as
with deal_phone as (
  select d.id as deal_id, d.deal_number, d.created_at,
         right(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'), 10) as ph10,
         (select min(d2.created_at) from public.deals d2
           where d2.customer_id = d.customer_id and d2.created_at > d.created_at) as next_deal_at,
         d.application_sent_at, d.application_sent_by, d.application_sent_attribution,
         d.appointment_synced_at, d.appointment_owner_user_id
    from public.deals d
    join public.customers c on c.id = d.customer_id
),
outcome as (
  select dp.deal_id, dp.deal_number, dp.ph10, dp.created_at, dp.next_deal_at,
         e.kind, e.at, e.author, e.rung_ok
    from deal_phone dp
    cross join lateral (values
      ('application_sent', dp.application_sent_at,   dp.application_sent_by,
         (dp.application_sent_attribution in ('recorded', 'inferred'))),
      ('appointment',      dp.appointment_synced_at, dp.appointment_owner_user_id, true)
    ) as e(kind, at, author, rung_ok)
   where e.at is not null and dp.ph10 <> ''
)
select
  n.call_key            as wavv_call_id,
  o.deal_number,
  o.kind                as evidence_kind,
  o.at                  as outcome_at,
  n.call_at,
  round((extract(epoch from (o.at - n.call_at)) / 60.0)::numeric, 1) as gap_min,
  n.src                 as call_source,
  n.typed               as typed_disposition,
  n.setter_id           as dialled_by,
  o.author              as outcome_by,
  case
    when o.author is null            then 'refused: the outcome has no author'
    -- `is not true`, not `not`: application_sent_attribution is NULL at rung 4
    -- (assumed_owner), and NULL would fall through this CASE instead of refusing.
    when o.rung_ok is not true       then 'refused: attribution is a same-day guess or the deal owner, not evidence'
    when n.src <> 'wavv'             then 'refused: the nearest dial is a GHL click-to-call, which has no disposition to fill'
    when n.typed is not null         then 'refused: the nearest dial is already dispositioned "' || n.typed || '" — the typed value wins'
    when n.setter_id is null         then 'refused: the dial is not attributed to any setter'
    when n.setter_id <> o.author     then 'refused: a different person produced the outcome'
    else 'derived'
  end                   as verdict
from outcome o
join lateral (
  select a.call_key, a.src, a.call_at, a.typed, a.setter_id
  from (
    select w.wavv_call_id, 'wavv'::text, w.started_at,
           nullif(nullif(btrim(w.disposition), ''), 'None'), m.setter_id
      from public.wavv_calls w
      left join public.wavv_caller_setters m on m.caller_id = w.caller_id
     where w.direction = 'outbound' and w.phone is not null
       and right(regexp_replace(w.phone, '[^0-9]', '', 'g'), 10) = o.ph10
       and w.started_at >= o.created_at - interval '30 minutes'
       and (o.next_deal_at is null or w.started_at < o.next_deal_at - interval '30 minutes')
    union all
    select 'ghl:' || g.ghl_message_id, 'ghl', g.called_at,
           nullif(btrim(g.disposition), ''), cl.user_id
      from public.ghl_call_log g
      left join public.closers cl on cl.ghl_user_id = g.ghl_user_id
     where g.direction = 'outbound' and g.deal_id = o.deal_id and g.called_at is not null
  ) a(call_key, src, call_at, typed, setter_id)
  where a.call_at <= o.at and a.call_at >= o.at - interval '45 minutes'
  order by a.call_at desc
  limit 1
) n on true;

revoke all on public.v_setter_dial_calls_derivation_audit from public, anon;
grant select on public.v_setter_dial_calls_derivation_audit to authenticated, service_role;

comment on view public.v_setter_dial_calls_derivation_audit is
  'Every outcome that found a dial within 45 minutes before it, and the verdict — derived, or the exact reason it was refused. A typed disposition that contradicts a later outcome (e.g. "No Answer" then an application) shows here as refused rather than being silently resolved.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. v_setter_dial_calls GAINS FOUR COLUMNS — AND CHANGES NONE
-- ════════════════════════════════════════════════════════════════════════════
-- `disposition` keeps its exact current meaning (raw passthrough, 'None'
-- included) so every existing reader returns the same number. Counters opt in
-- by reading `disposition_effective` and rendering the marker from
-- `disposition_source`.

drop view if exists public.v_setter_dial_calls;

create view public.v_setter_dial_calls
with (security_invoker = true) as

  -- ── 1. WAVV ───────────────────────────────────────────────────────────────
  select
    v.wavv_call_id,
    'wavv'::text                as source,
    v.started_at,
    v.answered_at,
    v.ended_at,
    v.seconds,
    v.outcome,
    v.disposition,
    -- What a COUNTER should use. Typed wins; a derivation only ever fills a hole.
    coalesce(nullif(nullif(btrim(v.disposition), ''), 'None'),
             dd.derived_disposition)          as disposition_effective,
    case
      when nullif(nullif(btrim(v.disposition), ''), 'None') is not null then 'typed'
      when dd.derived_disposition is not null                           then 'derived'
    end                                       as disposition_source,
    dd.disposition_derived_reason,
    dd.disposition_derived_at,
    v.human,
    v.recorded,
    v.phone,
    v.contact_id,
    v.contact_name,
    v.campaign_id,
    v.caller_id,
    v.setter_id,
    v.caller_label,
    v.mapping_source,
    v.setter_name,
    v.setter_email,
    v.is_attributed,
    v.note,
    v.summary
  from public.v_wavv_outbound_setter_calls v
  left join public.v_wavv_derived_dispositions dd on dd.wavv_call_id = v.wavv_call_id

  union all

  -- ── 2. GHL / LeadConnector click-to-calls ─────────────────────────────────
  select
    'ghl:' || g.ghl_message_id  as wavv_call_id,
    'ghl'::text                 as source,
    g.called_at                 as started_at,
    case when g.call_status in ('completed', 'voicemail') then g.called_at end as answered_at,
    case
      when g.call_status in ('completed', 'voicemail') and coalesce(g.duration_seconds, 0) > 0
        then g.called_at + make_interval(secs => g.duration_seconds)
    end                         as ended_at,
    g.duration_seconds          as seconds,
    g.call_status               as outcome,
    nullif(btrim(g.disposition), '') as disposition,
    -- GHL rows are never derived onto: ghl_call_log has no disposition a human
    -- fills (2 of 521 rows), so there is no hole in the sense this layer means.
    -- Whatever GHL does hold is 'typed' — it came from a person in GHL's UI.
    nullif(btrim(g.disposition), '') as disposition_effective,
    case when nullif(btrim(g.disposition), '') is not null then 'typed' end as disposition_source,
    null::text                  as disposition_derived_reason,
    null::timestamptz           as disposition_derived_at,
    null::boolean               as human,
    null::boolean               as recorded,
    nullif(right(regexp_replace(coalesce(g.to_number, ''), '[^0-9]', '', 'g'), 10), '') as phone,
    g.ghl_contact_id            as contact_id,
    coalesce(
      nullif(btrim(cu.business_name), ''),
      nullif(btrim(concat_ws(' ', cu.first_name, cu.last_name)), '')
    )                           as contact_name,
    null::text                  as campaign_id,
    nullif(right(regexp_replace(coalesce(g.from_number, ''), '[^0-9]', '', 'g'), 10), '') as caller_id,
    cl.user_id                  as setter_id,
    'GHL / LeadConnector line'::text as caller_label,
    'ghl_user'::text            as mapping_source,
    coalesce(sd.name, nullif(btrim(g.ghl_user_name), '')) as setter_name,
    p.email                     as setter_email,
    cl.user_id is not null      as is_attributed,
    null::text                  as note,
    null::text                  as summary
  from public.ghl_call_log g
  left join public.deals d      on d.id = g.deal_id
  left join public.customers cu on cu.id = d.customer_id
  left join public.closers cl   on cl.ghl_user_id = g.ghl_user_id
  left join public.staff_directory sd on sd.id = cl.user_id
  left join public.profiles p   on p.id = cl.user_id
  where g.direction = 'outbound'
    and g.called_at is not null
    and not exists (
      select 1
        from public.wavv_calls w
       where w.direction = 'outbound'
         and w.phone is not null
         and right(regexp_replace(w.phone, '[^0-9]', '', 'g'), 10)
           = right(regexp_replace(coalesce(g.to_number, ''), '[^0-9]', '', 'g'), 10)
         and right(regexp_replace(coalesce(g.to_number, ''), '[^0-9]', '', 'g'), 10) <> ''
         and w.started_at between g.called_at - interval '1 hour'
                             and g.called_at + interval '1 hour'
         and abs(extract(epoch from (w.started_at - g.called_at))) <= 180 + coalesce(w.seconds, 0)
    );

revoke all on public.v_setter_dial_calls from public, anon;
grant select on public.v_setter_dial_calls to authenticated, service_role;

comment on view public.v_setter_dial_calls is
  'EVERY outbound setter dial, from both dialers: v_wavv_outbound_setter_calls unioned with outbound ghl_call_log click-to-calls, with the GHL rows deduped against WAVV (same merchant phone within 180s + the WAVV call''s duration; WAVV wins). `source` says which system the row came from. GHL rows carry honest NULLs where GHL has no equivalent concept — human, recorded, and (on 519 of 521 rows) disposition. GHL attribution is direct (ghl_user_id -> closers.ghl_user_id -> closers.user_id). DISPOSITIONS: `disposition` is the RAW value, unchanged forever — exactly what the setter typed, WAVV''s literal ''None'' included. `disposition_effective` is what a COUNTER should read: the typed value, or a derived one from v_wavv_derived_dispositions when the setter left the hole and an application/appointment proves the conversation happened. `disposition_source` is ''typed'' | ''derived'' | NULL and MUST be rendered wherever the value is — a derived disposition may never print as though a setter typed it. `disposition_derived_reason` is a full sentence naming the artifact, the delay and the person. security_invoker: both source tables'' RLS still applies.';

-- ════════════════════════════════════════════════════════════════════════════
-- 4. deal_call_events() — the touch tracker learns the same vocabulary
-- ════════════════════════════════════════════════════════════════════════════
-- Return type changes, so this is a drop/create. The three RPCs that call it
-- resolve it by name at runtime and need no coordinated deploy; processor_deal_detail
-- is updated below so a derived value cannot render as a typed one there either.

drop function if exists public.deal_call_events(uuid[]);

create function public.deal_call_events(p_deal_ids uuid[])
returns table (
  deal_id            uuid,
  at                 timestamptz,
  source             text,
  src_rank           int,
  disposition        text,
  seconds            int,
  who                text,
  note               text,
  disposition_source text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with windowed as (
    select d.id, d.customer_id, d.created_at, c.phone,
           (select min(d2.created_at)
              from public.deals d2
             where d2.customer_id = d.customer_id
               and d2.created_at > d.created_at) as next_deal_at
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
           -- Typed first. Then a DERIVED disposition, when an application or an
           -- appointment proves the conversation the setter never typed. Only
           -- then does it fall through to WAVV's raw outcome.
           coalesce(
             nullif(nullif(btrim(w.disposition), ''), 'None'),
             dd.derived_disposition,
             initcap(replace(lower(coalesce(w.outcome, 'call')), '_', ' '))
           )                                              as disposition,
           w.seconds                                      as seconds,
           coalesce(
             nullif(btrim(w.agent_name), ''),
             nullif(btrim(concat_ws(' ', wc.first_name, wc.last_name)), '')
           )                                              as who,
           nullif(btrim(coalesce(w.note, '')), '')        as note,
           case
             when nullif(nullif(btrim(w.disposition), ''), 'None') is not null then 'typed'
             when dd.derived_disposition is not null                           then 'derived'
           end                                            as disposition_source
      from windowed x
      join public.wavv_calls w
        on x.phone is not null
       and right(regexp_replace(w.phone, '[^0-9]', '', 'g'), 10)
         = right(regexp_replace(x.phone, '[^0-9]', '', 'g'), 10)
       and w.started_at >= x.created_at - interval '30 minutes'
       and (x.next_deal_at is null
            or w.started_at < x.next_deal_at - interval '30 minutes')
      left join public.closers wc on wc.ghl_user_id = w.agent_key
      left join public.v_wavv_derived_dispositions dd on dd.wavv_call_id = w.wavv_call_id

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
           case when nullif(btrim(g.disposition), '') is not null then 'typed' end
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
           -- A hand-logged row IS somebody's typed record of the call.
           case when nullif(btrim(al.subject), '') is not null then 'typed' end
      from windowed x
      join public.activity_log al
        on al.entity_type = 'deal' and al.entity_id = x.id
       and al.interaction_type = 'call'
      left join public.profiles ap on ap.id = al.logged_by
  )
  select r.deal_id, r.at, r.source, r.src_rank, r.disposition, r.seconds, r.who, r.note,
         r.disposition_source
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
  'THE definition of the calls on a deal: wavv_calls (phone-matched inside the deal''s created_at window) + ghl_call_log + activity_log ''call'' rows, deduped rank wavv>ghl>activity by 180s + the keeper''s duration, never within a source. A WAVV row with no typed disposition takes a DERIVED one from v_wavv_derived_dispositions when an application or appointment proves the conversation; `disposition_source` says ''typed'' | ''derived'' | NULL and must be shown wherever the value is. NO VISIBILITY CHECK — callers must authorise and filter the deal ids first, which is why it is granted to service_role only.';

-- ── processor_deal_detail: label a derived value as derived ──────────────────
-- Same function, one changed expression: the touch label. Everything else is
-- byte-identical to 20260916h.

create or replace function public.processor_deal_detail(p_deal_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null or not (public.is_processor(v_uid) or public.is_ops_staff(v_uid)) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  with ev as (
    select * from public.deal_call_events(array[p_deal_id])
  )
  select jsonb_build_object(
    'deal', to_jsonb(d),
    'customer', to_jsonb(c),
    'application', (select to_jsonb(a) from public.mca_applications a where a.deal_id = d.id limit 1),
    'documents', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', cd.id,
          'file_name', cd.filename,
          'category', cd.document_type::text,
          'created_at', cd.created_at,
          'storage_path', cd.storage_path,
          'is_bank_statement', (cd.document_type = 'bank_statement')
        ) order by cd.created_at desc
      ), '[]'::jsonb)
      from public.customer_documents cd
      where cd.customer_id = d.customer_id
    ),
    'qa', jsonb_build_object(
      'checklist', coalesce(q.checklist, '{}'::jsonb),
      'qa_passed', coalesce(q.qa_passed, false),
      'qa_passed_at', q.qa_passed_at,
      'qa_passed_by_name', nullif(btrim(concat_ws(' ', qpa.first_name, qpa.last_name)), ''),
      'submission_ready_at', q.submission_ready_at,
      'submission_ready_by_name', nullif(btrim(concat_ws(' ', qra.first_name, qra.last_name)), ''),
      'decision', q.decision,
      'decision_reason', q.decision_reason,
      'decision_at', q.decision_at,
      'decision_by_name', nullif(btrim(concat_ws(' ', qda.first_name, qda.last_name)), ''),
      'notes', q.notes
    ),
    'touches_total', (select count(*) from ev),
    'touches', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'touched_at', e.at,
        'outcome', case
                     when e.source = 'wavv' then 'WAVV: ' || coalesce(e.disposition, 'call')
                     when e.source = 'ghl'  then 'GHL: '  || coalesce(e.disposition, 'call')
                     else e.disposition
                   end
                   -- A DERIVED disposition never prints as though the setter
                   -- typed it, on this surface or any other.
                   || case when e.disposition_source = 'derived' then ' (derived)' else '' end,
        'outcome_source', e.disposition_source,
        'note', e.note,
        'by_name', e.who
      ) order by e.at desc), '[]'::jsonb)
      from ev e
    )
  )
    into v_out
  from public.deals d
  join public.customers c on c.id = d.customer_id
  left join public.deal_processor_qa q on q.deal_id = d.id
  left join public.profiles qpa on qpa.id = q.qa_passed_by
  left join public.profiles qra on qra.id = q.submission_ready_by
  left join public.profiles qda on qda.id = q.decision_by
  where d.id = p_deal_id;

  if v_out is null then
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;
  return v_out;
end;
$function$;

revoke all on function public.processor_deal_detail(uuid) from public, anon;
grant execute on function public.processor_deal_detail(uuid) to authenticated, service_role;

-- ── realtime_lead_call_history: Hot Leads carries the marker too ─────────────
-- Same function and same money wall as 20260916h. The ONLY changes are two new
-- fields in the payload — `disposition_source` on each call and
-- `last_disposition_source` on the summary — so the panel can never print a
-- derived disposition as though the setter typed it. Existing fields are
-- untouched, so a client that has not been updated behaves exactly as before.

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

  with numbered as (
    select e.*,
           row_number() over (partition by e.deal_id order by e.at desc) as rn,
           count(*)      over (partition by e.deal_id)                   as total
      from public.deal_call_events(v_ids) e
  )
  select coalesce(jsonb_object_agg(g.deal_id, g.payload), '{}'::jsonb)
    into v_out
  from (
    select w.id::text as deal_id,
           jsonb_build_object(
             'attempts', coalesce(max(n.total), 0),
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

commit;
