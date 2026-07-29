-- Richer glance-state for the "⚡ dropped at handoff" affordance. The board + bar
-- need TWO facts per deal, not one: is it flagged, and did a REAL inbound transfer
-- call already run long enough to be a conversation (≥90s) — in which case the
-- "call dropped?" action is de-emphasized (a 6-minute call almost never dropped).
-- Replaces deals_handoff_drop_flags (returns-setof-uuid) with a table return; same
-- closer-safe permission gate (ops anywhere / closer owns the deal). The synthetic
-- 'handoff-flag:<deal>' fallback row carries no duration, so it never counts as a
-- long call.
drop function if exists public.deals_handoff_drop_flags(uuid[]);

create or replace function public.deals_handoff_states(p_deal_ids uuid[])
returns table (deal_id uuid, flagged boolean, long_inbound boolean)
language sql
security definer
set search_path to 'public'
as $$
  select cl.deal_id,
         bool_or(cl.disposition = 'disconnected_at_handoff') as flagged,
         bool_or(coalesce(cl.duration_seconds, 0) >= 90
                 and cl.ghl_message_id not like 'handoff-flag:%') as long_inbound
  from public.ghl_call_log cl
  where cl.deal_id = any(p_deal_ids)
    and cl.direction = 'inbound'
    and (is_ops_staff(auth.uid()) or closer_owns_deal(auth.uid(), cl.deal_id))
  group by cl.deal_id;
$$;

revoke all on function public.deals_handoff_states(uuid[]) from public, anon;
grant execute on function public.deals_handoff_states(uuid[]) to authenticated;
