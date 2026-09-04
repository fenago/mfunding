-- 20260904b — a do-not-contact flag PERMANENTLY closes the customer's open deals.
--
-- WHY. 2026-09-04 audit found 19 pipeline deals sitting under DND chips: the
-- flag writers (Playbook DND button / set-contact-dnd, the SMS STOP trigger,
-- the WAVV do-not-contact drain, early manual sets) each did only part of the
-- job, so suppressed merchants kept "Set callback" / "Quick App" buttons in
-- Processor and setter queues — an invitation to violate the merchant's
-- request. The owner's ruling: opted-out merchants leave the pipeline, and the
-- rule must be permanent, not a one-time cleanup.
--
-- HOW. One trigger on customers catches EVERY writer (edge fn, SQL trigger,
-- future code, manual statement). When do_not_contact flips false→true it:
--   1. Marks the customer's open deals dead (previous_status preserved,
--      lost_reason = 'opted_out') and writes an activity_log note per deal.
--   2. Fires the dnd-enforce edge function via pg_net (fire-and-forget) to
--      make GHL agree: contact-level DND (the suppression WAVV actually
--      honors) + every still-open opportunity closed as lost. Receipt in
--      ghl_event_hook_log (type 'dnd_enforce').
-- Deals already terminal (dead/declined) and the funded book
-- (funded/renewal_eligible/restructure_executed/servicing) are never touched —
-- a funded client's transactional servicing contact is not marketing outreach,
-- and history is never rewritten.
--
-- FAILURE POSTURE. The flag write is the compliance primitive and must NEVER
-- roll back because enforcement hiccuped. Both steps are wrapped so an error
-- becomes a WARNING; a flagged customer with a still-open deal remains visible
-- via the DND chip surfaces, which is exactly the recoverable state.

create or replace function public.customers_dnd_close_open_deals()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'vault', 'net'
as $$
declare
  v_secret text;
  v_anon   text;
  v_killed int := 0;
begin
  -- Only act on the false→true transition (INSERT rows arrive with OLD null).
  if tg_op = 'UPDATE' and coalesce(old.do_not_contact, false) then
    return new;
  end if;
  if not new.do_not_contact then
    return new;
  end if;

  -- 1) Close open deals locally.
  begin
    with killed as (
      update public.deals
         set previous_status = status,
             status          = 'dead',
             lost_reason     = 'opted_out'
       where customer_id = new.id
         and status not in ('dead','declined','funded','renewal_eligible',
                            'restructure_executed','servicing')
       returning id
    )
    insert into public.activity_log (entity_type, entity_id, interaction_type, subject, content)
    select 'deal', id, 'note', 'dnd:deal-closed',
           'Deal closed automatically — customer flagged do-not-contact ('
             || coalesce(new.do_not_contact_reason, 'no reason recorded') || ').'
      from killed;
    get diagnostics v_killed = row_count;
  exception when others then
    raise warning 'customers_dnd_close_open_deals: deal close failed for customer %: %', new.id, sqlerrm;
  end;

  -- 2) Fire-and-forget GHL enforcement (contact DND + close open opps).
  begin
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET' limit 1;
    select decrypted_secret into v_anon   from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY'  limit 1;
    if v_secret is not null then
      perform net.http_post(
        url     := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/dnd-enforce?secret=' || v_secret,
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'Authorization', 'Bearer ' || coalesce(v_anon, '')),
        body    := jsonb_build_object('ghl_contact_id', coalesce(new.ghl_contact_id, ''))
      );
    else
      raise warning 'customers_dnd_close_open_deals: GHL_WEBHOOK_SECRET missing from vault — GHL side not enforced for customer %', new.id;
    end if;
  exception when others then
    raise warning 'customers_dnd_close_open_deals: dnd-enforce dispatch failed for customer %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

comment on function public.customers_dnd_close_open_deals() is
  'Trigger body: when customers.do_not_contact flips on (any writer), close the customer''s open deals locally (lost_reason=opted_out + activity note) and fire the dnd-enforce edge fn via pg_net so GHL sets contact DND and closes open opportunities. Enforcement errors WARN, never roll back the flag.';

drop trigger if exists trg_customers_dnd_close_open_deals on public.customers;
create trigger trg_customers_dnd_close_open_deals
  after update of do_not_contact on public.customers
  for each row
  when (new.do_not_contact and not coalesce(old.do_not_contact, false))
  execute function public.customers_dnd_close_open_deals();

drop trigger if exists trg_customers_dnd_close_open_deals_ins on public.customers;
create trigger trg_customers_dnd_close_open_deals_ins
  after insert on public.customers
  for each row
  when (new.do_not_contact)
  execute function public.customers_dnd_close_open_deals();
