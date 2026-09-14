-- 20260914a — ONE pipeline position, pushed in REAL TIME, whichever side moved it.
--
-- Owner ruling 2026-09-14: "if they move it, regardless of where it's moved
-- from, we need it to be the same in the pipeline" — and explicitly: updated as
-- it happens, not reconciled overnight.
--
-- GHL → us was already real-time (the ghl-webhook stage mirror, fired by GHL's
-- own workflow). Us → GHL was not: ONLY updateDealStatus() in the client pushed.
-- Every other writer of deals.status was silent — the processor gate RPCs, the
-- customer_documents "statements landed" trigger, the call mirror's
-- new → contacted advance, processor_move_to_nurture, and any SQL correction.
-- That asymmetry is what produced 39 mismatched deals on 9/13.
--
-- Patching callers one at a time is how the drift happened, so the guarantee
-- lives HERE: any UPDATE of deals.status, from any writer, fires a targeted
-- push (~2s via pg_net) to the deal-stage-sync edge function. No sweep, no cron,
-- no cost when nothing changes.
--
-- LOOP SAFETY: a GHL-originated change writes deals.status (webhook mirror),
-- which fires this trigger. deal-stage-sync READS the opportunity first and
-- no-ops when it is already on the target stage — which is exactly that case —
-- so the cycle ends in one hop at the cost of a single GHL read.
--
-- FAILURE POSTURE: the status write is the business event and must never roll
-- back because a sync hiccupped. Dispatch errors become WARNINGs; the receipt
-- (or its absence) is visible in ghl_event_hook_log type 'deal_stage_sync'.

create or replace function public.deals_stage_sync_to_ghl()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'vault', 'net'
as $$
declare
  v_secret text;
  v_anon   text;
begin
  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET' limit 1;
    select decrypted_secret into v_anon   from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY'  limit 1;
    if v_secret is null then
      raise warning 'deals_stage_sync_to_ghl: GHL_WEBHOOK_SECRET missing from vault — deal % not synced', new.id;
      return null;
    end if;
    perform net.http_post(
      url     := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/deal-stage-sync?secret=' || v_secret,
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || coalesce(v_anon, '')),
      body    := jsonb_build_object('deal_id', new.id)
    );
  exception when others then
    raise warning 'deals_stage_sync_to_ghl: dispatch failed for deal %: %', new.id, sqlerrm;
  end;
  return null;  -- AFTER trigger
end;
$$;

comment on function public.deals_stage_sync_to_ghl() is
  'AFTER UPDATE OF status on deals: pushes the new stage to the matching GHL opportunity in real time via pg_net → deal-stage-sync. Writer-agnostic, so client code, RPCs, triggers and manual SQL all keep GHL in step. Loop-safe: the edge function no-ops when GHL already holds the target stage.';

drop trigger if exists trg_deals_stage_sync_to_ghl on public.deals;
create trigger trg_deals_stage_sync_to_ghl
  after update of status on public.deals
  for each row
  when (new.status is distinct from old.status and new.ghl_opportunity_id is not null)
  execute function public.deals_stage_sync_to_ghl();
