-- deals.spoke_at — the truthful "have we ACTUALLY had a conversation?" timestamp.
-- contacted_at lies for this purpose: it is stamped by any ≥30s completed call
-- (voicemail-box pickups included) AND — historically — by stage moves, so a deal
-- can read "contacted" without a human ever talking to the merchant. spoke_at is
-- the stricter signal: FIRST real conversation, stamped ONLY by
--   1) a human call disposition of 'spoke' / 'callback_set' / 'never_requested'
--      (a person asserting a conversation happened), or
--   2) a completed OUTBOUND call that ran ≥ 120s (twice the contact bar).
-- NEVER by a stage move or a backfill of stage history. Only-if-null, like the
-- rest of the timestamp ladder — the first real conversation always wins.
alter table public.deals add column if not exists spoke_at timestamptz;

comment on column public.deals.spoke_at is
  'First REAL conversation with the merchant. Stamped only by a human call disposition (spoke/callback_set/never_requested) or a completed outbound call >=120s. Never by stage moves. The truthful "spoke to them?" signal; contacted_at is the looser >=30s heuristic.';

-- Extend ghl_apply_call_telemetry with a 6th arg, p_spoke_at, coalesced into
-- spoke_at exactly like p_contacted_at into contacted_at (history-preserving).
-- Existing 5-arg named callers (the ghl-call-history sweep) keep working via the
-- default; contacted_at's ≥30s behavior is UNCHANGED. Drop first because
-- CREATE OR REPLACE cannot add a parameter without creating an ambiguous overload.
drop function if exists public.ghl_apply_call_telemetry(uuid, timestamptz, timestamptz, integer, timestamptz);

create or replace function public.ghl_apply_call_telemetry(
  p_deal_id uuid,
  p_first_at timestamptz,
  p_last_at timestamptz,
  p_new_attempts integer,
  p_contacted_at timestamptz,
  p_spoke_at timestamptz default null
)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.deals set
    first_attempt_at = least(coalesce(first_attempt_at, p_first_at), p_first_at),
    last_attempt_at  = greatest(coalesce(last_attempt_at, p_last_at), p_last_at),
    contact_attempts = coalesce(contact_attempts, 0) + greatest(p_new_attempts, 0),
    contacted_at     = coalesce(contacted_at, p_contacted_at),
    spoke_at         = coalesce(spoke_at, p_spoke_at)
  where id = p_deal_id;
$function$;

-- set_call_disposition — recreated from the LIVE closer-aware version (unchanged
-- auth, unchanged audit notes). Only difference: a spoke-set disposition now also
-- stamps spoke_at (6th telemetry arg = the call's time). A human tapping
-- spoke/callback_set/never_requested is the ground truth that a conversation
-- happened, so it is the strongest spoke_at signal.
create or replace function public.set_call_disposition(p_message_id text, p_disposition text)
returns table (ghl_message_id text, disposition text, disposition_at timestamptz, disposition_by uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_old text;
  v_deal_id uuid;
  v_called_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_disposition not in ('spoke','voicemail','no_answer','wrong_number','never_requested','gatekeeper','callback_set') then
    raise exception 'invalid disposition: %', p_disposition using errcode = '22023';
  end if;

  select cl.disposition, cl.deal_id, cl.called_at
    into v_old, v_deal_id, v_called_at
    from public.ghl_call_log cl
    where cl.ghl_message_id = p_message_id
    for update;
  if not found then
    raise exception 'call not found: %', p_message_id using errcode = 'P0002';
  end if;

  -- Ops staff grade anything; a CLOSER grades calls on deals THEY OWN — closers
  -- are the primary people on the phone, locking them out defeats the feature.
  if not (is_ops_staff(v_uid) or (v_deal_id is not null and closer_owns_deal(v_uid, v_deal_id))) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.ghl_call_log
    set disposition = p_disposition,
        disposition_by = v_uid,
        disposition_at = now()
    where public.ghl_call_log.ghl_message_id = p_message_id;

  -- Real conversation → stamp contacted_at AND spoke_at, both only-if-null. A human
  -- asserting the conversation happened is the strongest spoke signal there is.
  if p_disposition in ('spoke','never_requested','callback_set') and v_deal_id is not null then
    perform public.ghl_apply_call_telemetry(v_deal_id, v_called_at, v_called_at, 0, v_called_at, v_called_at);
  end if;

  if v_deal_id is not null and p_disposition is distinct from v_old then
    if p_disposition = 'wrong_number' then
      insert into public.activity_log (entity_type, entity_id, interaction_type, subject, content)
      values ('deal', v_deal_id, 'call', 'Call disposition: wrong number',
        json_build_object('source','call-disposition','ghl_message_id',p_message_id,
          'disposition','wrong_number','by',v_uid,'called_at',v_called_at)::text);
    elsif p_disposition = 'never_requested' then
      insert into public.activity_log (entity_type, entity_id, interaction_type, subject, content)
      values ('deal', v_deal_id, 'call', 'merchant says they never requested info',
        json_build_object('source','call-disposition','ghl_message_id',p_message_id,
          'disposition','never_requested','by',v_uid,'called_at',v_called_at)::text);
    end if;
  end if;

  return query
    select cl.ghl_message_id, cl.disposition, cl.disposition_at, cl.disposition_by
    from public.ghl_call_log cl
    where cl.ghl_message_id = p_message_id;
end;
$function$;

revoke all on function public.set_call_disposition(text, text) from public, anon;
grant execute on function public.set_call_disposition(text, text) to authenticated;

-- BACKFILL: seed spoke_at from existing call evidence — the earliest of any
-- completed ≥120s outbound call and any spoke-set disposition, per deal. Only-if-null.
with evidence as (
  select deal_id, min(called_at) as first_spoke
  from public.ghl_call_log
  where deal_id is not null
    and (
      (call_status = 'completed' and coalesce(duration_seconds,0) >= 120)
      or disposition in ('spoke','callback_set','never_requested')
    )
  group by deal_id
)
update public.deals d
   set spoke_at = e.first_spoke
  from evidence e
 where d.id = e.deal_id
   and d.spoke_at is null;
