-- deals_monotone_stage_timestamps
--
-- THE BUG: stage timestamps were stamped by whichever code path happened to move
-- the deal — and only for the rung it landed on. A deal dragged straight from
-- New to Application Sent (in the admin UI, or mirrored in from a GHL stage drag)
-- got application_sent_at but NEVER got contacted_at or qualified_at. The funnel
-- report counts a stage as "reached" by asking whether its timestamp is non-null,
-- so the Application Sent bucket ended up LARGER than the Contacted bucket above
-- it, and stage conversion printed rates above 100%.
--
-- THE FIX: make the database itself responsible for the invariant. Reaching a rung
-- means you passed every rung below it, so stamp the current rung AND backfill every
-- earlier rung that is still empty. coalesce() is what keeps an existing (real)
-- timestamp immovable — the trigger only ever fills holes, it never rewrites history.
--
-- Exit statuses (declined / dead / nurture) are NOT rungs. They say nothing about how
-- far a deal got, so they rank NULL and stamp nothing: a lead that dies at Contacted
-- must never be credited with reaching Funded.
--
-- Scoped to deal_type = 'mca' — VCF deals run an entirely different 8-stage ladder
-- (new_distressed … servicing) with its own vcf_* columns.

create or replace function public.deals_stage_rank(p_status text)
returns integer
language sql
immutable
as $function$
  select case p_status
    when 'new'                 then 0
    when 'contacted'           then 1
    when 'qualifying'          then 2
    when 'application_sent'    then 3
    when 'docs_collected'      then 4
    when 'bank_statements'     then 5
    when 'submitted_to_funder' then 6
    when 'offer_received'      then 7
    when 'offer_presented'     then 8
    when 'offer_accepted'      then 9
    when 'funded'              then 10
    when 'renewal_eligible'    then 11
    -- declined / dead / nurture are EXITS, not rungs. They say nothing about how far
    -- the deal got, so they must not stamp anything: a lead that dies at Contacted must
    -- never be credited with reaching Funded.
    else null
  end;
$function$;

create or replace function public.deals_stamp_stage_timestamps()
returns trigger
language plpgsql
as $function$
declare
  r integer;
  ts timestamptz := coalesce(new.updated_at, now());
begin
  if new.deal_type is distinct from 'mca' then
    return new;
  end if;

  r := public.deals_stage_rank(new.status);
  if r is null then
    return new;  -- an exit status (declined/dead/nurture) — leave every stamp untouched
  end if;

  -- Stamp this rung and every rung below it that is still empty. coalesce() is what
  -- makes an existing stamp immovable.
  if r >= 1  then new.contacted_at        := coalesce(new.contacted_at, ts);        end if;
  if r >= 2  then new.qualified_at        := coalesce(new.qualified_at, ts);        end if;
  if r >= 3  then new.application_sent_at := coalesce(new.application_sent_at, ts); end if;
  if r >= 4  then new.docs_collected_at   := coalesce(new.docs_collected_at, ts);   end if;
  if r >= 5  then new.bank_statements_at  := coalesce(new.bank_statements_at, ts);  end if;
  if r >= 6  then new.submitted_at        := coalesce(new.submitted_at, ts);        end if;
  if r >= 7  then new.offer_received_at   := coalesce(new.offer_received_at, ts);   end if;
  if r >= 8  then new.offer_presented_at  := coalesce(new.offer_presented_at, ts);  end if;
  if r >= 9  then new.offer_accepted_at   := coalesce(new.offer_accepted_at, ts);   end if;
  if r >= 10 then new.funded_at           := coalesce(new.funded_at, ts);           end if;

  return new;
end;
$function$;

drop trigger if exists deals_stamp_stage_timestamps_trg on public.deals;
create trigger deals_stamp_stage_timestamps_trg
  before insert or update of status on public.deals
  for each row execute function deals_stamp_stage_timestamps();

-- Heal the rows the old code already broke: re-stamp every MCA deal at its current
-- rung. The trigger fires on `update of status`, so writing status back to itself is
-- enough to make it run — and coalesce() means no real timestamp moves.
--
-- Safe to re-run. The other three triggers on deals all guard on
-- `NEW.status is distinct from OLD.status` (deals_merchant_notify,
-- seed_rail2_doc_requests) or on assigned_closer_id (enforce_deal_closer_assignment),
-- so a status-to-itself write fires nothing: no merchant emails, no doc requests.
-- Trigger name order also matters: deals_stamp_stage_timestamps_trg sorts before
-- deals_updated_at, so `new.updated_at` is still the row's PREVIOUS updated_at when
-- we read it — backfilled rungs get a historically plausible time, not now().
update public.deals set status = status where deal_type = 'mca';
