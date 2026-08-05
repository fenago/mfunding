-- ph_ucc_24: explicit, human-readable CONFIDENCE tier on every PH UCC lead.
-- =============================================================================
-- The owner wants to eyeball, per lead, how sure we are it's a live MCA merchant —
-- separate from lead_class (which says whether we KNOW the funder). So:
--
--   lead_class  = "do we know the funder?"   named_funder | agent_masked
--   confidence  = "how sure is it a live MCA merchant?"
--       'confirmed' = named_funder — the secured party IS a known MCA funder, so we
--                     know it's financing AND by whom. Gold standard. (ALL existing
--                     + future named leads, via the column default.)
--       'high'      = agent_masked, 3+ stacked fresh liens (heavy stacking →
--                     near-certain active MCA merchant). [A debtor that ALSO carries
--                     a named-funder lien is even stronger — but that debtor is
--                     already a 'confirmed' named lead and is deliberately NOT
--                     duplicated as an agent lead, so it never appears here.]
--       'medium'    = agent_masked, exactly 2 stacked fresh liens (classic stacking).
--       'low'       = agent_masked, single fresh agent-filed lien (a financed
--                     business, but could be equipment/RE — weakest signal).
--
-- confidence is the plain-English rollup of mca_score/stack_depth; both are kept.
-- score_reasons now carries a self-explanatory summary + the funder-unknown fact so
-- anyone reading the lead knows WHY it's that tier.
--
-- GATING UNCHANGED: every agent lead still lands at needs_skiptrace, phone null.
-- The owner dials which tiers get loaded (high, then optionally medium, then low)
-- when the gate is flipped — per-tier counts are reported so the threshold is a knob.
-- =============================================================================

-- ── 1. The confidence column (default 'confirmed' → every named lead, now + future,
--    is 'confirmed' automatically; the masked rebuild always sets high/medium/low). ─
alter table public.ph_ucc_leads
  add column if not exists confidence text not null default 'confirmed'
    check (confidence in ('confirmed','high','medium','low'));
comment on column public.ph_ucc_leads.confidence is
  'Plain-English confidence it is a live MCA merchant. confirmed = named_funder (funder known). high/medium/low = agent_masked by stacking (3+/2/1 fresh agent-filed liens). Rollup of mca_score/stack_depth; see score_reasons for the why.';
create index if not exists ph_ucc_leads_confidence_idx on public.ph_ucc_leads (lead_class, confidence);

-- ── 2. Backfill existing agent_masked leads (the default set them to 'confirmed';
--    fix them by stack_depth). Named leads correctly keep 'confirmed'. The rebuild
--    below is authoritative going forward. ──────────────────────────────────────────
update public.ph_ucc_leads
set confidence = case when stack_depth >= 3 then 'high'
                      when stack_depth = 2 then 'medium'
                      else 'low' end
where lead_class = 'agent_masked';

-- ── 3. Rebuild: tier every agent lead + include singles (p_min_stack default 1). ────
-- Now promotes ALL fresh agent-filed business debtors (non-noise, not already a named
-- lead), assigning confidence by stack depth. Singles land as 'low' (visible + gated,
-- never loaded until the owner opts in). Everything else is identical to ph_ucc_22's
-- rebuild (separate am| dedupe namespace, named leads untouched, sentinel funder).
create or replace function public.ph_ucc_rebuild_masked_leads(p_min_stack int default 1)
returns table (leads_upserted int, agent_debtors int, promoted int)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_upserted int := 0;
  v_skiptrace_ready boolean := false;
begin
  select coalesce((value->>'skiptrace_provider_configured')::boolean, false) into v_skiptrace_ready
  from public.platform_settings where key = 'ph_ucc';

  with af as (
    select
      f.state, f.filing_no, f.filed_date, f.debtor_name,
      f.debtor_address, f.debtor_city, f.debtor_state, f.debtor_zip,
      coalesce(nullif(f.raw->>'agent_canonical',''), f.secured_party_raw) as agent
    from public.ph_ucc_filings f
    where f.filing_class = 'agent_masked'
      and f.debtor_name is not null and length(trim(f.debtor_name)) > 1
      and not public.ph_ucc_is_agent_noise(f.debtor_name)
  ),
  rolled as (
    select
      state,
      (array_agg(debtor_name order by length(debtor_name) desc))[1] as debtor_name,
      lower(state) || '|' || public.ph_ucc_norm(
        (array_agg(debtor_name order by length(debtor_name) desc))[1]) as base_key,
      count(distinct filing_no) as stack_depth,
      array_agg(distinct agent) as agents,
      max(filed_date) as latest_filing_date,
      (array_agg(debtor_address order by filed_date desc nulls last))[1] as debtor_address,
      (array_agg(debtor_city    order by filed_date desc nulls last))[1] as debtor_city,
      (array_agg(debtor_state   order by filed_date desc nulls last))[1] as debtor_state,
      (array_agg(debtor_zip     order by filed_date desc nulls last))[1] as debtor_zip
    from af
    group by state, public.ph_ucc_norm(debtor_name)
    having length(public.ph_ucc_norm((array_agg(debtor_name order by length(debtor_name) desc))[1])) >= 2
       and count(distinct filing_no) >= p_min_stack
  ),
  net_new as (
    select r.* from rolled r
    where not exists (
      select 1 from public.ph_ucc_leads n
      where n.lead_class = 'named_funder' and n.dedupe_key = r.base_key
    )
  ),
  scored as (
    select *,
      (current_date - latest_filing_date) as freshness_days,
      round(stack_depth * (1 + 2 * greatest(0, (120 - (current_date - latest_filing_date)) / 120.0)), 2) as mca_score,
      case when stack_depth >= 3 then 'high'
           when stack_depth = 2 then 'medium'
           else 'low' end as confidence
    from net_new
  ),
  up as (
    insert into public.ph_ucc_leads as l (
      state, debtor_name, debtor_address, debtor_city, debtor_state, debtor_zip,
      matched_funders, stack_depth, latest_filing_date, freshness_days,
      score, mca_score, lead_class, confidence, agent_name, score_reasons,
      status, status_reason, dedupe_key)
    select
      state, debtor_name, debtor_address, debtor_city, debtor_state, debtor_zip,
      array['— agent-filed (funder unknown) —']::text[],
      stack_depth, latest_filing_date, freshness_days,
      mca_score, mca_score, 'agent_masked', confidence,
      array_to_string(agents, ', '),
      jsonb_build_object(
        'confidence', confidence,
        'funder_known', false,
        'stack_depth', stack_depth,
        'agent_liens', stack_depth,
        'agents', to_jsonb(agents),
        'latest_filing_date', latest_filing_date,
        'freshness_days', freshness_days,
        'summary', 'Agent-filed via ' || array_to_string(agents, ', ') || '; '
                   || stack_depth || ' fresh UCC lien(s) on this debtor; true funder unknown ('
                   || confidence || ' confidence).',
        'reasons', to_jsonb(array[
          case when stack_depth >= 3
               then stack_depth || ' fresh agent-filed liens (heavy stacking) — near-certain active MCA merchant'
               when stack_depth = 2
               then 'Exactly 2 fresh agent-filed liens on this debtor — classic MCA stacking'
               else 'Single fresh agent-filed lien — a financed business, but could be equipment/RE (weakest signal)'
          end,
          'Most recent agent-filed lien ' || (current_date - latest_filing_date) || ' days ago',
          'True funder is masked behind filing agent(s): ' || array_to_string(agents, ', ')
            || ' — unrecoverable from bulk data (skip-trace the merchant to confirm)',
          'Business-name profile clean (no real-estate/leasing/holding/gov markers)'
        ])
      ),
      'needs_skiptrace'::public.ph_ucc_lead_status,
      case when not v_skiptrace_ready
        then 'Agent-masked MCA lead (' || confidence || ' confidence). No skip-trace provider configured — no dialable number yet.'
        else 'Agent-masked MCA lead (' || confidence || ' confidence). Awaiting skip-trace append.' end,
      'am|' || base_key
    from scored
    on conflict (dedupe_key) do update set
      matched_funders    = excluded.matched_funders,
      stack_depth        = excluded.stack_depth,
      latest_filing_date = excluded.latest_filing_date,
      freshness_days     = excluded.freshness_days,
      score              = excluded.score,
      mca_score          = excluded.mca_score,
      confidence         = excluded.confidence,
      agent_name         = excluded.agent_name,
      score_reasons      = excluded.score_reasons,
      debtor_address     = coalesce(excluded.debtor_address, l.debtor_address),
      debtor_city        = coalesce(excluded.debtor_city, l.debtor_city),
      debtor_state       = coalesce(excluded.debtor_state, l.debtor_state),
      debtor_zip         = coalesce(excluded.debtor_zip, l.debtor_zip),
      status = case when l.status in ('ready','loaded','suppressed') then l.status
                    else 'needs_skiptrace'::public.ph_ucc_lead_status end
    returning 1)
  select count(*) into v_upserted from up;

  leads_upserted := v_upserted;
  select count(distinct base_key) into agent_debtors from (
    select lower(f.state) || '|' || public.ph_ucc_norm(f.debtor_name) as base_key
    from public.ph_ucc_filings f
    where f.filing_class = 'agent_masked' and f.debtor_name is not null
  ) s;
  select count(*) into promoted from public.ph_ucc_leads where lead_class = 'agent_masked';
  return next;
end $function$;

comment on function public.ph_ucc_rebuild_masked_leads(int) is
  'Roll up filing_class=agent_masked filings into agent_masked ph_ucc_leads with an explicit confidence tier (high=3+ / medium=2 / low=1 fresh agent liens); drop name-noise + debtors already named. Never touches named_funder leads (am| dedupe namespace). Gated: needs_skiptrace.';

revoke execute on function public.ph_ucc_rebuild_masked_leads(int) from public;
grant execute on function public.ph_ucc_rebuild_masked_leads(int) to service_role;
