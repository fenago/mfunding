-- Data Hygiene: Customers source gains a lead_source filter (joined to deals),
-- so Synergy live-transfer + real-time leads (and other sources) are searchable.
-- Only the customers branch changed (one predicate added after exclude_dnc).

CREATE OR REPLACE FUNCTION public.smart_list_source(p_source text, p_filters jsonb DEFAULT '{}'::jsonb, p_mode text DEFAULT 'count'::text, p_limit integer DEFAULT 1000, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tbl   text;
  v_proj  text;
  v_order text;
  v_ac    text;
  v_state text;
  v_pred  text;
  v_count bigint;
  v_rows  jsonb;
  v_lim   int := least(greatest(coalesce(p_limit, 1000), 1), 5000);
  v_off   int := greatest(coalesce(p_offset, 0), 0);
begin
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
      || ' and (jsonb_typeof($1->''lead_sources'') is distinct from ''array'' or jsonb_array_length($1->''lead_sources'')=0 or exists (select 1 from public.deals d where d.customer_id = t.id and d.lead_source::text = any(select jsonb_array_elements_text($1->''lead_sources''))))'
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
$function$

