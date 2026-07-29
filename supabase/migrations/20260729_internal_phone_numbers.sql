-- Internal team phones are NOT merchant drops. During the Jul phone crisis the team
-- tested the line by calling in from their own cells, producing a cluster of short
-- inbound calls the audit wrongly counted as "suspected instant drop" / merchant-facing
-- junk. Owner confirmed: +19542351294 is his cell, +19544391163 is Carlos's phone;
-- +17866022975 is Diego, +17037954193 is Khalil (new dev); +19547375692 is the main
-- corp line. A call whose COUNTERPARTY (the non-us side) is one of these is internal
-- testing and must be excluded from the drop picture.
--
-- 1. Seed the editable list (last-10 digit strings). Add/remove later via SQL.
insert into public.platform_settings (key, value, updated_at)
values (
  'internal_phone_numbers',
  '["9542351294","9544391163","7866022975","7037954193","9547375692"]'::jsonb,
  now()
)
on conflict (key) do nothing;  -- never clobber a hand-edited list

-- 2. call_audit_apply_internal(run) — reclassify a run's internal calls as
-- 'internal_test'. Counterparty = from_number for inbound, to_number for outbound
-- (so a legit inbound transfer, whose to = our main line, is NEVER excluded — only
-- calls FROM a team number are). Idempotent; the sweep calls it at finalize. Returns
-- the count reclassified. NB: our main line matches only when it is the COUNTERPARTY
-- (a line-to-line test), never as the destination of an inbound merchant transfer.
create or replace function public.call_audit_apply_internal(p_run_id uuid)
returns integer
language sql
security definer
set search_path to 'public'
as $$
  with nums as (
    select array(select jsonb_array_elements_text(value)
                 from public.platform_settings where key = 'internal_phone_numbers') as arr
  ),
  upd as (
    update public.call_audit_calls cac
    set classification = 'internal_test',
        meta = coalesce(cac.meta, '{}'::jsonb) || jsonb_build_object('internal', true)
    from nums
    where cac.run_id = p_run_id
      and cac.classification is distinct from 'internal_test'
      and right(regexp_replace(
            coalesce(case when cac.direction = 'inbound' then cac.from_number else cac.to_number end, ''),
            '\D', '', 'g'), 10) = any(nums.arr)
    returning 1
  )
  select coalesce(count(*), 0)::int from upd;
$$;

revoke all on function public.call_audit_apply_internal(uuid) from public, anon, authenticated;
grant execute on function public.call_audit_apply_internal(uuid) to service_role;

-- 3. Reconcile: exclude internal calls from the match pool. An internal number can
-- never satisfy a transfer reconciliation match. Same body as the missed_handoff
-- version, with one added filter on the calls CTE.
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
               'unknown') as merchant,
      (coalesce(d.lead_source,'') = 'live_transfer'
        and d.created_by is null
        and (d.contacted_at is null or d.contacted_at > d.created_at + interval '15 minutes')) as lt_missed,
      (coalesce(d.lead_source,'') = 'live_transfer'
        and (d.created_by is not null
             or (d.contacted_at is not null and d.contacted_at <= d.created_at + interval '15 minutes'))) as lt_captured
    from synergy_intake_log sil
    left join customers c on c.id = sil.customer_id
    left join deals d     on d.id = sil.deal_id
    where sil.received_at >= p_from and sil.received_at <= p_to
      and sil.outcome in ('created','deduped')
  ),
  calls as (
    select from_number,
           right(regexp_replace(coalesce(from_number,''), '\D', '', 'g'), 10) as from10,
           call_date, duration_s, classification
    from call_audit_calls
    where run_id = p_run_id and direction = 'inbound'
      and classification is distinct from 'internal_test'   -- internal test calls never match a transfer
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
  ),
  tagged as (
    select *,
      case bucket
        when 'disconnected_at_handoff' then 'closer-flagged'
        when 'no_call'                 then 'no call received'
        when 'answered_then_kicked'    then 'answered then kicked'
        when 'voicemail'               then 'voicemail'
        else null
      end as evidence,
      (kind = 'live_transfer'
       and bucket in ('disconnected_at_handoff','no_call','answered_then_kicked','voicemail')) as eligible
    from matched
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
        'missed_handoff', count(*) filter (where lt_missed),
        'handoff_captured', count(*) filter (where lt_captured),
        'missed_no_call', count(*) filter (where lt_missed and bucket = 'no_call'),
        'no_call', count(*) filter (where bucket = 'no_call'),
        'voicemail', count(*) filter (where bucket = 'voicemail'),
        'answered_then_kicked', count(*) filter (where bucket = 'answered_then_kicked'),
        'disconnected_at_handoff', count(*) filter (where bucket = 'disconnected_at_handoff'),
        'suspect_drop', count(*) filter (where bucket = 'suspect_drop'),
        'connected', count(*) filter (where bucket = 'connected'),
        'replacement_eligible', count(*) filter (where eligible)
      ) from tagged
    ),
    'rows', coalesce((
      select jsonb_agg(row_to_json(r)) from (
        select received_at, merchant, phone, kind, bucket,
               classification as call_class, call_date, duration_s, phone_match, gap_s, lt_missed
        from tagged
        order by (bucket = 'disconnected_at_handoff') desc, (bucket = 'answered_then_kicked') desc,
                 lt_missed desc, (bucket = 'suspect_drop') desc, (bucket = 'no_call') desc, received_at desc
        limit 500
      ) r
    ), '[]'::jsonb),
    'eligible', coalesce((
      select jsonb_agg(row_to_json(r)) from (
        select received_at, merchant, phone, kind, bucket, evidence, call_date, gap_s
        from tagged where eligible order by received_at desc limit 500
      ) r
    ), '[]'::jsonb),
    'suspects', coalesce((
      select jsonb_agg(row_to_json(r)) from (
        select received_at, merchant, phone, kind, call_date, duration_s, gap_s
        from tagged where bucket = 'suspect_drop' order by received_at desc limit 500
      ) r
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.call_audit_reconcile(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.call_audit_reconcile(uuid, timestamptz, timestamptz) to service_role;
