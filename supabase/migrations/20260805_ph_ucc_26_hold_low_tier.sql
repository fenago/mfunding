-- ph_ucc_26: HOLD the low-confidence agent-masked tier (reversible, flag-driven).
-- =============================================================================
-- Implements the owner's HOLD decision for the 6,142 confidence='low' (single fresh
-- agent-filed lien) agent_masked leads:
--   1. Structurally OUT of the skip-trace set — status='held' (ph_ucc_25); the trace
--      only picks needs_skiptrace. Backfilled below.
--   2. Still VISIBLE + filterable as Low in the lead book (confidence unchanged;
--      'held' renders like any status once confidence-ui adds its chip).
--   3. PRESERVED across rebuilds — the masked rebuild recomputes low's status from a
--      single durable flag every run, so a rebuild never reverts held → needs_skiptrace.
--   4. FULLY REVERSIBLE with one switch — set the flag true (then rebuild, or the
--      one-line UPDATE) flips all held low leads back to needs_skiptrace, forever.
--   5. High (328) + Medium (900) stay the active needs_skiptrace set. Named untouched.
--
-- WHY A FLAG (platform_settings.ph_ucc.low_agent_masked_active), not a status-preserve
-- entry: 'held' for low is a SYSTEMATIC state, not a per-lead human advance. If the
-- rebuild merely "preserved" 'held', flipping a lead back to needs_skiptrace would be
-- re-held on the next run (confidence is still 'low') — NOT reversible. Driving low's
-- status from the flag makes hold the default AND makes the flip stick. Human/terminal
-- advances (ready/loaded/suppressed) are still preserved exactly as before.
--
-- SCOPE: only ph_ucc_rebuild_masked_leads changes. ph_ucc_rebuild_leads (named) is
-- deliberately NOT touched — named leads live in a different dedupe_key namespace and
-- are never 'held', so the named pool (14,253 + 104 suppressed) stays exactly preserved.
-- =============================================================================

-- ── 1. The durable switch (default false = low is HELD) ───────────────────────
update public.platform_settings
set value = jsonb_build_object('low_agent_masked_active', false) || value
where key = 'ph_ucc';
-- (|| with existing on the right: only adds the key if absent; never clobbers a value
--  the owner has flipped.)

-- ── 2. Rebuild: drive low's status from the flag (else identical to ph_ucc_24) ─
create or replace function public.ph_ucc_rebuild_masked_leads(p_min_stack int default 1)
returns table (leads_upserted int, agent_debtors int, promoted int)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_upserted int := 0;
  v_skiptrace_ready boolean := false;
  v_low_active boolean := false;   -- owner switch: false ⇒ low leads are HELD
begin
  select coalesce((value->>'skiptrace_provider_configured')::boolean, false) into v_skiptrace_ready
  from public.platform_settings where key = 'ph_ucc';
  select coalesce((value->>'low_agent_masked_active')::boolean, false) into v_low_active
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
      -- low → held (unless the owner has activated the low tier); high/medium → active.
      case when confidence = 'low' and not v_low_active then 'held'::public.ph_ucc_lead_status
           else 'needs_skiptrace'::public.ph_ucc_lead_status end,
      case when confidence = 'low' and not v_low_active
             then 'Agent-masked LOW-confidence (single-lien) lead — HELD out of the skip-trace set by owner directive (conservative: stacked-only). Set platform_settings ph_ucc.low_agent_masked_active=true to activate.'
           when not v_skiptrace_ready
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
      -- preserve human/terminal advances; otherwise recompute from confidence+flag so
      -- the held state is reproduced every run (and un-held cleanly when the flag flips).
      status = case
        when l.status in ('ready','loaded','suppressed') then l.status
        when excluded.confidence = 'low' and not v_low_active then 'held'::public.ph_ucc_lead_status
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

revoke execute on function public.ph_ucc_rebuild_masked_leads(int) from public;
grant execute on function public.ph_ucc_rebuild_masked_leads(int) to service_role;

-- ── 3. Backfill: park the current low leads now (only the un-advanced ones) ────
update public.ph_ucc_leads
set status = 'held',
    status_reason = 'Agent-masked LOW-confidence (single-lien) lead — HELD out of the skip-trace set by owner directive (conservative: stacked-only). Set platform_settings ph_ucc.low_agent_masked_active=true to activate.'
where lead_class = 'agent_masked' and confidence = 'low' and status = 'needs_skiptrace';

-- ── HOW TO ACTIVATE LOW LATER (reversible) ────────────────────────────────────
-- AUTHORITATIVE one-op (flips EVERY held low lead — use this):
--   update public.platform_settings                                        -- (a) make it stick
--     set value = jsonb_set(value, '{low_agent_masked_active}', 'true') where key = 'ph_ucc';
--   update public.ph_ucc_leads set status = 'needs_skiptrace'             -- (b) flip them now
--     where lead_class='agent_masked' and confidence='low' and status='held';
-- The flag (a) makes it durable: every future ph_ucc_rebuild_masked_leads keeps low
-- ACTIVE. The UPDATE (b) is the reliable flip — do NOT rely on rebuild-alone to
-- un-hold, because a rebuild upserts only the currently-derivable debtors and leaves a
-- few already-existing leads untouched (they'd keep their old 'held' status).
-- To RE-HOLD: set the flag back to 'false' and UPDATE the low leads back to 'held'.
-- =============================================================================
