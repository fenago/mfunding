-- ORIGIN PER MERCHANT ROW, so a positive disposition says where it came from.
--
-- Owner: "i need some kind of badge or something to know what is real-time, live
-- transfer or setter wavv call". Same two-rung ladder as setter_dial_origins(),
-- but keyed by contact so a table row can carry its own badge. One RPC for a
-- page's worth of rows, never one per row.
--
-- short_label is the badge text -- it has to fit in a table cell beside a
-- disposition chip, so it is deliberately terser than the panel's label. Both
-- come from the same CASE shape so they cannot drift into disagreeing about what
-- a lead source is called.

create or replace function public.dial_origin_for_contacts(p_contact_ids text[])
returns table (
  contact_id   text,
  origin       text,
  short_label  text,
  is_cold_outbound boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_ops_staff(auth.uid()) or public.is_processor(auth.uid())) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  with ids as (select distinct unnest(p_contact_ids) as cid),
  att as (
    select ids.cid,
      coalesce(
        (select d.lead_source from public.deals d
          where d.ghl_contact_id = ids.cid
          order by d.created_at desc limit 1),
        (select 'list:' || coalesce(b.lead_type, 'unknown')
           from public.lead_records lr
           join public.lead_batches b on b.id = lr.batch_id
          where lr.ghl_contact_id = ids.cid limit 1)
      ) as origin_key
    from ids
  )
  select
    a.cid as contact_id,
    coalesce(a.origin_key, 'unattributed') as origin,
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
    end as short_label,
    coalesce(a.origin_key, '') like 'list:%' as is_cold_outbound
  from att a;
end;
$$;

revoke all on function public.dial_origin_for_contacts(text[]) from public, anon;
grant execute on function public.dial_origin_for_contacts(text[]) to authenticated, service_role;

comment on function public.dial_origin_for_contacts(text[]) is
  'contact_id -> lead origin, for per-row badges. Same ladder as '
  'setter_dial_origins(): a deal on the contact, else the Lead Machine batch '
  'type, else unattributed (never folded into a named origin).';
