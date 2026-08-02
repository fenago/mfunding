-- PH UCC — reconcile the backend to the SHIPPED dashboard contract
-- (src/pages/admin/PhUccMachinePage.tsx, commits ca235bd/1ec0ee8/b46b66d) and
-- close the data-quality gaps flagged in review. All additive/idempotent; the
-- only rename is canonical_funder->canonical_name (the UI reads/writes that name).
--
-- Verified live against the frontend's exact reads/writes:
--   • aliases: select *, insert {alias, canonical_name, source}, update {active}, delete by id
--   • leads:   update {status} by id (suppress)
--   • sources: select * -> rows_ingested, newest_filing_date, error_note
--   • filings: select filing_date, ingested_at
--   • settings: platform_settings key 'ph_ucc' = {ucc_load_enabled,
--     skiptrace_provider_configured, scrub_provider_configured} (all bool)

-- ── 1. Column-name reconciliation ──────────────────────────────────────────────
alter table public.ph_ucc_funder_aliases rename column canonical_funder to canonical_name;

-- UI reads ph_ucc_filings.filing_date; our column is filed_date. Mirror it.
alter table public.ph_ucc_filings
  add column if not exists filing_date date generated always as (filed_date) stored;
create index if not exists ph_ucc_filings_filing_date_idx on public.ph_ucc_filings (filing_date desc);

-- UI reads ph_ucc_sources.rows_ingested / error_note / newest_filing_date.
alter table public.ph_ucc_sources
  add column if not exists rows_ingested integer generated always as (last_rows) stored;
alter table public.ph_ucc_sources
  add column if not exists error_note text generated always as (notes) stored;
alter table public.ph_ucc_sources
  add column if not exists newest_filing_date date;                 -- maintained by ph-ucc-ingest
-- one-time backfill so the cards populate immediately
update public.ph_ucc_sources s
set newest_filing_date = (select max(f.filed_date) from public.ph_ucc_filings f where f.state = s.state)
where exists (select 1 from public.ph_ucc_filings f where f.state = s.state);

-- ── 2. Gate settings: single source of truth under key 'ph_ucc' ────────────────
-- The UI owns/edits these three bools. Seed them and REMOVE the duplicate gate
-- keys I had merged into 'ph_settings' (leaving ph_settings' other keys intact),
-- so there is exactly one gate row.
insert into public.platform_settings (key, value)
values ('ph_ucc', jsonb_build_object(
  'ucc_load_enabled', false,
  'skiptrace_provider_configured', false,
  'scrub_provider_configured', false))
on conflict (key) do update
  set value = jsonb_build_object(
    'ucc_load_enabled', false,
    'skiptrace_provider_configured', false,
    'scrub_provider_configured', false) || public.platform_settings.value;  -- keep human edits

update public.platform_settings
set value = value - 'ucc_load_enabled' - 'skiptrace_provider' - 'tcpa_scrub_provider'
where key = 'ph_settings';

-- ── 3. Staff write RLS — SINGLE OWNER is ph-backend's convergence migration ──────
-- The staff write policies for BOTH ph_ucc tables are owned SOLELY by
-- 20260802_ph_ucc_drop_redundant_alias_write_policies.sql:
--   • ph_ucc_funder_aliases: one FOR ALL policy `ph_ucc_funder_aliases_admin_write`
--   • ph_ucc_leads:          `ph_ucc_leads_admin_update`
-- (both is_admin_or_super, with check). That file sorts AFTER this one, so on a full
-- replay it creates the canonical policies last. This file only DEFENSIVELY drops the
-- stray overlapping alias policy in case a prior partial apply left one behind; it
-- does NOT create write policies. (An earlier version created them here, which raced
-- with the convergence file and briefly left the table with no write policy. We agreed
-- on a single owner — do not add creates back here; ping ph-backend for RLS changes.)
drop policy if exists ph_ucc_funder_aliases_admin_write on public.ph_ucc_funder_aliases;

-- ── 4. Data quality: deactivate non-MCA-position lender aliases ─────────────────
-- These are equipment-lease / freight-factoring lenders. Their UCC filings are
-- equipment/receivables liens, NOT MCA positions, so they are false positives for
-- an MCA-poaching dial list. We deactivate them for UCC MATCHING ONLY (this table)
-- — we do NOT touch lender_programs / the funder-ops classification. The owner can
-- re-enable any of these from the Alias Manager. (Flagged to funder-ops.)
update public.ph_ucc_funder_aliases
set active = false
where source = 'lenders'
  and canonical_name in ('TimePayment', 'Beacon Funding', 'RTS Financial');

-- ── 5. Data quality: dedupe the LCF canonical (curated 'LCF' == lenders 'The LCF Group') ──
update public.ph_ucc_funder_aliases set canonical_name = 'The LCF Group' where canonical_name = 'LCF';

-- ── 6. Matcher: use canonical_name + read the 'ph_ucc' gate ─────────────────────
create or replace function public.ph_ucc_rebuild_leads()
returns table (leads_upserted int, distinct_debtors int, matched_filings int)
language plpgsql security definer set search_path = public as $fn$
declare
  v_upserted int := 0;
  v_skiptrace_ready boolean := false;
begin
  select coalesce((value->>'skiptrace_provider_configured')::boolean, false) into v_skiptrace_ready
  from public.platform_settings where key = 'ph_ucc';

  with matched as (
    select distinct
      f.id as filing_id, f.state, f.filing_no, f.filed_date,
      f.debtor_name, f.debtor_address, f.debtor_city, f.debtor_state, f.debtor_zip,
      a.canonical_name
    from public.ph_ucc_filings f
    join public.ph_ucc_funder_aliases a
      on a.active
     and length(a.alias_norm) >= 3
     and f.sp_norm like '%' || a.alias_norm || '%'
     and (' ' || f.sp_norm || ' ') like ('%' || ' ' || a.alias_norm || ' ' || '%')
    where f.debtor_name is not null and length(trim(f.debtor_name)) > 1
  ),
  rolled as (
    select
      state,
      (array_agg(debtor_name order by length(debtor_name) desc))[1] as debtor_name,
      lower(state) || '|' || public.ph_ucc_norm(
        (array_agg(debtor_name order by length(debtor_name) desc))[1]) as dedupe_key,
      count(distinct filing_no) as stack_depth,
      array_agg(distinct canonical_name) as matched_funders,
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
      case when not v_skiptrace_ready
        then 'No skip-trace provider configured (ph_ucc.skiptrace_provider_configured = false) — no dialable number yet.'
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
