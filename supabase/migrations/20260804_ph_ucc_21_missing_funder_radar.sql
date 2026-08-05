-- ph_ucc_21: "MCA funders we're missing" radar.
-- =============================================================================
-- WHAT: a standing snapshot of the highest-frequency secured-party names in each
-- state's RAW UCC data that our funder dictionary (ph_ucc_funder_aliases) does
-- NOT already match and that are NOT depository/banks — i.e. probable MCA funders
-- we're overlooking. Replaces the manual audit that surfaced +2,652 leads.
--
-- EGRESS LAW: we store ONLY a lightweight name+count snapshot (a few thousand
-- rows max), NEVER the millions of raw filings. Population aggregates SERVER-SIDE
-- (Socrata $group for CT/CO/OR; DuckDB local aggregation for the CA/FL file
-- loaders) and pushes only the small survivor set.
--
-- PRECISION LAW: this table never auto-adds anything. Promotion (adding an alias)
-- is a per-row human decision via ph_ucc_promote_unmatched; the add UI defaults
-- risky/generic names to EXACT mode. The depository guard stays in the match path
-- so a promoted alias still can't match a bank.
-- =============================================================================

-- ── 1. Allow the 'radar' alias source ─────────────────────────────────────────
-- Promoted candidates land as source='radar' so they're distinguishable from the
-- curated / lenders / debanked dictionary entries.
alter table public.ph_ucc_funder_aliases
  drop constraint if exists ph_ucc_funder_aliases_source_check;
alter table public.ph_ucc_funder_aliases
  add constraint ph_ucc_funder_aliases_source_check
  check (source = any (array['lenders','curated','debanked','radar']));

-- ── 2. The snapshot table ─────────────────────────────────────────────────────
create table if not exists public.ph_ucc_unmatched_parties (
  id                uuid primary key default gen_random_uuid(),
  state             text,
  secured_party_raw text not null,               -- representative raw name (highest-count spelling)
  sp_norm           text not null,               -- public.ph_ucc_norm(secured_party_raw)
  filing_count      int not null default 0,      -- how often it appears in the raw data (frequency signal)
  first_seen        timestamptz not null default now(),
  last_refreshed    timestamptz not null default now(),
  status            text not null default 'new'
                      check (status in ('new','added','dismissed')),
  note              text,
  unique (state, sp_norm)
);
create index if not exists ph_ucc_unmatched_parties_status_count_idx
  on public.ph_ucc_unmatched_parties (status, filing_count desc);
comment on table public.ph_ucc_unmatched_parties is
  'Radar: high-frequency non-depository secured-party names our funder dictionary does NOT match — probable MCA funders we are overlooking. Name+count snapshot only (never raw filings). Populated weekly by ph-ucc-scan-unmatched (CT/CO/OR) and the CA/FL file loaders; promoted/dismissed per row by a super_admin.';

-- ── 3. RLS — super_admin only (this is a super_admin surface) ──────────────────
alter table public.ph_ucc_unmatched_parties enable row level security;
drop policy if exists ph_ucc_unmatched_parties_super_read  on public.ph_ucc_unmatched_parties;
drop policy if exists ph_ucc_unmatched_parties_super_write on public.ph_ucc_unmatched_parties;
create policy ph_ucc_unmatched_parties_super_read on public.ph_ucc_unmatched_parties
  for select to authenticated using (is_super_admin(auth.uid()));
create policy ph_ucc_unmatched_parties_super_write on public.ph_ucc_unmatched_parties
  for all to authenticated
  using (is_super_admin(auth.uid())) with check (is_super_admin(auth.uid()));

-- keep last_refreshed/updated behavior simple (no updated_at column here; the
-- population path sets last_refreshed explicitly).

-- ── 4. Population helper (SECURITY DEFINER; service-role only) ──────────────────
-- ONE authoritative implementation shared by the edge fn (CT/CO/OR) and the
-- CA/FL python loaders. Takes an aggregated [{name,cnt}, …] set for a state and:
--   • drops names below the min-count floor,
--   • drops depository/bank names (ph_ucc_is_depository on the norm),
--   • drops names our dictionary ALREADY matches (ph_ucc_match_secured_parties —
--     the exact same predicate the matcher/ingest use, so "unmatched" can't drift),
--   • collapses duplicates that share a normalized form (keeps the highest count),
--   • UPSERTs survivors on (state, sp_norm): refresh count + last_refreshed only.
-- CRITICAL: the upsert NEVER touches status, so 'added'/'dismissed' rows are never
-- clobbered back to 'new'. New rows default to 'new'.
create or replace function public.ph_ucc_upsert_unmatched(
  p_state text, p_rows jsonb, p_min_count int default 5)
returns int
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_n int := 0;
begin
  with cand as (
    select nullif(trim(x.name), '') as name,
           coalesce(x.cnt, 0)       as cnt,
           public.ph_ucc_norm(x.name) as n
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(name text, cnt int)
  ),
  filtered as (
    select name, cnt, n
    from cand
    where name is not null
      and cnt >= p_min_count
      and length(n) >= 3
      and not public.ph_ucc_is_depository(n)
  ),
  matched as (
    select m.party
    from public.ph_ucc_match_secured_parties(
      (select coalesce(array_agg(name), '{}'::text[]) from filtered)) as m(party)
  ),
  keep as (
    -- collapse names that normalize to the same sp_norm; keep the busiest spelling
    select distinct on (f.n) f.name, f.n, f.cnt
    from filtered f
    where f.name not in (select party from matched)
    order by f.n, f.cnt desc
  ),
  ins as (
    insert into public.ph_ucc_unmatched_parties as u
      (state, secured_party_raw, sp_norm, filing_count, last_refreshed)
    select p_state, k.name, k.n, k.cnt, now() from keep k
    on conflict (state, sp_norm) do update set
      filing_count      = excluded.filing_count,
      last_refreshed    = now(),
      secured_party_raw = excluded.secured_party_raw
      -- status intentionally NOT updated: never resurrect added/dismissed to new
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end
$function$;
grant execute on function public.ph_ucc_upsert_unmatched(text, jsonb, int) to service_role;

-- ── 5. Promote a candidate to a funder alias (SECURITY DEFINER; super_admin) ───
-- Adds the candidate's representative raw name as an active alias (source='radar')
-- mapped to p_canonical, marks the candidate 'added', and returns the alias id.
-- Caller re-runs the rebuild (+ re-ingests that state to FETCH the funder's
-- filings) afterwards — an alias only matches filings we already hold.
create or replace function public.ph_ucc_promote_unmatched(
  p_id uuid, p_canonical text, p_match_mode text default 'token')
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_cand   record;
  v_alias  text;
  v_canon  text;
  v_alias_id uuid;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'forbidden: super_admin only';
  end if;
  if p_match_mode not in ('token','exact') then
    raise exception 'invalid match_mode: % (expected token|exact)', p_match_mode;
  end if;

  select * into v_cand from public.ph_ucc_unmatched_parties where id = p_id;
  if not found then
    raise exception 'radar candidate % not found', p_id;
  end if;

  v_alias := v_cand.secured_party_raw;                              -- match the raw filed name
  v_canon := coalesce(nullif(trim(p_canonical), ''), v_cand.secured_party_raw);

  insert into public.ph_ucc_funder_aliases (alias, canonical_name, source, active, match_mode)
  values (v_alias, v_canon, 'radar', true, p_match_mode)
  on conflict (alias) do update set
    canonical_name = excluded.canonical_name,
    source         = 'radar',
    active         = true,
    match_mode     = excluded.match_mode
  returning id into v_alias_id;

  update public.ph_ucc_unmatched_parties
     set status = 'added',
         note   = 'promoted ' || to_char(now(),'YYYY-MM-DD') || ' → ' || v_canon || ' (' || p_match_mode || ')'
   where id = p_id;

  return v_alias_id;
end
$function$;
grant execute on function public.ph_ucc_promote_unmatched(uuid, text, text) to authenticated;

-- ── 6. Dismiss a candidate (SECURITY DEFINER; super_admin) ─────────────────────
create or replace function public.ph_ucc_dismiss_unmatched(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'forbidden: super_admin only';
  end if;
  update public.ph_ucc_unmatched_parties set status = 'dismissed' where id = p_id;
  if not found then
    raise exception 'radar candidate % not found', p_id;
  end if;
end
$function$;
grant execute on function public.ph_ucc_dismiss_unmatched(uuid) to authenticated;

-- ── 7. Weekly scan cron (CT/CO/OR) — standard secret + anon-bearer path ────────
-- Sunday 10:00 UTC, after the CO weekly ingest (08:00) so the dictionary/filings
-- are current. The scan hits Socrata's $group aggregate (zero DB egress) and
-- upserts only the small survivor set.
select cron.unschedule('ph-ucc-scan-unmatched-weekly')
where exists (select 1 from cron.job where jobname = 'ph-ucc-scan-unmatched-weekly');
select cron.schedule(
  'ph-ucc-scan-unmatched-weekly',
  '0 10 * * 0',
  $cron$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/ph-ucc-scan-unmatched?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := jsonb_build_object('state', 'ALL'),
    timeout_milliseconds := 120000
  );
  $cron$
);
