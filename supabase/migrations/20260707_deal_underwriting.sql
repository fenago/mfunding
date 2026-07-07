-- AI INTERNAL UNDERWRITER (Phase 1) — schema
-- Two tables:
--   underwriting_settings  — singleton, admin-tunable model knobs (thresholds,
--                            which padding categories count, model ids).
--   deal_underwriting      — one versioned row per underwrite run of a deal, with
--                            the extracted per-statement data, aggregated metrics,
--                            flags, ratings, the AI narrative, and a snapshot of the
--                            settings used (for reproducibility).
--
-- The underwriter reads a deal's bank statements (customer_documents), asks Claude
-- to extract per-statement figures, aggregates them deterministically into an
-- affordability read, then asks Claude for a short risk narrative. It NEVER moves
-- money and NEVER calls an MCA a loan.

-- ============================================================================
-- underwriting_settings — singleton model knobs
-- ============================================================================
create table if not exists public.underwriting_settings (
  id uuid primary key default gen_random_uuid(),
  -- Which transfer/padding deposit types count as "padding" (removed from true
  -- revenue). Admin can toggle any of these off.
  padding_categories jsonb not null default '{
    "zelle": true,
    "venmo": true,
    "cashapp": true,
    "paypal_personal": true,
    "internal_transfer": true,
    "owner_deposit": true,
    "reversal": true,
    "round_number": true,
    "same_day_in_out": true
  }'::jsonb,
  revenue_quality_flag_pct numeric not null default 85,   -- flag when true/reported < this %
  holdback_ceiling_pct numeric not null default 15,        -- safe % of true daily revenue for a new debit
  nsf_monthly_cap int not null default 5,
  negative_days_flag int not null default 3,
  debt_service_flag_pct numeric not null default 20,       -- flag when existing MCA debits > this % of true revenue
  min_avg_daily_balance numeric,
  extraction_model text not null default 'claude-sonnet-4-6',
  judge_model text not null default 'claude-opus-4-8',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

-- Seed exactly one row (idempotent — only if the table is empty).
insert into public.underwriting_settings (id)
select gen_random_uuid()
where not exists (select 1 from public.underwriting_settings);

alter table public.underwriting_settings enable row level security;

-- Admins (admin + super_admin) may read the settings; only super_admin may change.
drop policy if exists uw_settings_select on public.underwriting_settings;
create policy uw_settings_select on public.underwriting_settings
  for select to authenticated
  using (public.is_admin_or_super((select auth.uid())));

drop policy if exists uw_settings_update on public.underwriting_settings;
create policy uw_settings_update on public.underwriting_settings
  for update to authenticated
  using (public.is_super_admin((select auth.uid())))
  with check (public.is_super_admin((select auth.uid())));

-- ============================================================================
-- deal_underwriting — versioned run results
-- ============================================================================
create table if not exists public.deal_underwriting (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  version int not null,                       -- max(version)+1 per deal
  run_mode text not null default 'manual',    -- 'manual' | 'auto'
  docs_hash text,                             -- hash of the analyzed doc set (dedup for auto runs)
  per_statement jsonb,                        -- array: one object per bank statement
  metrics jsonb,                              -- aggregated affordability metrics (see edge fn)
  flags jsonb,                                -- array of {code, severity, message}
  risk_rating text,                           -- 'low' | 'medium' | 'high'
  affordability_rating text,                  -- 'strong' | 'adequate' | 'tight' | 'unaffordable'
  ai_narrative text,
  settings_snapshot jsonb,                    -- the settings row used, for reproducibility
  extraction_model text,
  judge_model text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists deal_underwriting_deal_version_idx
  on public.deal_underwriting (deal_id, version desc);

alter table public.deal_underwriting enable row level security;

-- Admins read every run; closers read runs for deals assigned to them.
drop policy if exists deal_uw_select on public.deal_underwriting;
create policy deal_uw_select on public.deal_underwriting
  for select to authenticated
  using (
    public.is_admin_or_super((select auth.uid()))
    or public.closer_owns_deal((select auth.uid()), deal_id)
  );

-- Writes are service-role only (the edge function runs the analysis and inserts
-- rows with the service key, which bypasses RLS). No client insert/update/delete
-- policy is defined, so authenticated users cannot fabricate underwriting rows.
