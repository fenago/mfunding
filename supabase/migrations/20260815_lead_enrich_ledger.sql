-- Ledger for lead-enrich-ghl. Its OWN table, not lead_push_jobs: the push
-- watchdog (cron 39) reinvokes lead-push-ghl for any 'running' row there, and
-- pointing it at an enrichment job would call the wrong function entirely.
create table if not exists public.lead_enrich_jobs (
  id          uuid primary key default gen_random_uuid(),
  status      text not null default 'running',   -- running|complete|paused|canceled|error
  updated     integer not null default 0,
  errored     integer not null default 0,
  message     text,
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.lead_enrich_jobs enable row level security;
drop policy if exists lead_enrich_jobs_staff_read on public.lead_enrich_jobs;
create policy lead_enrich_jobs_staff_read on public.lead_enrich_jobs
  for select to authenticated
  using ((select public.is_admin_or_super(auth.uid())));

-- Which contacts already carry the enrichment. Self-draining selector, so a
-- resumed run never redoes work.
alter table public.lead_records add column if not exists enriched_at timestamptz;
comment on column public.lead_records.enriched_at is
  'When this lead''s GHL contact last received the consolidated enrichment PUT '
  '(names, owner title, employees, revenue/bucket, industry_doc, SIC, website, '
  'entity, playbook link). NULL = still owed one.';

create index if not exists lead_records_enrich_pending_idx
  on public.lead_records (id)
  where enriched_at is null and status = 'pushed' and ghl_contact_id is not null;
