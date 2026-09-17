-- Two readability asks from the chase UI, both cheap and both correct.
--
-- 1. processor_application_queue() returns ghl_contact_id. The tab's on-demand
--    "check signature" action needed it and was doing a second batched read of
--    customers purely to find it.
--
-- 2. processor_pipeline_rows() gains the same tri-state the queue returns:
--    app_signed_state ('signed' | 'not_signed' | 'unchecked') + the
--    app_signed_checked_at that justifies it. The Processor board row and the
--    cockpit drawer are fed by this RPC and had no readability channel at all,
--    so the UI was forced to render "Signature unknown" for everything not
--    positively signed — honest, but weaker than the data now supports.
--    It also now reads the signature through public.customer_application_signatures,
--    so it inherits the merchant's real signedDate instead of the
--    completed_seen_at "when we noticed" timestamp, and there is one definition
--    of the signature rule rather than a fourth copy.

begin;

drop function if exists public.processor_application_queue();
CREATE OR REPLACE FUNCTION public.processor_application_queue()
 RETURNS TABLE(deal_id uuid, deal_number text, merchant_name text, deal_status text, deal_type text, customer_id uuid, ghl_contact_id text, do_not_contact boolean, assigned_closer_id uuid, assigned_closer_name text, app_sent_at timestamp with time zone, app_sent_by uuid, app_sent_by_name text, app_sent_attribution text, app_sent_attribution_basis text, born_at_application_sent boolean, app_signed_at timestamp with time zone, app_signed_state text, app_signed_checked_at timestamp with time zone, disclosure_signed_at timestamp with time zone, disclosure_state text, statements_count integer, statements_last_at timestamp with time zone, qa_decision text, qa_decided_at timestamp with time zone, qa_decision_reason text, days_since_app_sent integer, first_call_due_at timestamp with time zone, attempts_since_sent integer, last_attempt_at timestamp with time zone, last_conversation_at timestamp with time zone, app_row_exists boolean, app_fields jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  c_max constant int := 500;
begin
  if v_uid is null or not (public.is_processor(v_uid) or public.is_ops_staff(v_uid)) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select array_agg(d.id order by d.application_sent_at desc nulls last, d.created_at desc)
    into v_ids
    from public.deals d
   where d.deal_type = 'mca'
     and (
       d.application_sent_at is not null
       or exists (select 1 from public.mca_applications a where a.deal_id = d.id)
       or coalesce(public.deals_stage_rank(d.status), -1) >= 2
       -- A SIGNED application with no sent stamp and an early stage would
       -- otherwise be invisible to the one queue meant to catch it. Live proof:
       -- Express Redemption (MF-2026-0113) signed on 2026-07-22 and sat at
       -- 'contacted' for two months because nothing recorded a send.
       or exists (
         select 1 from public.customer_application_signatures s
          where s.customer_id = d.customer_id and s.app_signed_at is not null
       )
     );

  if v_ids is null then
    return;
  end if;
  if array_length(v_ids, 1) > c_max then
    v_ids := v_ids[1:c_max];
  end if;

  return query
  with calls as (
    -- REUSE the canonical call definition. Do not hand-roll a phone match here:
    -- deal_call_events already reconciles wavv / ghl / activity_log and dedupes
    -- the mirrors (see 20260916h).
    select e.deal_id, e.at, e.is_conversation
      from public.deal_call_events(v_ids) e
  ),
  agg as (
    select d.id,
           (select count(*)::int from calls k
             where k.deal_id = d.id
               and d.application_sent_at is not null
               and k.at >= d.application_sent_at)                       as attempts_since_sent,
           (select max(k.at) from calls k where k.deal_id = d.id)        as last_attempt_at,
           (select max(k.at) from calls k
             where k.deal_id = d.id and k.is_conversation)               as last_conversation_at
      from public.deals d
     where d.id = any (v_ids)
  )
  select
    d.id,
    d.deal_number,
    coalesce(nullif(btrim(c.business_name), ''),
             nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')),
    d.status,
    d.deal_type,
    d.customer_id,
    -- Returned so the UI's on-demand "check signature" action does not need a
    -- second batched read of customers just to find the contact id.
    c.ghl_contact_id,
    coalesce(c.do_not_contact, false),
    d.assigned_closer_id,
    nullif(btrim(concat_ws(' ', cl.first_name, cl.last_name)), ''),
    d.application_sent_at,
    -- Rung 4: no evidence, so the honest answer is whoever owns the deal. NULL
    -- only when the application was never sent — nothing to attribute.
    -- A phantom stamp is not a send, so it has no sender. This is the rule the
    -- readers already apply to a deal that was never sent — nothing to
    -- attribute, so NULL. Without it MF-2026-0324 reads "sent by Carlos Marquez".
    case when d.application_sent_at is null or ph.yes then null
         else coalesce(d.application_sent_by, d.assigned_closer_id) end,
    case when d.application_sent_at is null or ph.yes then null
         else coalesce(
           nullif(btrim(concat_ws(' ', sp.first_name, sp.last_name)), ''),
           nullif(btrim(concat_ws(' ', cl.first_name, cl.last_name)), '')
         ) end,
    case
      when d.application_sent_at is null or ph.yes then null
      when d.application_sent_attribution is not null then d.application_sent_attribution
      when d.assigned_closer_id is not null then 'assumed_owner'
      else 'unknown'
    end,
    case
      when ph.yes then
        'no send recorded here — the GHL opportunity mirror stamped this stage when the deal was created; any send happened inside GHL'
      when d.application_sent_at is null then null
      when d.application_sent_attribution is not null then d.application_sent_attribution_basis
      when d.assigned_closer_id is not null then
        'assumed: nobody recorded who sent it — this is the closer the deal is assigned to'
      else 'no record of who sent it, and the deal has no assigned closer'
    end,
    ph.yes,
    sig.app_signed_at,
    case
      when sig.app_signed_at is not null then 'signed'
      when c.ghl_contact_id is null or c.ghl_docs_checked_at is null then 'unchecked'
      else 'not_signed'
    end,
    c.ghl_docs_checked_at,
    sig.disclosure_signed_at,
    case
      when sig.disclosure_signed_at is not null then 'signed'
      when c.ghl_contact_id is null or c.ghl_docs_checked_at is null then 'unchecked'
      else 'not_signed'
    end,
    bs.n,
    bs.last_at,
    q.decision,
    q.decision_at,
    q.decision_reason,
    case when d.application_sent_at is null then null
         else floor(extract(epoch from (now() - d.application_sent_at)) / 86400.0)::int
    end,
    d.first_call_due_at,
    a.attempts_since_sent,
    a.last_attempt_at,
    a.last_conversation_at,
    (app.id is not null),
    jsonb_build_object(
      -- The saved draft, verbatim, or null when none exists. The TS helper
      -- switches on exactly this: a row means "hydrate", null means "seed".
      'application', case when app.id is null then null else to_jsonb(app) end,
      -- What the helper's SEED branch reads off the deal + customer + lead payload.
      'deal', jsonb_build_object(
        'id', d.id,
        'deal_type', d.deal_type,
        'status', d.status,
        'amount_requested', d.amount_requested,
        'use_of_funds', d.use_of_funds,
        'lead_qual', coalesce(d.lead_qual, '{}'::jsonb)
      ),
      'customer', jsonb_build_object(
        'id', c.id,
        'business_name', c.business_name,
        'first_name', c.first_name,
        'last_name', c.last_name,
        'email', c.email,
        'phone', c.phone,
        'industry', c.industry,
        'monthly_revenue', c.monthly_revenue,
        'address_street', c.address_street,
        'address_city', c.address_city,
        'address_state', c.address_state,
        'address_zip', c.address_zip
      )
    )
  from public.deals d
  join public.customers c on c.id = d.customer_id
  join agg a on a.id = d.id
  left join public.profiles cl on cl.id = d.assigned_closer_id
  left join public.profiles sp on sp.id = d.application_sent_by
  left join public.deal_processor_qa q on q.deal_id = d.id
  left join lateral (
    select * from public.mca_applications ma where ma.deal_id = d.id
     order by ma.updated_at desc nulls last limit 1
  ) app on true
  left join lateral (
    -- customer_documents is a LOCAL table: an empty result is a real zero, not
    -- an unreadable one, so no third state is invented here.
    select count(*)::int as n, max(cd.created_at) as last_at
      from public.customer_documents cd
     where cd.customer_id = d.customer_id
       and cd.document_type = 'bank_statement'
  ) bs on true
  left join public.customer_application_signatures sig on sig.customer_id = d.customer_id
  left join lateral (
    select public.is_phantom_application_send(
             d.application_sent_at, d.created_at, d.created_by,
             app.id is not null) as yes
  ) ph on true
  where d.id = any (v_ids)
  order by d.application_sent_at desc nulls last, d.created_at desc;
end;
$function$
;

revoke all on function public.processor_application_queue() from public, anon;
grant execute on function public.processor_application_queue() to authenticated, service_role;

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
      cu.ghl_contact_id, cu.ghl_docs_checked_at,
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
      (select s.app_signed_at from public.customer_application_signatures s
        where s.customer_id = b.customer_id) as app_signed_at,
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
      -- Readability channel. 'unchecked' is NOT 'not_signed': ghl_doc_completions
      -- is a mirror, and a customer we have never read has an unknown signature,
      -- not an absent one. Same tri-state processor_application_queue() returns.
      'app_signed_state', case
         when r.app_signed_at is not null then 'signed'
         when r.ghl_contact_id is null or r.ghl_docs_checked_at is null then 'unchecked'
         else 'not_signed'
       end,
      'app_signed_checked_at', r.ghl_docs_checked_at,
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
;

revoke all on function public.processor_pipeline_rows(text, text, integer) from public, anon;
grant execute on function public.processor_pipeline_rows(text, text, integer) to authenticated, service_role;

commit;

-- ── The checked-at scope was under-claiming what the crawl proves ───────────
--
-- ghl_docs_mark_checked() stamped only the application-chase scope. But
-- ghl-doc-sweep reads status=completed for the WHOLE LOCATION — every signature
-- in the account, in two API calls. Once that crawl succeeds, an absent
-- signature is proven absent for EVERY contact, not just the ones a processor
-- happens to be chasing.
--
-- Measured consequence of the narrow scope: on the Processor board (323 rows,
-- wider than the chase queue) 251 rows read 'unchecked' purely because their
-- customer sat outside the chase scope — even though the sweep had just
-- established there is no signature for them. That is the mirror image of the
-- bug this workstream exists to kill: under-claiming knowledge we actually have
-- is not as harmful as over-claiming it, but it is still wrong, and it makes the
-- honest tri-state look broken.
--
-- Scope is now every customer with a GHL contact id. Still bounded (338 today),
-- still once an hour, still only after a COMPLETE crawl.
create or replace function public.ghl_docs_mark_checked(p_checked_at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n integer;
begin
  if auth.uid() is not null then
    raise exception 'ghl_docs_mark_checked is service-role only' using errcode = '42501';
  end if;

  -- A complete crawl of the location's completed documents has seen every
  -- signature that exists, so absence is established for every linked contact.
  -- A customer with NO ghl_contact_id is untouched: there is nothing to have
  -- looked at, and they stay honestly 'unchecked'.
  update public.customers c
     set ghl_docs_checked_at = p_checked_at
   where c.ghl_contact_id is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function public.ghl_docs_mark_checked(timestamptz) from public, anon, authenticated;
grant execute on function public.ghl_docs_mark_checked(timestamptz) to service_role;

comment on function public.ghl_docs_mark_checked(timestamptz) is
  'Stamps customers.ghl_docs_checked_at for every customer with a GHL contact id. Call ONLY after a crawl that read the ENTIRE completed-document set — a partial crawl must never mark the book as checked. A customer with no contact id is left unchecked: there was nothing to look at.';
