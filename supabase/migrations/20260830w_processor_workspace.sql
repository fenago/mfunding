-- PROCESSOR WORKSPACE — data layer for the top-level /admin/processor page (2026-08-30)
--
-- A "processor" is a closers.is_processor=true closer. This migration adds the
-- READ + WRITE + CLAIM RPCs the Processor workspace binds to. Everything is gated
-- on  is_processor(auth.uid()) OR is_ops_staff(auth.uid())  (is_ops_staff already
-- covers admin/super_admin/employee — verified). NO table RLS on `deals` is touched:
-- regular closers keep their own-book money wall. These SECURITY DEFINER RPCs are
-- the only place whole-board reads + owner-approved full PII/economics are exposed,
-- and ONLY to processors/ops.
--
-- Owner ruling captured here: unlike the ops "Processor Board" (processor_deals_in_stage,
-- which masks PII/amount with '1' presence sentinels), THIS workspace must let the
-- processor SEE EVERYTHING on the application and the bank statements so they can
-- actually chase and complete files. So processor_pipeline_rows / processor_deal_detail
-- return the FULL mca_applications row with REAL values (to_jsonb), the real
-- amount_requested, and the bank-statement documents.
--
-- Reuses the existing helpers unchanged: is_processor(uuid), is_ops_staff(uuid),
-- processor_stage_counts(), processor_deals_in_stage(...). Nothing here regresses them.
--
-- ── Ground-truth facts verified against the live DB before writing this ──
--   • deals.status is text; MCA stage set (13): new, contacted, qualifying,
--     application_sent, docs_collected, bank_statements, submitted_to_funder,
--     offer_received, offer_presented, offer_accepted, funded, renewal_eligible,
--     nurture. VCF stage set (8): new_distressed, hardship_consult,
--     positions_analysis, strategy_proposal, agreement_sent, submitted_to_vcf,
--     restructure_executed, servicing. (src/data/pipelines.ts)
--   • Bank statements live in public.customer_documents keyed by CUSTOMER
--     (there is no deal_id on that table): document_type = 'bank_statement'
--     (enum customer_document_type). Bucket = 'customer-documents'. So a deal's
--     bank-statement count = customer_documents rows for deals.customer_id with
--     document_type='bank_statement'. deals.bank_statements_at is a separate stamp.
--   • customer_documents columns: id, customer_id, document_type, filename (NOT
--     file_name), storage_path, file_size, mime_type, status, created_at, ...
--   • Storage RLS on customer-documents: ops_all (is_ops_staff → any) + closer
--     (own book only). A processor-closer is money-walled at the storage layer for
--     other closers' books, so whole-board signed URLs CANNOT be minted by the
--     frontend and there is no SQL signing function — processor_document_url is
--     served by the `processor-document-url` EDGE FUNCTION (service role signs
--     after this-migration's gate + in-pipeline validation). See that function.
--   • activity_log: entity_type CHECK in (customer,lender,marketing_vendor,deal);
--     entity_id NOT NULL; interaction_type CHECK includes note/call. We log to
--     activity_log with entity_type='deal', entity_id=<deal id>, logged_by=uid.

-- ===========================================================================
-- 0a. Allow callback_source='processor'. The existing check permitted only
--     'merchant_stated' | 'closer_promised'; processor_set_callback stamps
--     'processor' so a processor-set callback is distinguishable from a
--     merchant-stated / closer-promised one.
-- ===========================================================================
alter table public.deals drop constraint if exists deals_callback_source_check;
alter table public.deals add constraint deals_callback_source_check
  check (callback_source = any (array['merchant_stated'::text,'closer_promised'::text,'processor'::text]));

-- ===========================================================================
-- 0. processor_working — per-processor "I'm working this deal" claim.
-- ===========================================================================
create table if not exists public.processor_working (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid not null references public.deals(id)    on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (deal_id, profile_id)
);

comment on table public.processor_working is
  'Per-processor claim on a deal ("what I am working"). Visible to all processors/ops so the workspace can show "Working: <name>"; a processor may only claim/unclaim under their OWN profile_id.';

create index if not exists processor_working_deal_idx on public.processor_working(deal_id);

alter table public.processor_working enable row level security;

drop policy if exists processor_working_select on public.processor_working;
create policy processor_working_select on public.processor_working
  for select to authenticated
  using (public.is_processor(auth.uid()) or public.is_ops_staff(auth.uid()));

drop policy if exists processor_working_insert on public.processor_working;
create policy processor_working_insert on public.processor_working
  for insert to authenticated
  with check (profile_id = auth.uid() and public.is_processor(auth.uid()));

drop policy if exists processor_working_delete on public.processor_working;
create policy processor_working_delete on public.processor_working
  for delete to authenticated
  using (profile_id = auth.uid() and public.is_processor(auth.uid()));

-- ===========================================================================
-- 1. processor_pipeline_rows(pipe, sort, limit) — whole-board rows for a pipe.
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
      pr.first_name as cl_first, pr.last_name as cl_last
    from public.deals d
    left join public.customers cu on cu.id = d.customer_id
    left join public.profiles  pr on pr.id = d.assigned_closer_id
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
  'Whole-board pipeline rows for the Processor workspace (pipe: mca|vcf; sort: age|callback|stage|amount|closer). FULL mca_applications (real values), real amount_requested, bank-statement counts, and per-processor working claims. days_in_pipeline/is_stale clock = deals.created_at, threshold 14d. Processor/ops only.';

-- ===========================================================================
-- 2. processor_deal_detail(deal_id) — one deal, everything.
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
    )
  )
    into v_out
  from public.deals d
  join public.customers c on c.id = d.customer_id
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
  'One deal for the Processor workspace: full deal + full customer + full mca_applications (real values) + all customer_documents (bank statements flagged). Processor/ops only.';

-- ===========================================================================
-- 3. WRITE RPCs — each stamps the deal AND logs an auditable activity_log row
--    (entity_type=deal, entity_id=deal, interaction_type valid, logged_by=uid).
-- ===========================================================================

-- 3a. processor_set_callback
create or replace function public.processor_set_callback(
  p_deal_id     uuid,
  p_callback_at timestamptz,
  p_note        text default null
)
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

  update public.deals
     set callback_at = p_callback_at,
         callback_source = 'processor',
         updated_at = now()
   where id = p_deal_id;
  if not found then
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;

  insert into public.activity_log(entity_type, entity_id, interaction_type, subject, content, logged_by)
  values ('deal', p_deal_id, 'note', 'Callback set — processor',
          coalesce(p_note, 'Callback scheduled for ' || p_callback_at::text), v_uid);

  return jsonb_build_object('ok', true, 'callback_at', p_callback_at);
end;
$$;

revoke all on function public.processor_set_callback(uuid, timestamptz, text) from public, anon;
grant execute on function public.processor_set_callback(uuid, timestamptz, text) to authenticated, service_role;

comment on function public.processor_set_callback(uuid, timestamptz, text) is
  'Processor workspace: set deals.callback_at (+ callback_source=processor) and log it. Processor/ops only.';

-- 3b. processor_set_appointment
create or replace function public.processor_set_appointment(
  p_deal_id        uuid,
  p_appointment_at timestamptz
)
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

  update public.deals
     set appointment_at = p_appointment_at,
         updated_at = now()
   where id = p_deal_id;
  if not found then
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;

  insert into public.activity_log(entity_type, entity_id, interaction_type, subject, content, logged_by)
  values ('deal', p_deal_id, 'note', 'Appointment set — processor',
          'Appointment scheduled for ' || p_appointment_at::text, v_uid);

  return jsonb_build_object('ok', true, 'appointment_at', p_appointment_at);
end;
$$;

revoke all on function public.processor_set_appointment(uuid, timestamptz) from public, anon;
grant execute on function public.processor_set_appointment(uuid, timestamptz) to authenticated, service_role;

comment on function public.processor_set_appointment(uuid, timestamptz) is
  'Processor workspace: set deals.appointment_at and log it. Processor/ops only. (GHL calendar sync is a separate concern handled by callback-calendar-sync, not this data-layer stamp.)';

-- 3c. processor_log_contact
create or replace function public.processor_log_contact(
  p_deal_id uuid,
  p_outcome text,
  p_note    text default null
)
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

  update public.deals
     set last_attempt_at = now(),
         contacted_at = coalesce(contacted_at, now()),
         contact_attempts = coalesce(contact_attempts, 0) + 1,
         updated_at = now()
   where id = p_deal_id;
  if not found then
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;

  insert into public.activity_log(entity_type, entity_id, interaction_type, subject, content, logged_by)
  values ('deal', p_deal_id, 'call',
          'Contact attempt — processor: ' || coalesce(nullif(btrim(p_outcome), ''), 'attempted'),
          p_note, v_uid);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.processor_log_contact(uuid, text, text) from public, anon;
grant execute on function public.processor_log_contact(uuid, text, text) to authenticated, service_role;

comment on function public.processor_log_contact(uuid, text, text) is
  'Processor workspace: stamp deals.last_attempt_at=now (+ contacted_at if null, +1 contact_attempts) and log the attempt (supports repeated call-backs). Processor/ops only.';

-- 3d. processor_move_to_nurture
create or replace function public.processor_move_to_nurture(
  p_deal_id uuid,
  p_reason  text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_old text;
begin
  if v_uid is null or not (public.is_processor(v_uid) or public.is_ops_staff(v_uid)) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select status into v_old from public.deals where id = p_deal_id;
  if v_old is null then
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;

  update public.deals
     set previous_status = status,   -- RHS = pre-update value
         status = 'nurture',
         nurture_at = coalesce(nurture_at, now()),
         updated_at = now()
   where id = p_deal_id;

  insert into public.activity_log(entity_type, entity_id, interaction_type, subject, content,
                                  old_status, new_status, logged_by)
  values ('deal', p_deal_id, 'note', 'Moved to long-term nurture — processor',
          p_reason, v_old, 'nurture', v_uid);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.processor_move_to_nurture(uuid, text) from public, anon;
grant execute on function public.processor_move_to_nurture(uuid, text) to authenticated, service_role;

comment on function public.processor_move_to_nurture(uuid, text) is
  'Processor workspace: stamp previous_status then set status=nurture (+ nurture_at) and log it. Nurture is not a funded transition, so no commission side-effect applies; GHL mirroring, if desired, is a frontend concern via the existing stage-move service. Processor/ops only.';

-- ===========================================================================
-- 4. processor_toggle_working(deal_id) — claim/unclaim the caller's working flag.
-- ===========================================================================
create or replace function public.processor_toggle_working(p_deal_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- Only a processor may claim a deal (mirrors the table INSERT/DELETE policy).
  if v_uid is null or not public.is_processor(v_uid) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.deals where id = p_deal_id) then
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.processor_working
              where deal_id = p_deal_id and profile_id = v_uid) then
    delete from public.processor_working
     where deal_id = p_deal_id and profile_id = v_uid;
    return jsonb_build_object('working', false);
  else
    insert into public.processor_working(deal_id, profile_id)
    values (p_deal_id, v_uid)
    on conflict (deal_id, profile_id) do nothing;
    return jsonb_build_object('working', true);
  end if;
end;
$$;

revoke all on function public.processor_toggle_working(uuid) from public, anon;
grant execute on function public.processor_toggle_working(uuid) to authenticated, service_role;

comment on function public.processor_toggle_working(uuid) is
  'Processor workspace: toggle the caller''s "I am working this deal" claim (processor_working). Returns {working:bool}. Processors only (ops non-processors can SEE claims but not make them).';
