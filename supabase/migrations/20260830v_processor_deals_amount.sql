-- PROCESSOR BOARD — surface the REQUESTED AMOUNT on the whole-board list (2026-08-30)
--
-- Owner decision: the Processor Board (Setter Performance → Operations, processors
-- only) should show each deal's REQUESTED AMOUNT so a processor can triage by size.
-- The original processor_deals_in_stage() deliberately masked amount_requested as a
-- '1' presence sentinel (the setter money wall, 20260827). This re-exposes ONLY
-- deals.amount_requested, and ONLY through this processor/ops-gated RPC — it does
-- NOT touch table RLS and does NOT change what a regular role=closer can read
-- (their own-book money wall is untouched). Commission/splits stay unexposed.
--
-- Everything else is byte-for-byte the prior function; the single change is the new
-- top-level 'amount_requested' (real value) alongside the existing display columns.

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
      d.amount_requested,
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
      'amount_requested', r.amount_requested,
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
          'owner_first_name', a.owner_first_name,
          'owner_last_name', a.owner_last_name,
          'owner_title', a.owner_title,
          'owner_ownership_pct', a.owner_ownership_pct,
          'owner_email', a.owner_email,
          'owner_phone', a.owner_phone,
          'owner_home_city', a.owner_home_city,
          'owner_home_state', a.owner_home_state,
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
  'Whole-board deals in one stage for the Processor Board (sort: recent|closer). Returns display columns + deals.amount_requested (owner-approved for processors/ops) + customer subset + application presence sentinels (no commission, no PII values). Processor/ops only.';
