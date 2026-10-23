-- ── What we already believe about a funder, with where it came from ─────────
--
-- The validation panel's "confirm what we hold" rows come from here. It exists
-- as a SECURITY DEFINER helper rather than a widened SELECT because of the
-- standing rule on this project: a setter surface that needs funder data gets a
-- COLUMN-SCOPED helper, never `grant select` on `lender_programs` — that table
-- carries 46 columns including commercial terms, and the validation panel needs
-- about fifteen of them.
--
-- Precedence is deliberate: a funder's own DOCUMENT beats our record, because
-- the document is the primary source and the record is somebody's summary of
-- one. When they disagree we return the document's value AND say what the
-- record holds, rather than silently picking a winner — a setter reading
-- "$20,000/mo" needs to know the agreement says $15,000 before she reads it
-- down the phone.
create or replace function public.funder_known_values(p_lender_ids uuid[])
returns table (
  lender_id uuid, field_key text, value text, source text,
  quote text, confidence text, disagrees text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not (
       is_ops_staff(v_uid) or is_processor(v_uid) or is_closer(v_uid)
     ) then
    raise exception 'not authorized to read funder known values' using errcode = '42501';
  end if;

  return query
  with rec as (
    select l.id,
      jsonb_strip_nulls(jsonb_build_object(
        'box_min_monthly_revenue',   coalesce(l.min_monthly_revenue, p.monthly_revenue_required)::text,
        'box_min_time_in_business',  coalesce(l.min_time_in_business, p.time_in_business_months)::text,
        'box_min_fico',              coalesce(l.min_credit_score, p.min_credit_score)::text,
        'box_min_funding_amount',    coalesce(l.min_funding_amount, p.approval_min)::text,
        'box_max_funding_amount',    coalesce(l.max_funding_amount, p.approval_max)::text,
        'box_max_positions',         coalesce(l.category->'criteria'->>'max_positions', p.max_position::text),
        'box_first_position_only',   l.category->'flags'->>'first_position_only',
        'box_restricted_states',     nullif(array_to_string(coalesce(l.states_restricted, p.excluded_states), ', '), ''),
        'box_restricted_industries', nullif(array_to_string(coalesce(l.industries_restricted, p.excluded_industries), ', '), ''),
        'bank_statement_months',     p.doc_bank_statement_months::text,
        'commission_points',         coalesce(l.commission_rate::text, nullif(concat_ws('–', p.points_min::text, p.points_max::text), '')),
        -- Kept apart on purpose: coalescing both onto the same column made
        -- every funder echo one value under two labels, which reads like
        -- corroboration and is nothing of the kind.
        'time_to_decision',          p.time_to_approve,
        'funding_speed',             l.funding_speed,
        'submission_email_confirmed', nullif(btrim(coalesce(l.submission_email, '')), ''),
        'portal_url_confirmed',      nullif(btrim(coalesce(l.submission_portal_url, '')), ''),
        'signed_app_own_form',       case when p.doc_application then 'yes' end
      )) as kv
    from public.lenders l
    left join lateral (
      select * from public.lender_programs lp
      where lp.lender_id = l.id order by lp.is_active desc nulls last, lp.updated_at desc nulls last limit 1
    ) p on true
    where l.id = any(p_lender_ids)
  ),
  rec_rows as (
    select r.id as lid, e.key as fk, e.value as val from rec r, jsonb_each_text(r.kv) e
  ),
  -- Newest document fact per (lender, field). Documents outrank the record.
  doc as (
    select distinct on (f.lender_id, f.field_key)
      f.lender_id as lid, f.field_key as fk, f.value as val,
      f.source_file, f.quote, f.confidence
    from public.funder_doc_facts f
    where f.lender_id = any(p_lender_ids)
    order by f.lender_id, f.field_key,
             case f.confidence when 'high' then 0 when 'medium' then 1 else 2 end,
             f.extracted_at desc
  ),
  -- Document field names are not always the panel's item keys.
  doc_mapped as (
    select d.lid, case d.fk
             when 'min_monthly_revenue'        then 'box_min_monthly_revenue'
             when 'min_time_in_business_months' then 'box_min_time_in_business'
             when 'min_fico'                   then 'box_min_fico'
             when 'min_funding_amount'         then 'box_min_funding_amount'
             when 'max_funding_amount'         then 'box_max_funding_amount'
             when 'max_positions'              then 'box_max_positions'
             when 'first_position_only'        then 'box_first_position_only'
             when 'excluded_states'            then 'box_restricted_states'
             when 'excluded_industries'        then 'box_restricted_industries'
             when 'commission_payment_timing'  then 'payment_timing'
             when 'application_form_required'  then 'signed_app_own_form'
             when 'submission_email'           then 'submission_email_confirmed'
             when 'submission_portal'          then 'portal_url_confirmed'
             when 'submission_channel'         then 'submit_channel'
             else d.fk end as fk,
           d.val, d.source_file, d.quote, d.confidence
    from doc d
  )
  select
    coalesce(dm.lid, rr.lid),
    coalesce(dm.fk, rr.fk),
    coalesce(dm.val, rr.val),
    case when dm.val is not null then dm.source_file else 'our funder record' end,
    dm.quote,
    coalesce(dm.confidence, 'medium'),
    case
      when dm.val is not null and rr.val is not null and btrim(lower(dm.val)) <> btrim(lower(rr.val))
      then 'our record says ' || rr.val
    end
  from rec_rows rr
  full outer join doc_mapped dm on dm.lid = rr.lid and dm.fk = rr.fk
  where coalesce(dm.val, rr.val) is not null and btrim(coalesce(dm.val, rr.val)) <> '';
end;
$fn$;

-- pg_default_acl grants EXECUTE on new public functions to anon, authenticated
-- AND service_role BY NAME — revoking from PUBLIC alone leaves anon holding it.
revoke execute on function public.funder_known_values(uuid[]) from public, anon, authenticated, service_role;
grant  execute on function public.funder_known_values(uuid[]) to authenticated;
