-- ORIGIN AND DIALER ARE TWO DIMENSIONS, and the owner named both in one breath.
--
-- "UCC, Aged, Live Transfer, WAVV, Direct Call in GHL, wherever" -- the first
-- three are where the LEAD came from, the last two are which DIALER placed the
-- call. Different questions, so they belong side by side rather than in one list
-- where a reader has to know which kind each row is.
--
-- v_setter_dial_calls already carries `source` ('wavv' | 'ghl'), so this is two
-- extra filtered counts and no new join. GHL rows are click-to-calls placed from
-- the Revenue Playbook and carry NO disposition, which is why they are excluded
-- from the conversation and positive rates elsewhere on the page -- so counting
-- them separately here is the point: a large ghl_dials number beside zero
-- conversations is a reporting artifact, not a performance signal.
--
-- Measured over 30 days: WAVV places almost all cold-list volume (30,579 of
-- 30,678 UCC dials), while Synergy live transfers are nearly 40% GHL
-- click-to-call (213 of 556) -- a merchant already on the line gets dialled back
-- from the Playbook, not power-dialled.

drop function if exists public.setter_dial_origins(timestamptz, timestamptz, uuid);

create function public.setter_dial_origins(
  p_from timestamptz, p_to timestamptz, p_setter uuid default null
)
returns table (
  origin text, origin_label text, is_cold_outbound boolean,
  dials bigint, unique_contacts bigint, dispositioned bigint,
  conversations bigint, long_calls bigint, positive_merchants bigint,
  wavv_dials bigint, ghl_dials bigint
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
      'Appointment Set','Interested','Callback','Application Sent'))::bigint,
    -- WHICH DIALER placed it. Two dimensions, one table.
    count(*) filter (where a.source = 'wavv')::bigint,
    count(*) filter (where a.source = 'ghl')::bigint
  from att a group by 1, 2, 3 order by 4 desc;
end;
$$;

revoke all on function public.setter_dial_origins(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.setter_dial_origins(timestamptz, timestamptz, uuid) to authenticated, service_role;
