-- The package went to the funder six hours ago and the deal did not know
--
-- MF-2026-0418 (EZ Lawn) had a clean deal_submissions row — status 'submitted',
-- submitted_at 2026-09-29 03:15:57Z, 12 files, a real GHL message id — while
-- deals.submitted_at was NULL and the status still read bank_statements. The
-- Playbook and the processor board showed an unsubmitted deal that had been
-- submitted. Two more, MF-2026-0366 and MF-2026-0385, were in the same state
-- within the hour.
--
-- WHY. There are two submit paths and only one of them advanced the deal:
--
--   DealDetailPage → submitToMultipleFunders → invokes the edge function, THEN
--                    calls updateDealStatus from the client. Works.
--   FunderPicker   → invokes the same edge function directly. Zero calls to
--                    updateDealStatus. Never advanced anything.
--
-- And submit-to-funders itself has never written deals.status — despite the
-- comment above the client call claiming it does. So the advance was a
-- client-side workaround bolted onto one of two callers, and the moment
-- submissions moved to the Playbook it stopped happening. The six older deals
-- look correct only because they went through the other door.
--
-- The fix is to stop relying on the caller. The submission row IS the evidence
-- that a package went out — it exists because the email was sent — so the row
-- advances the deal, whoever wrote it. Any future third submit path inherits
-- this without knowing it exists.
--
-- Stamped from the submission's OWN submitted_at, never now(): the deal records
-- when the funder received the package, not when a trigger noticed. Routed
-- through deals_advance_status, so it is forward-only, refuses parked and
-- terminal deals, and cannot reach funded.

create or replace function public.deal_submissions_advance_stage()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Stage bookkeeping must never fail a submission. The package going out
  -- matters more than the rung moving; the warning is the trail.
  begin
    -- Only a row that represents a package actually SENT. A pending portal
    -- submission or a draft has no submitted_at and proves nothing.
    if NEW.submitted_at is null then
      return NEW;
    end if;

    -- On UPDATE, only act when the send just happened. A funder declining
    -- later rewrites status on this row; that is not a new submission, and
    -- re-firing would be noise (the ratchet would refuse it anyway).
    if TG_OP = 'UPDATE' and OLD.submitted_at is not distinct from NEW.submitted_at then
      return NEW;
    end if;

    perform public.deals_advance_status(
      NEW.deal_id, 'submitted_to_funder', NEW.submitted_at, 'evidence:funder_submission');
  exception when others then
    raise warning 'deal_submissions_advance_stage skipped for deal %: %', NEW.deal_id, sqlerrm;
  end;

  return NEW;
end;
$function$;

drop trigger if exists trg_deal_submissions_advance_stage on public.deal_submissions;
create trigger trg_deal_submissions_advance_stage
  after insert or update of submitted_at on public.deal_submissions
  for each row execute function public.deal_submissions_advance_stage();

comment on function public.deal_submissions_advance_stage() is
  'A submission row carrying submitted_at advances its deal to submitted_to_funder, '
  'stamped with the submission''s own send time. Exists because the advance used to '
  'live in ONE of two client submit paths, so packages sent from the Playbook left the '
  'deal reading bank_statements. Never fails the submission.';
