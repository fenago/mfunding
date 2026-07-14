-- ═══════════════════════════════════════════════════════════════════════════
-- BUSINESS ENRICHMENT (ENR1) — one-button Firecrawl research on a lead's business.
-- Per research/PLAN_business_enrichment.md §3.
--
-- One row per RUN of the enrich-business edge function. Cache lookups go through
-- business_key (normalized business name + '|' + state) + recency, so a renewal
-- deal on the same merchant is a free cache hit.
--
-- TRUTH DISCIPLINE: every found_* field is UNVERIFIED web data. Nothing here ever
-- auto-writes to customers/deals — LOAD happens only through explicit per-field
-- "Use" clicks in the UI (EnrichmentCard), and the host component owns the write.
--
-- ⚠️ INJECTION SAFETY (P1 note for future wiring): `raw`, `candidates`, and the
-- found_* fields contain text scraped from arbitrary web pages. NOTHING in P1
-- feeds this to an LLM. If P2 wires it into deal-assistant / underwrite-deal /
-- an ANALYZE pass, the content MUST be fenced as untrusted DATA per plan §7 —
-- never interpolated into a prompt as instructions.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.business_enrichment (
  id                uuid primary key default gen_random_uuid(),
  -- linkage
  customer_id       uuid references public.customers(id),
  deal_id           uuid references public.deals(id),          -- deal the button was pressed on
  business_key      text not null,                             -- normalize(business_name)|state → cache key
  requested_by      uuid references public.profiles(id),
  -- lifecycle
  status            text not null default 'searching'
                    check (status in ('searching','crawling','analyzing','completed','failed')),
  error             text,
  seed_url          text,                                      -- closer-supplied override URL, if any
  -- SEARCH output
  candidates        jsonb,        -- [{url,title,snippet,score,reasons[]}]
  chosen_url        text,
  -- match confidence (plan §4) — deterministic TS score, NEVER produced by an LLM
  match_score       int,          -- 0–100
  match_verdict     text check (match_verdict in ('confident','possible','no_match')),
  mismatch_reasons  text[],       -- e.g. {'state differs: CA vs lead TX'}
  -- LOAD fields (all nullable; ALL UNVERIFIED — "found online, confirm with merchant")
  found_street      text,
  found_city        text,
  found_state       text,
  found_zip         text,
  found_phone       text,
  found_website     text,
  found_entity_hint text,         -- 'LLC' | 'Corp' | 'PC' | … (from name/footer/registries)
  found_ein         text,         -- only if publicly posted (rare; nonprofits, some registries)
  found_year_started int,
  -- CONFIRM + ANALYZE output
  confirmations     jsonb,        -- [{claim, lead_value, web_value, verdict:'match|differ|not_found'}]
  analysis          jsonb,        -- P2: {summary_bullets[], customer_type, red_flags[], …} — NULL in P1
  -- cost & audit
  credits_estimate  numeric,      -- best estimate of Firecrawl credits burned by this run
  raw               jsonb,        -- trimmed Firecrawl payloads (search + agent), for debugging
  created_at        timestamptz not null default now(),
  completed_at      timestamptz
);

create index if not exists business_enrichment_key_recency_idx
  on public.business_enrichment (business_key, created_at desc);
create index if not exists business_enrichment_deal_idx
  on public.business_enrichment (deal_id);
create index if not exists business_enrichment_created_idx
  on public.business_enrichment (created_at);  -- daily-cap count

-- ── RLS: staff read; writes by SERVICE ROLE ONLY (no authenticated write path) ──
alter table public.business_enrichment enable row level security;

drop policy if exists "Admins read enrichment" on public.business_enrichment;
create policy "Admins read enrichment" on public.business_enrichment
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role in ('admin','super_admin')
    )
  );

drop policy if exists "Closers read enrichment on own deals" on public.business_enrichment;
create policy "Closers read enrichment on own deals" on public.business_enrichment
  for select to authenticated
  using (
    is_closer((select auth.uid()))
    and deal_id is not null
    and closer_owns_deal((select auth.uid()), deal_id)
  );

-- No INSERT/UPDATE/DELETE policies on purpose: only the enrich-business edge
-- function (service role, bypasses RLS) may write rows.

-- ── Cost knobs (tunable without a deploy) ──
insert into public.platform_settings (key, value)
values ('enrichment', '{"daily_cap": 25, "cache_ttl_days": 30}'::jsonb)
on conflict (key) do nothing;
