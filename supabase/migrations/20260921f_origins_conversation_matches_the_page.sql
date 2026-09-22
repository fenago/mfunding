-- MY "CONVERSATIONS" MEANT SOMETHING ELSE THAN THE PAGE'S (2026-09-21).
--
-- Owner: "something doesn't seem right about this... if we had 35 conversations
-- ...where did they come from because this doesn't add up to 35". Correct, and
-- the fault was mine: the origins panel and the funnel KPI directly above it
-- were using ONE WORD FOR TWO DIFFERENT THINGS.
--
--   the page  isConversation(r) = dispositionOf(r) IN CONVERSATION_DISPOSITIONS
--                                 -- a human CHOSE a value after speaking
--   this RPC  seconds >= 120     -- a call that merely lasted two minutes
--
-- Those are not close. A 3-minute voicemail counted for me and not for the page;
-- a 40-second "Interested" counted for the page and not for me. The column could
-- not sum to the KPI and never would have.
--
-- Now sharing the page's definition exactly, including two exclusions that are
-- load-bearing and must not drift:
--   . VOICEMAIL is not a conversation, whatever its duration.
--   . WAVV's literal "None" is excluded from BOTH lists on purpose: the basis of
--     the rule is that a human chose a value after talking to someone. Folding
--     "None" in would convert a logging gap into a performance number.
-- disposition_effective is the right column: it already carries the derived
-- value where one was established, so the page's derived exception comes free.
--
-- Duration is KEPT as its own column (long_calls) rather than deleted. It is
-- genuinely informative beside the disposition count -- a cold list with long
-- calls and zero dispositioned conversations is telling you something -- but it
-- is now NAMED for what it measures instead of borrowing a word that already
-- meant something else on the same screen.
--
-- Verified after applying, for today: conversations sum to 35 across origins,
-- matching the funnel's "35 calls were dispositioned as a real conversation".

drop function if exists public.setter_dial_origins(timestamptz, timestamptz, uuid);

create function public.setter_dial_origins(
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
  long_calls        bigint,
  positive_merchants bigint
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
      when 'live_transfer' then 'Synergy live transfer — merchant on the line'
      when 'realtime_appt' then 'Synergy real-time lead — call within 5 min'
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
    -- THE PAGE'S DEFINITION, verbatim. Voicemail and "None" excluded by absence
    -- from this list, exactly as CONVERSATION_DISPOSITIONS excludes them.
    count(*) filter (where a.disposition_effective in (
      'Full App + Statements','Full Application','Interested','Not Interested',
      'Appointment Set','Callback','Do Not Contact','Application Sent')
    )::bigint as conversations,
    -- Duration, named for what it is. NOT a conversation count.
    count(*) filter (where coalesce(a.seconds, 0) >= 120)::bigint as long_calls,
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
  'Dial origin mix for a window. conversations uses the PAGE definition '
  '(disposition_effective IN CONVERSATION_DISPOSITIONS) so it sums to the funnel '
  'KPI; long_calls is the separate >=120s duration count. positive_merchants is '
  'per MERCHANT, matching the Positives panel.';
