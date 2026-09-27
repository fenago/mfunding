-- Stages advance on evidence, and say honestly where the stamp came from
--
-- Three of the four things that should move a deal already had a home:
--   · a contact logged            → log_contact_attempt      → contacted
--   · a bank statement landing    → trg_customer_documents_advance_stage
--                                                            → bank_statements
--   · a processor QA GO           → processor_qa_decision    → bank_statements
--
-- The two missing ones are the merchant-facing halves of the same story: WE
-- sent an application, and THEY signed it. Both already have a table that
-- learns about them on an existing cron, and neither had a gate. MF-2026-0422
-- is the case that made this concrete — application sent 20:10, disclosure
-- signed 20:12, documents emailed back 20:16-20:25, application signed 20:29,
-- and the deal read "contacted" the next morning.
--
-- NOTHING HERE INVENTS A RUNG. Each gate fires on a row that only exists
-- because the event happened, and hands the event's OWN timestamp to the
-- stamp, so the deal records when the merchant acted rather than when a cron
-- noticed. deals.application_sent_at is never read as evidence: it is written
-- BY stage moves, and using it would let a stage move justify itself.
--
-- All advancement goes through deals_advance_status(), which already refuses
-- VCF deals, refuses any target that is not strictly forward, refuses parked
-- and terminal statuses, and refuses `funded` and beyond outright. No path in
-- this file can fund a deal or mint a commission.

-- ---------------------------------------------------------------------------
-- 1. The ratchet learns to stamp honestly
-- ---------------------------------------------------------------------------
-- deals_stamp_stage_timestamps fills every rung beneath the new status from
-- now() and marks each one 'inferred'. That is right for a rung nobody
-- witnessed. It is wrong for the rung the evidence is ABOUT: we know when the
-- merchant signed, to the second, and writing now() instead would replace a
-- fact with a guess and then label the guess the same way.
--
-- So the caller may pass the evidence's timestamp and a provenance label. The
-- stamp trigger only fills NULL holes, so a value set here survives it, and
-- because the column is no longer NULL the trigger will not overwrite our
-- label with 'inferred'.
--
-- Two args become four with defaults, which would make the old 2-arg call
-- ambiguous — so the old signature is dropped and recreated. Its body was
-- captured from pg_get_functiondef first, not from the 20260913b migration
-- text, and is reproduced below unchanged apart from the stamping.

drop function if exists public.deals_advance_status(uuid, text);

create or replace function public.deals_advance_status(
  p_deal_id    uuid,
  p_target     text,
  p_stamp_at   timestamptz default null,
  p_provenance text        default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status   text;
  v_type     text;
  v_rank     integer;
  v_target   integer;
  v_col      text;
  v_existing timestamptz;
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

  -- The target rung's own timestamp column. A fixed CASE, not caller input, so
  -- it is safe to interpolate as an identifier below.
  v_col := case p_target
    when 'contacted'           then 'contacted_at'
    when 'qualifying'          then 'qualified_at'
    when 'application_sent'    then 'application_sent_at'
    when 'docs_collected'      then 'docs_collected_at'
    when 'bank_statements'     then 'bank_statements_at'
    when 'submitted_to_funder' then 'submitted_at'
    when 'offer_received'      then 'offer_received_at'
    when 'offer_presented'     then 'offer_presented_at'
    when 'offer_accepted'      then 'offer_accepted_at'
    else null
  end;

  if v_col is not null and p_stamp_at is not null then
    execute format('select %I from public.deals where id = $1', v_col)
      into v_existing using p_deal_id;
  end if;

  -- Only claim the evidence wrote the stamp when the stamp was actually empty.
  -- An existing timestamp is somebody else's record of the same rung and keeps
  -- both its value and whatever provenance it already carried.
  if v_col is not null and p_stamp_at is not null and v_existing is null then
    execute format(
      'update public.deals '
      '   set status     = $1, '
      '       updated_at = now(), '
      '       %I         = $2, '
      '       stage_stamp_provenance = '
      '         coalesce(stage_stamp_provenance, ''{}''::jsonb) || jsonb_build_object($3, $4) '
      ' where id = $5', v_col)
      using p_target, p_stamp_at, v_col, coalesce(p_provenance, 'evidence'), p_deal_id;
  else
    update public.deals
       set status     = p_target,
           updated_at = now()
     where id = p_deal_id;
  end if;

  return true;
end;
$function$;

revoke all on function public.deals_advance_status(uuid, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.deals_advance_status(uuid, text, timestamptz, text)
  to service_role;

comment on function public.deals_advance_status(uuid, text, timestamptz, text) is
  'The one forward-only status advance. Refuses VCF deals, parked/terminal statuses, '
  'non-forward targets, and anything at or past funded. p_stamp_at/p_provenance let an '
  'evidence-driven caller record the rung with the event''s OWN timestamp and say so in '
  'stage_stamp_provenance, instead of letting the stamp trigger fill now() as ''inferred''.';

-- ---------------------------------------------------------------------------
-- 2. Which deal does a merchant-level event belong to?
-- ---------------------------------------------------------------------------
-- Signatures and sent documents attach to the CUSTOMER, not the deal. A repeat
-- merchant has one signature row and two deals, so a gate that guessed would
-- advance a renewal off the previous deal's paperwork.
--
-- One resolver, shared by both gates below and matching the rule
-- customer_documents_advance_stage has used since 20260913b: act only when
-- exactly one live MCA deal exists. Zero or several is not a failure — it is a
-- question, and the gates raise it instead of guessing.

create or replace function public.stage_gate_resolve_deal(p_customer_id uuid)
returns table(live_deal_id uuid, live_count integer, parked_deal_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with live as (
    select d.id
      from public.deals d
     where d.customer_id = p_customer_id
       and d.deal_type = 'mca'
       and d.status not in ('funded', 'renewal_eligible', 'restructure_executed',
                            'servicing', 'nurture', 'declined', 'dead')
  ),
  parked as (
    select d.id
      from public.deals d
     where d.customer_id = p_customer_id
       and d.deal_type = 'mca'
       and d.status in ('nurture', 'declined', 'dead')
     order by d.updated_at desc
     limit 1
  )
  select (select id from live limit 1),
         (select count(*)::integer from live),
         (select id from parked);
$function$;

comment on function public.stage_gate_resolve_deal(uuid) is
  'Which MCA deal a customer-level event (a signature, a sent application) belongs to. '
  'Exactly one live deal is actionable; zero or several is reported, not guessed.';

-- ---------------------------------------------------------------------------
-- 3. Evidence that arrives on a parked deal is FLAGGED, never moved
-- ---------------------------------------------------------------------------
-- A park is a person's decision, recorded with their name on it — the log reads
-- "Moved to long-term nurture — processor". A closer parked Express Redemption
-- because the business is closing. An automation that drags a deal back out
-- because a document exists is worse than the bug it is fixing.
--
-- But silence is also wrong: a merchant who signs after being parked is a real
-- signal somebody should see. So the deal stays exactly where the human put it
-- and the timeline says what arrived.
--
-- Fires at most once per deal per marker, so a nightly re-crawl re-inserting
-- the same evidence cannot turn one signature into a wall of identical notes.

create or replace function public.stage_gate_flag_ahead(
  p_deal_id uuid,
  p_what    text,
  p_when    timestamptz
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.activity_log (entity_type, entity_id, interaction_type, subject, content)
  select 'deal', p_deal_id, 'note', 'evidence:ahead-of-stage',
         p_what || ' on ' || to_char(p_when, 'YYYY-MM-DD HH24:MI') || ' UTC, after this deal was parked. '
         || 'The stage was NOT changed — parking is a decision somebody made about this merchant and a '
         || 'document arriving does not reverse it. If this merchant is back in play, bring the deal back '
         || 'and it will resume from the stage it left.'
   where not exists (
     select 1 from public.activity_log a
      where a.entity_type = 'deal' and a.entity_id = p_deal_id
        and a.subject = 'evidence:ahead-of-stage'
        and a.content like p_what || '%'
   );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3b. Evidence we cannot attribute is FLAGGED, never allocated
-- ---------------------------------------------------------------------------
-- A merchant with two live MCA deals (a renewal opened while the first is still
-- working) has ONE signature row and ONE set of sent documents, because both
-- attach to the customer. Picking one is worse than doing nothing: it advances
-- a deal on another deal's paperwork, and the wrong one silently looks ready.
--
-- Today no customer has more than one live MCA deal — all 128 have exactly one —
-- so this is a case that has not happened yet. It will, the first time a renewal
-- overlaps, and the version of this gate that "handles it in the nightly
-- reconcile" was a silent no-op wearing a comment. Ambiguity is a question; the
-- gate asks it on every candidate deal rather than answering it.
--
-- Flags EVERY live deal, not the customer, because the person who needs to
-- resolve it is whoever opens either deal. Once per deal per marker.

create or replace function public.stage_gate_flag_ambiguous(
  p_customer_id uuid,
  p_what        text,
  p_when        timestamptz
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n integer;
begin
  select count(*) into v_n
    from public.deals d
   where d.customer_id = p_customer_id
     and d.deal_type = 'mca'
     and d.status not in ('funded', 'renewal_eligible', 'restructure_executed',
                          'servicing', 'nurture', 'declined', 'dead');

  insert into public.activity_log (entity_type, entity_id, interaction_type, subject, content)
  select 'deal', d.id, 'note', 'evidence:ambiguous-deal',
         p_what || ' on ' || to_char(p_when, 'YYYY-MM-DD HH24:MI') || ' UTC, but this merchant has '
         || v_n || ' live MCA deals and the evidence attaches to the merchant, not to one deal. '
         || 'NO stage was changed on any of them — advancing the wrong deal would make it look ready '
         || 'to submit on another deal''s paperwork. Whoever owns these decides which one this belongs '
         || 'to and moves it by hand.'
    from public.deals d
   where d.customer_id = p_customer_id
     and d.deal_type = 'mca'
     and d.status not in ('funded', 'renewal_eligible', 'restructure_executed',
                          'servicing', 'nurture', 'declined', 'dead')
     and not exists (
       select 1 from public.activity_log a
        where a.entity_type = 'deal' and a.entity_id = d.id
          and a.subject = 'evidence:ambiguous-deal'
          and a.content like p_what || '%'
     );
end;
$function$;

comment on function public.stage_gate_flag_ambiguous(uuid, text, timestamptz) is
  'Customer-level evidence arrived for a merchant with several live MCA deals. Flags every '
  'one of them and moves none — picking would advance a deal on another deal''s paperwork.';

-- ---------------------------------------------------------------------------
-- 4. GATE — we sent an application
-- ---------------------------------------------------------------------------
-- Evidence: a row in ghl_document_recipients naming an application document,
-- which exists only because ghl-doc-sweep read that document back OUT of GHL.
-- This is the same source deal_send_evidence() calls 'has_evidence', and it is
-- deliberately not deals.application_sent_at — that column is written by stage
-- moves, so trusting it would let a stage move prove itself.
--
-- is_application_doc_name() returns FALSE for anything matching 'disclosure',
-- so the Broker Compensation Disclosure cannot trigger this. It is not the
-- application and it never was.
--
-- Stamp comes from doc_created_at: when the document was raised in GHL, which
-- is the send. No new GHL calls — the sweep that fills this table already runs
-- hourly and again nightly.

create or replace function public.ghl_document_recipients_advance_stage()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_customer uuid;
  v_matches  integer;
  v_r        record;
begin
  -- Stage bookkeeping must never fail the sweep that is recording evidence.
  begin
    if not public.is_application_doc_name(NEW.doc_name) then
      return NEW;
    end if;

    -- Resolve the merchant across the whole contact SET and every known email —
    -- a merchant is not one GHL contact id, and a document sent to a sibling
    -- address is still that merchant's document.
    select count(*), min(c.id) into v_matches, v_customer
      from public.customers c
     where (NEW.contact_id is not null
            and (c.ghl_contact_id = NEW.contact_id
                 or NEW.contact_id = any (coalesce(c.ghl_contact_ids, '{}'::text[]))))
        or (NEW.recipient_email is not null
            and (lower(btrim(c.email)) = lower(btrim(NEW.recipient_email))
                 or lower(btrim(NEW.recipient_email)) = any (
                      select lower(btrim(x))
                        from unnest(coalesce(c.additional_emails, '{}'::text[])) x)));

    -- Nobody, or two merchants who share an address: say nothing rather than
    -- advance the wrong deal.
    if coalesce(v_matches, 0) <> 1 or v_customer is null then
      return NEW;
    end if;

    select * into v_r from public.stage_gate_resolve_deal(v_customer);

    if v_r.live_count = 1 then
      perform public.deals_advance_status(
        v_r.live_deal_id, 'application_sent',
        NEW.doc_created_at, 'evidence:app_document');
    elsif v_r.live_count = 0 and v_r.parked_deal_id is not null then
      perform public.stage_gate_flag_ahead(
        v_r.parked_deal_id, 'An application document went out', NEW.doc_created_at);
    elsif v_r.live_count > 1 then
      perform public.stage_gate_flag_ambiguous(
        v_customer, 'An application document went out', NEW.doc_created_at);
    end if;
  exception when others then
    raise warning 'ghl_document_recipients_advance_stage skipped: %', sqlerrm;
  end;

  return NEW;
end;
$function$;

drop trigger if exists trg_ghl_document_recipients_advance_stage on public.ghl_document_recipients;
create trigger trg_ghl_document_recipients_advance_stage
  after insert on public.ghl_document_recipients
  for each row execute function public.ghl_document_recipients_advance_stage();

comment on function public.ghl_document_recipients_advance_stage() is
  'Gate: an application document read back out of GHL advances the merchant''s single '
  'live MCA deal to application_sent, stamped with the document''s own creation time. '
  'Disclosures are excluded by is_application_doc_name(). Never fails the sweep.';

-- ---------------------------------------------------------------------------
-- 5. GATE — they signed it
-- ---------------------------------------------------------------------------
-- The signature lands in ghl_doc_completions. customer_application_signatures
-- is a VIEW over that table (one row per customer, max signed_at), so the
-- trigger goes on the table underneath it.
--
-- The rung is docs_collected, not application_sent: the send and the return are
-- two different events by two different parties, and collapsing them would
-- lose the distinction the chase clock depends on.

create or replace function public.ghl_doc_completions_advance_stage()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_signed timestamptz;
  v_r      record;
begin
  begin
    if NEW.customer_id is null or not public.is_application_doc_name(NEW.doc_name) then
      return NEW;
    end if;

    -- Same definition the view uses.
    v_signed := coalesce(NEW.signed_at, NEW.completed_seen_at);
    if v_signed is null then
      return NEW;
    end if;

    -- On UPDATE, only a signature that just APPEARED is news. Re-saving an
    -- unrelated column on a document signed last week is not a new event.
    if TG_OP = 'UPDATE'
       and coalesce(OLD.signed_at, OLD.completed_seen_at) is not distinct from v_signed then
      return NEW;
    end if;

    select * into v_r from public.stage_gate_resolve_deal(NEW.customer_id);

    if v_r.live_count = 1 then
      perform public.deals_advance_status(
        v_r.live_deal_id, 'docs_collected', v_signed, 'evidence:app_signature');
    elsif v_r.live_count = 0 and v_r.parked_deal_id is not null then
      perform public.stage_gate_flag_ahead(
        v_r.parked_deal_id, 'The merchant signed their application', v_signed);
    elsif v_r.live_count > 1 then
      perform public.stage_gate_flag_ambiguous(
        NEW.customer_id, 'The merchant signed their application', v_signed);
    end if;
  exception when others then
    raise warning 'ghl_doc_completions_advance_stage skipped: %', sqlerrm;
  end;

  return NEW;
end;
$function$;

drop trigger if exists trg_ghl_doc_completions_advance_stage on public.ghl_doc_completions;
create trigger trg_ghl_doc_completions_advance_stage
  after insert or update of signed_at, completed_seen_at on public.ghl_doc_completions
  for each row execute function public.ghl_doc_completions_advance_stage();

comment on function public.ghl_doc_completions_advance_stage() is
  'Gate: a SIGNED application (not a disclosure) advances the merchant''s single live MCA '
  'deal to docs_collected, stamped with the signature time. Sits on the table beneath the '
  'customer_application_signatures view. Never fails the sweep.';

-- ---------------------------------------------------------------------------
-- 6. The dry run — what the gates WOULD do, without doing any of it
-- ---------------------------------------------------------------------------
-- Read-only. One row per deal that sits below its own evidence, saying which
-- rule fires, what it would set, and whether it moves or only flags.
--
-- "Below" is measured against the greater of status and previous_status,
-- because a parked deal that reached application_sent before it was parked is
-- not mis-staged — it is parked. Without that, 61 deals look wrong and 24
-- actually are.

create or replace function public.stage_evidence_dryrun()
returns table(
  deal_number     text,
  business_name   text,
  current_status  text,
  pre_park_status text,
  action          text,
  rule            text,
  target_status   text,
  would_stamp_at  timestamptz,
  evidence        text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with d as (
    select id, deal_number, status, previous_status, customer_id
      from public.deals where deal_type = 'mca'
  ),
  se as (select * from public.deal_send_evidence((select array_agg(id) from d))),
  sent as (
    select c.id as customer_id, min(r.doc_created_at) as first_sent
      from public.customers c
      join public.ghl_document_recipients r
        on public.is_application_doc_name(r.doc_name)
       and (r.contact_id = any (coalesce(c.ghl_contact_ids, '{}'::text[])
                                || case when c.ghl_contact_id is null then '{}'::text[]
                                        else array[c.ghl_contact_id] end)
            or lower(btrim(r.recipient_email)) = lower(btrim(c.email)))
     group by c.id
  ),
  sig as (select customer_id, app_signed_at from public.customer_application_signatures),
  bs as (
    select customer_id, count(*) n, min(created_at) first_at
      from public.customer_documents where document_type = 'bank_statement' group by 1
  ),
  e as (
    select d.*, c.business_name, se.verdict, se.evidence_docs,
           sent.first_sent, sig.app_signed_at,
           coalesce(bs.n, 0) as bs_n, bs.first_at as bs_first,
           greatest(coalesce(public.deals_stage_rank(d.status), -1),
                    coalesce(public.deals_stage_rank(d.previous_status), -1)) as eff_rank,
           (d.status in ('nurture', 'dead', 'declined')) as parked
      from d
      join public.customers c on c.id = d.customer_id
      left join se   on se.deal_id      = d.id
      left join sent on sent.customer_id = d.customer_id
      left join sig  on sig.customer_id  = d.customer_id
      left join bs   on bs.customer_id   = d.customer_id
  )
  select e.deal_number, e.business_name, e.status, e.previous_status,
         case when e.parked then 'FLAG ONLY' else 'WOULD MOVE' end,
         case when e.bs_n > 0                  and e.eff_rank < 5 then 'bank statement on file'
              when e.app_signed_at is not null and e.eff_rank < 4 then 'application signed'
              else 'application document sent' end,
         case when e.bs_n > 0                  and e.eff_rank < 5 then 'bank_statements'
              when e.app_signed_at is not null and e.eff_rank < 4 then 'docs_collected'
              else 'application_sent' end,
         case when e.bs_n > 0                  and e.eff_rank < 5 then e.bs_first
              when e.app_signed_at is not null and e.eff_rank < 4 then e.app_signed_at
              else e.first_sent end,
         concat_ws('; ',
           nullif('send verdict ' || coalesce(e.verdict, 'null')
                  || ' (' || coalesce(e.evidence_docs, 0) || ' doc)', ''),
           case when e.app_signed_at is not null then 'signed ' || e.app_signed_at::date::text end,
           case when e.bs_n > 0 then e.bs_n || ' bank statement(s)' end)
    from e
   where (e.verdict = 'has_evidence'      and e.eff_rank < 3)
      or (e.app_signed_at is not null     and e.eff_rank < 4)
      or (e.bs_n > 0                      and e.eff_rank < 5)
   order by e.parked, e.deal_number;
$function$;

revoke all on function public.stage_evidence_dryrun() from public, anon;
grant execute on function public.stage_evidence_dryrun() to authenticated, service_role;

comment on function public.stage_evidence_dryrun() is
  'READ-ONLY. Every MCA deal sitting below its own evidence, with the rule that would fire, '
  'the stage it would move to, and the timestamp it would stamp. Parked deals show as '
  'FLAG ONLY. Run and review this before enabling any backfill.';
