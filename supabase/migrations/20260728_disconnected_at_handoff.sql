-- Closer-settable "⚡ Disconnected at handoff" call disposition — the HUMAN ground
-- truth counterpart to the Call/Transfer Quality audit's metadata-derived
-- `suspected_instant_drop`. The audit's "missed handoff" is a machine guess; this is
-- the closer (usually Carlos) asserting, on the actual inbound transfer call, that the
-- line dropped the moment the conference handed off. Human truth outranks the audio
-- guess: wherever a call carries this disposition, the audit row's classification
-- becomes `disconnected_at_handoff` regardless of transcript/metadata (applied by
-- call_audit_apply_dispositions below, called at run finalize).
--
-- Three parts:
--   1. widen the CHECK constraint + the RPC's IN-list to allow the new value, and
--      write a deal-timeline note when a call is flagged (like wrong_number /
--      never_requested). It is NOT a "real conversation", so it never stamps
--      contacted_at / spoke_at.
--   2. call_audit_apply_dispositions(run) — the override the sweep runs at finalize.
--   3. call_audit_reconcile — add the `disconnected_at_handoff` transfer bucket
--      (distinct from suspect_drop and from no_call / "missed handoff").

-- ── 1a. Allow the value on the ledger ──────────────────────────────────────────
alter table public.ghl_call_log drop constraint if exists ghl_call_log_disposition_check;
alter table public.ghl_call_log
  add constraint ghl_call_log_disposition_check
  check (disposition in ('spoke','voicemail','no_answer','wrong_number','never_requested','gatekeeper','callback_set','disconnected_at_handoff'));

-- ── 1b. RPC: allow the value + write the flag note ─────────────────────────────
-- Reproduces the live closer-aware body (ops staff grade anything; a closer grades
-- calls on deals THEY own via closer_owns_deal) and adds `disconnected_at_handoff`
-- to the IN-list and a timeline note. The telemetry stamp set (spoke/never_requested/
-- callback_set) is unchanged — a disconnected handoff is NOT a conversation.
create or replace function public.set_call_disposition(p_message_id text, p_disposition text)
returns table (ghl_message_id text, disposition text, disposition_at timestamptz, disposition_by uuid)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_old text;
  v_deal_id uuid;
  v_called_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_disposition not in ('spoke','voicemail','no_answer','wrong_number','never_requested','gatekeeper','callback_set','disconnected_at_handoff') then
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
  -- (disconnected_at_handoff is deliberately NOT here — the line dropped, no talk.)
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
    elsif p_disposition = 'disconnected_at_handoff' then
      insert into public.activity_log (entity_type, entity_id, interaction_type, subject, content)
      values ('deal', v_deal_id, 'call', 'Call flagged: disconnected at handoff',
        json_build_object('source','call-disposition','ghl_message_id',p_message_id,
          'disposition','disconnected_at_handoff','by',v_uid,'called_at',v_called_at)::text);
    end if;
  end if;

  return query
    select cl.ghl_message_id, cl.disposition, cl.disposition_at, cl.disposition_by
    from public.ghl_call_log cl
    where cl.ghl_message_id = p_message_id;
end;
$$;

revoke all on function public.set_call_disposition(text, text) from public, anon;
grant execute on function public.set_call_disposition(text, text) to authenticated;

-- ── 2. Audit override — human flag beats the machine class ─────────────────────
-- For a finished/re-run window, force every audit row whose call carries the
-- `disconnected_at_handoff` disposition (joined by the shared GHL message id — both
-- call_audit_calls and ghl_call_log derive it from the same GHL TYPE_CALL message) to
-- classification `disconnected_at_handoff`, stamping meta.closer_flagged provenance.
-- Idempotent + reversible on re-run: a NEW run re-classifies from transcript/metadata
-- first, so if the flag is later cleared the next run reverts to the honest class.
-- Returns the number of rows overridden. Service-role only (the sweep calls it).
create or replace function public.call_audit_apply_dispositions(p_run_id uuid)
returns integer
language sql
security definer
set search_path to 'public'
as $$
  with upd as (
    update public.call_audit_calls cac
    set classification = 'disconnected_at_handoff',
        meta = coalesce(cac.meta, '{}'::jsonb)
               || jsonb_build_object(
                    'closer_flagged', true,
                    'disposition', gcl.disposition,
                    'disposition_by', gcl.disposition_by,
                    'disposition_at', gcl.disposition_at)
    from public.ghl_call_log gcl
    where gcl.ghl_message_id = cac.ghl_message_id
      and gcl.disposition = 'disconnected_at_handoff'
      and cac.run_id = p_run_id
      and cac.classification is distinct from 'disconnected_at_handoff'
    returning 1
  )
  select coalesce(count(*), 0)::int from upd;
$$;

revoke all on function public.call_audit_apply_dispositions(uuid) from public, anon, authenticated;
grant execute on function public.call_audit_apply_dispositions(uuid) to service_role;

-- ── 3. Reconcile: add the closer-flagged transfer bucket ───────────────────────
-- A paid transfer matched to a call the closer flagged `disconnected_at_handoff`
-- counts as its own bucket — distinct from suspect_drop (metadata guess) and from
-- no_call ("missed handoff"). Same body as 20260726, one new CASE branch + count.
create or replace function public.call_audit_reconcile(
  p_run_id uuid,
  p_from   timestamptz,
  p_to     timestamptz
) returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  with transfers as (
    select
      sil.ghl_email_record_id                       as id,
      sil.received_at,
      sil.outcome,
      coalesce(d.lead_source, 'unknown')            as kind,
      c.phone,
      right(regexp_replace(coalesce(c.phone,''), '\D', '', 'g'), 10) as phone10,
      coalesce(nullif(trim(c.business_name), ''),
               nullif(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), ''),
               'unknown') as merchant
    from synergy_intake_log sil
    left join customers c on c.id = sil.customer_id
    left join deals d     on d.id = sil.deal_id
    where sil.received_at >= p_from and sil.received_at <= p_to
      and sil.outcome in ('created','deduped')   -- real, paid transfers only
  ),
  calls as (
    select from_number,
           right(regexp_replace(coalesce(from_number,''), '\D', '', 'g'), 10) as from10,
           call_date, duration_s, classification
    from call_audit_calls
    where run_id = p_run_id and direction = 'inbound'
  ),
  matched as (
    select t.*, m.classification, m.call_date, m.duration_s, m.phone_match, m.gap_s,
      case
        when m.classification is null                                   then 'no_call'
        when m.classification = 'disconnected_at_handoff'              then 'disconnected_at_handoff'
        when m.classification = 'missed_transfer_voicemail'            then 'voicemail'
        when m.classification = 'answered_then_kicked'                 then 'answered_then_kicked'
        when m.classification in ('suspected_instant_drop','mid_call_drop') then 'suspect_drop'
        else 'connected'
      end as bucket
    from transfers t
    left join lateral (
      select cl.classification, cl.call_date, cl.duration_s,
             (t.phone10 <> '' and cl.from10 = t.phone10) as phone_match,
             round(extract(epoch from (cl.call_date - t.received_at)))::int as gap_s
      from calls cl
      where (t.phone10 <> '' and cl.from10 = t.phone10)
         or abs(extract(epoch from (cl.call_date - t.received_at))) <= 600
      order by (case when t.phone10 <> '' and cl.from10 = t.phone10 then 0 else 1 end),
               abs(extract(epoch from (cl.call_date - t.received_at)))
      limit 1
    ) m on true
  )
  select jsonb_build_object(
    'window', jsonb_build_object('from', p_from, 'to', p_to),
    'summary', (
      select jsonb_build_object(
        'transfers', count(*),
        'live_transfer', count(*) filter (where kind = 'live_transfer'),
        'realtime', count(*) filter (where kind = 'realtime_appt'),
        'matched_to_call', count(*) filter (where classification is not null),
        'matched_by_phone', count(*) filter (where phone_match),
        'matched_by_time', count(*) filter (where classification is not null and not coalesce(phone_match,false)),
        'no_call', count(*) filter (where bucket = 'no_call'),
        'voicemail', count(*) filter (where bucket = 'voicemail'),
        'answered_then_kicked', count(*) filter (where bucket = 'answered_then_kicked'),
        'disconnected_at_handoff', count(*) filter (where bucket = 'disconnected_at_handoff'),
        'suspect_drop', count(*) filter (where bucket = 'suspect_drop'),
        'connected', count(*) filter (where bucket = 'connected')
      ) from matched
    ),
    'rows', coalesce((
      select jsonb_agg(row_to_json(r)) from (
        select received_at, merchant, phone, kind, bucket,
               classification as call_class, call_date, duration_s, phone_match, gap_s
        from matched
        order by (bucket = 'disconnected_at_handoff') desc, (bucket = 'answered_then_kicked') desc,
                 (bucket = 'suspect_drop') desc, (bucket = 'no_call') desc, received_at desc
        limit 500
      ) r
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.call_audit_reconcile(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.call_audit_reconcile(uuid, timestamptz, timestamptz) to service_role;
