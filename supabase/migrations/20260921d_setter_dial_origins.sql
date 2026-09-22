-- WHERE THE DIALS CAME FROM — origin attribution for Setter Performance and the
-- Processor console (2026-09-21).
--
-- Owner: "where the lead dispositions come from... if they originate from an
-- outbound telemarketing campaign like wavv or a real time lead or live transfer
-- or other."
--
-- THE HARD PART: 95% of dials are to contacts that have NO DEAL. Over 30 days
-- that is 33,368 calls across 19,397 distinct contacts against 370 total deals,
-- so `deals.lead_source` alone answers almost nothing. The cold-list origin lives
-- in the Lead Machine: lead_records.ghl_contact_id -> lead_batches.lead_type.
--
-- Two-rung ladder, strongest first:
--   1. a DEAL on that contact  -> deals.lead_source   (the lead became real work)
--   2. a lead_records row      -> 'list:'||lead_type  (cold list, never a deal)
--   3. neither                 -> NULL, rendered as UNATTRIBUTED and never folded
--      into anything. 37 of 33,368 over 30 days.
--
-- Coverage measured before building: 99.9%.
--
-- WHY THIS EXISTS: it separates the floor's effort from the floor's results.
-- Measured over the 30 days to 2026-09-21:
--   list:ucc      30,441 dials ->  35 conversations ->  0 positive merchants
--   list:aged      1,402 dials ->   1 conversation  ->  0
--   live_transfer    556 dials ->  17 conversations ->  9
--   realtime_appt    428 dials ->  18 conversations ->  9
--   ghl_other        355 dials ->  14 conversations -> 25
--   ucc_list         131 dials ->  16 conversations -> 11
-- 97% of all dialling produced zero positives. Verified NOT an artifact: the UCC
-- rows are fully dispositioned (17,903 Voice Message, 5,673 No Answer, 1,690
-- System Callback, 566 Bad Number, 521 Not Interested) — real outcomes, none of
-- them positive. A zero that was checked, not a zero from an unread column.

create index if not exists deals_ghl_contact_id_idx
  on public.deals (ghl_contact_id) where ghl_contact_id is not null;

create or replace function public.setter_dial_origins(
  p_from timestamptz,
  p_to   timestamptz,
  p_setter uuid default null
)
returns table (
  origin            text,
  origin_label      text,
  is_cold_outbound  boolean,
  dials             bigint,
  unique_contacts   bigint,
  dispositioned     bigint,
  conversations     bigint,
  positive_merchants bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Ops staff OR processor. Same gate as the rest of the console; a plain closer
  -- has no business reading the whole floor's origin mix.
  if not (public.is_ops_staff(auth.uid()) or public.is_processor(auth.uid())) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  with c as (
    select v.* from public.v_setter_dial_calls v
    where v.started_at >= p_from and v.started_at < p_to
      and (p_setter is null or v.setter_id = p_setter)
  ),
  att as (
    select c.*,
      coalesce(
        (select d.lead_source from public.deals d
          where d.ghl_contact_id = c.contact_id
          order by d.created_at desc limit 1),
        (select 'list:' || coalesce(b.lead_type, 'unknown')
           from public.lead_records lr
           join public.lead_batches b on b.id = lr.batch_id
          where lr.ghl_contact_id = c.contact_id limit 1)
      ) as origin_key
    from c
  )
  select
    coalesce(a.origin_key, 'unattributed') as origin,
    case coalesce(a.origin_key, 'unattributed')
      when 'list:ucc'      then 'UCC list — cold outbound'
      when 'list:aged'     then 'Aged list — cold outbound'
      when 'list:unknown'  then 'Purchased list — cold outbound'
      when 'live_transfer' then 'Live transfer'
      when 'realtime_appt' then 'Real-time appointment'
      when 'ucc_list'      then 'UCC lead — now a deal'
      when 'aged_list'     then 'Aged lead — now a deal'
      when 'ph_setter'     then 'PH setter — self-sourced'
      when 'referral'      then 'Referral'
      when 'ghl_other'     then 'Created in VibeReach'
      when 'unattributed'  then 'Unattributed — we could not trace it'
      else coalesce(a.origin_key, 'unattributed')
    end as origin_label,
    coalesce(a.origin_key, '') like 'list:%' as is_cold_outbound,
    count(*)::bigint as dials,
    count(distinct a.contact_id)::bigint as unique_contacts,
    count(*) filter (where a.disposition_effective is not null)::bigint as dispositioned,
    -- Same 120s bar the page uses for a conversation.
    count(*) filter (where coalesce(a.seconds, 0) >= 120)::bigint as conversations,
    -- Counted by MERCHANT, not by call — one merchant dispositioned positively
    -- three times is one opportunity, which is the rule the Positives panel uses.
    count(distinct a.contact_id) filter (
      where a.disposition_effective in (
        'Full App + Statements','Full Application','Partial Application',
        'Appointment Set','Interested','Callback','Application Sent')
    )::bigint as positive_merchants
  from att a
  group by 1, 2, 3
  order by dials desc;
end;
$$;

revoke all on function public.setter_dial_origins(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.setter_dial_origins(timestamptz, timestamptz, uuid) to authenticated, service_role;

comment on function public.setter_dial_origins(timestamptz, timestamptz, uuid) is
  'Dial origin mix for a window: deals.lead_source when the contact has a deal, '
  'else the Lead Machine batch type (lead_records -> lead_batches.lead_type), '
  'else UNATTRIBUTED — never folded into a named bucket. positive_merchants is '
  'counted per MERCHANT, matching the Positives panel.';
