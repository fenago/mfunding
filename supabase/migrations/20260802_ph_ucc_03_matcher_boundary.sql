-- PH UCC matcher precision: token-BOUNDARY matching instead of raw substring.
--
-- WHY: short normalized aliases (e.g. IOU, LCF, GRP, RTS — real MCA funders whose
-- names collapse to 3 letters after suffix-stripping) were matching mid-word as a
-- naive substring: "IOU" inside "PRECIOUS", "RTS" inside "SPORTS". A UCC lead
-- feeds a dialer, so a false MCA-position tag is expensive. We now require the
-- alias to appear as a whole space-delimited token run inside the secured party.
--
-- The trgm LIKE stays as an index-accelerated PREFILTER (narrows candidates), and
-- the boundary LIKE on ' '||sp_norm||' ' is the exact test. alias_norm is
-- [A-Z0-9 ] only, so neither concat can inject a LIKE metacharacter.
create or replace function public.ph_ucc_rebuild_leads()
returns table (leads_upserted int, distinct_debtors int, matched_filings int)
language plpgsql security definer set search_path = public as $fn$
declare
  v_upserted int := 0;
  v_skiptrace_provider text;
begin
  select value->>'skiptrace_provider' into v_skiptrace_provider
  from public.platform_settings where key = 'ph_settings';

  with matched as (
    select distinct
      f.id as filing_id, f.state, f.filing_no, f.filed_date,
      f.debtor_name, f.debtor_address, f.debtor_city, f.debtor_state, f.debtor_zip,
      a.canonical_funder
    from public.ph_ucc_filings f
    join public.ph_ucc_funder_aliases a
      on a.active
     and length(a.alias_norm) >= 3
     and f.sp_norm like '%' || a.alias_norm || '%'                              -- indexed prefilter
     and (' ' || f.sp_norm || ' ') like ('%' || ' ' || a.alias_norm || ' ' || '%')  -- token boundary
    where f.debtor_name is not null and length(trim(f.debtor_name)) > 1
  ),
  rolled as (
    select
      state,
      (array_agg(debtor_name order by length(debtor_name) desc))[1] as debtor_name,
      lower(state) || '|' || public.ph_ucc_norm(
        (array_agg(debtor_name order by length(debtor_name) desc))[1]) as dedupe_key,
      count(distinct filing_no) as stack_depth,
      array_agg(distinct canonical_funder) as matched_funders,
      max(filed_date) as latest_filing_date,
      (array_agg(debtor_address order by filed_date desc nulls last))[1] as debtor_address,
      (array_agg(debtor_city    order by filed_date desc nulls last))[1] as debtor_city,
      (array_agg(debtor_state   order by filed_date desc nulls last))[1] as debtor_state,
      (array_agg(debtor_zip     order by filed_date desc nulls last))[1] as debtor_zip
    from matched
    group by state, public.ph_ucc_norm(debtor_name)
    having length(public.ph_ucc_norm((array_agg(debtor_name order by length(debtor_name) desc))[1])) >= 2
  ),
  scored as (
    select *,
      (current_date - latest_filing_date) as freshness_days,
      round(
        stack_depth * (1 + 2 * greatest(0, (120 - (current_date - latest_filing_date)) / 120.0))
      , 2) as score
    from rolled
  ),
  up as (
    insert into public.ph_ucc_leads as l (
      state, debtor_name, debtor_address, debtor_city, debtor_state, debtor_zip,
      matched_funders, stack_depth, latest_filing_date, freshness_days, score,
      status, status_reason, dedupe_key)
    select
      state, debtor_name, debtor_address, debtor_city, debtor_state, debtor_zip,
      matched_funders, stack_depth, latest_filing_date, freshness_days, score,
      'needs_skiptrace'::public.ph_ucc_lead_status,
      case when v_skiptrace_provider is null
        then 'No skip-trace provider configured (ph_settings.skiptrace_provider is null / PH_SKIPTRACE_API_KEY not in vault) — no dialable number yet.'
        else 'Awaiting skip-trace append.' end,
      dedupe_key
    from scored
    on conflict (dedupe_key) do update set
      matched_funders    = excluded.matched_funders,
      stack_depth        = excluded.stack_depth,
      latest_filing_date = excluded.latest_filing_date,
      freshness_days     = excluded.freshness_days,
      score              = excluded.score,
      debtor_address     = coalesce(excluded.debtor_address, l.debtor_address),
      debtor_city        = coalesce(excluded.debtor_city, l.debtor_city),
      debtor_state       = coalesce(excluded.debtor_state, l.debtor_state),
      debtor_zip         = coalesce(excluded.debtor_zip, l.debtor_zip),
      status = case when l.status in ('ready','loaded','suppressed') then l.status
                    else 'needs_skiptrace'::public.ph_ucc_lead_status end
    returning 1)
  select count(*) into v_upserted from up;

  leads_upserted := v_upserted;
  select count(distinct f.id) into matched_filings
  from public.ph_ucc_filings f
  join public.ph_ucc_funder_aliases a
    on a.active and length(a.alias_norm) >= 3
   and f.sp_norm like '%' || a.alias_norm || '%'
   and (' ' || f.sp_norm || ' ') like ('%' || ' ' || a.alias_norm || ' ' || '%');
  select count(distinct dedupe_key) into distinct_debtors from public.ph_ucc_leads;
  return next;
end $fn$;
