-- stage_trigger_also_stamps_first_attempt
--
-- THE HOLE: deals_stamp_stage_timestamps() stamped the stage ladder but knew nothing
-- about first_attempt_at. So a status advance set contacted_at and left first_attempt_at
-- NULL — and since deal_sla_met() / deal_speed_to_lead_seconds() are judged on
-- first_attempt_at, those deals became UNSCOREABLE for speed-to-lead. Four real-time
-- leads were already stranded that way: reached, but with no record of the outreach
-- that reached them. It is incoherent on its face — you cannot have CONTACTED someone
-- you never ATTEMPTED to reach.
--
-- THE FIX: reaching a merchant PROVES we tried to reach them, so contacted_at implies
-- an attempt no later than itself. coalesce() is load-bearing: it must never overwrite
-- a real earlier attempt a closer logged. If they dialled at 10:02 and got through at
-- 10:05, the SLA is judged on 10:02 — the attempt, not the answer.

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

  -- Reaching a merchant proves we tried to reach them. Never overwrite a real attempt a
  -- closer logged earlier — that timestamp is the one the SLA is actually about.
  if new.contacted_at is not null then
    new.first_attempt_at := coalesce(new.first_attempt_at, new.contacted_at);
    new.last_attempt_at  := coalesce(new.last_attempt_at, new.contacted_at);
    if coalesce(new.contact_attempts, 0) = 0 then
      new.contact_attempts := 1;
    end if;
  end if;

  return new;
end;
$function$;

-- Repair the rows the old trigger already stranded: contacted, but with no attempt
-- on record, therefore unscoreable for speed-to-lead. Idempotent.
update public.deals
set first_attempt_at = coalesce(first_attempt_at, contacted_at),
    last_attempt_at  = coalesce(last_attempt_at, contacted_at),
    contact_attempts = greatest(coalesce(contact_attempts, 0), 1)
where deal_type = 'mca'
  and contacted_at is not null
  and first_attempt_at is null;
