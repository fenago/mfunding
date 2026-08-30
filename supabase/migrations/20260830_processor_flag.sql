-- PROCESSOR ROLE (2026-08-30)
-- A "processor" is a CLOSER with one extra capability: they work the WHOLE MCA
-- board (docs collection, chasing missing application fields, pushing deals
-- forward) rather than only their own assigned book. By design this is NOT a new
-- user_role enum value — every `role='closer'` check in the app and RLS stays
-- exactly as it is. A processor is simply `closers.is_processor = true`.
--
-- GRANT a user the processor capability:
--   UPDATE public.closers SET is_processor = true WHERE user_id = '<profile-uuid>';
-- (the user must already have a closers row; see 20260826_closers_roster.sql)
--
-- ── WHY WHOLE-BOARD READS NEED AN RPC (verified against the live DB) ──
-- The original design note assumed `closer_select_all_deals` still let any closer
-- SELECT the whole deals board. It DOES NOT: 20260827_setter_deal_money_wall.sql
-- DROPPED that policy and replaced it with `closer_select_own_deals` (own-book +
-- unassigned only), moving whole-book reads behind money-masking SECURITY DEFINER
-- RPCs. So a plain `deals` SELECT run as a role=closer processor returns only
-- their own + unassigned rows — NOT the whole board the Processor Board needs.
--   • customers: `closer_select_all_customers` IS still whole-board (untouched).
--   • mca_applications: closers see only their OWN deals' rows.
-- Therefore the Processor Board reads the whole board through two SECURITY DEFINER
-- RPCs gated on is_processor()/is_ops_staff(), mirroring the money-wall pattern.
-- Deal ECONOMICS/commission and merchant PII (SSN/DOB/EIN/bank/home address) are
-- never returned in full — only what the board renders + presence sentinels the
-- completeness meter needs. No table RLS is changed by this migration.

-- ---------------------------------------------------------------------------
-- 1. The flag.
-- ---------------------------------------------------------------------------
alter table public.closers
  add column if not exists is_processor boolean not null default false;

comment on column public.closers.is_processor is
  'A closer with the whole-board Processor capability (Setter Performance -> Operations -> Processor Board). Not a role; every role=closer check is unchanged.';

-- ---------------------------------------------------------------------------
-- 2. is_processor(uid) — true when this user has an active-capability closers row.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so the check is not itself subject to RLS on `closers`
-- (closers only lets a user read their OWN row + admins). Any authenticated user
-- may ask about any uid, but it only reveals a single boolean.
create or replace function public.is_processor(uid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.closers c
    where c.user_id = uid and c.is_processor = true
  );
$$;

revoke all on function public.is_processor(uuid) from public, anon;
grant execute on function public.is_processor(uuid) to authenticated, service_role;

comment on function public.is_processor(uuid) is
  'True when a closers row exists for uid with is_processor=true. Drives the Processor Board gate + its whole-board RPCs.';

-- ---------------------------------------------------------------------------
-- 3. processor_stage_counts() — whole-board deal counts grouped by status.
-- ---------------------------------------------------------------------------
-- Returns {"<status>": <count>, ...} across EVERY deal (no assigned_closer
-- filter). Feeds the PipelineFlow per-stage counts. Gated to processors + ops.
create or replace function public.processor_stage_counts()
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

  select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
    into v_out
  from (
    select status, count(*)::int as cnt
    from public.deals
    group by status
  ) t;

  return v_out;
end;
$$;

revoke all on function public.processor_stage_counts() from public, anon;
grant execute on function public.processor_stage_counts() to authenticated, service_role;

comment on function public.processor_stage_counts() is
  'Whole-board deal counts grouped by status for the Processor Board pipeline. Processor/ops only.';

-- ---------------------------------------------------------------------------
-- 4. processor_deals_in_stage(status, sort, limit) — whole-board list for a stage.
-- ---------------------------------------------------------------------------
-- Returns a jsonb ARRAY (not SETOF — avoids the PostgREST scalar-setof ambiguity,
-- same as find_customer_deals_lite). Each element carries:
--   • the safe display columns the row renders (deal_number, status, stamps, …),
--   • the assigned closer's name (so the list can group/sort by closer),
--   • a `customer` subset (whole-board readable already via closer_select_all_customers),
--   • an `application` object = the required-field presence needed by
--     applicationCompleteness(): non-sensitive fields as real values, and the
--     sensitive PII columns (EIN, DOB, routing/account #, home address, requested
--     amount) as a '1' PRESENCE SENTINEL so the % is accurate without leaking data.
-- Deal economics/commission columns are simply never selected.
create or replace function public.processor_deals_in_stage(
  p_status text,
  p_sort   text default 'recent',
  p_limit  int  default 200
)
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
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    p_limit := 200;
  end if;

  with ranked as (
    select
      d.id, d.deal_number, d.status, d.previous_status, d.lead_source,
      d.updated_at, d.created_at, d.contacted_at, d.spoke_at, d.last_attempt_at,
      d.callback_at, d.callback_source, d.appointment_at, d.appointment_promised_at,
      d.stips_promised_by, d.bank_statements_at, d.use_of_funds, d.deal_type,
      d.assigned_closer_id, d.customer_id,
      pr.first_name as cl_first, pr.last_name as cl_last,
      row_number() over (
        order by
          case when p_sort = 'closer'
               then lower(coalesce(pr.last_name, pr.first_name, '~')) end asc nulls last,
          d.updated_at desc nulls last
      ) as rn
    from public.deals d
    left join public.profiles pr on pr.id = d.assigned_closer_id
    where d.status = p_status
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'deal_number', r.deal_number,
      'status', r.status,
      'previous_status', r.previous_status,
      'lead_source', r.lead_source,
      'updated_at', r.updated_at,
      'created_at', r.created_at,
      'contacted_at', r.contacted_at,
      'spoke_at', r.spoke_at,
      'last_attempt_at', r.last_attempt_at,
      'callback_at', r.callback_at,
      'callback_source', r.callback_source,
      'appointment_at', r.appointment_at,
      'appointment_promised_at', r.appointment_promised_at,
      'stips_promised_by', r.stips_promised_by,
      'bank_statements_at', r.bank_statements_at,
      'use_of_funds', r.use_of_funds,
      'deal_type', r.deal_type,
      'assigned_closer_id', r.assigned_closer_id,
      'closer', case when r.assigned_closer_id is null then null
        else jsonb_build_object('id', r.assigned_closer_id,
                                'first_name', r.cl_first, 'last_name', r.cl_last) end,
      'customer', (
        select jsonb_build_object(
          'id', c.id,
          'first_name', c.first_name,
          'last_name', c.last_name,
          'business_name', c.business_name,
          'email', c.email,
          'additional_emails', c.additional_emails,
          'phone', c.phone,
          'additional_phones', c.additional_phones,
          'industry', c.industry,
          'monthly_revenue', c.monthly_revenue,
          'address_street', c.address_street,
          'address_city', c.address_city,
          'address_state', c.address_state,
          'address_zip', c.address_zip,
          'do_not_contact', c.do_not_contact
        )
        from public.customers c where c.id = r.customer_id
      ),
      'application', (
        select jsonb_build_object(
          -- Business (not sensitive)
          'business_legal_name', a.business_legal_name,
          'business_type', a.business_type,
          'business_start_date', a.business_start_date,
          'industry', a.industry,
          'business_phone', a.business_phone,
          'business_email', a.business_email,
          'business_address', a.business_address,
          'business_city', a.business_city,
          'business_state', a.business_state,
          'business_zip', a.business_zip,
          -- Owner (names/contact not sensitive; DOB + home address masked)
          'owner_first_name', a.owner_first_name,
          'owner_last_name', a.owner_last_name,
          'owner_title', a.owner_title,
          'owner_ownership_pct', a.owner_ownership_pct,
          'owner_email', a.owner_email,
          'owner_phone', a.owner_phone,
          'owner_home_city', a.owner_home_city,
          'owner_home_state', a.owner_home_state,
          -- Presence sentinels for sensitive PII / economics (never the value)
          'ein', case when nullif(btrim(coalesce(a.ein, '')), '') is not null then '1' end,
          'owner_dob', case when a.owner_dob is not null then '1' end,
          'owner_home_address', case when nullif(btrim(coalesce(a.owner_home_address, '')), '') is not null then '1' end,
          'bank_name', a.bank_name,
          'bank_routing_number', case when nullif(btrim(coalesce(a.bank_routing_number, '')), '') is not null then '1' end,
          'bank_account_number', case when nullif(btrim(coalesce(a.bank_account_number, '')), '') is not null then '1' end,
          'amount_requested', case when a.amount_requested is not null then '1' end,
          'use_of_funds', a.use_of_funds,
          'monthly_revenue', case when a.monthly_revenue is not null then '1' end
        )
        from public.mca_applications a where a.deal_id = r.id
      )
    ) order by r.rn
  ), '[]'::jsonb)
    into v_out
  from ranked r
  where r.rn <= p_limit;

  return v_out;
end;
$$;

revoke all on function public.processor_deals_in_stage(text, text, int) from public, anon;
grant execute on function public.processor_deals_in_stage(text, text, int) to authenticated, service_role;

comment on function public.processor_deals_in_stage(text, text, int) is
  'Whole-board deals in one stage for the Processor Board (sort: recent|closer). Returns display columns + customer subset + application presence sentinels (no economics, no PII values). Processor/ops only.';
