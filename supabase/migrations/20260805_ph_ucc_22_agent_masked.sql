-- ph_ucc_22: AGENT-MASKED MCA lead class.
-- =============================================================================
-- WHAT: a second lead class alongside the named-funder pipeline. It harvests
-- merchants whose UCC financing statement is filed under a REPRESENTATION AGENT
-- (Corporation Service Company / CSC, C T Corporation, First Corporate Solutions,
-- CHTD, Middesk, Lien Solutions, Financial Agent Services, Secured Lender
-- Solutions, …) — where the TRUE funder is unrecoverable from bulk data (no funder
-- field; collateral code uniformly "OFS"; confirmed CT/CO/CA). The DEBTOR is fully
-- known, and the representation-agent filing pattern is a strong MCA / fintech-
-- syndication signal. We MCA-SCORE each agent-masked debtor and promote ONLY the
-- high-confidence set so equipment/RE/bank-syndication noise (CSC also files those)
-- never becomes a lead.
--
-- WHY (verified 2026-08-05 against the live CT portal, data.ct.gov/xfev-8smz):
--   • 77,175 fresh (≤540d) Active ORIG-FIN-STMT filings in CT.
--   • 5,990 of them are agent-masked (all cleanly representation agents).
--   • 3,935 distinct business debtors carry ≥1 agent-masked lien;
--       532 carry 2+ (stacking), 152 carry 3+.
--   • Of the 532 stackers, ~495 read as textbook MCA small businesses (logistics,
--       asphalt, auto body, deli, towing, foods) once RE/leasing/holding names are
--       removed — and the 33 removed noise names were the DEEPEST stackers (13-14
--       liens: "… REAL ESTATE LLC", "… LEASING LLC", "… REALTY LLC"). So stack
--       depth alone is NOT sufficient: high-stack RE/leasing entities must be de-
--       noised by business-name profile. This migration encodes exactly that.
--
-- SCORING MODEL (the whole point — precision over recall, per owner "start
-- conservative"):
--   PRIMARY   = STACKING. stack_depth = # distinct fresh agent-masked liens on the
--               same (normalized) debtor. 2+ = textbook MCA stacking behaviour
--               (equipment/RE borrowers rarely stack MCAs). 3+ = very high.
--   NOISE GUARD = business-name profile. RE / leasing / realty / holdings /
--               property / development / land-holding / gov entities are demoted
--               OUT of the promoted set (ph_ucc_is_agent_noise).
--   CROSS-REF = if the debtor ALSO carries a named-MCA-funder lien, it already
--               EXISTS as a named_funder lead (the named pipeline captured it), so
--               we do NOT create a duplicate agent-masked lead — it is reported as
--               "already captured" overlap, never re-dialed.
--   Promotion default = stack_depth ≥ 2 AND not name-noise AND not already a
--               named_funder lead. Tier counts (3+, 2+, single, noise, overlap)
--               are reported per state by the edge fn so the owner can loosen later.
--
-- INVARIANTS this migration guarantees:
--   • Named-funder leads are UNTOUCHED. Agent patterns are DISJOINT from the funder
--     dictionary (verified: ph_ucc_match_secured_parties returns [] for every agent
--     name), so agent-masked filings can never become named leads, and the named
--     ph_ucc_rebuild_leads() is not modified at all. Agent leads live in a separate
--     dedupe_key namespace ('am|…') so they can never collide with a named lead.
--   • Gates stay OFF. Agent-masked leads land at needs_skiptrace, phone/email null,
--     matched_funders = the "funder unknown" sentinel. Nothing loads to GHL/dialing
--     until ph_ucc.skiptrace_provider_configured / ucc_load_enabled are flipped.
--   • Egress law. The harvest aggregates/pages SERVER-SIDE and stores ONLY the
--     scored survivors' filings — never the ~100k+ raw masked filings.
-- =============================================================================

-- ── 1. ph_ucc_leads: the agent-masked lead columns ────────────────────────────
alter table public.ph_ucc_leads
  add column if not exists lead_class text not null default 'named_funder'
    check (lead_class in ('named_funder','agent_masked'));
alter table public.ph_ucc_leads
  add column if not exists agent_name text;         -- filing agent(s), e.g. "Corporation Service Company (CSC)"
alter table public.ph_ucc_leads
  add column if not exists mca_score numeric;        -- agent-masked MCA-confidence score (named leads keep `score`)
alter table public.ph_ucc_leads
  add column if not exists score_reasons jsonb;      -- human-readable {stack_depth, agents, reasons:[…]}

comment on column public.ph_ucc_leads.lead_class is
  'named_funder (default; the secured party is a known MCA funder) | agent_masked (the secured party is a representation agent — true funder hidden on the filing image; promoted only when MCA-scored high-confidence).';
comment on column public.ph_ucc_leads.agent_name is
  'agent_masked only: the filing agent(s) that masked the funder (Corporation Service Company / C T Corporation / …).';
comment on column public.ph_ucc_leads.score_reasons is
  'agent_masked only: reproducible MCA-score breakdown (stack_depth, agents, freshness, name-profile) + human-readable reasons.';

create index if not exists ph_ucc_leads_class_idx on public.ph_ucc_leads (lead_class);
-- Existing rows keep lead_class='named_funder' by the default → the named lead pool
-- (14,357 as of 2026-08-05, incl. 104 OR suppressions) is preserved exactly.

-- ── 2. ph_ucc_filings: tag which pipeline a filing belongs to ──────────────────
-- Existing filings are all funder-matched → default 'named_funder'. Agent-masked
-- ingest inserts rows with filing_class='agent_masked' and secured_party_raw = the
-- AGENT name (raw.agent_canonical carries the canonicalized agent). This is the ONE
-- flag the masked rebuild filters on, so it never scans the funder-matched book and
-- the named rebuild never scans the agent book.
alter table public.ph_ucc_filings
  add column if not exists filing_class text not null default 'named_funder'
    check (filing_class in ('named_funder','agent_masked'));
create index if not exists ph_ucc_filings_class_state_idx
  on public.ph_ucc_filings (filing_class, state, lower(debtor_name));
comment on column public.ph_ucc_filings.filing_class is
  'named_funder (secured party is a known funder — the historical book) | agent_masked (secured party is a representation agent; raw.agent_canonical = the agent).';

-- ── 3. ph_ucc_agents: the representation-agent dictionary (maintainable) ────────
-- Distinct from ph_ucc_funder_aliases. Matching is a case-insensitive substring on
-- the RAW secured-party name (NOT ph_ucc_norm — norm strips CORPORATION/COMPANY and
-- would collapse "Corporation Service Company" to "SERVICE"). `pattern` is the
-- UPPER-cased distinctive substring to LIKE; `canonical_agent` is the display name.
-- Add a row → the next masked ingest catches it. Precision-tested 2026-08-05: every
-- seeded pattern matches ONLY representation-agent filings in CT/CO, zero funders.
create table if not exists public.ph_ucc_agents (
  id              uuid primary key default gen_random_uuid(),
  pattern         text not null,                    -- UPPER substring matched against upper(secured_party_raw)
  canonical_agent text not null,                    -- display / rollup name
  active          boolean not null default true,
  note            text,
  created_at      timestamptz not null default now(),
  unique (pattern)
);
comment on table public.ph_ucc_agents is
  'Representation-agent name dictionary for AGENT-MASKED MCA detection (CSC / CT Corporation / First Corporate Solutions / CHTD / Middesk / Lien Solutions / …). pattern = UPPER substring LIKEd against upper(secured_party_raw). Maintainable: add a row and re-run ph-ucc-ingest-masked.';

alter table public.ph_ucc_agents enable row level security;
drop policy if exists ph_ucc_agents_admin_read  on public.ph_ucc_agents;
drop policy if exists ph_ucc_agents_super_write on public.ph_ucc_agents;
create policy ph_ucc_agents_admin_read on public.ph_ucc_agents
  for select to authenticated using (is_admin_or_super(auth.uid()));
create policy ph_ucc_agents_super_write on public.ph_ucc_agents
  for all to authenticated
  using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));

insert into public.ph_ucc_agents (pattern, canonical_agent, note) values
  ('CORPORATION SERVICE COMPANY', 'Corporation Service Company (CSC)', 'incl. "as Representative" forms'),
  ('C T CORPORATION',             'C T Corporation System',            'spaced form "C T"'),
  ('CT CORPORATION',              'C T Corporation System',            'unspaced form "CT"'),
  ('FIRST CORPORATE SOLUTIONS',   'First Corporate Solutions',         null),
  ('CHTD',                        'CHTD Company',                      'CSC-affiliated filing agent'),
  ('WOLTERS KLUWER',             'Wolters Kluwer / Lien Solutions',   null),
  ('LIEN SOLUTIONS',              'Wolters Kluwer / Lien Solutions',   null),
  ('MIDDESK',                     'Middesk',                           null),
  ('FINANCIAL AGENT SERVICE',     'Financial Agent Services',          'SERVICE/SERVICES'),
  ('SECURED LENDER SOLUTIONS',    'Secured Lender Solutions',          null)
on conflict (pattern) do nothing;

-- ── 4. ph_ucc_is_agent_noise: the business-name de-noiser ──────────────────────
-- TRUE when a debtor name reads as a NON-MCA entity that representation agents also
-- file for at high volume: real estate / leasing / realty / holdings / property /
-- development / land-holding vehicles, and governmental bodies. Calibrated on the
-- live CT 2+ set (removes the 13-14-deep "… REAL ESTATE/LEASING/REALTY LLC"
-- stackers while keeping operating small businesses). Conservative by design (better
-- to drop a borderline holding co than dial a non-MCA); the owner can loosen later.
-- KEEP THIS REGEX IN SYNC with AGENT_NOISE in ph-ucc-ingest-masked/index.ts and the
-- CA/FL python loaders (is_agent_noise) — all three must agree on "noise".
create or replace function public.ph_ucc_is_agent_noise(name text)
returns boolean
language sql
immutable
as $function$
  select
    coalesce(upper(name),'') ~
      '(REAL ESTATE|REALTY|PROPERT(Y|IES)|LEASING|(^| )HOLDINGS?( |$)|(^| )HOLDING (CO|COMPANY|LLC)|APARTMENT|CONDOMINIUM|(^| )RENTALS?( |$)|DEVELOPMENT|(^| )INVESTMENTS?( |$)|(^| )VENTURES?( |$)|LAND (COMPANY|HOLDING|TRUST)|(^| )REIT( |$)|SOLAR|WIND FARM)'
  or
    coalesce(upper(name),'') ~
      '((^| )(CITY|COUNTY|TOWN|VILLAGE|BOROUGH) OF |UNIVERSITY|(^| )AUTHORITY( |$)|MUNICIPAL|BOARD OF EDUCATION|HOUSING AUTHORITY|SCHOOL DISTRICT)';
$function$;
comment on function public.ph_ucc_is_agent_noise(text) is
  'TRUE if a debtor name reads as a non-MCA RE/leasing/holding/gov entity (representation agents file these too). Used by the agent-masked rebuild + ingest to keep the promoted set high-confidence. KEEP IN SYNC with AGENT_NOISE in ph-ucc-ingest-masked and the CA/FL loaders.';

-- ── 5. ph_ucc_match_agents: raw parties that match an active agent pattern ──────
-- Convenience helper for the CA/FL file loaders + any consistency check. Returns the
-- DISTINCT input parties whose upper() contains an active agent pattern. (The edge
-- fn does its own in-TS canonicalization from ph_ucc_agents so it can map the raw
-- name to canonical_agent; this rpc is the SQL mirror of "is this an agent name".)
create or replace function public.ph_ucc_match_agents(p_parties text[])
returns setof text
language sql
stable
security definer
set search_path = public
as $function$
  select distinct p.party
  from unnest(p_parties) as p(party)
  where exists (
    select 1 from public.ph_ucc_agents a
    where a.active and upper(p.party) like '%' || a.pattern || '%'
  );
$function$;
grant execute on function public.ph_ucc_match_agents(text[]) to service_role;

-- ── 6. ph_ucc_rebuild_masked_leads: roll up stored agent filings → agent leads ──
-- Mirrors ph_ucc_rebuild_leads' shape but for filing_class='agent_masked'. Because
-- the ingest stores ONLY survivor filings (stack≥2, non-noise, non-overlap) AND all
-- of each survivor's agent liens, count(distinct filing_no) here reproduces the true
-- stack depth. Safety nets re-applied here (idempotent, defends against a re-run or a
-- manually inserted row): drop name-noise debtors, drop debtors already captured as a
-- named_funder lead, require stack_depth ≥ p_min_stack (default 2).
--
--   mca_score = stack_depth * (1 + 2 * recency_weight)   [same curve as named `score`
--               so the two lead classes are comparable in the skiptrace queue]
--   score / mca_score both set (skiptrace orders on `score`).
--   matched_funders = {'— agent-filed (funder unknown) —'}  (sentinel; true funder
--               is unrecoverable from bulk data).
create or replace function public.ph_ucc_rebuild_masked_leads(p_min_stack int default 2)
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
    -- exclude debtors already captured as a named_funder lead (no dialer dupes)
    select r.* from rolled r
    where not exists (
      select 1 from public.ph_ucc_leads n
      where n.lead_class = 'named_funder' and n.dedupe_key = r.base_key
    )
  ),
  scored as (
    select *,
      (current_date - latest_filing_date) as freshness_days,
      round(
        stack_depth * (1 + 2 * greatest(0, (120 - (current_date - latest_filing_date)) / 120.0))
      , 2) as mca_score
    from net_new
  ),
  up as (
    insert into public.ph_ucc_leads as l (
      state, debtor_name, debtor_address, debtor_city, debtor_state, debtor_zip,
      matched_funders, stack_depth, latest_filing_date, freshness_days,
      score, mca_score, lead_class, agent_name, score_reasons,
      status, status_reason, dedupe_key)
    select
      state, debtor_name, debtor_address, debtor_city, debtor_state, debtor_zip,
      array['— agent-filed (funder unknown) —']::text[],
      stack_depth, latest_filing_date, freshness_days,
      mca_score, mca_score, 'agent_masked',
      array_to_string(agents, ', '),
      jsonb_build_object(
        'stack_depth', stack_depth,
        'agent_liens', stack_depth,
        'agents', to_jsonb(agents),
        'latest_filing_date', latest_filing_date,
        'freshness_days', freshness_days,
        'reasons', to_jsonb(array[
          stack_depth || ' fresh agent-filed UCC lien(s) on this debtor (stacking) — textbook MCA behaviour',
          'Most recent agent-filed lien ' || (current_date - latest_filing_date) || ' days ago',
          'Funder identity masked behind filing agent(s): ' || array_to_string(agents, ', '),
          'Business-name profile clean (no real-estate/leasing/holding/gov markers)'
        ])
      ),
      'needs_skiptrace'::public.ph_ucc_lead_status,
      case when not v_skiptrace_ready
        then 'Agent-masked MCA lead. No skip-trace provider configured (ph_ucc.skiptrace_provider_configured = false) — no dialable number yet.'
        else 'Agent-masked MCA lead. Awaiting skip-trace append.' end,
      'am|' || base_key
    from scored
    on conflict (dedupe_key) do update set
      matched_funders    = excluded.matched_funders,
      stack_depth        = excluded.stack_depth,
      latest_filing_date = excluded.latest_filing_date,
      freshness_days     = excluded.freshness_days,
      score              = excluded.score,
      mca_score          = excluded.mca_score,
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
  'Roll up filing_class=agent_masked filings into agent_masked ph_ucc_leads: stack≥p_min_stack, drop name-noise + debtors already named, mca_score = stack*(1+2*recency). Never touches named_funder leads (separate dedupe_key namespace am|…). Gated: lands at needs_skiptrace.';

grant execute on function public.ph_ucc_rebuild_masked_leads(int) to service_role;

-- Tighten past the named siblings: these definer fns are only ever called by the
-- edge fn (service_role) or the CA/FL loaders (postgres, which bypasses grants), so
-- drop the default PUBLIC execute — no anon/authenticated needs them.
revoke execute on function public.ph_ucc_match_agents(text[]) from public;
revoke execute on function public.ph_ucc_rebuild_masked_leads(int) from public;
grant execute on function public.ph_ucc_match_agents(text[]) to service_role;
grant execute on function public.ph_ucc_rebuild_masked_leads(int) to service_role;
