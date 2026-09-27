-- The suppression belongs at the one door, not on one of the four corridors
--
-- 20260926c put the back-fill suppression flag inside deals_merchant_notify.
-- That was the wrong place, and it cost a real merchant four portal notices
-- before anyone noticed.
--
-- WHAT HAPPENED. Back-filling MF-2026-0083 (Angetavi) to application_sent with
-- the flag set correctly suppressed the stage notice — zero 'stage' messages
-- were written. But a status change into application_sent ALSO fires
-- trg_seed_rail2_doc_requests, which inserts four rows into deal_doc_requests,
-- and every one of those fires trg_doc_request_merchant_notify. Four
-- 'doc_requested' notices landed in the portal of a merchant who has not
-- responded in 66 days, caused by nothing he did.
--
-- There are FOUR functions that call notify_merchant:
--   deals_merchant_notify · doc_request_merchant_notify
--   merchant_doc_merchant_notify · submission_merchant_notify
-- Gating one of four is not a guard, it is a coincidence about which path a
-- given back-fill happens to take. A status change reaches at least two of
-- them, and the second one is reached INDIRECTLY through another trigger, so
-- reading the obvious function was never going to reveal it.
--
-- So the flag moves to notify_merchant, which is the single door every merchant
-- notice goes through. Nothing can route around it, and a fifth caller added
-- next year inherits the behaviour without knowing it exists.
--
-- Same contract as before: transaction-local, and absent or unreadable means
-- SEND. Suppression requires the literal 'on'.
--
--   perform set_config('app.suppress_merchant_notify', 'on', true);
--
-- deals_merchant_notify is restored to its pre-20260926c form (captured from
-- pg_get_functiondef) so there is exactly one gate and nothing to drift.

create or replace function public.notify_merchant(
  p_customer_id uuid,
  p_deal_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_action_path text default '/portal'::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_to uuid;
  v_from uuid;
  v_body text;
  v_msg uuid;
  v_suppress boolean := false;
begin
  -- A back-fill corrects OUR records. The merchant cannot tell "we fixed a bug"
  -- from "something happened on my file", so they hear nothing. Read in its own
  -- block so that ANY failure resolves to SEND — a notification guard that
  -- fails into silence is how merchants stop hearing from us and nobody
  -- notices for a month.
  begin
    v_suppress := coalesce(current_setting('app.suppress_merchant_notify', true), '') = 'on';
  exception when others then
    v_suppress := false;
  end;
  if v_suppress then
    return null;
  end if;

  select user_id into v_to from public.customers where id = p_customer_id;
  if v_to is null then
    return null;  -- merchant has no portal profile yet; nothing to deliver
  end if;

  if p_deal_id is not null then
    select assigned_closer_id into v_from from public.deals where id = p_deal_id;
  end if;
  if v_from is null then
    select id into v_from from public.profiles
      where role in ('super_admin','admin')
      order by (role = 'super_admin') desc, created_at asc nulls last limit 1;
  end if;
  if v_from is null then
    return null;
  end if;

  -- Column is the source of truth for the notification bell; the appended body
  -- link is the email-parity + plain-text fallback.
  v_body := p_body;
  if p_action_path is not null then
    v_body := v_body || E'\n\nOpen your portal: https://mfunding.net' || p_action_path;
  end if;

  insert into public.messages(from_user_id, to_user_id, subject, body, related_customer_id, status, kind, action_path)
    values (v_from, v_to, p_title, v_body, p_customer_id, 'unread', p_kind, p_action_path)
    returning id into v_msg;
  return v_msg;
end
$function$;

comment on function public.notify_merchant(uuid, uuid, text, text, text, text) is
  'The single door for merchant portal notices. Honours a transaction-local '
  'app.suppress_merchant_notify = ''on'' so a back-fill cannot message merchants about '
  'our own bookkeeping — absent or unreadable means SEND. All four *_merchant_notify '
  'triggers route through here, including doc-request seeding reached indirectly '
  'from a stage change.';

-- Restore deals_merchant_notify to its pre-20260926c form: one gate, at the door.
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
end
$function$;
