-- Processor gates drive deals.status
--
-- The Processor workspace ran a 4-gate model that was a state machine unto itself:
-- a processor could take a deal all the way to QA-passed and `deals.status` never
-- moved, so every other surface (closer queues, pipeline counts, the merchant
-- portal) still showed the deal parked at whatever rung it entered on. This wires
-- three of the four gates to the real status column.
--
--   (1) Interested    → processor_log_contact   → new -> contacted
--   (2) App complete  → client ensureDealStageAtLeast (already correct, untouched)
--   (3) Statements in → trigger on customer_documents -> bank_statements
--   (4) QA passed     → processor_qa_decision('go') / processor_mark_ready
--                                                -> bank_statements
--
-- Gate (4) stops at `bank_statements`, NOT `submitted_to_funder`: a QA verdict says
-- the file is ready to go out, not that it went out. Moving to submitted_to_funder
-- is submit-to-funders' job and carries its own side effects.
--
-- The `*_at` rung stamps are NOT written here. `deals_stamp_stage_timestamps_trg`
-- (BEFORE UPDATE OF status) already fills them from deals_stage_rank(); duplicating
-- that logic would be the sixth competing stage ordering in this codebase.

-- ---------------------------------------------------------------------------
-- 1. The single forward-only status advance
-- ---------------------------------------------------------------------------
-- One implementation, used by all three gates. Returns TRUE only when it actually
-- moved the deal, so callers can stay quiet rather than guess.

create or replace function public.deals_advance_status(p_deal_id uuid, p_target text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
  v_type   text;
  v_rank   integer;
  v_target integer;
begin
  select d.status, d.deal_type into v_status, v_type
    from public.deals d
   where d.id = p_deal_id
     for update;
  if not found then
    return false;
  end if;

  -- MCA rungs only. A VCF deal runs the new_distressed..servicing ladder and must
  -- never be pushed onto an MCA status by an MCA-shaped gate.
  if v_type is distinct from 'mca' then
    return false;
  end if;

  -- Terminal and parked statuses are decisions a person made about this deal.
  -- Automation never overrides them, forward-looking rank or not.
  if v_status in ('funded', 'renewal_eligible', 'restructure_executed',
                  'servicing', 'nurture', 'declined', 'dead') then
    return false;
  end if;

  v_rank   := public.deals_stage_rank(v_status);
  v_target := public.deals_stage_rank(p_target);

  -- A null rank on either side means "not a rung" — never guess a direction.
  if v_rank is null or v_target is null or v_target <= v_rank then
    return false;
  end if;

  -- `funded` and beyond fire commission creation and GHL sync that live in the
  -- funding path, not here. Refuse rather than half-fund a deal.
  if v_target >= public.deals_stage_rank('funded') then
    return false;
  end if;

  update public.deals
     set status     = p_target,
         updated_at = now()
   where id = p_deal_id;

  return true;
end;
$function$;

revoke all on function public.deals_advance_status(uuid, text) from public, anon, authenticated;

comment on function public.deals_advance_status(uuid, text) is
  'Forward-only MCA status advance used by the processor gates. Refuses backwards '
  'moves, non-MCA deals, terminal/parked statuses, and anything at funded or beyond. '
  'Returns true only if the deal actually moved. Rung timestamps come from '
  'deals_stamp_stage_timestamps_trg, not from here.';

-- ---------------------------------------------------------------------------
-- 2. Gate (1) — Interested: processor_log_contact
-- ---------------------------------------------------------------------------
-- Was stamping contacted_at on EVERY outcome, including no_answer. That conflates
-- "we dialled" with "we reached them" and breaks the two-clocks convention
-- documented at src/services/dealService.ts:1831 — a wall of no-answers would read
-- as a 100% contact rate. Two clocks, kept apart:
--
--   first_attempt_at / last_attempt_at / contact_attempts → ANY outcome. We tried.
--   contacted_at (+ new -> contacted)                     → only a reached outcome.
--
-- Reached outcomes, from the drawer's CONTACT_OUTCOMES vocabulary
-- (src/components/admin/processor/ProcessorDetailDrawer.tsx:215):
--   reached, not_interested   → a human conversation happened (you only learn
--                               someone is not interested by speaking to them)
--   no_answer, left_voicemail, bad_number → nobody was reached
--
-- This mirrors logContactAttempt('reached') on the closer side exactly, so the
-- processor and closer paths can't disagree about what a contact is.

create or replace function public.processor_log_contact(p_deal_id uuid, p_outcome text, p_note text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid      uuid := auth.uid();
  v_outcome  text := nullif(btrim(p_outcome), '');
  v_reached  boolean;
  v_advanced boolean := false;
begin
  if v_uid is null or not (public.is_processor(v_uid) or public.is_ops_staff(v_uid)) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  v_reached := v_outcome in ('reached', 'not_interested');

  update public.deals
     set last_attempt_at  = now(),
         first_attempt_at = coalesce(first_attempt_at, now()),
         contact_attempts = coalesce(contact_attempts, 0) + 1,
         contacted_at     = case when v_reached then coalesce(contacted_at, now())
                                 else contacted_at end,
         updated_at       = now()
   where id = p_deal_id;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;

  if v_reached then
    v_advanced := public.deals_advance_status(p_deal_id, 'contacted');
  end if;

  insert into public.processor_touches(deal_id, outcome, note, touched_by)
  values (p_deal_id, v_outcome, p_note, v_uid);

  insert into public.activity_log(entity_type, entity_id, interaction_type, subject, content, logged_by)
  values ('deal', p_deal_id, 'call',
          'Contact attempt — processor: ' || coalesce(v_outcome, 'attempted'),
          p_note, v_uid);

  return jsonb_build_object('ok', true, 'reached', v_reached, 'advanced', v_advanced);
end;
$function$;

revoke all on function public.processor_log_contact(uuid, text, text) from public, anon;
grant execute on function public.processor_log_contact(uuid, text, text) to authenticated, service_role;

comment on function public.processor_log_contact(uuid, text, text) is
  'Logs a processor contact attempt. Attempt counters move on every outcome; '
  'contacted_at and the new -> contacted advance only on a reached outcome '
  '(reached / not_interested). Two clocks — see dealService.ts:1831.';

-- ---------------------------------------------------------------------------
-- 3. Gate (3) — Statements in: trigger on customer_documents
-- ---------------------------------------------------------------------------
-- This belongs on the table, not in the upload path, because there are several
-- writers and they don't share code: the merchant portal checklist
-- (DocChecklist.tsx), the shared admin uploader (DocumentUploader.tsx), the signed
-- application writer (signedApplication.ts), AND the server-side classifier, which
-- turns an already-uploaded row INTO a bank_statement by UPDATE rather than INSERT
-- (_shared/docClassify.ts reconcileDocumentType, underwrite-deal/index.ts:736).
-- A trigger is the only chokepoint every one of those passes through — an
-- edge-function write bypasses all client code by construction.
--
-- customer_documents is customer-scoped; deals are not. A customer with several
-- live deals gives no way to tell which one these statements belong to, so the
-- rule is: advance only when there is EXACTLY ONE live MCA deal, otherwise do
-- nothing. Live check (2026-09-13): 6 customers hold more than one deal — 4 of
-- them have zero non-terminal deals and 2 have exactly one. None is ambiguous
-- today, and if one ever is, this does nothing rather than move the wrong
-- merchant's file.

create or replace function public.customer_documents_advance_stage()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_live_count integer;
  v_deal_id    uuid;
begin
  -- Never let stage bookkeeping fail a document upload. A merchant's statements
  -- landing matters more than the rung moving; the warning is the trail.
  begin
    if NEW.document_type is distinct from 'bank_statement'::customer_document_type then
      return NEW;
    end if;

    -- On UPDATE, only act when the type actually just BECAME bank_statement.
    -- Re-saving an unrelated column on an existing statement is not a new arrival.
    if TG_OP = 'UPDATE' and OLD.document_type is not distinct from NEW.document_type then
      return NEW;
    end if;

    select count(*) into v_live_count
      from public.deals d
     where d.customer_id = NEW.customer_id
       and d.deal_type = 'mca'
       and d.status not in ('funded', 'renewal_eligible', 'restructure_executed',
                            'servicing', 'nurture', 'declined', 'dead');

    if v_live_count <> 1 then
      return NEW;  -- zero or ambiguous — say nothing rather than guess
    end if;

    select d.id into v_deal_id
      from public.deals d
     where d.customer_id = NEW.customer_id
       and d.deal_type = 'mca'
       and d.status not in ('funded', 'renewal_eligible', 'restructure_executed',
                            'servicing', 'nurture', 'declined', 'dead')
     limit 1;

    perform public.deals_advance_status(v_deal_id, 'bank_statements');
  exception when others then
    raise warning 'customer_documents_advance_stage skipped: %', sqlerrm;
  end;

  return NEW;
end;
$function$;

drop trigger if exists trg_customer_documents_advance_stage on public.customer_documents;
create trigger trg_customer_documents_advance_stage
  after insert or update of document_type on public.customer_documents
  for each row execute function public.customer_documents_advance_stage();

comment on function public.customer_documents_advance_stage() is
  'Gate 3: the first bank_statement to land for a customer advances their single '
  'live MCA deal to bank_statements. Fires on INSERT and on the classifier''s '
  'UPDATE of document_type. Does nothing when the customer has zero or several '
  'live deals. Never fails the upload.';

-- ---------------------------------------------------------------------------
-- 4. Gate (4) — QA passed
-- ---------------------------------------------------------------------------
-- Both entry points already refuse to run without statements on file (v_has_bs),
-- so a deal that reaches either one has provably cleared the bank_statements rung.
-- Advancing to bank_statements is therefore recording what is already true. Stop
-- there — submitted_to_funder belongs to submit-to-funders.

create or replace function public.processor_qa_decision(p_deal_id uuid, p_decision text, p_reason text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_has_bs boolean;
  v_ready  timestamptz;
begin
  if v_uid is null or not (public.is_processor(v_uid) or public.is_ops_staff(v_uid)) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_decision not in ('go','no_go') then
    raise exception 'decision must be go or no_go' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.deals d where d.id = p_deal_id) then
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;

  insert into public.deal_processor_qa (deal_id) values (p_deal_id)
    on conflict (deal_id) do nothing;

  if p_decision = 'go' then
    v_has_bs := exists (
      select 1 from public.customer_documents cd
        join public.deals d on d.id = p_deal_id
       where cd.customer_id = d.customer_id
         and cd.document_type = 'bank_statement'
    );
    if not v_has_bs then
      raise exception 'Bank statements must be on file before a GO'
        using errcode = 'P0001';
    end if;

    update public.deal_processor_qa
       set qa_passed           = true,
           qa_passed_at        = coalesce(qa_passed_at, now()),
           qa_passed_by        = coalesce(qa_passed_by, v_uid),
           decision            = 'go',
           decision_at         = now(),
           decision_by         = v_uid,
           decision_reason     = null,
           submission_ready_at = now(),
           submission_ready_by = v_uid,
           updated_at          = now()
     where deal_id = p_deal_id
    returning submission_ready_at into v_ready;

    -- The GO gate above proves statements are on file; record the rung.
    perform public.deals_advance_status(p_deal_id, 'bank_statements');

    insert into public.activity_log(entity_type, entity_id, interaction_type, subject, content, logged_by)
    values ('deal', p_deal_id, 'note', 'QA verdict: GO — ready for AI Underwriter (processor)', null, v_uid);
  else
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'A NO-GO needs a reason' using errcode = 'P0001';
    end if;

    update public.deal_processor_qa
       set qa_passed           = false,
           decision            = 'no_go',
           decision_at         = now(),
           decision_by         = v_uid,
           decision_reason     = p_reason,
           submission_ready_at = null,
           submission_ready_by = null,
           updated_at          = now()
     where deal_id = p_deal_id;

    -- A NO-GO moves nothing. The deal is where it was; someone has to fix the file.

    insert into public.activity_log(entity_type, entity_id, interaction_type, subject, content, logged_by)
    values ('deal', p_deal_id, 'note', 'QA verdict: NO-GO — do not submit (processor)', p_reason, v_uid);
  end if;

  return jsonb_build_object('ok', true, 'decision', p_decision, 'submission_ready_at', v_ready);
end;
$function$;

revoke all on function public.processor_qa_decision(uuid, text, text) from public, anon;
grant execute on function public.processor_qa_decision(uuid, text, text) to authenticated, service_role;

create or replace function public.processor_mark_ready(p_deal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_passed boolean;
  v_has_bs boolean;
  v_ready  timestamptz;
begin
  if v_uid is null or not (public.is_processor(v_uid) or public.is_ops_staff(v_uid)) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if not exists (select 1 from public.deals d where d.id = p_deal_id) then
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;

  select q.qa_passed into v_passed
    from public.deal_processor_qa q
   where q.deal_id = p_deal_id;

  v_has_bs := exists (
    select 1
      from public.customer_documents cd
      join public.deals d on d.id = p_deal_id
     where cd.customer_id = d.customer_id
       and cd.document_type = 'bank_statement'
  );

  if not coalesce(v_passed, false) or not v_has_bs then
    raise exception 'QA must be passed and bank statements on file before marking ready'
      using errcode = 'P0001';
  end if;

  update public.deal_processor_qa
     set submission_ready_at = now(),
         submission_ready_by = v_uid,
         updated_at = now()
   where deal_id = p_deal_id
  returning submission_ready_at into v_ready;

  -- Same reasoning as the GO path: the guard above proves the rung was reached.
  perform public.deals_advance_status(p_deal_id, 'bank_statements');

  insert into public.activity_log(entity_type, entity_id, interaction_type, subject, content, logged_by)
  values ('deal', p_deal_id, 'note', 'Marked ready for submission — processor', null, v_uid);

  return jsonb_build_object('ok', true, 'submission_ready_at', v_ready);
end;
$function$;

revoke all on function public.processor_mark_ready(uuid) from public, anon;
grant execute on function public.processor_mark_ready(uuid) to authenticated, service_role;
