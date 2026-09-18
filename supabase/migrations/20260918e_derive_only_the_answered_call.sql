-- Derive only the call WAVV recorded as answered. One of three, not three.
--
-- OWNER-LEVEL RULING (2026-09-18, team lead, after `positives-fix` caught it):
-- 20260918d derived three calls. Two of them must not be derived, and the
-- evidence is worse than "the dialer didn't mark it answered".
--
--   deal          lead source      answered?   seconds   deal created      figures already on the deal
--   MF-2026-0323  ghl_other        YES         97        16 min AFTER      none
--   MF-2026-0385  realtime_appt    no          NULL      same second       $50,000 ask / $20,000 mo
--   MF-2026-0297  ucc_list         no          NULL      3 min after       $150,000 revenue
--
-- On 0385 and 0297 the merchant's figures were on the deal BEFORE any
-- conversation could have produced them — the live-transfer vendor supplied
-- them, or the purchased UCC list did. A setter can send a PREFILLED
-- application to such a merchant without speaking to anybody, and Rafael's deal
-- card literally reads "Never spoken to — 2 attempts". So for a lead that
-- arrived pre-populated, "an application was sent" is NOT evidence that a
-- conversation happened. Deriving one there manufactures the conversation —
-- the exact failure this whole workstream exists to prevent, committed by us.
--
-- MF-2026-0323 is the opposite on every axis: answered, 97 seconds, the deal was
-- created AFTER the call, and it carried no ask and no revenue beforehand. The
-- data came from the call. That derivation is sound.
--
-- ── THE GATE IS STRUCTURAL, NOT A SPECIAL CASE ──────────────────────────────
-- `answered_at is not null` is required to derive. This is not three deals'
-- worth of hand-tuning; it repairs an invariant. SetterPerformancePage's funnel
-- is a STRICT SUBSET CHAIN — dials ⊇ connects ⊇ humans ⊇ conversations ⊇
-- positives — and every step rate is printed as a conditional percentage that
-- must never exceed 100%. connects only increments on answered_at, and
-- reachedHuman() hard-returns false without it. A derived conversation on an
-- unanswered row would increment `conversations` while `connects` and `humans`
-- stayed put: invisible in today's floor totals (humans 96, conversations 26),
-- but a step rate over 100% on any per-setter card where those counts are single
-- digits. Gating on the answer means a derived conversation can never outrun its
-- own parent rungs.
--
-- And the repair must NOT be "also derive a connect and a human" — that invents
-- two more facts to protect one.
--
-- ── WHAT THE UNANSWERED ROWS GET INSTEAD ────────────────────────────────────
-- Nothing derived, and `positives-fix`'s "no disposition on the call" flag on
-- the Applications-sent row, which STAYS. For Rafael that is the truthful
-- answer: the application is real and we cannot prove a conversation.
--
-- They also now reach the Disposition Review tab, which is the better fix and
-- the one the team lead actually wanted. See section 3.
--
-- ── STRUCTURE CHANGE ────────────────────────────────────────────────────────
-- 20260918d's view emitted only the calls that passed every gate, so a refused
-- call was simply absent and no surface could say why. That is the wrong shape
-- now that a refusal is itself a thing worth showing. So:
--
--   v_wavv_call_outcome_links     EVERY WAVV call that is the nearest dial
--                                 before an outcome, gated or not, carrying
--                                 `refusal_reason` (NULL = derived). ONE row per
--                                 call. This is the base.
--   v_wavv_derived_dispositions   a thin filter over it: refusal_reason is null.
--                                 Same columns as before, so every reader of
--                                 20260918d keeps working.
--
-- One body, so the derivation and the audit can never drift apart.
--
-- RENAME: disposition_derived_at -> disposition_derived_from_at. It is the
-- moment of the EVIDENCE, not the moment we computed the derivation, and the
-- old name reads like the latter at 2am.

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. THE BASE: every nearest-dial link, with the verdict attached
-- ════════════════════════════════════════════════════════════════════════════

drop view if exists public.v_wavv_derived_dispositions cascade;
drop view if exists public.v_wavv_call_outcome_links cascade;

create view public.v_wavv_call_outcome_links
with (security_invoker = true) as
with deal_phone as (
  select
    d.id                                                                  as deal_id,
    d.deal_number,
    d.created_at,
    right(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'), 10)   as ph10,
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
    e.kind, e.at, e.author, e.rung_ok
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
paired as (
  select
    o.deal_id, o.deal_number, o.kind, o.at as outcome_at, o.author,
    n.call_key, n.src, n.call_at, n.answered_at, n.typed, n.setter_id,
    extract(epoch from (o.at - n.call_at)) / 60.0 as gap_min
  from outcome o
  join lateral (
    -- THE NEAREST PRECEDING DIAL, from EITHER dialer. A GHL click-to-call is
    -- here only so it can BLOCK — it has no disposition a human ever fills, so
    -- when it wins this race no WAVV call links to that outcome at all, and the
    -- outcome correctly produces neither a derivation nor a review flag.
    select a.call_key, a.src, a.call_at, a.answered_at, a.typed, a.setter_id
    from (
      select w.wavv_call_id                                          as call_key,
             'wavv'::text                                            as src,
             w.started_at                                            as call_at,
             w.answered_at                                           as answered_at,
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

      select 'ghl:' || g.ghl_message_id, 'ghl', g.called_at,
             case when g.call_status in ('completed', 'voicemail') then g.called_at end,
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
  where n.src = 'wavv'   -- a GHL winner blocks; it never becomes a link
)
-- One call can be the nearest dial before BOTH an application and an
-- appointment. Nearest outcome wins, so joining this can never duplicate a dial.
select distinct on (p.call_key)
  p.call_key                              as wavv_call_id,
  p.deal_id,
  p.deal_number,
  p.kind                                  as evidence_kind,
  p.outcome_at,
  round(p.gap_min::numeric, 1)            as gap_min,
  p.answered_at,
  p.typed                                 as typed_disposition,
  p.setter_id                             as dialled_by,
  p.author                                as outcome_by,
  case p.kind
    when 'appointment' then 'Appointment Set'
    else 'Application Sent'
  end                                     as derived_disposition,
  'derived from the '
    || case p.kind when 'appointment' then 'appointment booked ' else 'application sent ' end
    || case
         when p.gap_min < 1 then 'moments'
         else round(p.gap_min)::text || ' minute' || case when round(p.gap_min) = 1 then '' else 's' end
       end
    || ' later'
    || coalesce(' — ' || nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''), '')
                                          as disposition_derived_reason,
  -- NULL means the derivation stands. Anything else is the reason it does not,
  -- in the order the gates are checked.
  case
    when p.typed is not null then
      'the setter already dispositioned this call "' || p.typed || '" — the typed value wins'
    when p.answered_at is null then
      'WAVV never recorded this call as answered, so there is no conversation to credit — '
      || 'a pre-filled application can be sent to a merchant nobody spoke to'
    when p.setter_id is null then
      'this dial is not attributed to any setter'
    when p.setter_id <> p.author then
      'a different person produced the outcome'
  end                                     as refusal_reason
from paired p
left join public.profiles pr on pr.id = p.author
order by p.call_key, p.gap_min asc;

revoke all on public.v_wavv_call_outcome_links from public, anon;
grant select on public.v_wavv_call_outcome_links to authenticated, service_role;

comment on view public.v_wavv_call_outcome_links is
  'EVERY WAVV dial that is the most recent dial (from either dialer) within 45 minutes before an author-bearing outcome on the same deal — whether or not a disposition may be derived from it. ONE row per call. `refusal_reason` NULL means the derivation stands; otherwise it says why not, checked in order: already dispositioned > never answered > unattributed dial > a different person produced the outcome. The ANSWERED gate is structural: the funnel is a strict subset chain (dials>connects>humans>conversations>positives) and a derived conversation on an unanswered row would outrun its own parent rungs. It is also substantive — on a realtime_appt or ucc_list lead the merchant''s figures are on the deal before any call, so a pre-filled application can be sent to someone nobody spoke to. A row with a refusal_reason still LINKS the call to the artifact, which is what puts it in front of a human in the Disposition Review tab.';

-- ── The strict view: unchanged contract, now a thin filter ──────────────────

create view public.v_wavv_derived_dispositions
with (security_invoker = true) as
select
  l.wavv_call_id,
  l.deal_id,
  l.deal_number,
  l.evidence_kind,
  l.outcome_at            as disposition_derived_from_at,
  l.dialled_by            as setter_id,
  l.derived_disposition,
  l.disposition_derived_reason,
  l.gap_min               as disposition_derived_gap_min
from public.v_wavv_call_outcome_links l
where l.refusal_reason is null;

revoke all on public.v_wavv_derived_dispositions from public, anon;
grant select on public.v_wavv_derived_dispositions to authenticated, service_role;

comment on view public.v_wavv_derived_dispositions is
  'THE canonical derivation: the subset of v_wavv_call_outcome_links that passed every gate. A WAVV dial WAVV RECORDED AS ANSWERED, with no typed disposition, that is the most recent dial within 45 minutes before an outcome the SAME setter authored. Never writes wavv_calls.disposition. One row per call.';

-- The audit view is now redundant with the base view and would be a second copy
-- of the same logic to keep in sync. Read v_wavv_call_outcome_links instead.
drop view if exists public.v_setter_dial_calls_derivation_audit;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. v_setter_dial_calls — rename, and carry the ungated link
-- ════════════════════════════════════════════════════════════════════════════
-- `disposition` remains the RAW passthrough. Two groups of added columns:
--   disposition_effective / _source / _derived_reason / _derived_from_at
--       the DERIVATION. Present only when every gate passed.
--   outcome_followed_at / _kind / _refusal
--       the LINK, gated or not. This is what lets the Disposition Review tab see
--       a call that produced an application but earned no derivation — Rafael's
--       case exactly.

drop view if exists public.v_setter_dial_calls;

create view public.v_setter_dial_calls
with (security_invoker = true) as

  select
    v.wavv_call_id,
    'wavv'::text                as source,
    v.started_at,
    v.answered_at,
    v.ended_at,
    v.seconds,
    v.outcome,
    v.disposition,
    coalesce(nullif(nullif(btrim(v.disposition), ''), 'None'),
             case when l.refusal_reason is null then l.derived_disposition end)
                                              as disposition_effective,
    case
      when nullif(nullif(btrim(v.disposition), ''), 'None') is not null then 'typed'
      when l.refusal_reason is null and l.derived_disposition is not null then 'derived'
    end                                       as disposition_source,
    case when l.refusal_reason is null then l.disposition_derived_reason end
                                              as disposition_derived_reason,
    case when l.refusal_reason is null then l.outcome_at end
                                              as disposition_derived_from_at,
    -- THE LINK, always — this is how a refused call still reaches a human.
    l.outcome_at                              as outcome_followed_at,
    l.evidence_kind                           as outcome_followed_kind,
    l.refusal_reason                          as outcome_followed_refusal,
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
  left join public.v_wavv_call_outcome_links l on l.wavv_call_id = v.wavv_call_id

  union all

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
    nullif(btrim(g.disposition), '') as disposition_effective,
    case when nullif(btrim(g.disposition), '') is not null then 'typed' end as disposition_source,
    null::text                  as disposition_derived_reason,
    null::timestamptz           as disposition_derived_from_at,
    null::timestamptz           as outcome_followed_at,
    null::text                  as outcome_followed_kind,
    null::text                  as outcome_followed_refusal,
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
  'EVERY outbound setter dial, from both dialers, deduped (GHL rows dropped when a WAVV row to the same merchant phone started within 180s + that call''s duration). `disposition` is the RAW value, unchanged forever — exactly what the setter typed, WAVV''s literal ''None'' included. `disposition_effective` is what a COUNTER reads: the typed value, or a DERIVED one when the call was ANSWERED, undispositioned, and the same setter sent an application within 45 minutes. `disposition_source` is ''typed'' | ''derived'' | NULL and MUST be rendered wherever the value is. SEPARATELY, `outcome_followed_at` / `_kind` / `_refusal` link a call to an artifact that followed it EVEN WHEN NO DERIVATION WAS ALLOWED — that is how an unanswered call which produced an application still reaches the Disposition Review tab instead of vanishing.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. deal_call_events — same gate, same vocabulary
-- ════════════════════════════════════════════════════════════════════════════
-- Signature is unchanged from 20260918d, so this is a plain replace; only the
-- source view it joins has narrowed.

create or replace function public.deal_call_events(p_deal_ids uuid[])
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
    select x.id                                           as deal_id,
           w.started_at                                   as at,
           'wavv'::text                                   as source,
           1                                              as src_rank,
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

    select x.id, al.created_at, 'activity', 3,
           nullif(btrim(al.subject), ''),
           null::int,
           coalesce(
             nullif(btrim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
             (regexp_match(al.subject, '— by (.+)$'))[1]
           ),
           nullif(btrim(left(coalesce(al.content, ''), 160)), ''),
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

commit;
