-- Only an admin/super_admin may CHANGE a deal's assigned closer. Applied live via MCP 2026-07-11.
--
-- Closes a hole found while building deal→closer attribution: the
-- closer_update_own_deals policy's WITH CHECK calls closer_owns_deal(), a
-- SECURITY DEFINER function that re-SELECTs the row by id — so it evaluates OLD
-- ownership and happily passes an UPDATE that hands the deal (and therefore its
-- commission) to a DIFFERENT closer. RLS cannot inspect the proposed NEW row
-- here, so this is enforced with a trigger instead.
--
-- Money follows deals.assigned_closer_id (autoCreateCommissionForFundedDeal), so
-- this is a payout-integrity control, not just tidiness.

create or replace function public.enforce_deal_closer_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_closer_id is distinct from old.assigned_closer_id then
    -- Server-side/service-role contexts (intakes, ghl-webhook, cron) have no
    -- auth.uid() — they are trusted and must keep working.
    if (select auth.uid()) is null then
      return new;
    end if;

    -- Admins / super_admins may reassign freely.
    if public.is_admin_or_super((select auth.uid())) then
      return new;
    end if;

    -- A closer may CLAIM an unassigned deal, and only to THEMSELVES.
    if old.assigned_closer_id is null
       and new.assigned_closer_id = (select auth.uid()) then
      return new;
    end if;

    raise exception 'Only an admin or super_admin can change the assigned closer on a deal';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_deal_closer_assignment on public.deals;
create trigger trg_enforce_deal_closer_assignment
  before update on public.deals
  for each row
  execute function public.enforce_deal_closer_assignment();
