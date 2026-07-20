-- One-tap call dispositions on ghl_call_log — human ground truth for the campaign
-- audit, layered over the duration/status heuristic. Writes go ONLY through the
-- SECURITY DEFINER RPC below (no direct UPDATE policy): an RLS UPDATE policy can
-- gate rows but not columns, so a browser-writable policy would let the client
-- rewrite duration_seconds / call_status / deal_id — the very ledger the audit
-- trusts. The RPC touches exactly three columns, runs the contacted_at + audit-note
-- side effects atomically, and centralizes the is_ops_staff check.

alter table public.ghl_call_log
  add column if not exists disposition text
    check (disposition in ('spoke','voicemail','no_answer','wrong_number','never_requested','gatekeeper','callback_set')),
  add column if not exists disposition_by uuid references public.profiles(id),
  add column if not exists disposition_at timestamptz;

-- set_call_disposition(message_id, dispo): grade one call. Last write wins
-- (re-grading allowed — a mis-tap is fixed by tapping a different chip).
-- Semantics side effects:
--   spoke / never_requested / callback_set  → a REAL conversation happened, so
--     stamp the deal's contacted_at if it lacks one (via ghl_apply_call_telemetry,
--     which coalesces — never unstamps existing history).
--   wrong_number     → audit note on the deal (vendor evidence; the disposition
--     itself is the queryable signal the audit reads).
--   never_requested  → audit note "merchant says they never requested info"
--     (feeds the audit's bogus counter alongside closed_reason='bogus_never_requested').
-- Notes are only written when the grade actually CHANGES to that value, so
-- re-tapping the same chip refreshes who/when without duplicating the note.
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
  if not is_ops_staff(v_uid) then
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

  update public.ghl_call_log
    set disposition = p_disposition,
        disposition_by = v_uid,
        disposition_at = now()
    where public.ghl_call_log.ghl_message_id = p_message_id;

  -- Real conversation → stamp contacted_at only if still null (history-preserving).
  if p_disposition in ('spoke','never_requested','callback_set') and v_deal_id is not null then
    perform public.ghl_apply_call_telemetry(v_deal_id, v_called_at, v_called_at, 0, v_called_at);
  end if;

  -- Audit notes, only on a genuine change to that grade (no dup on same-chip re-tap).
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
$$;

revoke all on function public.set_call_disposition(text, text) from public, anon;
grant execute on function public.set_call_disposition(text, text) to authenticated;

-- PATCH (same day): closers grade THEIR OWN deals' calls — closers are the
-- primary people on the phone; ops-only locked out the main actor. Ops staff
-- still grade anything. (applied live 2026-07-20)
-- The function body above is superseded by the closer-aware version:
--   authorize AFTER loading the row: is_ops_staff(uid) OR closer_owns_deal(uid, deal_id).
