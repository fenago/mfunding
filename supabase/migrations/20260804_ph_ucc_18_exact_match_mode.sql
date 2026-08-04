-- ph_ucc_18: EXACT-FULL-NAME match mode for the PH UCC funder matcher.
-- =============================================================================
-- WHY: the token matcher normalizes secured-party names with ph_ucc_norm(),
-- which STRIPS the descriptor words FUNDING / FUND / CAPITAL / FINANCIAL /
-- FINANCE / GROUP / SERVICING (so "distinctive core token" aliases work). But a
-- handful of confirmed-real MCA funders have names that are ONLY those stripped
-- words plus one generic word, so they collapse to a bare generic token that
-- over-matches unrelated companies and cannot be added as a token/trgm alias:
--   Alternative Funding Group -> ph_ucc_norm "ALTERNATIVE" (mortgage trusts, energy funds)
--   Specialty Capital         -> ph_ucc_norm "SPECIALTY"   (ASD Specialty Healthcare, insurers)
--   Agile Capital Funding     -> ph_ucc_norm "AGILE"       (Agile Occupational Medicine, etc.)
-- (Flagged for exactly this path in ph_ucc_17's "NOT added" note.)
--
-- FIX: a second, opt-in match mode that compares the FULL descriptor-preserving
-- normalization of the secured party to the alias's full-normalized form by
-- EQUALITY — so "ALTERNATIVE FUNDING GROUP LLC" matches ONLY the alias
-- "alternative funding group", never bare "ALTERNATIVE ...". The depository
-- guard (ph_ucc_is_depository) still applies. Existing 202 active aliases keep
-- behaving EXACTLY as before: match_mode defaults to 'token'.
--
-- HOW A FUTURE AGENT ADDS AN EXACT-MODE ALIAS (reusable path):
--   insert into public.ph_ucc_funder_aliases (alias, canonical_name, source, active, match_mode)
--   values ('Specialty Capital', 'Specialty Capital', 'curated', true, 'exact')
--   on conflict (alias) do update set match_mode='exact', active=true;
--   -- then: select public.ph_ucc_rebuild_leads();  (and re-ingest to pull filings)
-- Use 'exact' ONLY when the funder's distinctive words are all norm-stripped
-- descriptors; otherwise use 'token' (the default) with the distinctive core.
-- =============================================================================

-- ── 1. Descriptor-preserving normalization (full-name) ───────────────────────
-- Strip corporate-FORM suffixes only (LLC/INC/CORP/CO/LP/LTD/THE/agent phrases)
-- but KEEP the descriptor words FUNDING/FUND/CAPITAL/FINANCIAL/FINANCE/GROUP/
-- SERVICING that ph_ucc_norm() throws away. Upper-case, non-alnum -> single
-- spaces, trim. IMMUTABLE so it can back a generated column + index.
-- KEEP IN SYNC with the DuckDB `norm2` macro in scripts/ph_ucc_ca_loader.py
-- (same corporate-FORM suffix list) so the CA file loader and the DB matcher
-- agree on what an exact name normalizes to.
create or replace function public.ph_ucc_norm_full(s text)
returns text language sql immutable as $$
  select trim(regexp_replace(
    regexp_replace(
      upper(coalesce(s,'')),
      '\y(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LP|LLP|LTD|THE|AS REPRESENTATIVE|AS COLLATERAL AGENT|AS AGENT)\y',
      ' ', 'g'),
    '[^A-Z0-9]+', ' ', 'g'))
$$;

-- ── 2. Alias schema: match_mode + full-name generated column ──────────────────
alter table public.ph_ucc_funder_aliases
  add column if not exists match_mode text not null default 'token'
    check (match_mode in ('token','exact'));
comment on column public.ph_ucc_funder_aliases.match_mode is
  'token (default) = trgm+token-boundary contains on ph_ucc_norm (distinctive core token). exact = full-name equality on ph_ucc_norm_full (for funders whose distinctive words are all norm-stripped descriptors like FUNDING/CAPITAL/GROUP).';

alter table public.ph_ucc_funder_aliases
  add column if not exists alias_full_norm text
    generated always as (public.ph_ucc_norm_full(alias)) stored;

-- ── 3. Filings: full-name normalized generated column + index for exact join ──
-- ph_ucc_filings is small (matched-only, ~13k rows), so the stored column is a
-- cheap one-time compute and lets the exact-equality join use an index.
alter table public.ph_ucc_filings
  add column if not exists sp_norm_full text
    generated always as (public.ph_ucc_norm_full(secured_party_raw)) stored;
create index if not exists ph_ucc_filings_sp_norm_full_idx
  on public.ph_ucc_filings (sp_norm_full);

-- ── 4. Shared matcher: honor BOTH modes in ph_ucc_rebuild_leads ──────────────
-- Faithful copy of the ph_ucc_12 definition; the ONLY change is the alias join
-- predicate, which now ORs the existing token rule with an exact-equality rule.
-- The depository guard and everything downstream are unchanged.
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
     and (
       (a.match_mode = 'token'
         and length(a.alias_norm) >= 3
         and f.sp_norm like '%' || a.alias_norm || '%'
         and (' ' || f.sp_norm || ' ') like ('%' || ' ' || a.alias_norm || ' ' || '%'))
       or
       (a.match_mode = 'exact'
         and a.alias_full_norm <> ''
         and f.sp_norm_full = a.alias_full_norm)
     )
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
    on a.active
   and (
     (a.match_mode = 'token'
       and length(a.alias_norm) >= 3
       and f.sp_norm like '%' || a.alias_norm || '%'
       and (' ' || f.sp_norm || ' ') like ('%' || ' ' || a.alias_norm || ' ' || '%'))
     or
     (a.match_mode = 'exact'
       and a.alias_full_norm <> ''
       and f.sp_norm_full = a.alias_full_norm)
   )
  where not public.ph_ucc_is_depository(f.sp_norm);
  select count(distinct dedupe_key) into distinct_debtors from public.ph_ucc_leads;
  return next;
end $function$;

-- ── 5. Ingest pre-filter RPC: honor BOTH modes (keep IN SYNC with the rebuild) ─
-- The edge fn's keepFunderMatches() calls this; its predicate MUST equal the
-- rebuild join above or ingest would drop filings the rebuild keeps (or vice
-- versa). Same OR of token + exact, same depository guard.
create or replace function public.ph_ucc_match_secured_parties(p_parties text[])
returns setof text
language sql
stable
security definer
set search_path = public
as $function$
  select p.party
  from unnest(p_parties) as p(party)
  where (
    exists (
      select 1
      from public.ph_ucc_funder_aliases a
      where a.active
        and a.match_mode = 'token'
        and length(a.alias_norm) >= 3
        and public.ph_ucc_norm(p.party) like '%' || a.alias_norm || '%'
        and (' ' || public.ph_ucc_norm(p.party) || ' ')
              like ('%' || ' ' || a.alias_norm || ' ' || '%')
    )
    or exists (
      select 1
      from public.ph_ucc_funder_aliases a
      where a.active
        and a.match_mode = 'exact'
        and a.alias_full_norm <> ''
        and public.ph_ucc_norm_full(p.party) = a.alias_full_norm
    )
  )
  and not public.ph_ucc_is_depository(public.ph_ucc_norm(p.party));
$function$;

grant execute on function public.ph_ucc_match_secured_parties(text[]) to service_role;

-- ── 6. Add the 3 confirmed MCA funders as EXACT-mode aliases ──────────────────
-- Legal-form variants (LLC etc.) all collapse to the same alias_full_norm, so a
-- single canonical alias per funder covers them; extra explicit variants are
-- harmless (same full-norm). All precision-tested against the raw 5-state
-- secured-party universe: each exact alias matches ONLY the real funder — zero
-- banks / healthcare / insurers / mortgage trusts (see migration report).
insert into public.ph_ucc_funder_aliases (alias, canonical_name, source, active, match_mode) values
  ('Alternative Funding Group', 'Alternative Funding Group', 'curated', true, 'exact'),
  ('Specialty Capital',         'Specialty Capital',         'curated', true, 'exact'),
  ('Agile Capital Funding',     'Agile Capital Funding',     'curated', true, 'exact')
on conflict (alias) do update set
  canonical_name = excluded.canonical_name,
  source     = excluded.source,
  active     = true,
  match_mode = 'exact';
