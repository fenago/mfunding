-- Processor QA — explicit GO / NO-GO verdict (2026-08-31)
--
-- The QA step becomes a checklist + a clear go/no-go decision (submit / don't
-- submit). A GO flags the deal into the owner's queue to run through the AI
-- Underwriter; a NO-GO records a reason and sends it back into the funnel for the
-- processor to fix. Adds decision columns + processor_qa_decision(), and surfaces
-- the decision on both reader functions.

-- 1. Decision columns on the QA row.
alter table public.deal_processor_qa
  add column if not exists decision        text,
  add column if not exists decision_at     timestamptz,
  add column if not exists decision_by      uuid references public.profiles(id),
  add column if not exists decision_reason  text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deal_processor_qa_decision_check') then
    alter table public.deal_processor_qa
      add constraint deal_processor_qa_decision_check
      check (decision is null or decision in ('go','no_go'));
  end if;
end$$;

-- 2. processor_qa_decision — record the go/no-go verdict.
--    GO   → requires bank statements on file; stamps qa_passed + submission_ready
--           (the owner's "ready for AI Underwriter" queue). Clears any prior reason.
--    NO-GO→ requires a reason; clears submission_ready and qa_passed so it drops
--           back into the funnel flagged for rework.
create or replace function public.processor_qa_decision(
  p_deal_id  uuid,
  p_decision text,
  p_reason   text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_has_bs boolean;
  v_ready timestamptz;
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

  -- Make sure a QA row exists to update.
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
       set qa_passed          = true,
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

    insert into public.activity_log(entity_type, entity_id, interaction_type, subject, content, logged_by)
    values ('deal', p_deal_id, 'note', 'QA verdict: GO — ready for AI Underwriter (processor)', null, v_uid);
  else
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'A NO-GO needs a reason' using errcode = 'P0001';
    end if;

    update public.deal_processor_qa
       set qa_passed          = false,
           decision            = 'no_go',
           decision_at         = now(),
           decision_by         = v_uid,
           decision_reason     = p_reason,
           submission_ready_at = null,
           submission_ready_by = null,
           updated_at          = now()
     where deal_id = p_deal_id;

    insert into public.activity_log(entity_type, entity_id, interaction_type, subject, content, logged_by)
    values ('deal', p_deal_id, 'note', 'QA verdict: NO-GO — do not submit (processor)', p_reason, v_uid);
  end if;

  return jsonb_build_object('ok', true, 'decision', p_decision, 'submission_ready_at', v_ready);
end;
$function$;

revoke all on function public.processor_qa_decision(uuid, text, text) from public, anon;
grant execute on function public.processor_qa_decision(uuid, text, text) to authenticated, service_role;

-- 3. processor_deal_detail — expose the decision in the qa object.
create or replace function public.processor_deal_detail(p_deal_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null or not (public.is_processor(v_uid) or public.is_ops_staff(v_uid)) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'deal', to_jsonb(d),
    'customer', to_jsonb(c),
    'application', (select to_jsonb(a) from public.mca_applications a where a.deal_id = d.id limit 1),
    'documents', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', cd.id,
          'file_name', cd.filename,
          'category', cd.document_type::text,
          'created_at', cd.created_at,
          'storage_path', cd.storage_path,
          'is_bank_statement', (cd.document_type = 'bank_statement')
        ) order by cd.created_at desc
      ), '[]'::jsonb)
      from public.customer_documents cd
      where cd.customer_id = d.customer_id
    ),
    'qa', jsonb_build_object(
      'checklist', coalesce(q.checklist, '{}'::jsonb),
      'qa_passed', coalesce(q.qa_passed, false),
      'qa_passed_at', q.qa_passed_at,
      'qa_passed_by_name', nullif(btrim(concat_ws(' ', qpa.first_name, qpa.last_name)), ''),
      'submission_ready_at', q.submission_ready_at,
      'submission_ready_by_name', nullif(btrim(concat_ws(' ', qra.first_name, qra.last_name)), ''),
      'decision', q.decision,
      'decision_reason', q.decision_reason,
      'decision_at', q.decision_at,
      'decision_by_name', nullif(btrim(concat_ws(' ', qda.first_name, qda.last_name)), ''),
      'notes', q.notes
    )
  )
    into v_out
  from public.deals d
  join public.customers c on c.id = d.customer_id
  left join public.deal_processor_qa q on q.deal_id = d.id
  left join public.profiles qpa on qpa.id = q.qa_passed_by
  left join public.profiles qra on qra.id = q.submission_ready_by
  left join public.profiles qda on qda.id = q.decision_by
  where d.id = p_deal_id;

  if v_out is null then
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;
  return v_out;
end;
$function$;

-- 4. processor_pipeline_rows — expose qa_decision + reason on each row.
create or replace function public.processor_pipeline_rows(
  p_pipe text default 'mca'::text,
  p_sort text default 'recent'::text,
  p_limit integer default 500
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid   := auth.uid();
  v_out    jsonb;
  v_stages text[];
  c_stale_days constant int := 14;
begin
  if v_uid is null or not (public.is_processor(v_uid) or public.is_ops_staff(v_uid)) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    p_limit := 500;
  end if;

  if lower(coalesce(p_pipe, 'mca')) = 'vcf' then
    v_stages := array['new_distressed','hardship_consult','positions_analysis',
                      'strategy_proposal','agreement_sent','submitted_to_vcf',
                      'restructure_executed','servicing'];
  else
    v_stages := array['new','contacted','qualifying','application_sent',
                      'docs_collected','bank_statements','submitted_to_funder',
                      'offer_received','offer_presented','offer_accepted',
                      'funded','renewal_eligible','nurture'];
  end if;

  with base as (
    select
      d.id, d.deal_number, d.status, d.deal_type, d.created_at,
      d.amount_requested, d.assigned_closer_id, d.customer_id,
      d.callback_at, d.appointment_at, d.bank_statements_at,
      greatest(d.spoke_at, d.last_attempt_at, d.contacted_at) as last_contact_at,
      floor(extract(epoch from (now() - d.created_at)) / 86400.0)::int as days_in_pipeline,
      cu.business_name, cu.first_name as cu_first, cu.last_name as cu_last,
      cu.phone, cu.email, cu.do_not_contact,
      pr.first_name as cl_first, pr.last_name as cl_last,
      q.qa_passed as qa_passed, q.qa_passed_at as qa_passed_at,
      q.submission_ready_at as submission_ready_at,
      q.decision as qa_decision, q.decision_reason as qa_decision_reason
    from public.deals d
    left join public.customers cu on cu.id = d.customer_id
    left join public.profiles  pr on pr.id = d.assigned_closer_id
    left join public.deal_processor_qa q on q.deal_id = d.id
    where d.status = any(v_stages)
  ),
  enriched as (
    select b.*,
      (select count(*)::int
         from public.customer_documents cd
        where cd.customer_id = b.customer_id
          and cd.document_type = 'bank_statement') as bs_count,
      (select w.profile_id
         from public.processor_working w
        where w.deal_id = b.id
        order by w.created_at asc
        limit 1) as wb_id,
      exists(select 1 from public.processor_working w
              where w.deal_id = b.id and w.profile_id = v_uid) as wb_mine
    from base b
  ),
  ranked as (
    select e.*,
      wp.first_name as wb_first, wp.last_name as wb_last,
      row_number() over (order by
        case when p_sort = 'recent'  then e.created_at end desc nulls last,
        case when p_sort = 'amount'  then e.amount_requested end desc nulls last,
        case when p_sort = 'callback' then e.callback_at end asc nulls last,
        case when p_sort = 'closer'  then lower(coalesce(e.cl_last, e.cl_first, '~')) end asc nulls last,
        case when p_sort = 'stage'   then array_position(v_stages, e.status) end asc nulls last,
        case when p_sort = 'age'     then e.created_at end asc nulls last,
        e.created_at desc nulls last
      ) as rn
    from enriched e
    left join public.profiles wp on wp.id = e.wb_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'deal_number', r.deal_number,
      'status', r.status,
      'deal_type', r.deal_type,
      'business_name', r.business_name,
      'contact_name', nullif(btrim(concat_ws(' ', r.cu_first, r.cu_last)), ''),
      'phone', r.phone,
      'email', r.email,
      'do_not_contact', coalesce(r.do_not_contact, false),
      'amount_requested', r.amount_requested,
      'created_at', r.created_at,
      'days_in_pipeline', r.days_in_pipeline,
      'is_stale', (r.days_in_pipeline >= c_stale_days),
      'assigned_closer_id', r.assigned_closer_id,
      'closer_name', nullif(btrim(concat_ws(' ', r.cl_first, r.cl_last)), ''),
      'callback_at', r.callback_at,
      'appointment_at', r.appointment_at,
      'last_contact_at', r.last_contact_at,
      'has_bank_statements', (r.bs_count > 0),
      'bank_statements_at', r.bank_statements_at,
      'bank_statement_count', r.bs_count,
      'working_by', r.wb_id,
      'working_by_name', nullif(btrim(concat_ws(' ', r.wb_first, r.wb_last)), ''),
      'working_is_mine', r.wb_mine,
      'qa_passed', coalesce(r.qa_passed, false),
      'qa_passed_at', r.qa_passed_at,
      'submission_ready_at', r.submission_ready_at,
      'qa_decision', r.qa_decision,
      'qa_decision_reason', r.qa_decision_reason,
      'application', (select to_jsonb(a) from public.mca_applications a where a.deal_id = r.id limit 1)
    ) order by r.rn
  ), '[]'::jsonb)
    into v_out
  from ranked r
  where r.rn <= p_limit;

  return v_out;
end;
$function$;
