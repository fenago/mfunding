-- Backward stage moves are silent to the merchant.
--
-- Admins (and super_admins) can now rewind a mis-staged deal (e.g.
-- application_sent → qualifying) from the app. A rewind is a pipeline
-- CORRECTION, not progress — the merchant must never be pinged about it.
-- Before this change, deals_merchant_notify fired a portal message for any
-- status change whose merchant step key changed (e.g. rewinding
-- submitted_to_funder → docs_collected would message "documents"), which reads
-- as nonsense to the merchant.
--
-- Guard: only send the stage notice when the move is NOT backward. Backward =
-- both old and new status have a deals_stage_rank (MCA rungs) and the new rank
-- is lower. VCF stages and exit statuses have no rank, so their behavior is
-- unchanged. Forward moves (rank increases) notify exactly as before.
create or replace function public.deals_merchant_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old_step text;
  v_new_step text;
  v_backward boolean;
  nm int;
  c record;
begin
  begin
    if NEW.status is distinct from OLD.status then
      -- A rewind (admin pipeline correction) must never message the merchant.
      v_backward := public.deals_stage_rank(NEW.status) is not null
                and public.deals_stage_rank(OLD.status) is not null
                and public.deals_stage_rank(NEW.status) < public.deals_stage_rank(OLD.status);

      v_old_step := public.merchant_step_key(NEW.deal_type, OLD.status);
      v_new_step := public.merchant_step_key(NEW.deal_type, NEW.status);
      if not v_backward
         and v_new_step is not null
         and v_new_step is distinct from v_old_step
         and v_new_step not in ('getting_started','growing','support','offers') then
        select * into c from public.merchant_notice_copy('stage', NEW.deal_type, v_new_step);
        perform public.notify_merchant(NEW.customer_id, NEW.id, 'stage', c.title, c.body, '/portal');
      end if;
    end if;

    if NEW.paydown_percentage is distinct from OLD.paydown_percentage then
      nm := public.renewal_milestone_for(NEW.paydown_percentage);
      if nm is not null and nm > coalesce(OLD.last_renewal_milestone, 0) then
        NEW.last_renewal_milestone := nm;
        select * into c from public.merchant_notice_copy('renewal', NEW.deal_type, nm::text);
        perform public.notify_merchant(NEW.customer_id, NEW.id, 'renewal_milestone', c.title, c.body, '/portal');
      end if;
    end if;
  exception when others then
    raise warning 'deals_merchant_notify skipped: %', sqlerrm;
  end;
  return NEW;
end $function$;
