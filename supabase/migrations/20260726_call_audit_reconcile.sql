-- Transfer Reconciliation for the Call/Transfer Quality audit.
--
-- The money question the owner asked: of the PAID Synergy transfers in a window, how
-- many resulted in (a) no call record at all, (b) our voicemail, (c) answered-then-
-- kicked, (d) a real conversation? We already have both halves in Postgres, so no GHL
-- email re-parsing is needed:
--   • transfers  — synergy_intake_log (one row per intake email, received_at + outcome),
--     joined to customers for the E.164 merchant phone + name, and to deals for the
--     lead kind (live_transfer vs realtime_appt).
--   • calls      — the run's own inbound rows in call_audit_calls.
--
-- Match: merchant phone == call.from_number (last-10-digit compare, tolerant of format),
-- FALLING BACK to timestamp proximity (±10 min) — live transfers often land on our line
-- from the conference bridge's caller ID, not the merchant's number, so time is the
-- reliable signal there. Phone match wins when both exist; nearest-in-time otherwise.
--
-- Returns a single jsonb {window, summary, rows} the edge function stores in
-- call_audit_runs.totals.reconciliation and the UI renders. SECURITY DEFINER + granted
-- to service_role only (the edge function calls it); no client path.

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
        'suspect_drop', count(*) filter (where bucket = 'suspect_drop'),
        'connected', count(*) filter (where bucket = 'connected')
      ) from matched
    ),
    'rows', coalesce((
      select jsonb_agg(row_to_json(r)) from (
        select received_at, merchant, phone, kind, bucket,
               classification as call_class, call_date, duration_s, phone_match, gap_s
        from matched
        order by (bucket = 'answered_then_kicked') desc, (bucket = 'suspect_drop') desc,
                 (bucket = 'no_call') desc, received_at desc
        limit 500
      ) r
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.call_audit_reconcile(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.call_audit_reconcile(uuid, timestamptz, timestamptz) to service_role;
