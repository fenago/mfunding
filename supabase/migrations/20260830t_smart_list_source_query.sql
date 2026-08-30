-- Data Hygiene — rich source filtering for the Build-smart-list builder.
--
-- The builder needs to slice the three Supabase source books (lead_records /
-- ph_ucc_leads / customers) by MANY dimensions — not just the handful PostgREST
-- can express. Two of them can't be done cleanly through PostgREST at all:
--   • EFFECTIVE STATE — aged lead_records rows have state/city/zip = NULL; their
--     location lives in state_inferred (COALESCE(NULLIF(state,''),state_inferred)).
--     The old builder filtered on `state` only → "Aged + Florida = 0" when the true
--     answer is 10,176. This fixes it at the source of truth.
--   • AREA CODE — a left(digits-only phone) prefix match.
--
-- So all DB-source counting/paging routes through ONE SECURITY DEFINER RPC that
-- applies the whole filter set (COALESCE state, area code, revenue ranges, boolean
-- flags, phone status, enrichment presence, …) in SQL. The SAME filter jsonb is
-- persisted on smart_lists.criteria, so Save→materialize reproduces identical
-- membership. A seq scan over ~250k for an occasional admin count is acceptable.
--
-- p_mode:
--   'count' → { count: <bigint>, sample: [ ≤6 snapshot rows ] }   (live preview)
--   'rows'  → { rows: [ snapshot rows ] }                          (materialize paging)
-- Snapshot row shape matches hygiene.ts MemberSnapshot:
--   { id, business, contact, phone, email, state, city }
--
-- Compliance: internal surface; MCA positions are advances/funding, never "loan".

-- ── us_state_code(): full name OR 2-letter code → stored 2-letter code ──────────────
-- Lets a code-keyed picker match customers rows that store the full state NAME
-- ('Florida' → 'FL') and pass codes ('FL' → 'FL') straight through. Unknown/blank
-- returns NULL so it simply never equals a picked code (row excluded, never errors).
create or replace function public.us_state_code(p_in text)
returns text
language sql
immutable
as $fn$
  select case upper(btrim(coalesce(p_in, '')))
    when 'AL' then 'AL' when 'ALABAMA' then 'AL'
    when 'AK' then 'AK' when 'ALASKA' then 'AK'
    when 'AZ' then 'AZ' when 'ARIZONA' then 'AZ'
    when 'AR' then 'AR' when 'ARKANSAS' then 'AR'
    when 'CA' then 'CA' when 'CALIFORNIA' then 'CA'
    when 'CO' then 'CO' when 'COLORADO' then 'CO'
    when 'CT' then 'CT' when 'CONNECTICUT' then 'CT'
    when 'DE' then 'DE' when 'DELAWARE' then 'DE'
    when 'DC' then 'DC' when 'DISTRICT OF COLUMBIA' then 'DC'
    when 'FL' then 'FL' when 'FLORIDA' then 'FL'
    when 'GA' then 'GA' when 'GEORGIA' then 'GA'
    when 'HI' then 'HI' when 'HAWAII' then 'HI'
    when 'ID' then 'ID' when 'IDAHO' then 'ID'
    when 'IL' then 'IL' when 'ILLINOIS' then 'IL'
    when 'IN' then 'IN' when 'INDIANA' then 'IN'
    when 'IA' then 'IA' when 'IOWA' then 'IA'
    when 'KS' then 'KS' when 'KANSAS' then 'KS'
    when 'KY' then 'KY' when 'KENTUCKY' then 'KY'
    when 'LA' then 'LA' when 'LOUISIANA' then 'LA'
    when 'ME' then 'ME' when 'MAINE' then 'ME'
    when 'MD' then 'MD' when 'MARYLAND' then 'MD'
    when 'MA' then 'MA' when 'MASSACHUSETTS' then 'MA'
    when 'MI' then 'MI' when 'MICHIGAN' then 'MI'
    when 'MN' then 'MN' when 'MINNESOTA' then 'MN'
    when 'MS' then 'MS' when 'MISSISSIPPI' then 'MS'
    when 'MO' then 'MO' when 'MISSOURI' then 'MO'
    when 'MT' then 'MT' when 'MONTANA' then 'MT'
    when 'NE' then 'NE' when 'NEBRASKA' then 'NE'
    when 'NV' then 'NV' when 'NEVADA' then 'NV'
    when 'NH' then 'NH' when 'NEW HAMPSHIRE' then 'NH'
    when 'NJ' then 'NJ' when 'NEW JERSEY' then 'NJ'
    when 'NM' then 'NM' when 'NEW MEXICO' then 'NM'
    when 'NY' then 'NY' when 'NEW YORK' then 'NY'
    when 'NC' then 'NC' when 'NORTH CAROLINA' then 'NC'
    when 'ND' then 'ND' when 'NORTH DAKOTA' then 'ND'
    when 'OH' then 'OH' when 'OHIO' then 'OH'
    when 'OK' then 'OK' when 'OKLAHOMA' then 'OK'
    when 'OR' then 'OR' when 'OREGON' then 'OR'
    when 'PA' then 'PA' when 'PENNSYLVANIA' then 'PA'
    when 'RI' then 'RI' when 'RHODE ISLAND' then 'RI'
    when 'SC' then 'SC' when 'SOUTH CAROLINA' then 'SC'
    when 'SD' then 'SD' when 'SOUTH DAKOTA' then 'SD'
    when 'TN' then 'TN' when 'TENNESSEE' then 'TN'
    when 'TX' then 'TX' when 'TEXAS' then 'TX'
    when 'UT' then 'UT' when 'UTAH' then 'UT'
    when 'VT' then 'VT' when 'VERMONT' then 'VT'
    when 'VA' then 'VA' when 'VIRGINIA' then 'VA'
    when 'WA' then 'WA' when 'WASHINGTON' then 'WA'
    when 'WV' then 'WV' when 'WEST VIRGINIA' then 'WV'
    when 'WI' then 'WI' when 'WISCONSIN' then 'WI'
    when 'WY' then 'WY' when 'WYOMING' then 'WY'
    else null
  end;
$fn$;

-- ── smart_list_source(): filtered count / rows for a DB source ──────────────────────
create or replace function public.smart_list_source(
  p_source  text,
  p_filters jsonb default '{}'::jsonb,
  p_mode    text  default 'count',
  p_limit   int   default 1000,
  p_offset  int   default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_tbl   text;
  v_proj  text;
  v_order text;
  v_ac    text;   -- area-code expression for this source's phone column
  v_state text;   -- effective-state expression for this source
  v_pred  text;   -- shared WHERE predicate (references $1 = p_filters)
  v_count bigint;
  v_rows  jsonb;
  v_lim   int := least(greatest(coalesce(p_limit, 1000), 1), 5000);
  v_off   int := greatest(coalesce(p_offset, 0), 0);
begin
  -- Staff gate — this scans big books, so admin/super_admin only.
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'super_admin')
  ) then
    raise exception 'forbidden: admin only';
  end if;

  if p_source = 'lead_records' then
    v_tbl   := 'public.lead_records';
    v_ac    := $ac$regexp_replace(coalesce(t.phone,''),'\D','','g')$ac$;
    v_state := $st$coalesce(nullif(t.state,''), t.state_inferred)$st$;
    v_proj  := $pj$jsonb_build_object(
        'id', t.id,
        'business', nullif(btrim(t.company),''),
        'contact', nullif(btrim(concat_ws(' ', t.first_name, t.last_name)),''),
        'phone', nullif(btrim(t.phone),''),
        'email', nullif(btrim(t.email),''),
        'state', coalesce(nullif(t.state,''), t.state_inferred),
        'city', nullif(btrim(t.city),''))$pj$;
    v_order := 'coalesce(t.dial_score,0) desc, t.created_at desc';
    v_pred  :=
      ' (jsonb_typeof($1->''states'') is distinct from ''array'' or jsonb_array_length($1->''states'')=0'
        || ' or public.us_state_code(' || v_state || ') = any(select jsonb_array_elements_text($1->''states'')))'
      || ' and (jsonb_typeof($1->''area_codes'') is distinct from ''array'' or jsonb_array_length($1->''area_codes'')=0'
        || ' or (case when length(' || v_ac || ')=11 and left(' || v_ac || ',1)=''1'' then substr(' || v_ac || ',2,3) else left(' || v_ac || ',3) end) = any(select jsonb_array_elements_text($1->''area_codes'')))'
      || ' and (coalesce($1->>''zip_prefix'','''')='''' or t.zip like ($1->>''zip_prefix'')||''%'')'
      || ' and (coalesce($1->>''city'','''')='''' or t.city ilike ''%''||($1->>''city'')||''%'')'
      || ' and (coalesce($1->>''industry'','''')='''' or t.industry_bucket ilike ''%''||($1->>''industry'')||''%'' or t.sic_description ilike ''%''||($1->>''industry'')||''%'')'
      || ' and (jsonb_typeof($1->''entity_types'') is distinct from ''array'' or jsonb_array_length($1->''entity_types'')=0 or t.entity_type = any(select jsonb_array_elements_text($1->''entity_types'')))'
      || ' and (coalesce($1->>''min_revenue'','''')='''' or coalesce(t.revenue, t.revenue_band_high) >= ($1->>''min_revenue'')::numeric)'
      || ' and (coalesce($1->>''max_revenue'','''')='''' or coalesce(t.revenue, t.revenue_band_low) <= ($1->>''max_revenue'')::numeric)'
      || ' and (jsonb_typeof($1->''line_types'') is distinct from ''array'' or jsonb_array_length($1->''line_types'')=0 or lower(coalesce(t.line_type,'''')) = any(select lower(x) from jsonb_array_elements_text($1->''line_types'') x))'
      || ' and (coalesce($1->>''carrier'','''')='''' or t.carrier ilike ''%''||($1->>''carrier'')||''%'')'
      || ' and (coalesce($1->>''has_phone'','''')<>''true'' or nullif(btrim(t.phone),'''') is not null)'
      || ' and (coalesce($1->>''has_email'','''')<>''true'' or t.has_any_email is true)'
      || ' and (coalesce($1->>''phone_status'','''')='''''
        || ' or ($1->>''phone_status''=''reachable'' and t.phone_reachable is true)'
        || ' or ($1->>''phone_status''=''disconnected'' and t.phone_disconnected is true)'
        || ' or ($1->>''phone_status''=''unvalidated'' and t.phone_validated_at is null))'
      || ' and (coalesce($1->>''dial_score_min'','''')='''' or coalesce(t.dial_score,0) >= ($1->>''dial_score_min'')::int)'
      || ' and (coalesce($1->>''enriched'','''')='''''
        || ' or ($1->>''enriched''=''yes'' and (t.skiptrace_raw is not null or t.apollo_raw is not null))'
        || ' or ($1->>''enriched''=''no'' and t.skiptrace_raw is null and t.apollo_raw is null))'
      || ' and (coalesce($1->>''lead_type'','''')='''' or t.lead_type = $1->>''lead_type'')'
      || ' and (coalesce($1->>''status'','''')='''' or t.status = $1->>''status'')'
      || ' and (coalesce($1->>''search'','''')='''' or t.company ilike ''%''||($1->>''search'')||''%'')';

  elsif p_source = 'ph_ucc' then
    v_tbl   := 'public.ph_ucc_leads';
    v_ac    := $ac$regexp_replace(coalesce(t.phone,''),'\D','','g')$ac$;
    v_proj  := $pj$jsonb_build_object(
        'id', t.id,
        'business', nullif(btrim(t.debtor_name),''),
        'contact', nullif(btrim(t.person_name),''),
        'phone', nullif(btrim(t.phone),''),
        'email', nullif(btrim(t.email),''),
        'state', nullif(btrim(t.state),''),
        'city', nullif(btrim(t.debtor_city),''))$pj$;
    v_order := 't.score desc nulls last';
    v_pred  :=
      ' (jsonb_typeof($1->''states'') is distinct from ''array'' or jsonb_array_length($1->''states'')=0'
        || ' or public.us_state_code(t.state) = any(select jsonb_array_elements_text($1->''states'')))'
      || ' and (jsonb_typeof($1->''area_codes'') is distinct from ''array'' or jsonb_array_length($1->''area_codes'')=0'
        || ' or (case when length(' || v_ac || ')=11 and left(' || v_ac || ',1)=''1'' then substr(' || v_ac || ',2,3) else left(' || v_ac || ',3) end) = any(select jsonb_array_elements_text($1->''area_codes'')))'
      || ' and (coalesce($1->>''zip_prefix'','''')='''' or t.debtor_zip like ($1->>''zip_prefix'')||''%'')'
      || ' and (coalesce($1->>''city'','''')='''' or t.debtor_city ilike ''%''||($1->>''city'')||''%'')'
      || ' and (coalesce($1->>''min_stack'','''')='''' or coalesce(t.stack_depth,0) >= ($1->>''min_stack'')::int)'
      || ' and (coalesce($1->>''secured_party'','''')='''' or array_to_string(coalesce(t.matched_funders,array[]::text[]), '' '') ilike ''%''||($1->>''secured_party'')||''%'')'
      || ' and (coalesce($1->>''filing_within_days'','''')='''' or t.latest_filing_date >= current_date - ($1->>''filing_within_days'')::int)'
      || ' and (jsonb_typeof($1->''confidence'') is distinct from ''array'' or jsonb_array_length($1->''confidence'')=0 or t.confidence = any(select jsonb_array_elements_text($1->''confidence'')))'
      || ' and (coalesce($1->>''lead_class'','''')='''' or t.lead_class = $1->>''lead_class'')'
      || ' and (coalesce($1->>''status'','''')='''' or t.status::text = $1->>''status'')'
      || ' and (coalesce($1->>''has_phone'','''')<>''true'' or nullif(btrim(t.phone),'''') is not null)'
      || ' and (coalesce($1->>''has_email'','''')<>''true'' or nullif(btrim(t.email),'''') is not null)'
      || ' and (coalesce($1->>''hide_litigator'','''')<>''true'' or coalesce(t.tcpa_litigator,false)=false)'
      || ' and (coalesce($1->>''search'','''')='''' or t.debtor_name ilike ''%''||($1->>''search'')||''%'')';

  elsif p_source = 'customers' then
    v_tbl   := 'public.customers';
    v_ac    := $ac$regexp_replace(coalesce(t.phone,''),'\D','','g')$ac$;
    v_proj  := $pj$jsonb_build_object(
        'id', t.id,
        'business', nullif(btrim(t.business_name),''),
        'contact', nullif(btrim(concat_ws(' ', t.first_name, t.last_name)),''),
        'phone', nullif(btrim(t.phone),''),
        'email', nullif(btrim(t.email),''),
        'state', nullif(btrim(t.address_state),''),
        'city', nullif(btrim(t.address_city),''))$pj$;
    v_order := 't.created_at desc';
    v_pred  :=
      ' (jsonb_typeof($1->''states'') is distinct from ''array'' or jsonb_array_length($1->''states'')=0'
        || ' or public.us_state_code(t.address_state) = any(select jsonb_array_elements_text($1->''states'')))'
      || ' and (jsonb_typeof($1->''area_codes'') is distinct from ''array'' or jsonb_array_length($1->''area_codes'')=0'
        || ' or (case when length(' || v_ac || ')=11 and left(' || v_ac || ',1)=''1'' then substr(' || v_ac || ',2,3) else left(' || v_ac || ',3) end) = any(select jsonb_array_elements_text($1->''area_codes'')))'
      || ' and (coalesce($1->>''zip_prefix'','''')='''' or t.address_zip like ($1->>''zip_prefix'')||''%'')'
      || ' and (coalesce($1->>''city'','''')='''' or t.address_city ilike ''%''||($1->>''city'')||''%'')'
      || ' and (coalesce($1->>''industry'','''')='''' or t.industry ilike ''%''||($1->>''industry'')||''%'')'
      || ' and (jsonb_typeof($1->''entity_types'') is distinct from ''array'' or jsonb_array_length($1->''entity_types'')=0 or t.entity_type = any(select jsonb_array_elements_text($1->''entity_types'')))'
      || ' and (coalesce($1->>''min_revenue'','''')='''' or coalesce(t.monthly_revenue,0) >= ($1->>''min_revenue'')::numeric)'
      || ' and (coalesce($1->>''max_revenue'','''')='''' or coalesce(t.monthly_revenue,0) <= ($1->>''max_revenue'')::numeric)'
      || ' and (jsonb_typeof($1->''line_types'') is distinct from ''array'' or jsonb_array_length($1->''line_types'')=0 or lower(coalesce(t.line_type,'''')) = any(select lower(x) from jsonb_array_elements_text($1->''line_types'') x))'
      || ' and (coalesce($1->>''has_phone'','''')<>''true'' or nullif(btrim(t.phone),'''') is not null)'
      || ' and (coalesce($1->>''has_email'','''')<>''true'' or nullif(btrim(t.email),'''') is not null)'
      || ' and (coalesce($1->>''phone_status'','''')='''''
        || ' or ($1->>''phone_status''=''reachable'' and t.phone_reachable is true)'
        || ' or ($1->>''phone_status''=''unvalidated'' and t.phone_checked_at is null))'
      || ' and (coalesce($1->>''exclude_dnc'','''')<>''true'' or coalesce(t.do_not_contact,false)=false)'
      || ' and (coalesce($1->>''status'','''')='''' or t.status::text = $1->>''status'')'
      || ' and (coalesce($1->>''search'','''')='''' or t.business_name ilike ''%''||($1->>''search'')||''%'')';
  else
    raise exception 'unknown source: %', p_source;
  end if;

  if p_mode = 'rows' then
    execute
      'select coalesce(jsonb_agg(r),''[]''::jsonb) from ('
      || 'select ' || v_proj || ' as r from ' || v_tbl || ' t where ' || v_pred
      || ' order by ' || v_order || ' limit ' || v_lim || ' offset ' || v_off || ') q'
      into v_rows using coalesce(p_filters, '{}'::jsonb);
    return jsonb_build_object('rows', coalesce(v_rows, '[]'::jsonb));
  else
    execute 'select count(*) from ' || v_tbl || ' t where ' || v_pred
      into v_count using coalesce(p_filters, '{}'::jsonb);
    execute
      'select coalesce(jsonb_agg(r),''[]''::jsonb) from ('
      || 'select ' || v_proj || ' as r from ' || v_tbl || ' t where ' || v_pred
      || ' order by ' || v_order || ' limit 6) q'
      into v_rows using coalesce(p_filters, '{}'::jsonb);
    return jsonb_build_object('count', v_count, 'sample', coalesce(v_rows, '[]'::jsonb));
  end if;
end;
$fn$;

grant execute on function public.us_state_code(text) to authenticated, service_role;
grant execute on function public.smart_list_source(text, jsonb, text, int, int) to authenticated, service_role;
