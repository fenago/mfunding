-- processor_pipeline_rows: stop re-inlining the "is this the application?" rule.
--
-- It carried gc.doc_name ~* 'application|prefill|partial'. That excludes today's
-- 'MCA — Broker Compensation Disclosure' only by luck of wording — a future doc
-- named "Application Disclosure" would silently flip the 2 disclosure-only
-- merchants to "application signed". The rule now lives in ONE place,
-- public.is_application_doc_name() (migration 20260917a), and this reader calls it.
-- Body is otherwise byte-identical to what was live.

CREATE OR REPLACE FUNCTION public.processor_pipeline_rows(p_pipe text DEFAULT 'mca'::text, p_sort text DEFAULT 'recent'::text, p_limit integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      (select concat_ws(' ', pt.first_name, pt.last_name)
         from public.activity_log al
         join public.profiles pt on pt.id = al.logged_by
        where al.entity_type = 'deal' and al.entity_id = b.id and al.logged_by is not null
        order by al.created_at desc limit 1) as last_touched_by,
      (select max(al.created_at) from public.activity_log al
        where al.entity_type = 'deal' and al.entity_id = b.id) as last_activity_at,
      (select max(gc.completed_seen_at) from public.ghl_doc_completions gc where gc.customer_id = b.customer_id and public.is_application_doc_name(gc.doc_name)) as app_signed_at,
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
  ),
  -- Only the rows this page actually renders. The helper is not inlinable (it
  -- is SECURITY DEFINER), so it is a real per-call cost proportional to the deal
  -- set — 41ms for today's 312 open deals. Computing it AFTER the rank/limit
  -- bounds that cost at p_limit deals permanently, instead of letting it grow
  -- with the whole board. No effect on today's numbers (312 < 500).
  page as (
    select * from ranked r where r.rn <= p_limit
  ),
  ev as (
    select e.deal_id,
           count(*)::int as n,
           bool_or((e.at at time zone 'America/New_York')::date
                   = (now() at time zone 'America/New_York')::date) as today
      from public.deal_call_events(array(select p.id from page p)) e
     group by e.deal_id
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
      -- STALE MEANS UNWORKED, NOT OLD.
      -- This used to be `days_in_pipeline >= 14`, i.e. days since the deal was
      -- CREATED — nothing to do with whether anyone had touched it. The bucket
      -- is labelled "Two weeks, no traction", so it was telling the processor to
      -- nurture merchants they had called that same week: on 2026-09-13 it
      -- flagged 128 of 155 open deals (83%), 22 of which had been worked in the
      -- previous 7 days. Now it measures the real last touch — the newest of any
      -- logged activity or any contact attempt — falling back to created_at for
      -- a deal nobody has touched at all (correctly stale once it ages out).
      'days_since_touch', floor(extract(epoch from (now() - greatest(
          coalesce(r.last_activity_at, r.created_at),
          coalesce(r.last_contact_at,  r.created_at),
          r.created_at))) / 86400.0)::int,
      'is_stale', (greatest(
          coalesce(r.last_activity_at, r.created_at),
          coalesce(r.last_contact_at,  r.created_at),
          r.created_at) < now() - make_interval(days => c_stale_days)),
      'assigned_closer_id', r.assigned_closer_id,
      'closer_name', nullif(btrim(concat_ws(' ', r.cl_first, r.cl_last)), ''),
      'callback_at', r.callback_at,
      'appointment_at', r.appointment_at,
      'last_contact_at', r.last_contact_at,
      'has_bank_statements', (r.bs_count > 0),
      'bank_statements_at', r.bank_statements_at,
      'bank_statement_count', r.bs_count,
      'touches_total', coalesce(ev.n, 0),
      'touched_today', coalesce(ev.today, false),
      'last_touched_by', nullif(btrim(r.last_touched_by), ''),
      'last_activity_at', r.last_activity_at,
      'application_signed_at', r.app_signed_at,
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
  from page r
  left join ev on ev.deal_id = r.id;

  return v_out;
end;
$function$
