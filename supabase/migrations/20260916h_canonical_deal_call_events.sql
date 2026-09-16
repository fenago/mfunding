-- One definition of "a call on this deal". ═══════════════════════════════════
--
-- Three surfaces counted touches three different ways:
--
--   realtime_lead_call_history  wavv + ghl + activity + processor_touches,
--                               DEDUPED (rank wavv>ghl>activity>manual, drop a
--                               strictly-lower-ranked row within 180s + the
--                               keeper's duration), WAVV attributed to a deal by
--                               a created_at window.  ← the correct one
--   processor_deal_detail       processor_touches + activity + wavv, RAW SUM,
--                               no ghl at all, no deal window on WAVV.
--   processor_pipeline_rows     processor_touches + activity, RAW SUM.
--
-- So the drawer, the board and the Hot Leads panel disagreed about the same
-- deal. Measured on live open deals, against processor_deal_detail's own source
-- set: 7 deals counted an activity_log row that falls inside a WAVV call's
-- window, plus 1 deal counting the single legacy processor_touches row that
-- already has an activity_log twin — 8 deals reading one touch too many.
--
-- The bigger distortion is what those two RAW SUMS could not see. The GHL event
-- hook writes BOTH a ghl_call_log row AND an activity_log 'call' row for the
-- same physical call: across open deals that is 861 ghl rows and 763 activity
-- rows, of which 703 are mirrors of each other. processor_deal_detail counted
-- the mirrors and ignored the originals, so a GHL click-to-call with no
-- activity twin (158 of them) counted as ZERO touches there while Hot Leads
-- counted it as one.
--
-- public.deal_call_events() is now the single definition. All three read it.
--
-- processor_touches is dropped as a SOURCE (instruction: stop summing a store
-- nothing writes, which can now only contribute a duplicate). The table and its
-- one row stay exactly where they are — no data is deleted — and that row is
-- still counted, through the activity_log twin it has always had.

-- ── The helper ───────────────────────────────────────────────────────────────
-- ⚠ DOES NO VISIBILITY CHECK. It is a building block for SECURITY DEFINER
-- functions that have ALREADY authorised the caller and filtered the deal ids
-- they pass in. It is deliberately NOT granted to authenticated/anon, so it
-- cannot be called directly to read around the money wall.

create or replace function public.deal_call_events(p_deal_ids uuid[])
returns table (
  deal_id     uuid,
  at          timestamptz,
  source      text,
  src_rank    int,
  disposition text,
  seconds     int,
  who         text,
  note        text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with windowed as (
    -- Where this deal's claim on the customer's phone history ends: the next
    -- deal the same customer opened. Calls from then on belong to THAT deal.
    select d.id, d.customer_id, d.created_at, c.phone,
           (select min(d2.created_at)
              from public.deals d2
             where d2.customer_id = d.customer_id
               and d2.created_at > d.created_at) as next_deal_at
      from public.deals d
      join public.customers c on c.id = d.customer_id
     where d.id = any (p_deal_ids)
  ),
  raw_calls as (
    -- 1. WAVV — the primary dialer. Phone-keyed, so attributed by the window.
    select x.id                                           as deal_id,
           w.started_at                                   as at,
           'wavv'::text                                   as source,
           1                                              as src_rank,
           -- WAVV writes the literal string 'None' when the setter hung up
           -- without picking a disposition row. Rendering "— None" next to a
           -- call reads as a result; falling through to the outcome says what
           -- actually happened.
           coalesce(
             nullif(nullif(btrim(w.disposition), ''), 'None'),
             initcap(replace(lower(coalesce(w.outcome, 'call')), '_', ' '))
           )                                              as disposition,
           w.seconds                                      as seconds,
           -- agent_name is NULL on every live wavv_calls row, so
           -- closers.ghl_user_id is the ONLY way this row can say who dialed.
           coalesce(
             nullif(btrim(w.agent_name), ''),
             nullif(btrim(concat_ws(' ', wc.first_name, wc.last_name)), '')
           )                                              as who,
           nullif(btrim(coalesce(w.note, '')), '')        as note
      from windowed x
      join public.wavv_calls w
        on x.phone is not null
       and right(regexp_replace(w.phone, '[^0-9]', '', 'g'), 10)
         = right(regexp_replace(x.phone, '[^0-9]', '', 'g'), 10)
       and w.started_at >= x.created_at - interval '30 minutes'
       and (x.next_deal_at is null
            or w.started_at < x.next_deal_at - interval '30 minutes')
      left join public.closers wc on wc.ghl_user_id = w.agent_key

    union all

    -- 2. GHL / LeadConnector calls, already keyed to the deal.
    select x.id, g.called_at, 'ghl', 2,
           coalesce(nullif(btrim(g.disposition), ''),
                    initcap(nullif(btrim(g.call_status), ''))),
           g.duration_seconds,
           coalesce(
             nullif(btrim(g.ghl_user_name), ''),
             nullif(btrim(concat_ws(' ', gc.first_name, gc.last_name)), '')
           ),
           null::text
      from windowed x
      join public.ghl_call_log g on g.deal_id = x.id
      left join public.closers gc on gc.ghl_user_id = g.ghl_user_id

    union all

    -- 3. activity_log call rows: every hand-logged dial (log_contact_attempt)
    --    plus the GHL hook's own mirror of (2), which the dedupe removes.
    select x.id, al.created_at, 'activity', 3,
           nullif(btrim(al.subject), ''),
           null::int,
           coalesce(
             nullif(btrim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
             (regexp_match(al.subject, '— by (.+)$'))[1]
           ),
           nullif(btrim(left(coalesce(al.content, ''), 160)), '')
      from windowed x
      join public.activity_log al
        on al.entity_type = 'deal' and al.entity_id = x.id
       and al.interaction_type = 'call'
      left join public.profiles ap on ap.id = al.logged_by
  )
  -- THE canonical dedupe: a row dies only to a STRICTLY higher-ranked row on the
  -- same deal within 180s plus the keeper's own duration. Never within a source,
  -- so two genuine dials logged a minute apart both count.
  select r.deal_id, r.at, r.source, r.src_rank, r.disposition, r.seconds, r.who, r.note
    from raw_calls r
   where not exists (
     select 1
       from raw_calls k
      where k.deal_id = r.deal_id
        and k.src_rank < r.src_rank
        and abs(extract(epoch from (k.at - r.at))) <= 180 + coalesce(k.seconds, 0)
   );
$function$;

revoke all on function public.deal_call_events(uuid[]) from public, anon, authenticated;
grant execute on function public.deal_call_events(uuid[]) to service_role;

comment on function public.deal_call_events(uuid[]) is
  'THE definition of the calls on a deal: wavv_calls (phone-matched inside the deal''s created_at window) + ghl_call_log + activity_log ''call'' rows, deduped rank wavv>ghl>activity by 180s + the keeper''s duration, never within a source. NO VISIBILITY CHECK — callers must authorise and filter the deal ids first, which is why it is granted to service_role only. Read by realtime_lead_call_history, processor_deal_detail and processor_pipeline_rows so those three can no longer disagree about one deal.';

-- ── 1. realtime_lead_call_history — same behaviour, one fewer copy ───────────
-- The money wall stays HERE (it decides which deals may be read); only the
-- event assembly moves into the helper. processor_touches drops out as a
-- source: its one row is already counted through its activity_log twin.

create or replace function public.realtime_lead_call_history(p_deal_ids uuid[])
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_ops   boolean;
  v_proc  boolean;
  v_ids   uuid[];
  v_out   jsonb;
  -- Matches ROW_CAP in HotLeadsPanel.tsx. A caller asking for more than the
  -- panel can render is not the panel.
  c_max_deals constant int := 200;
  -- Individual calls returned per deal. `attempts` is always the TRUE total,
  -- even when the array is capped — the count is never silently truncated.
  c_max_calls constant int := 60;
begin
  if v_uid is null or not public.is_staff_reader(v_uid) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if p_deal_ids is null or array_length(p_deal_ids, 1) is null then
    return '{}'::jsonb;
  end if;
  if array_length(p_deal_ids, 1) > c_max_deals then
    raise exception 'Too many deals requested (max %)', c_max_deals using errcode = '22023';
  end if;

  v_ops := public.is_ops_staff(v_uid);
  -- A PROCESSOR works the WHOLE board (owner ruling; same exemption the deals
  -- RLS and the processor_* RPCs already carry). Without this a processor's
  -- hot-lead rows come back EMPTY, which the panel correctly renders as
  -- "call history unreadable" — honest, but useless to the people who work
  -- these leads all day.
  v_proc := public.is_processor(v_uid);

  -- The money wall's own SELECT predicate, re-stated. Ops staff see everything;
  -- a setter sees their own book plus unassigned. Anything else drops out here
  -- and therefore never appears in the result at all.
  select array_agg(d.id) into v_ids
    from public.deals d
   where d.id = any (p_deal_ids)
     and (
       v_ops
       or v_proc
       or d.assigned_closer_id is null
       or d.assigned_closer_id = v_uid
       or d.created_by = v_uid
       or d.assigned_closer_id = any (public.my_closer_ids(v_uid))
     );

  if v_ids is null then
    return '{}'::jsonb;
  end if;

  with numbered as (
    select e.*,
           row_number() over (partition by e.deal_id order by e.at desc) as rn,
           count(*)      over (partition by e.deal_id)                   as total
      from public.deal_call_events(v_ids) e
  )
  select coalesce(jsonb_object_agg(g.deal_id, g.payload), '{}'::jsonb)
    into v_out
  from (
    select w.id::text as deal_id,
           jsonb_build_object(
             'attempts', coalesce(max(n.total), 0),
             'last_at',          (array_agg(n.at          order by n.rn))[1],
             'last_disposition', (array_agg(n.disposition order by n.rn))[1],
             'last_by',          (array_agg(n.who         order by n.rn))[1],
             'last_source',      (array_agg(n.source      order by n.rn))[1],
             'calls', coalesce(
               jsonb_agg(
                 jsonb_build_object(
                   'at', n.at,
                   'source', n.source,
                   'disposition', n.disposition,
                   'seconds', n.seconds,
                   'who', n.who
                 ) order by n.rn
               ) filter (where n.rn <= c_max_calls),
               '[]'::jsonb)
           ) as payload
      from unnest(v_ids) as w(id)
      left join numbered n on n.deal_id = w.id
     group by w.id
  ) g;

  return v_out;
end;
$function$;

revoke all on function public.realtime_lead_call_history(uuid[]) from public, anon;
grant execute on function public.realtime_lead_call_history(uuid[]) to authenticated, service_role;

-- ── 2. processor_deal_detail — count and list the SAME events ────────────────
-- touches_total was three raw-summed terms; the touches array was the same
-- three unioned. Both now read the helper, so the number and the list can never
-- disagree, and neither can disagree with Hot Leads.

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

  with ev as (
    select * from public.deal_call_events(array[p_deal_id])
  )
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
    ),
    'touches_total', (select count(*) from ev),
    'touches', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'touched_at', e.at,
        -- The source still shows in the label — a WAVV dial and a hand-logged
        -- disposition are different evidence and the tracker says which.
        'outcome', case
                     when e.source = 'wavv' then 'WAVV: ' || coalesce(e.disposition, 'call')
                     when e.source = 'ghl'  then 'GHL: '  || coalesce(e.disposition, 'call')
                     else e.disposition
                   end,
        'note', e.note,
        'by_name', e.who
      ) order by e.at desc), '[]'::jsonb)
      from ev e
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

revoke all on function public.processor_deal_detail(uuid) from public, anon;
grant execute on function public.processor_deal_detail(uuid) to authenticated, service_role;

-- ── 3. processor_pipeline_rows — the board agrees with the drawer ────────────
-- touches_total / touched_today were processor_touches + activity_log, raw. The
-- board therefore also never counted a GHL click-to-call at all. One call to the
-- helper for the whole page, aggregated per deal.

create or replace function public.processor_pipeline_rows(p_pipe text default 'mca'::text, p_sort text default 'recent'::text, p_limit integer default 500)
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
      (select concat_ws(' ', pt.first_name, pt.last_name)
         from public.activity_log al
         join public.profiles pt on pt.id = al.logged_by
        where al.entity_type = 'deal' and al.entity_id = b.id and al.logged_by is not null
        order by al.created_at desc limit 1) as last_touched_by,
      (select max(al.created_at) from public.activity_log al
        where al.entity_type = 'deal' and al.entity_id = b.id) as last_activity_at,
      (select max(gc.completed_seen_at) from public.ghl_doc_completions gc where gc.customer_id = b.customer_id and gc.doc_name ~* 'application|prefill|partial') as app_signed_at,
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
$function$;

revoke all on function public.processor_pipeline_rows(text, text, integer) from public, anon;
grant execute on function public.processor_pipeline_rows(text, text, integer) to authenticated, service_role;
