-- Speed to Lead was judging setters on a column blind to the dialer they use.
--
-- THE ACCUSATION. "Are we even answering the phone in time?" on /admin/revenue
-- branded Catherine Zaragosa and Kristine Gidoc as hours late on dials they made
-- in seconds:
--
--   deal           real first dial      the screen said
--   MF-2026-0385   28 seconds           12m 15s — MISS
--   MF-2026-0358   35 seconds           21.8 HOURS
--   MF-2026-0350   105 seconds          20.3 HOURS
--   MF-2026-0346   111 seconds          43.6 HOURS
--
-- THE MECHANISM. deal_sla_met() and deal_speed_to_lead_seconds() both key on
-- deals.first_attempt_at, and that column is BLIND TO WAVV — the primary dialer —
-- exactly as the standing rule in this project says it is. Worse, it is
-- back-filled from contacted_at by deals_stamp_stage_timestamps, so the SLA clock
-- was being judged on the moment the merchant PICKED UP, or on a stage move. On
-- MF-2026-0385 first_attempt_at, contacted_at and application_sent_at are the
-- same instant — the stage back-stamp — while the real dial was 28 seconds in.
--
-- The evidence it never consulted is public.deal_call_events(uuid[]), the
-- canonical four-source union this project already calls THE definition of "the
-- calls on a deal".
--
-- ═══ THE HEADLINE BARELY MOVES. THE VERDICTS DO. ════════════════════════════
--   before   78 met / 144 judged = 54.2%
--   after    92 met / 158 judged = 58.2%
--   9 deals flip MISSED -> MET, 1 flips MET -> MISSED, 14 become judgeable.
--
-- So the aggregate was roughly right BY ACCIDENT, with errors in both directions
-- cancelling, while fifteen individual judgements about named people's work were
-- wrong. That is the more serious defect: nobody is managed against the mean.
--
-- ═══ TWO RULES THAT STOP THIS BECOMING THE SAME BUG REVERSED ════════════════
--
-- 1. SINCE ARRIVAL. Only calls at or after deals.created_at can answer a clock
--    that starts at deals.created_at. deal_call_events scopes WAVV to the deal's
--    whole ENGAGEMENT (bounded by genuine re-entries, not by created_at), so a
--    naive min() reaches back before the lead existed. MEASURED: 18 realtime_appt
--    deals have a call before arrival, ranging from 5.9 minutes to FORTY-ONE DAYS
--    early, and not one is within 60 seconds — so none is clock skew, every one
--    is a genuinely earlier call. Without this gate the met count reads 96 and
--    credits setters with answering leads before they existed.
--
-- 2. NEITHER SOURCE'S SILENCE OVERRULES THE OTHER'S RECORD. The first attempt is
--    the EARLIEST POSITIVE EVIDENCE from either the call union or the legacy
--    stamp. A stamp is evidence an attempt happened; the union is evidence of
--    calls; NEITHER is evidence of absence.
--    MEASURED: five July 13 deals (MF-2026-0020/0023/0024/0027/0029) carry
--    first_attempt_at 70-267 seconds after arrival — precise, plausible, real —
--    and the call union sees nothing until the next day, because WAVV sync did
--    not exist until late August. Letting the union overrule them would newly
--    accuse five setters of missing an SLA they met, which is this exact bug
--    facing the other way. With the rule, only ONE deal flips to missed:
--    MF-2026-0347, whose stamp sits 41 days BEFORE the lead arrived and is
--    therefore excluded by rule 1 as meaningless for this clock.
--
-- ═══ TRI-STATE. A MISS IS AN ACCUSATION AND MUST CLEAR THE SAME BAR. ════════
-- Owner's standing rule: "if it says an application is sent - that should be
-- valid! and validated." A MISS is a judgement about a named person's work, so it
-- gets the same treatment. `unverified` exists so a deal we cannot read renders
-- as unreadable and NEVER as met and NEVER as missed:
--   • the merchant has no phone, so the WAVV branch cannot match at all; or
--   • the legacy stamp claims an attempt that the call union cannot corroborate
--     AND that predates the lead's arrival — we have contradictory evidence and
--     no way to settle it.
-- Measured today: 0 no-phone, 1 contradictory. Both rare, both real, neither
-- allowed to become a red badge.
--
-- WHY THIS IS AN RPC AND NOT A FIX TO THE TWO COMPUTED COLUMNS. deal_sla_met(d)
-- and deal_speed_to_lead_seconds(d) are IMMUTABLE and take a `deals` row, which
-- is what lets PostgREST select them as computed columns. deal_call_events is
-- STABLE and SECURITY DEFINER, so an IMMUTABLE function may not call it. The old
-- functions are left in place, unchanged, and marked in their comments as blind —
-- deleting them would break any other reader silently.

begin;

create or replace function public.deal_speed_to_lead(p_deal_ids uuid[])
returns table (
  deal_id             uuid,
  first_attempt_at    timestamptz,
  -- 'call'  the canonical union saw a real dial (wavv / ghl / hand-logged)
  -- 'stamp' only the legacy deals.first_attempt_at knows about it
  first_attempt_source text,
  speed_seconds       int,
  -- met | missed | no_clock | never_worked | unverified
  sla_verdict         text,
  -- A sentence, because a red badge on somebody's work has to be able to say why.
  verdict_basis       text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  -- ⚠ AUTHORISE FIRST. deal_call_events() carries NO visibility check by design
  -- (it is granted to service_role only, precisely so it cannot be called around
  -- the money wall). A SECURITY DEFINER wrapper over it that is granted to
  -- `authenticated` therefore HAS to gate its own caller, or any signed-in
  -- closer could read first-attempt data for the whole book by passing deal ids.
  -- Speed to Lead is a super_admin route and this is management data about named
  -- people's response times; ops staff only.
  if auth.uid() is null or not public.is_ops_staff(auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  with scope as (
    select d.id, d.created_at, d.first_attempt_at, d.contacted_at, d.first_call_due_at,
           nullif(btrim(coalesce(c.phone, '')), '') as phone
      from public.deals d
      left join public.customers c on c.id = d.customer_id
     where d.id = any (p_deal_ids)
  ),
  -- RULE 1: since arrival. deal_call_events windows WAVV by the whole engagement,
  -- which reaches back before the lead existed; a clock that starts at created_at
  -- can only be answered by a call at or after created_at.
  ev as (
    select s.id as deal_id, min(e.at) as ev_first
      from scope s
      join public.deal_call_events(array(select id from scope)) e
        on e.deal_id = s.id
       and e.at >= s.created_at
     group by s.id
  ),
  resolved as (
    select s.*,
           ev.ev_first,
           -- A stamp BEFORE arrival says nothing about this clock (one sits 41
           -- days early), so it is not positive evidence and is dropped.
           case when s.first_attempt_at >= s.created_at then s.first_attempt_at end as stamp_at
      from scope s
      left join ev on ev.deal_id = s.id
  )
  select
    r.id,
    -- RULE 2: earliest positive evidence from EITHER source.
    least(coalesce(r.stamp_at, r.ev_first), coalesce(r.ev_first, r.stamp_at)) as first_attempt_at,
    case
      when r.ev_first is not null and r.stamp_at is not null
        then case when r.ev_first <= r.stamp_at then 'call' else 'stamp' end
      when r.ev_first is not null then 'call'
      when r.stamp_at is not null then 'stamp'
    end as first_attempt_source,
    case
      when least(coalesce(r.stamp_at, r.ev_first), coalesce(r.ev_first, r.stamp_at)) is null then null
      else greatest(0, extract(epoch from (
             least(coalesce(r.stamp_at, r.ev_first), coalesce(r.ev_first, r.stamp_at)) - r.created_at))::int)
    end as speed_seconds,
    case
      when r.first_call_due_at is null then 'no_clock'
      -- UNREADABLE, never a verdict. No phone = the WAVV branch cannot match, so
      -- "no calls found" would be our blindness rendered as their failure.
      when r.phone is null then 'unverified'
      when least(coalesce(r.stamp_at, r.ev_first), coalesce(r.ev_first, r.stamp_at)) is not null
        then case
               when least(coalesce(r.stamp_at, r.ev_first), coalesce(r.ev_first, r.stamp_at))
                    <= r.first_call_due_at then 'met'
               else 'missed'
             end
      -- A legacy stamp or a contacted_at exists but nothing corroborates it and
      -- the stamp itself is unusable. Contradictory evidence is not a miss.
      when r.first_attempt_at is not null or r.contacted_at is not null then 'unverified'
      else 'never_worked'
    end as sla_verdict,
    case
      when r.first_call_due_at is null then 'Live transfer or no clock set — there was nothing to be late for.'
      when r.phone is null then 'The merchant has no phone number on file, so the dialer record cannot be matched to this deal. This is our blindness, not a missed call.'
      when r.ev_first is not null and (r.stamp_at is null or r.ev_first <= r.stamp_at)
        then 'Earliest dial on record across WAVV, GHL and hand-logged calls, counted from when the lead arrived.'
      when r.stamp_at is not null
        then 'No dial is mirrored for this deal, but deals.first_attempt_at records one — kept, because the call mirror predates this lead and its silence is not evidence of absence.'
      when r.first_attempt_at is not null or r.contacted_at is not null
        then 'The deal carries an attempt stamp that no call record corroborates and that predates the lead''s own arrival. Contradictory, so no verdict.'
      else 'No dial on record from any source since this lead arrived.'
    end as verdict_basis
  from resolved r;
end;
$function$;

revoke all on function public.deal_speed_to_lead(uuid[]) from public, anon;
grant execute on function public.deal_speed_to_lead(uuid[]) to authenticated, service_role;

comment on function public.deal_speed_to_lead(uuid[]) is
  'Speed-to-lead judged on public.deal_call_events — the canonical wavv+ghl+activity union — instead of deals.first_attempt_at, which is BLIND TO WAVV and back-filled from contacted_at by the stage-timestamp trigger. Two rules keep it honest: (1) only calls AT OR AFTER deals.created_at count, because deal_call_events windows WAVV by the whole engagement and reaches back before the lead existed — 18 realtime_appt deals have a call up to 41 days early; (2) the first attempt is the EARLIEST POSITIVE EVIDENCE from either the call union or the legacy stamp, because neither source''s silence is evidence of absence — five July deals pre-date the WAVV mirror entirely and would otherwise be newly accused. Verdict is TRI-STATE: met | missed | no_clock | never_worked | unverified. A deal whose history cannot be read is unverified and never renders as met or missed, because a MISS is an accusation about a named person''s work.';

-- The old computed columns stay (other readers may select them) but must never
-- again be mistaken for the truth.
comment on function public.deal_sla_met(deals) is
  '⚠ BLIND TO WAVV. Judges deals.first_attempt_at, which no WAVV dial writes and which deals_stamp_stage_timestamps back-fills from contacted_at — so it measures when the merchant picked up, or a stage move, not when the setter dialled. Kept for compatibility. Use public.deal_speed_to_lead(uuid[]) for any judgement about a person''s response time.';
comment on function public.deal_speed_to_lead_seconds(deals) is
  '⚠ BLIND TO WAVV — see deal_sla_met. Measured 2026-09-18: this reported 21.8 and 43.6 HOURS for dials placed in 35 and 111 SECONDS. Use public.deal_speed_to_lead(uuid[]).';

commit;
