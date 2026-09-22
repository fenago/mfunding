-- `ghl_other` IS NOT AN ORIGIN, AND LETTING IT WIN INVERTED THE HEADLINE.
--
-- Owner asked where J&T Wood Grinding came from. The two rungs said:
--   deal  MF-2026-0402  lead_source = 'ghl_other'   created 09-21 14:48
--   list  lead_records -> lead_batches   ucc   batch UCC-20260813
-- It is a UCC cold-list lead from an August batch that a setter converted into a
-- deal today. My ladder took the deal rung first, so it reported "Created in
-- VibeReach".
--
-- SCOPE: 57 of 58 ghl_other deals are in the Lead Machine. ghl_other is what the
-- CRM stamps when it does not know a source -- it is the ABSENCE of an origin,
-- and it was outranking the table that actually knew. Worse, it hid the origin
-- precisely for the leads that CONVERTED, because converting is what creates the
-- deal that then says ghl_other.
--
-- WHAT THIS CORRECTS over 30 days (I reported the wrong version to the owner):
--              before (ghl_other wins)       after (fall through)
--   ucc        30,441 dials,  0 positives    30,678 dials, 21 positives
--   aged        1,402 dials,  0 positives     1,512 dials,  4 positives
--   VibeReach     355 dials, 25 positives          8 dials,  0 positives
-- Total positives 55 both ways -- nothing was invented, 25 sat in the wrong row.
-- So "cold lists produced no positives at all" was FALSE: they produced 25 of
-- 55. The honest read is a brutal ratio, not a zero -- 30,678 cold dials for 21
-- positive merchants -- which is a different and more useful fact.
--
-- Only ghl_other and NULL fall through. realtime_appt (31 of 170) and
-- live_transfer (14 of 99) also appear in the Lead Machine, and for those the
-- DEAL rung is right: the vendor delivered that lead, and the same business also
-- sitting on a purchased list does not make the vendor's delivery a cold dial.
--
-- The ladder now lives in ONE function that both readers call, so the panel and
-- the per-row badges cannot drift into disagreeing about what an origin is.

create or replace function public._origin_key_for_contact(p_contact text)
returns text language sql stable set search_path = public as $$
  with deal_src as (
    select nullif(d.lead_source, 'ghl_other') as src
    from public.deals d
    where d.ghl_contact_id = p_contact
    order by d.created_at desc limit 1
  ),
  machine as (
    select 'list:' || coalesce(b.lead_type, 'unknown') as src
    from public.lead_records lr join public.lead_batches b on b.id = lr.batch_id
    where lr.ghl_contact_id = p_contact limit 1
  )
  select coalesce(
    (select src from deal_src where src is not null),
    (select src from machine),
    (select 'ghl_other' from public.deals d where d.ghl_contact_id = p_contact limit 1)
  );
$$;

revoke all on function public._origin_key_for_contact(text) from public, anon;
grant execute on function public._origin_key_for_contact(text) to authenticated, service_role;

comment on function public._origin_key_for_contact(text) is
  'The ONE origin ladder, shared by setter_dial_origins() and '
  'dial_origin_for_contacts() so they cannot disagree. deals.lead_source wins '
  'EXCEPT ghl_other/NULL, which mean "the CRM does not know" and must not '
  'outrank the Lead Machine batch that does.';

drop function if exists public.setter_dial_origins(timestamptz, timestamptz, uuid);

create function public.setter_dial_origins(
  p_from timestamptz, p_to timestamptz, p_setter uuid default null
)
returns table (
  origin text, origin_label text, is_cold_outbound boolean,
  dials bigint, unique_contacts bigint, dispositioned bigint,
  conversations bigint, long_calls bigint, positive_merchants bigint
)
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_ops_staff(auth.uid()) or public.is_processor(auth.uid())) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  with c as (
    select v.* from public.v_setter_dial_calls v
    where v.started_at >= p_from and v.started_at < p_to
      and (p_setter is null or v.setter_id = p_setter)
  ),
  att as (select c.*, public._origin_key_for_contact(c.contact_id) as origin_key from c)
  select
    coalesce(a.origin_key, 'unattributed'),
    case coalesce(a.origin_key, 'unattributed')
      when 'list:ucc'      then 'UCC list — cold outbound'
      when 'list:aged'     then 'Aged list — cold outbound'
      when 'list:unknown'  then 'Purchased list — cold outbound'
      when 'live_transfer' then 'Synergy live transfer — merchant on the line'
      when 'realtime_appt' then 'Synergy real-time lead — call within 5 min'
      when 'ucc_list'      then 'UCC lead — now a deal'
      when 'aged_list'     then 'Aged lead — now a deal'
      when 'ph_setter'     then 'PH setter — self-sourced'
      when 'referral'      then 'Referral'
      when 'ghl_other'     then 'Created in VibeReach — no list knows it'
      when 'unattributed'  then 'Unattributed — we could not trace it'
      else coalesce(a.origin_key, 'unattributed')
    end,
    coalesce(a.origin_key, '') like 'list:%',
    count(*)::bigint,
    count(distinct a.contact_id)::bigint,
    count(*) filter (where a.disposition_effective is not null)::bigint,
    count(*) filter (where a.disposition_effective in (
      'Full App + Statements','Full Application','Interested','Not Interested',
      'Appointment Set','Callback','Do Not Contact','Application Sent'))::bigint,
    count(*) filter (where coalesce(a.seconds, 0) >= 120)::bigint,
    count(distinct a.contact_id) filter (where a.disposition_effective in (
      'Full App + Statements','Full Application','Partial Application',
      'Appointment Set','Interested','Callback','Application Sent'))::bigint
  from att a group by 1, 2, 3 order by 4 desc;
end;
$$;

revoke all on function public.setter_dial_origins(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.setter_dial_origins(timestamptz, timestamptz, uuid) to authenticated, service_role;

create or replace function public.dial_origin_for_contacts(p_contact_ids text[])
returns table (contact_id text, origin text, short_label text, is_cold_outbound boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_ops_staff(auth.uid()) or public.is_processor(auth.uid())) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  with ids as (select distinct unnest(p_contact_ids) as cid),
  att as (select ids.cid, public._origin_key_for_contact(ids.cid) as origin_key from ids)
  select a.cid,
    coalesce(a.origin_key, 'unattributed'),
    case coalesce(a.origin_key, 'unattributed')
      when 'list:ucc'      then 'UCC cold'
      when 'list:aged'     then 'Aged cold'
      when 'list:unknown'  then 'List cold'
      when 'live_transfer' then 'Live transfer'
      when 'realtime_appt' then 'Real-time'
      when 'ucc_list'      then 'UCC'
      when 'aged_list'     then 'Aged'
      when 'ph_setter'     then 'PH setter'
      when 'referral'      then 'Referral'
      when 'ghl_other'     then 'VibeReach'
      when 'unattributed'  then 'Origin unknown'
      else coalesce(a.origin_key, 'unattributed')
    end,
    coalesce(a.origin_key, '') like 'list:%'
  from att a;
end;
$$;

revoke all on function public.dial_origin_for_contacts(text[]) from public, anon;
grant execute on function public.dial_origin_for_contacts(text[]) to authenticated, service_role;
