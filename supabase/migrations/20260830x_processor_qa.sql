-- PROCESSOR QA / SUBMISSION-READINESS — data layer add-on (2026-08-30)
--
-- Adds the QA + "ready for submission" persistence on top of the existing
-- Processor workspace (migration 20260830w_processor_workspace.sql). The
-- processor's job: take any interested lead → complete application + bank
-- statements → run a QA check → flag READY FOR SUBMISSION (owner ruling: flag
-- only, never auto-advance deals.status). Everything here is gated on
-- is_processor(auth.uid()) OR is_ops_staff(auth.uid()). NO deals-table RLS is
-- touched.
--
-- The QA checklist ITEMS are owned by the frontend and stored as opaque jsonb —
-- SQL never enumerates or interprets them.
--
-- ── Ground-truth facts verified against the live DB before writing this ──
--   • public.deal_processor_qa did NOT exist prior to this migration.
--   • customer_document_type enum includes 'bank_statement'. Bank statements are
--     keyed by CUSTOMER (customer_documents.customer_id, no deal_id), so a deal's
--     bank statements = customer_documents rows for deals.customer_id with
--     document_type='bank_statement'.
--   • activity_log CHECK: entity_type in (customer,lender,marketing_vendor,deal);
--     interaction_type in (call,email,sms,note,meeting,voicemail,
--     document_uploaded,status_change,application_submitted,follow_up_scheduled).
--     'system' is NOT allowed → all system events log as interaction_type='note'.
--   • is_processor(uuid) / is_ops_staff(uuid) helpers exist (unchanged here).
--   • processor_pipeline_rows / processor_deal_detail current bodies captured
--     from pg_get_functiondef and preserved byte-for-byte below except the added
--     QA/readiness fields.

-- ===========================================================================
-- 1. deal_processor_qa — one QA/readiness row per deal (opaque checklist).
-- ===========================================================================
create table if not exists public.deal_processor_qa (
  deal_id            uuid primary key references public.deals(id) on delete cascade,
  checklist          jsonb not null default '{}'::jsonb,
  qa_passed          boolean not null default false,
  qa_passed_at       timestamptz,
  qa_passed_by       uuid references public.profiles(id),
  submission_ready_at timestamptz,
  submission_ready_by uuid references public.profiles(id),
  notes              text,
  updated_at         timestamptz default now()
);

comment on table public.deal_processor_qa is
  'Per-deal QA + submission-readiness state for the Processor workspace. checklist is OPAQUE per-item state owned by the frontend (SQL never enumerates it). Writes go through processor_save_qa / processor_mark_ready / processor_unmark_ready (SECURITY DEFINER); no direct client writes. Gated on is_processor OR is_ops_staff.';

alter table public.deal_processor_qa enable row level security;

-- SELECT for processor/ops. Writes are SECURITY-DEFINER-only (no INSERT/UPDATE
-- policies → the wrapper RPCs are the sole write path).
drop policy if exists deal_processor_qa_select on public.deal_processor_qa;
create policy deal_processor_qa_select on public.deal_processor_qa
  for select to authenticated
  using (public.is_processor(auth.uid()) or public.is_ops_staff(auth.uid()));

-- ===========================================================================
-- 2. WRITE RPCs — SECURITY DEFINER, processor/ops gated, each logs an
--    activity_log row (entity_type=deal, entity_id=deal, valid interaction_type,
--    logged_by=uid), mirroring the sibling processor_* write RPCs.
-- ===========================================================================

-- 2a. processor_save_qa — upsert the checklist + notes + pass state.
--     Stamps qa_passed_at/by when qa_passed FLIPS to true (preserves the
--     original pass time on a re-save that is still true); clears both on false.
create or replace function public.processor_save_qa(
  p_deal_id   uuid,
  p_checklist jsonb,
  p_passed    boolean,
  p_notes     text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_uid       uuid := auth.uid();
  v_passed    boolean;
  v_passed_at timestamptz;
begin
  if v_uid is null or not (public.is_processor(v_uid) or public.is_ops_staff(v_uid)) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if not exists (select 1 from public.deals d where d.id = p_deal_id) then
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;

  insert into public.deal_processor_qa
    (deal_id, checklist, notes, qa_passed, qa_passed_at, qa_passed_by, updated_at)
  values
    (p_deal_id, coalesce(p_checklist, '{}'::jsonb), p_notes, coalesce(p_passed, false),
     case when coalesce(p_passed, false) then now()   else null end,
     case when coalesce(p_passed, false) then v_uid   else null end,
     now())
  on conflict (deal_id) do update set
    checklist    = coalesce(p_checklist, '{}'::jsonb),
    notes        = p_notes,
    qa_passed    = coalesce(p_passed, false),
    -- preserve the original pass timestamp/user while it stays true; clear on false
    qa_passed_at = case when coalesce(p_passed, false)
                        then coalesce(public.deal_processor_qa.qa_passed_at, now())
                        else null end,
    qa_passed_by = case when coalesce(p_passed, false)
                        then coalesce(public.deal_processor_qa.qa_passed_by, v_uid)
                        else null end,
    updated_at   = now()
  returning qa_passed, qa_passed_at into v_passed, v_passed_at;

  insert into public.activity_log(entity_type, entity_id, interaction_type, subject, content, logged_by)
  values ('deal', p_deal_id, 'note',
          'QA ' || case when v_passed then 'passed' else 'saved (not passed)' end || ' — processor',
          p_notes, v_uid);

  return jsonb_build_object('ok', true, 'qa_passed', v_passed, 'qa_passed_at', v_passed_at);
end;
$$;

revoke all on function public.processor_save_qa(uuid, jsonb, boolean, text) from public, anon;
grant execute on function public.processor_save_qa(uuid, jsonb, boolean, text) to authenticated, service_role;

comment on function public.processor_save_qa(uuid, jsonb, boolean, text) is
  'Processor workspace: upsert deal_processor_qa (opaque checklist + notes + qa_passed). Stamps qa_passed_at/by when passed flips to true, clears them on false, and logs it. Processor/ops only.';

-- 2b. processor_mark_ready — flag ready ONLY if qa_passed AND bank statements
--     on file. Does NOT change deals.status (owner ruling: flag, don't submit).
create or replace function public.processor_mark_ready(p_deal_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
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

  insert into public.activity_log(entity_type, entity_id, interaction_type, subject, content, logged_by)
  values ('deal', p_deal_id, 'note', 'Marked ready for submission — processor', null, v_uid);

  return jsonb_build_object('ok', true, 'submission_ready_at', v_ready);
end;
$$;

revoke all on function public.processor_mark_ready(uuid) from public, anon;
grant execute on function public.processor_mark_ready(uuid) to authenticated, service_role;

comment on function public.processor_mark_ready(uuid) is
  'Processor workspace: flag a deal submission-ready (submission_ready_at/by=now) ONLY when its deal_processor_qa.qa_passed=true AND a bank_statement customer_document exists for deals.customer_id — else raises. Does NOT change deals.status. Processor/ops only.';

-- 2c. processor_unmark_ready — clear the readiness flag.
create or replace function public.processor_unmark_ready(p_deal_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not (public.is_processor(v_uid) or public.is_ops_staff(v_uid)) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if not exists (select 1 from public.deals d where d.id = p_deal_id) then
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;

  update public.deal_processor_qa
     set submission_ready_at = null,
         submission_ready_by = null,
         updated_at = now()
   where deal_id = p_deal_id;

  insert into public.activity_log(entity_type, entity_id, interaction_type, subject, content, logged_by)
  values ('deal', p_deal_id, 'note', 'Cleared ready-for-submission flag — processor', null, v_uid);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.processor_unmark_ready(uuid) from public, anon;
grant execute on function public.processor_unmark_ready(uuid) to authenticated, service_role;

comment on function public.processor_unmark_ready(uuid) is
  'Processor workspace: clear submission_ready_at/by on deal_processor_qa. Processor/ops only.';

-- ===========================================================================
-- 3a. EXTEND processor_pipeline_rows — add light QA/readiness keys via LEFT JOIN
--     to deal_processor_qa. Every prior field preserved byte-for-byte; the full
--     checklist is intentionally NOT included here (it comes back in deal_detail).
-- ===========================================================================
create or replace function public.processor_pipeline_rows(
  p_pipe  text default 'mca',
  p_sort  text default 'age',
  p_limit int  default 500
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid    uuid   := auth.uid();
  v_out    jsonb;
  v_stages text[];
  -- The "entered pipeline" clock is deals.created_at. A deal is STALE once it has
  -- been in the pipeline >= this many days. Change this one constant to retune.
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
      q.submission_ready_at as submission_ready_at
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
        case when p_sort = 'amount'  then e.amount_requested end desc nulls last,
        case when p_sort = 'callback' then e.callback_at end asc nulls last,
        case when p_sort = 'closer'  then lower(coalesce(e.cl_last, e.cl_first, '~')) end asc nulls last,
        case when p_sort = 'stage'   then array_position(v_stages, e.status) end asc nulls last,
        -- 'age' (default) and the universal tiebreaker: oldest created_at first
        e.created_at asc nulls last
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
      'application', (select to_jsonb(a) from public.mca_applications a where a.deal_id = r.id limit 1)
    ) order by r.rn
  ), '[]'::jsonb)
    into v_out
  from ranked r
  where r.rn <= p_limit;

  return v_out;
end;
$$;

revoke all on function public.processor_pipeline_rows(text, text, int) from public, anon;
grant execute on function public.processor_pipeline_rows(text, text, int) to authenticated, service_role;

comment on function public.processor_pipeline_rows(text, text, int) is
  'Whole-board pipeline rows for the Processor workspace (pipe: mca|vcf; sort: age|callback|stage|amount|closer). FULL mca_applications (real values), real amount_requested, bank-statement counts, per-processor working claims, and light QA/readiness state (qa_passed, qa_passed_at, submission_ready_at) via deal_processor_qa. days_in_pipeline/is_stale clock = deals.created_at, threshold 14d. Processor/ops only.';

-- ===========================================================================
-- 3b. EXTEND processor_deal_detail — add the full `qa` object via LEFT JOIN to
--     deal_processor_qa (+ resolve stamper names). All prior fields preserved.
-- ===========================================================================
create or replace function public.processor_deal_detail(p_deal_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
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
      'notes', q.notes
    )
  )
    into v_out
  from public.deals d
  join public.customers c on c.id = d.customer_id
  left join public.deal_processor_qa q on q.deal_id = d.id
  left join public.profiles qpa on qpa.id = q.qa_passed_by
  left join public.profiles qra on qra.id = q.submission_ready_by
  where d.id = p_deal_id;

  if v_out is null then
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;
  return v_out;
end;
$$;

revoke all on function public.processor_deal_detail(uuid) from public, anon;
grant execute on function public.processor_deal_detail(uuid) to authenticated, service_role;

comment on function public.processor_deal_detail(uuid) is
  'One deal for the Processor workspace: full deal + full customer + full mca_applications (real values) + all customer_documents (bank statements flagged) + a `qa` object (opaque checklist, qa_passed/at/by_name, submission_ready_at/by_name, notes; defaults {}/false when no QA row). Processor/ops only.';
