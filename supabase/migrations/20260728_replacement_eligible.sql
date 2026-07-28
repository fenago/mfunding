-- Replacement-eligible transfers — the owner sends this list to Synergy to demand
-- REPLACEMENT transfers (not refunds) for handoffs that failed on our side of the
-- bridge. A transfer is replacement-eligible when its matched call is defensible
-- hard evidence, NOT a metadata proxy:
--   · closer-flagged `disconnected_at_handoff`  (human ground truth)
--   · `no_call`            — no inbound call matched at all (a missed handoff)
--   · `answered_then_kicked` — transcript-confirmed conference kick
--   · `voicemail`         — rang to our machine (needs transcription live)
-- `suspect_drop` (suspected_instant_drop / mid_call_drop metadata proxies) is
-- deliberately EXCLUDED from the eligible list and surfaced separately as
-- "review → flag if confirmed" so Carlos can one-tap-promote a real one via the
-- disposition chip. The eligible + suspects arrays are returned in the reconcile
-- jsonb, so they persist in call_audit_runs.totals.reconciliation for every run.
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
  ),
  tagged as (
    select *,
      -- Defensible replacement evidence only (human flag or hard absence / confirmed).
      case bucket
        when 'disconnected_at_handoff' then 'closer-flagged'
        when 'no_call'                 then 'no call received'
        when 'answered_then_kicked'    then 'answered then kicked'
        when 'voicemail'               then 'voicemail'
        else null
      end as evidence,
      (bucket in ('disconnected_at_handoff','no_call','answered_then_kicked','voicemail')) as eligible
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
               classification as call_class, call_date, duration_s, phone_match, gap_s
        from tagged
        order by (bucket = 'disconnected_at_handoff') desc, (bucket = 'answered_then_kicked') desc,
                 (bucket = 'suspect_drop') desc, (bucket = 'no_call') desc, received_at desc
        limit 500
      ) r
    ), '[]'::jsonb),
    -- First-class replacement-request list: defensible failures only, newest first.
    'eligible', coalesce((
      select jsonb_agg(row_to_json(r)) from (
        select received_at, merchant, phone, kind, bucket, evidence, call_date, gap_s
        from tagged
        where eligible
        order by received_at desc
        limit 500
      ) r
    ), '[]'::jsonb),
    -- Suspects: metadata proxies to REVIEW → flag if confirmed (not sent as-is).
    'suspects', coalesce((
      select jsonb_agg(row_to_json(r)) from (
        select received_at, merchant, phone, kind, call_date, duration_s, gap_s
        from tagged
        where bucket = 'suspect_drop'
        order by received_at desc
        limit 500
      ) r
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.call_audit_reconcile(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.call_audit_reconcile(uuid, timestamptz, timestamptz) to service_role;
