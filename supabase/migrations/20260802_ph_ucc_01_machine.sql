-- PH UCC List Machine — the data spine.
--
-- WHAT THIS IS: an in-house manufactured-lead pipeline that pulls UCC financing-
-- statement filings from state open-data portals, detects merchants who already
-- carry an MCA position (the secured party is a known funder), rolls them up into
-- ranked "fresh position" leads, and (once the human gates are lit) skip-traces,
-- TCPA-scrubs, and loads them into the PH dialing campaign.
--
-- NAMING LAW: every asset here is prefixed ph_ucc_ / settings live under
-- platform_settings.ph_settings. Nothing here reads or writes MCA/VCF assets.
--
-- HONEST GATES (see ph_ucc_leads.status): a matched lead can NOT advance past
-- needs_skiptrace until PH_SKIPTRACE_API_KEY + ph_settings.skiptrace_provider
-- exist, can NOT reach `ready` until the TCPA scrub stage exists, and NOTHING is
-- loaded to GHL/dialing until ph_settings.ucc_load_enabled = true (default FALSE).
-- We NEVER put an unscrubbed number anywhere dialable.
--
-- SOURCE REALITY (verified 2026-08-02 against the live portals):
--   • COLORADO  data.colorado.gov (Socrata) — 2.5M filings, refreshed daily,
--     secured-party names present. USABLE. Split across 3 tables joined on fileid
--     (Filing / Debtor / Secured-Party). Real MCA hits confirmed (Forward
--     Financing, Credibly, CFG Merchant, Fora, Bitty, Kalamata, Vox, Pearl…).
--   • OREGON    data.oregon.gov (Socrata) — "UCC List of Filings Entered Last
--     Month", ~5.7k rows, denormalized (party_type DB/SP + entity name). USABLE,
--     inherently fresh.
--   • VIRGINIA  odgavaprod.ogopendata.com (CKAN) — the ONLY two UCC datasets
--     (filing-details, lien-details) carry filing METADATA ONLY: IFS/file number,
--     dates, lien/filing type, status. NO debtor names, NO secured-party names.
--     UNUSABLE for MCA-position matching. Seeded as status='unusable' with the
--     reason recorded — not silently "active".
--   • CALIFORNIA bizfile master unload ($100, owner must purchase). Seeded as
--     status='awaiting_purchase'; the file loader is a documented TODO.

-- ── Enums ─────────────────────────────────────────────────────────────────────
do $$ begin
  create type public.ph_ucc_lead_status as enum
    ('matched','needs_skiptrace','needs_scrub','ready','loaded','suppressed');
exception when duplicate_object then null; end $$;

-- ── ph_ucc_sources — one row per state feed + its health/cadence ───────────────
create table if not exists public.ph_ucc_sources (
  id            uuid primary key default gen_random_uuid(),
  state         text not null,                    -- 2-letter USPS
  name          text not null,                    -- human label
  kind          text not null check (kind in ('api','file')),
  endpoint      text,                             -- base URL / dataset id / portal
  cadence       text not null default 'weekly'
                  check (cadence in ('daily','weekly','biweekly','monthly','manual')),
  status        text not null default 'active'
                  check (status in ('active','awaiting_purchase','unusable','paused','error','disabled')),
  last_pull_at  timestamptz,
  last_rows     integer,                          -- filings ingested on last pull
  last_cursor   text,                             -- resumable paging cursor (per-source meaning)
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (state, name)
);
comment on table public.ph_ucc_sources is
  'PH UCC feeds: one row per state open-data source with cadence + health. status=unusable means the portal lacks party names (VA); awaiting_purchase means the owner must buy the file (CA).';

-- ── ph_ucc_filings — normalized filing rows (one per filing×secured-party) ──────
create table if not exists public.ph_ucc_filings (
  id                uuid primary key default gen_random_uuid(),
  state             text not null,
  filing_no         text not null,                -- state filing/file number
  filed_date        date,
  lapse_date        date,
  status            text,                          -- Active / Lapsed / etc (as published)
  debtor_name       text,
  debtor_address    text,
  debtor_city       text,
  debtor_state      text,
  debtor_zip        text,
  secured_party_raw text,                          -- verbatim secured-party name (matcher input)
  raw               jsonb not null default '{}'::jsonb,  -- provenance: all parties, source cols
  source_id         uuid references public.ph_ucc_sources(id) on delete set null,
  ingested_at       timestamptz not null default now(),
  -- dedupe: a filing can carry several secured parties; each (state,filing,party)
  -- is one row. md5/lower/concat are immutable, so this generates cleanly.
  dedupe_hash       text generated always as
                      (md5(lower(state || '|' || filing_no || '|' || coalesce(secured_party_raw,'')))) stored,
  unique (dedupe_hash)
);
create index if not exists ph_ucc_filings_state_filed_idx on public.ph_ucc_filings (state, filed_date desc);
create index if not exists ph_ucc_filings_debtor_idx on public.ph_ucc_filings (state, lower(debtor_name));
create index if not exists ph_ucc_filings_sp_idx on public.ph_ucc_filings (lower(secured_party_raw));
comment on table public.ph_ucc_filings is
  'Normalized UCC filings, one row per (state, filing_no, secured_party). raw holds full provenance. Matcher reads secured_party_raw.';

-- ── ph_ucc_funder_aliases — the MCA-funder name dictionary ─────────────────────
create table if not exists public.ph_ucc_funder_aliases (
  id               uuid primary key default gen_random_uuid(),
  alias            text not null,                  -- name variant to look for
  canonical_funder text not null,                  -- display/rollup name
  lender_id        uuid references public.lenders(id) on delete set null,
  source           text not null default 'curated' check (source in ('lenders','curated')),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (alias)
);
comment on table public.ph_ucc_funder_aliases is
  'Secured-party name dictionary for MCA-position detection: our lenders (source=lenders) + a curated known-MCA-funder list (source=curated). Matcher does normalized contains against ph_ucc_filings.secured_party_raw.';

-- ── ph_ucc_leads — debtor rollup, ranked, gated ────────────────────────────────
create table if not exists public.ph_ucc_leads (
  id                 uuid primary key default gen_random_uuid(),
  state              text not null,
  debtor_name        text not null,
  debtor_address     text,
  debtor_city        text,
  debtor_state       text,
  debtor_zip         text,
  matched_funders    text[] not null default '{}',
  stack_depth        integer not null default 0,   -- distinct matched filings for this debtor
  latest_filing_date date,
  freshness_days     integer,                       -- as-of last rebuild (current_date - latest_filing_date)
  score              numeric not null default 0,    -- recency-weighted stack signal (see ph_ucc_rebuild_leads)
  phone              text,                          -- null until skip-trace stage (gated)
  email              text,                          -- null until skip-trace stage (gated)
  status             public.ph_ucc_lead_status not null default 'matched',
  status_reason      text,                          -- why it's parked at its current stage
  dedupe_key         text not null,                 -- lower(state)|normalized(debtor_name)
  ghl_contact_id     text,                          -- set only after a real gated load
  loaded_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (dedupe_key)
);
create index if not exists ph_ucc_leads_status_idx on public.ph_ucc_leads (status);
create index if not exists ph_ucc_leads_score_idx on public.ph_ucc_leads (score desc);
comment on table public.ph_ucc_leads is
  'Debtor-level MCA-position leads rolled up from ph_ucc_filings. phone/email stay null until the skip-trace gate is lit; nothing loads to GHL until ph_settings.ucc_load_enabled=true.';

-- keep updated_at honest (ph_touch_updated_at() already exists from ph_setter_scorecards)
drop trigger if exists ph_ucc_sources_touch on public.ph_ucc_sources;
create trigger ph_ucc_sources_touch before update on public.ph_ucc_sources
  for each row execute function public.ph_touch_updated_at();
drop trigger if exists ph_ucc_leads_touch on public.ph_ucc_leads;
create trigger ph_ucc_leads_touch before update on public.ph_ucc_leads
  for each row execute function public.ph_touch_updated_at();

-- ── RLS: admin/super_admin read; service-role (edge fns) bypasses & writes ──────
alter table public.ph_ucc_sources        enable row level security;
alter table public.ph_ucc_filings        enable row level security;
alter table public.ph_ucc_funder_aliases enable row level security;
alter table public.ph_ucc_leads          enable row level security;

do $$
declare t text;
begin
  foreach t in array array['ph_ucc_sources','ph_ucc_filings','ph_ucc_funder_aliases','ph_ucc_leads'] loop
    execute format('drop policy if exists %I_admin_read on public.%I', t, t);
    execute format(
      'create policy %I_admin_read on public.%I for select to authenticated using (is_admin_or_super(auth.uid()))',
      t, t);
  end loop;
end $$;

-- ── Normalization used by the matcher (mirror of _shared/uccFunders.ts norm) ────
-- Uppercase, drop the corporate-suffix noise words, strip everything non-alnum to
-- single spaces, trim. IMMUTABLE so it can index/join. KEEP IN SYNC with the TS.
create or replace function public.ph_ucc_norm(s text)
returns text language sql immutable as $$
  select trim(regexp_replace(
    regexp_replace(
      upper(coalesce(s,'')),
      '\y(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LP|LLP|LTD|THE|AS REPRESENTATIVE|AS COLLATERAL AGENT|AS AGENT|FUNDING|FUND|CAPITAL|FINANCIAL|FINANCE|GROUP|SERVICING)\y',
      ' ', 'g'),
    '[^A-Z0-9]+', ' ', 'g'))
$$;

-- ── Extend ph_settings with the UCC gate keys (non-destructive merge) ──────────
-- Only ADDS keys that are missing; never clobbers values a human has set. Defaults
-- are the safe/off position: no providers, loading DISABLED.
update public.platform_settings
set value = jsonb_build_object(
      'skiptrace_provider',  null,     -- e.g. 'batchskiptracing' | 'idi' (gate: needs PH_SKIPTRACE_API_KEY too)
      'tcpa_scrub_provider', null,     -- TCPA cell-scrub provider (gate: needs PH_TCPA_SCRUB too)
      'ucc_load_enabled',    false     -- MASTER SWITCH: nothing touches GHL/dialing until the owner flips true
    ) || value                         -- existing keys win (right side overrides on ||)
where key = 'ph_settings';

-- ── Seed the sources (idempotent) ──────────────────────────────────────────────
insert into public.ph_ucc_sources (state, name, kind, endpoint, cadence, status, notes) values
  ('CO','Colorado SOS — data.colorado.gov (Socrata)','api',
   'https://data.colorado.gov/resource', 'weekly','active',
   'Filing wffy-3uut / Debtor 8upq-58vz / SecuredParty ap62-sav4, joined on fileid. Targeted secured-party ingest by funder alias. Daily-refreshed source.'),
  ('OR','Oregon SOS — data.oregon.gov (Socrata)','api',
   'https://data.oregon.gov/resource/snfi-f79b.json', 'monthly','active',
   'UCC List of Filings Entered Last Month — denormalized, party_type DB/SP. Full ingest each run; inherently fresh.'),
  ('VA','Virginia SCC — odgavaprod.ogopendata.com (CKAN)','api',
   'https://odgavaprod.ogopendata.com', 'weekly','unusable',
   'UNUSABLE: filing-details + lien-details carry filing metadata only (IFS/file no, dates, lien/filing type, status). NO debtor or secured-party names -> cannot detect MCA positions. Verified 2026-08-02.'),
  ('CA','California SOS — bizfile master unload','file',
   'https://bpd.cdn.sos.ca.gov/ucc/ucc-fee-schedule.pdf', 'weekly','awaiting_purchase',
   'Owner must buy the $100 master data unload (weekly deltas free). Loader is a documented TODO in ph-ucc-ingest until the file exists.')
on conflict (state, name) do nothing;

-- ── Seed curated MCA-funder aliases (idempotent) ───────────────────────────────
-- Canonical -> variants. Includes our observed funders + the majors, plus the
-- entity-name variants states actually file under (On Deck Capital, Kapitus
-- Servicing, etc.) so hits aren't missed. norm() handles suffix noise, so aliases
-- are the distinctive core token(s).
insert into public.ph_ucc_funder_aliases (alias, canonical_funder, source) values
  ('Calabria Funding','Calabria Funding','curated'),
  ('Nav Kapital','Nav Kapital','curated'),
  ('FUNNDED','FUNNDED.COM','curated'),
  ('UNIFIE','UNIFIE Fund','curated'),
  ('Dedicated Financial','Dedicated Financial','curated'),
  ('Likety Cap','Likety Cap','curated'),
  ('Likety','Likety Cap','curated'),
  ('OnDeck','OnDeck','curated'),
  ('On Deck Capital','OnDeck','curated'),
  ('Forward Financing','Forward Financing','curated'),
  ('Rapid Finance','Rapid Finance','curated'),
  ('Rapid Financial','Rapid Finance','curated'),
  ('Kapitus','Kapitus','curated'),
  ('Strategic Funding','Kapitus','curated'),
  ('Fora Financial','Fora Financial','curated'),
  ('Everest Business Funding','Everest Business Funding','curated'),
  ('Libertas','Libertas','curated'),
  ('Mulligan Funding','Mulligan Funding','curated'),
  ('CFG Merchant Solutions','CFG Merchant Solutions','curated'),
  ('CFG Merchant','CFG Merchant Solutions','curated'),
  ('Itria Ventures','Itria Ventures','curated'),
  ('Cloudfund','Cloudfund','curated'),
  ('Vox Funding','Vox Funding','curated'),
  ('Pearl Capital','Pearl Capital','curated'),
  ('Pearl Beta','Pearl Capital','curated'),
  ('Pearl Delta','Pearl Capital','curated'),
  ('Fox Capital','Fox Capital','curated'),
  ('Torro','Torro','curated'),
  ('Kalamata Capital','Kalamata Capital','curated'),
  ('Kalamata','Kalamata Capital','curated'),
  ('Bitty Advance','Bitty Advance','curated'),
  ('Bitty','Bitty Advance','curated'),
  ('Greenbox Capital','Greenbox Capital','curated'),
  ('Credibly','Credibly','curated'),
  ('Retail Capital','Credibly','curated'),
  ('Expansion Capital','Expansion Capital','curated'),
  ('Lendini','Lendini','curated'),
  ('Funding Metrics','Lendini','curated'),
  ('Bizcap','Bizcap','curated'),
  ('LCF','LCF','curated')
on conflict (alias) do nothing;

-- ── Seed aliases from our own lenders table (source=lenders) ───────────────────
-- Use the verbatim company_name as the alias (norm() handles the rest). Only sane
-- lengths; skip names that would collapse to <3 normalized chars (too generic to
-- match safely). Never overwrite an existing alias row.
insert into public.ph_ucc_funder_aliases (alias, canonical_funder, lender_id, source)
select l.company_name, l.company_name, l.id, 'lenders'
from public.lenders l
where l.company_name is not null
  and length(public.ph_ucc_norm(l.company_name)) >= 3
on conflict (alias) do nothing;

-- ── The matcher: rebuild ph_ucc_leads from ph_ucc_filings ──────────────────────
-- Reads every filing whose secured_party_raw normalized-CONTAINS an active alias,
-- rolls up to the debtor, and writes a ranked, gated lead.
--
-- SCORE FORMULA (documented, reproducible):
--   freshness_days   = current_date - latest_filing_date
--   recency_weight   = greatest(0, (120 - freshness_days) / 120.0)   -- 1.0 today → 0 at ≥120d
--   score            = stack_depth * (1 + 2 * recency_weight)
--   → a 3-stack filed today scores 3*(1+2)=9; a lone 120-day-old position scores 1.
-- Stack depth (# of distinct MCA filings on the same debtor) is the core "they
-- keep stacking, they need capital / they're a churn risk to poach" signal;
-- recency multiplies it because a fresh filing is a dial-now window.
--
-- GATES: phone is always null here (no skip-trace yet) → every lead lands at
-- needs_skiptrace with the reason recorded. Human-advanced rows (loaded/
-- suppressed/ready) are never downgraded on rebuild, and any appended phone/email
-- is preserved.
create or replace function public.ph_ucc_rebuild_leads()
returns table (leads_upserted int, distinct_debtors int, matched_filings int)
language plpgsql security definer set search_path = public as $$
declare
  v_upserted int := 0;
  v_skiptrace_provider text;
begin
  select value->>'skiptrace_provider' into v_skiptrace_provider
  from public.platform_settings where key = 'ph_settings';

  with matched as (
    -- one row per (filing, matched canonical funder)
    select distinct
      f.id as filing_id, f.state, f.filing_no, f.filed_date,
      f.debtor_name, f.debtor_address, f.debtor_city, f.debtor_state, f.debtor_zip,
      a.canonical_funder
    from public.ph_ucc_filings f
    join public.ph_ucc_funder_aliases a
      on a.active
     and length(public.ph_ucc_norm(a.alias)) >= 3
     and position(public.ph_ucc_norm(a.alias) in public.ph_ucc_norm(f.secured_party_raw)) > 0
    where f.debtor_name is not null and length(trim(f.debtor_name)) > 1
  ),
  rolled as (
    select
      state,
      -- pick a representative display name (the longest seen spelling)
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
      -- never downgrade a human/gated advance; only (re)park un-advanced rows
      status = case when l.status in ('ready','loaded','suppressed') then l.status
                    else 'needs_skiptrace'::public.ph_ucc_lead_status end
    returning 1)
  select count(*) into v_upserted from up;

  leads_upserted := v_upserted;
  select count(distinct f.id) into matched_filings
  from public.ph_ucc_filings f
  join public.ph_ucc_funder_aliases a on a.active
   and length(public.ph_ucc_norm(a.alias)) >= 3
   and position(public.ph_ucc_norm(a.alias) in public.ph_ucc_norm(f.secured_party_raw)) > 0;
  select count(distinct dedupe_key) into distinct_debtors from public.ph_ucc_leads;
  return next;
end $$;

comment on function public.ph_ucc_rebuild_leads() is
  'Rebuild ph_ucc_leads from ph_ucc_filings: normalized-contains match vs ph_ucc_funder_aliases, roll up per debtor, score = stack_depth*(1+2*recency). All new leads land at needs_skiptrace (no provider yet); loaded/suppressed/ready are never downgraded.';
