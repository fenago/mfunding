-- A merchant never hears from us because we fixed our own records
--
-- A back-fill corrects OUR bookkeeping. It is not an event in the merchant's
-- world, and they cannot tell the difference: a portal notice saying "your
-- application" reads the same whether it arrived because something happened on
-- their file or because we repaired a stage column two months later.
--
-- The case that forced this: MF-2026-0083 (Angetavi) went quiet after viewing
-- an application on 2026-07-22 and never signed. Back-filling his stage to
-- application_sent moves him across a notifying step boundary
-- (getting_started → application), so deals_merchant_notify would post "your
-- application" to his portal 66 days after he stopped responding — arriving
-- from nowhere, triggered by nothing he did. The notice would be ACCURATE and
-- still wrong to send. Re-engaging him is a deliberate phone call by a human,
-- not a side effect of a data repair.
--
-- THE FLAG IS TRANSACTION-LOCAL AND DEFAULTS TO NOTIFYING.
--
--   perform set_config('app.suppress_merchant_notify', 'on', true);
--
-- Set it with is_local => true in the same transaction as the back-fill writes,
-- and it dies with the transaction. Three things it deliberately is NOT:
--
--   · NOT `alter table public.deals disable trigger trg_deals_merchant_notify`.
--     Disabling a trigger is global, not session-scoped: for as long as it is
--     off, EVERY connection loses merchant notifications, so a genuine
--     transition happening concurrently is silently dropped. That trades a
--     cosmetic problem for a real one.
--   · NOT insert-then-delete of the messages rows. A merchant with the portal
--     open sees the notice and then watches it vanish. Don't send it.
--   · NOT fail-safe-to-silence. An absent, empty or UNREADABLE setting means
--     NOTIFY. Suppression requires the literal string 'on' and nothing else.
--     A guard that fails closed into silence is how merchants stop hearing
--     from us and nobody notices for a month — the read is wrapped in its own
--     exception handler that resolves to "send" if current_setting misbehaves.
--
-- Body below is deals_merchant_notify captured from pg_get_functiondef (NOT
-- from migration text — rebuilding from stale migration source has silently
-- reverted five migrations in this project before). The ONLY changes are the
-- v_suppress read and the two places it is consulted.

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
  v_suppress boolean := false;
  nm int;
  c record;
begin
  -- Read the flag in its own block so that ANY failure resolves to "send".
  -- current_setting(..., true) returns NULL rather than raising for a missing
  -- key, but the handler is here so a future change to that behaviour cannot
  -- turn an error into silence.
  begin
    v_suppress := coalesce(current_setting('app.suppress_merchant_notify', true), '') = 'on';
  exception when others then
    v_suppress := false;
  end;

  begin
    if NEW.status is distinct from OLD.status then
      -- A rewind (admin pipeline correction) must never message the merchant.
      v_backward := public.deals_stage_rank(NEW.status) is not null
                and public.deals_stage_rank(OLD.status) is not null
                and public.deals_stage_rank(NEW.status) < public.deals_stage_rank(OLD.status);

      v_old_step := public.merchant_step_key(NEW.deal_type, OLD.status);
      v_new_step := public.merchant_step_key(NEW.deal_type, NEW.status);
      if not v_backward
         and not v_suppress
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
        -- The milestone still advances while suppressed: it is our record of how
        -- far the deal has paid down, and losing it would make the NEXT genuine
        -- milestone fire late. Only the message is withheld.
        NEW.last_renewal_milestone := nm;
        if not v_suppress then
          select * into c from public.merchant_notice_copy('renewal', NEW.deal_type, nm::text);
          perform public.notify_merchant(NEW.customer_id, NEW.id, 'renewal_milestone', c.title, c.body, '/portal');
        end if;
      end if;
    end if;
  exception when others then
    raise warning 'deals_merchant_notify skipped: %', sqlerrm;
  end;
  return NEW;
end
$function$;

comment on function public.deals_merchant_notify() is
  'Posts merchant portal notices on forward stage moves and renewal milestones. Skips '
  'backward moves (admin corrections). A back-fill suppresses the notice for its own '
  'transaction with set_config(''app.suppress_merchant_notify'', ''on'', true) — '
  'transaction-local, never a disabled trigger, and absent/unreadable means SEND.';
