-- One-tap "⚡ Dropped at handoff" straight from the My Day board card — zero
-- navigation. Same ground truth as the CallHistoryPanel chip (disposition
-- `disconnected_at_handoff` on the actual inbound transfer call), reached without
-- opening the deal. Two SECURITY DEFINER RPCs the card calls directly:
--
--   1. flag_deal_handoff_drop(deal, on/off) — sets/clears the flag. When the deal
--      HAS an inbound transfer call in the ledger (the card mirrors it via
--      ghl-call-history first, record-only, exactly like the panel does on load),
--      it grades that real call — so call_audit_apply_dispositions() overrides the
--      audit class by shared GHL message id and the reconciliation bucket + the
--      replacement-eligible list light up UNCHANGED. When the deal has NO inbound
--      call at all, it records a deal-level fallback flag as a synthetic ledger row
--      (ghl_message_id = 'handoff-flag:<deal>'). That synthetic row can never join
--      call_audit_calls, so it can't corrupt the audit — and it doesn't need to:
--      the reconciliation already treats a no-call LIVE TRANSFER as replacement-
--      eligible, so the deal-level flag only has to be surfaced (card tag + timeline
--      note), not invented.
--   2. deals_handoff_drop_flags(deal[]) — the glance-state read. RLS on ghl_call_log
--      is ops-only (staff_select_ghl_call_log), so a closer can't SELECT the ledger
--      to see their own flag; this definer read returns the flagged subset gated by
--      the SAME permission as the write (ops anywhere / closer owns the deal).
--
-- Permission mirrors set_call_disposition exactly: is_ops_staff(uid) OR
-- closer_owns_deal(uid, deal). No new grants beyond authenticated.

-- ── 1. Flag / unflag from the board ────────────────────────────────────────────
create or replace function public.flag_deal_handoff_drop(p_deal_id uuid, p_flag boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid     uuid := auth.uid();
  v_msg     text;
  v_called  timestamptz;
  v_contact text;
  v_created timestamptz;
  v_mode    text;
begin
  if v_uid is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- Ops staff flag anything; a closer flags deals THEY own — same gate as the
  -- per-call disposition RPC. Closers are the people on the phone; locking them
  -- out defeats the whole "flag it from the card" point.
  if not (is_ops_staff(v_uid) or closer_owns_deal(v_uid, p_deal_id)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- The latest inbound (transfer) call already mirrored into the ledger, if any.
  -- The card runs ghl-call-history (record-only inbound mirror) before this call,
  -- so a real transfer that exists in GHL is present here when there is one.
  select cl.ghl_message_id, cl.called_at
    into v_msg, v_called
    from public.ghl_call_log cl
    where cl.deal_id = p_deal_id
      and cl.direction = 'inbound'
      and cl.ghl_message_id not like 'handoff-flag:%'
    order by cl.called_at desc
    limit 1;

  if p_flag then
    if v_msg is not null then
      -- Grade the REAL inbound call → identical to the panel chip, so the audit
      -- override + reconciliation bucket work with no change.
      update public.ghl_call_log
        set disposition = 'disconnected_at_handoff',
            disposition_by = v_uid,
            disposition_at = now()
        where ghl_message_id = v_msg;
      v_mode := 'call';
    else
      -- No inbound call in GHL: deal-level fallback. Synthetic ledger row, inert to
      -- the audit (never joins call_audit_calls) — the no-call live transfer is
      -- already replacement-eligible; this just persists + surfaces the assertion.
      select ghl_contact_id, created_at into v_contact, v_created
        from public.deals where id = p_deal_id;
      insert into public.ghl_call_log
        (ghl_message_id, deal_id, ghl_contact_id, direction, call_status,
         called_at, disposition, disposition_by, disposition_at)
      values
        ('handoff-flag:' || p_deal_id, p_deal_id, coalesce(v_contact, 'unknown'),
         'inbound', 'flag_only', coalesce(v_created, now()),
         'disconnected_at_handoff', v_uid, now())
      on conflict (ghl_message_id) do update
        set disposition = 'disconnected_at_handoff',
            disposition_by = v_uid,
            disposition_at = now();
      v_mode := 'deal_fallback';
    end if;

    insert into public.activity_log (entity_type, entity_id, interaction_type, subject, content)
    values ('deal', p_deal_id, 'call', 'Handoff flagged from board: disconnected at handoff',
      json_build_object('source','myday-card','mode',v_mode,'by',v_uid)::text);
  else
    -- Undo: clear the flag wherever it lives. Clearing a real call to NULL reverts
    -- it to the honest machine class on the next audit run (the flag is reversible
    -- by design); the synthetic fallback row is simply removed.
    update public.ghl_call_log
      set disposition = null, disposition_by = null, disposition_at = null
      where deal_id = p_deal_id
        and direction = 'inbound'
        and disposition = 'disconnected_at_handoff'
        and ghl_message_id not like 'handoff-flag:%';
    delete from public.ghl_call_log
      where ghl_message_id = 'handoff-flag:' || p_deal_id;
    v_mode := 'cleared';

    insert into public.activity_log (entity_type, entity_id, interaction_type, subject, content)
    values ('deal', p_deal_id, 'call', 'Handoff flag cleared from board',
      json_build_object('source','myday-card','by',v_uid)::text);
  end if;

  return jsonb_build_object('deal_id', p_deal_id, 'flagged', p_flag, 'mode', v_mode);
end;
$$;

revoke all on function public.flag_deal_handoff_drop(uuid, boolean) from public, anon;
grant execute on function public.flag_deal_handoff_drop(uuid, boolean) to authenticated;

-- ── 2. Glance-state read for the board (closer-safe) ───────────────────────────
create or replace function public.deals_handoff_drop_flags(p_deal_ids uuid[])
returns setof uuid
language sql
security definer
set search_path to 'public'
as $$
  select distinct cl.deal_id
  from public.ghl_call_log cl
  where cl.deal_id = any(p_deal_ids)
    and cl.direction = 'inbound'
    and cl.disposition = 'disconnected_at_handoff'
    and (is_ops_staff(auth.uid()) or closer_owns_deal(auth.uid(), cl.deal_id));
$$;

revoke all on function public.deals_handoff_drop_flags(uuid[]) from public, anon;
grant execute on function public.deals_handoff_drop_flags(uuid[]) to authenticated;
