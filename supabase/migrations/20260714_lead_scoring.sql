-- Lead scoring v1 (research/PLAN_lead_scoring.md).
--
-- Two storage jobs, deliberately split:
--   1. CURRENT score → columns on deals. The hot read path (My Day polls every
--      15s, the deals list) reads them join-free.
--   2. HISTORY → lead_score_events, APPEND-ONLY. Every recompute snapshots ALL
--      inputs + factor points; this is the v2 calibration dataset. v1 weights are
--      judgment (0 funded deals exist — no ground truth), so the event log is what
--      lets a v2 be FITTED on outcomes instead of guessed again.
--
-- score_version stamps every score so old and new formulas are never mixed in
-- analysis when weights change.

alter table public.deals
  add column if not exists lead_grade text,
  add column if not exists lead_score numeric,
  add column if not exists expected_value numeric,
  add column if not exists score_reasons jsonb,
  add column if not exists score_version integer,
  add column if not exists scored_at timestamptz;

do $$ begin
  alter table public.deals
    add constraint deals_lead_grade_check check (lead_grade in ('A','B','C','D'));
exception when duplicate_object then null; end $$;

comment on column public.deals.lead_grade is
  'v1 rules-based close-likelihood grade (A/B/C/D). JUDGMENT weights — 0 funded deals at v1; see research/PLAN_lead_scoring.md. Label as estimate everywhere it renders.';
comment on column public.deals.expected_value is
  'Estimated $ = P(close) x expected gross commission on the fundable amount (sized off revenue, never the ask). The true "best first" sort order.';
comment on column public.deals.score_reasons is
  'Factor array [{factor, points, max, note}] — the notes ARE the explanation the UI shows. Never a black box.';

-- ── Append-only score history (the v2 training set) ──────────────────────────
create table if not exists public.lead_score_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  version integer not null,
  trigger text not null,          -- intake|qual_update|underwriting|funder_response|email_health|sweep|manual|backfill
  inputs jsonb not null,          -- full snapshot: stated + underwritten numbers, likely-funder count, every factor's points
  score numeric not null,
  grade text not null check (grade in ('A','B','C','D')),
  expected_value numeric,
  created_at timestamptz not null default now()
);

create index if not exists idx_lead_score_events_deal
  on public.lead_score_events (deal_id, created_at desc);

alter table public.lead_score_events enable row level security;

-- RLS mirrors deals EXACTLY by delegating to it: the subquery runs under the
-- caller's own deals policies (ops staff see all; closers see owned + unassigned),
-- so this can never drift from deals' visibility rules.
drop policy if exists "read score events for visible deals" on public.lead_score_events;
create policy "read score events for visible deals"
  on public.lead_score_events for select to authenticated
  using (deal_id in (select id from public.deals));

-- APPEND-ONLY: no insert/update/delete policies for authenticated users.
-- Writes come exclusively from the score-lead edge function (service role,
-- bypasses RLS). History is never edited.
