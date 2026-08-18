-- wavv_calls — local mirror of the WAVV dialer's call log.
--
-- WHY A MIRROR AT ALL. Setters now dial with WAVV embedded in VibeReach (GHL);
-- HotProspector is retired. WAVV's Public API v3 is the only place per-call
-- activity exists, and it is keyset-paginated newest-first — useless for the
-- ad-hoc range/group-by queries a management scorecard needs. So a 10-minute
-- cron mirrors calls in here and /admin/setter-performance queries THIS table.
-- WAVV's API is NOT on the GHL quota, so this costs no GHL budget.
--
-- RAW IS THE SOURCE OF TRUTH. Every call's full JSON body is kept in `raw`.
-- The typed columns are a projection of it. This matters for one specific
-- reason: WAVV's published docs never named the per-agent field on a call
-- object (it may be userId / user / member / agent), and we could not probe a
-- live call because the API key in the vault is currently invalid. agent_key /
-- agent_name are therefore BEST-GUESS extractions that start out NULL. Once a
-- real call lands and the field is confirmed, `wavv-sync` action:'reparse'
-- re-derives every column from `raw` with zero API spend — no re-pull, no data
-- loss. NULL agent_key means "not attributed yet", never "no rep".

create table if not exists public.wavv_calls (
  id            uuid primary key default gen_random_uuid(),
  wavv_call_id  text        not null unique,
  direction     text,
  phone         text,
  caller_id     text,
  started_at    timestamptz,
  answered_at   timestamptz,
  ended_at      timestamptz,
  seconds       int,
  outcome       text,
  disposition   text,
  human         boolean,
  recorded      boolean,
  summary       text,
  agent_key     text,
  agent_name    text,
  raw           jsonb       not null,
  created_at    timestamptz not null default now()
);

comment on table public.wavv_calls is
  'Mirror of WAVV Public API v3 calls, pulled every 10 min by the wavv-sync edge function. Read by /admin/setter-performance. raw holds the untouched call JSON; typed columns are a re-derivable projection (see wavv-sync action:reparse).';
comment on column public.wavv_calls.agent_key is
  'Best-guess per-agent identifier extracted from raw (WAVV docs never named the field). NULL = not attributed yet, NOT "no rep". Backfilled by wavv-sync action:reparse once the real field name is observed on live data.';
comment on column public.wavv_calls.seconds is
  'Talk time in seconds as reported by WAVV. A "conversation" in the scorecard is seconds > 60.';
comment on column public.wavv_calls.answered_at is
  'Non-null = the call connected. This is the scorecard connect definition; re-verify against live data once a valid WAVV key lands.';

-- The scorecard always filters a date range and groups by rep, so both the
-- range scan and the grouping are indexed. started_at desc matches the newest-
-- first ordering the call log renders in.
create index if not exists wavv_calls_started_at_desc_idx on public.wavv_calls (started_at desc);
create index if not exists wavv_calls_agent_key_idx       on public.wavv_calls (agent_key);
-- The incremental sync upserts on wavv_call_id; the unique constraint above
-- already indexes it. Disposition/outcome breakdowns are computed in-page from
-- the range slice, so they need no index of their own.

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Managers only. Closers must NOT read each other's dial stats (owner rule), so
-- unlike the ph_ucc tables this grants NOTHING to the closer role. Writes are
-- service-role only: no policy grants insert/update/delete to `authenticated`,
-- and service_role bypasses RLS, so the edge function is the only writer.
-- auth.uid() is wrapped in a scalar subselect per the RLS initplan convention
-- (20260813_rls_initplan_wrap.sql) so the check is evaluated once, not per row.
alter table public.wavv_calls enable row level security;

drop policy if exists wavv_calls_admin_read on public.wavv_calls;
create policy wavv_calls_admin_read on public.wavv_calls
  for select to authenticated
  using ((select is_admin_or_super((select auth.uid()))));

-- ── Vault-read RPC for the WAVV token (mirror of get_ph_apollo_key) ──────────
-- The edge function never holds the key in an env var; it reads it at request
-- time, so replacing the vault secret takes effect on the very next run with no
-- redeploy. service_role only — never granted to authenticated.
create or replace function public.get_wavv_api_key()
returns text
language sql
security definer
set search_path to 'public', 'vault'
as $fn$
  select decrypted_secret from vault.decrypted_secrets where name = 'WAVV_API_KEY' limit 1;
$fn$;
revoke all on function public.get_wavv_api_key() from public, anon, authenticated;
grant execute on function public.get_wavv_api_key() to service_role;

create or replace function public.get_wavv_team_id()
returns text
language sql
security definer
set search_path to 'public', 'vault'
as $fn$
  select decrypted_secret from vault.decrypted_secrets where name = 'WAVV_TEAM_ID' limit 1;
$fn$;
revoke all on function public.get_wavv_team_id() from public, anon, authenticated;
grant execute on function public.get_wavv_team_id() to service_role;

-- ── Sync state ───────────────────────────────────────────────────────────────
-- platform_settings key 'wavv_sync' (matching the ghl_opp_backfill pattern)
-- rather than a bespoke table. Seeded with a null watermark so the first sync
-- knows it has never run; key_invalid starts FALSE and is set to true only by an
-- observed 401 — it is a report of reality, never a guess.
insert into public.platform_settings (key, value, updated_at)
values (
  'wavv_sync',
  jsonb_build_object(
    'watermark',          null,
    'last_sync_at',       null,
    'last_status',        'never_run',
    'last_error',         null,
    'key_invalid',        false,
    'rows_upserted_last', 0,
    'truncated',          false
  ),
  now()
)
on conflict (key) do nothing;
