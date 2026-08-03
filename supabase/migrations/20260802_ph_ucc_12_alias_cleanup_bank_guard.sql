-- PH UCC — global alias cleanup + shared deposit-institution guard
-- =============================================================================
-- WHY: The FL full-download load proved that bare generic one-word aliases in
-- ph_ucc_funder_aliases match BANKS and other non-MCA creditors, not MCA
-- funders. "NATIONAL" alone matched 13,388 real bank filings in FL (PNC,
-- Huntington, Fifth Third, U.S. Bank, Wells Fargo, KeyBank, …). The FL loader
-- blocked those LOCALLY only (scripts/ph_ucc_fl_loader.py BLOCKLIST), so the
-- earlier CO/CA/OR loads — which had no such guard — inserted bank customers as
-- fake "MCA merchants." Audit (2026-08-02) confirmed 807 contaminated leads,
-- incl. ~104 already skip-traced OR leads that are U.S. Bank / KeyBank / Marlin
-- Leasing / Simplot / True Value customers, not MCA merchants.
--
-- This migration fixes the SHARED dictionary (not a per-load blocklist) two ways:
--   1. Deactivate / tighten the dangerous aliases (audit note in `source`).
--   2. Add a reusable deposit-institution guard to ph_ucc_rebuild_leads so NO
--      future ingest (CA still loading, future CO/OR/FL refreshes, file-ingest)
--      can turn a bank filing into an MCA lead — even if the alias survives.
--
-- Leads are scrubbed separately (delete non-protected orphans + rebuild) AFTER
-- the CA load finishes, so orphans are computed against final data. Skip-traced
-- leads are NEVER deleted — the owner paid for them; they are flagged instead.
-- =============================================================================

-- ── 1a. DEACTIVATE hopeless generic / bank-catching aliases ──────────────────
-- Each matched banks / persons / retail / equipment-lessors / RE funds far more
-- than (or instead of) the intended funder, AND cannot be tightened because the
-- funder's distinctive word is a norm-stripped suffix (FUNDING/CAPITAL/GROUP/…),
-- so a longer alias_norm would never match. Deactivated (not deleted) so a
-- re-seed of the dictionary will not resurrect them. Real funders behind these
-- are still reachable via their distinctive shell aliases where those exist
-- (e.g. Credibly via CREDIBLY/DEATH VALLEY/RED RIVER RIDGE; Pearl via
-- PEARL CASH/BETA/DELTA/RIVIS; Funding Circle via FC MARKETPLACE).
-- (audit note lives in this migration's comments + an activity_log entry; the
-- `source` column is constrained to lenders/curated/debanked so is left as-is.)
update public.ph_ucc_funder_aliases
set active = false
where active and alias_norm in (
  'NETWORK',            -- Funding Network → "COLONIAL FUNDING NETWORK…"; generic
  'CIRCLE',             -- Funding Circle → covered by FC MARKETPLACE; "Circle K" etc
  'RETAIL',             -- Credibly → matched Kawasaki Retail Finance, Simplot AB Retail
  'EXPRESS',            -- Capital Express → ERTC Express, Express Tech, Libertas trusts
  'VALUE',              -- Value Capital Funding → matched "TRUE VALUE COMPANY"
  'FOX',                -- Fox Capital → "FOX" is hopelessly generic
  'VELOCITY',           -- Velocity Capital Group → Velocity Financial (RE) collisions
  'ROK',                -- ROK Financial → FL-flagged non-MCA
  'GRP',                -- GRP Funding → FL-flagged debt-buyer; "GRP" abbrev noise
  'RELIANCE',           -- Reliance Financial → Reliance Standard (insurance)/Reliance Bank
  'INTREPID',           -- Intrepid Finance → FL-flagged non-MCA
  'DIESEL',             -- Diesel Funding → trucking/fuel companies
  'TANGO',              -- Snap Advances shell → Tango Card etc
  'PEARL',              -- bare Pearl Capital → generic; kept: PEARL CASH/BETA/DELTA/RIVIS
  'DAVID ALLEN',        -- David Allen Capital → matches persons named David Allen
  'FINANCING SOLUTIONS',-- Financing Solutions → "CONTRACT/PERIDOT FINANCING SOLUTIONS"
  'MARLIN',             -- Marlin Capital → 728 "MARLIN LEASING CORP" equipment liens (non-MCA)
  'LENDINGCLUB'         -- Lending Club → now "LENDINGCLUB BANK, N.A." (a depository)
);

-- NATIONAL is intentionally KEPT active: after the deposit-institution guard
-- below, its only non-bank matches are the real "NATIONAL FUNDING, INC." (58
-- filings). The guard drops the 124 bank matches ("… NATIONAL ASSOCIATION").

-- ── 1b. TIGHTEN STRATEGIC → distinctive norm-surviving token ─────────────────
-- "STRATEGIC" is generic, but Kapitus's legacy name "Strategic Funding Source"
-- norms to "STRATEGIC SOURCE" (FUNDING is stripped) — distinctive and safe.
-- alias_norm is a GENERATED column (ph_ucc_norm(alias)); set `alias` and it
-- recomputes to "STRATEGIC SOURCE" automatically.
update public.ph_ucc_funder_aliases
set alias = 'Strategic Funding Source'
where alias_norm = 'STRATEGIC' and canonical_name = 'Kapitus';

-- ── 2. Reusable deposit-institution guard ────────────────────────────────────
-- True when a NORMALIZED secured-party name is a bank / thrift / credit union.
-- Operates on ph_ucc_norm() output (suffixes stripped, non-alnum → single
-- spaces, upper-case). No MCA funder canonical contains BANK/BANC/SAVINGS/
-- CREDIT UNION/NATIONAL ASSOCIATION, so substring tests are safe here; N A/FCU/
-- FSB/SSB use token boundaries to avoid clipping unrelated words.
create or replace function public.ph_ucc_is_depository(sp_norm text)
returns boolean
language sql
immutable
as $function$
  select coalesce(sp_norm,'') ~ 'BANK'
      or coalesce(sp_norm,'') ~ '(^| )BANC'          -- BANC, BANCORP, BANCSHARES
      or coalesce(sp_norm,'') ~ 'SAVINGS'
      or coalesce(sp_norm,'') ~ 'CREDIT UNION'
      or coalesce(sp_norm,'') ~ 'NATIONAL ASSOCIATION'
      or coalesce(sp_norm,'') ~ '(^| )N A( |$)'      -- N.A.
      or coalesce(sp_norm,'') ~ '(^| )(FCU|F C U|FSB|F S B|SSB|S S B)( |$)'
$function$;

-- ── 3. Shared matcher: apply the guard in ph_ucc_rebuild_leads ───────────────
-- Faithful copy of the existing function with `and not
-- public.ph_ucc_is_depository(f.sp_norm)` added to BOTH the lead-building join
-- and the matched_filings recount, so bank filings can never become leads and
-- never inflate stack_depth — for every state, every future ingest.
create or replace function public.ph_ucc_rebuild_leads()
 returns TABLE(leads_upserted integer, distinct_debtors integer, matched_filings integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
      and not public.ph_ucc_is_depository(f.sp_norm)
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
   and (' ' || f.sp_norm || ' ') like ('%' || ' ' || a.alias_norm || ' ' || '%')
  where not public.ph_ucc_is_depository(f.sp_norm);
  select count(distinct dedupe_key) into distinct_debtors from public.ph_ucc_leads;
  return next;
end $function$;
