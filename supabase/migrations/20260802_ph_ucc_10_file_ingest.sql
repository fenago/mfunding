-- PH UCC — bulk-FILE ingest infrastructure (the repeatable, UI-driven feature).
--
-- WHAT THIS ADDS: the permanent home for file-based UCC states (CA master unload,
-- FL full download, any future file state) so the NEXT load needs no agent:
--   • ph-ucc-uploads    — private storage bucket for the owner's uploaded CSV(s)
--   • ph_ucc_ingest_jobs    — one row per upload/auto-fetch run, with live progress
--   • ph_ucc_ingest_matches — per-job staging: ONLY the funder-matched filings
--     (bounds memory at GB scale — see ph-ucc-file-ingest for the streaming design)
--   • ph_ucc_sources.fetch_mode — how a source is fed (api_cron / file_upload /
--     file_autofetch) so the dashboard can render the right control per state
--   • the FL source row
--
-- NAMING LAW: everything is ph_ucc_ / ph-ucc-. No skiptrace, no dialing here —
-- this is INGEST ONLY. The freshness/termination filter + funder-alias match are
-- the SAME ones CO/OR use (ph_ucc_norm + ph_ucc_rebuild_leads); file states feed
-- the identical ph_ucc_filings spine.

-- ── 1. fetch_mode on sources — how the feed is driven (honest per-state) ────────
--   api_cron       : pulled from an open-data API on a cron (CO, OR) — "Pull now"
--   file_upload    : owner uploads a purchased/downloaded file (CA) — "Upload file"
--   file_autofetch : a free file auto-downloaded on a cron (FL, if URL is open) —
--                    shows "auto-fetch <cadence>" + a manual-upload fallback
alter table public.ph_ucc_sources
  add column if not exists fetch_mode text
    check (fetch_mode in ('api_cron','file_upload','file_autofetch'));

update public.ph_ucc_sources set fetch_mode = 'api_cron'    where state in ('CO','OR') and fetch_mode is null;
update public.ph_ucc_sources set fetch_mode = 'file_upload' where state = 'CA' and fetch_mode is null;
-- VA is unusable; leave fetch_mode null (no control rendered).

comment on column public.ph_ucc_sources.fetch_mode is
  'How this feed is driven: api_cron (open-data API on a cron), file_upload (owner uploads a file), file_autofetch (free file auto-downloaded on a cron). Drives which control the dashboard card shows.';

-- ── 2. FL source — free full download, refreshed every business day ─────────────
-- Whether it auto-fetches or stays manual depends on floridaucc.com exposing a
-- stable no-auth download URL; ph-ucc-file-ingest sets fetch_mode accordingly and
-- (if open) a cron is wired. Seed as file_upload; the fetch wiring can promote it.
insert into public.ph_ucc_sources (state, name, kind, endpoint, cadence, status, fetch_mode, notes) values
  ('FL','Florida SOS — floridaucc.com bulk download','file',
   'https://www.floridaucc.com/', 'daily','active','file_upload',
   'Free full UCC download (events / debtors / secureds / filings), regenerated every business day. Loaded via UI upload; promoted to file_autofetch once a stable no-auth daily URL is confirmed.')
on conflict (state, name) do nothing;

-- ── 3. Storage bucket for uploaded bulk files (private, admin-only) ─────────────
-- 2GB file-size limit so a large unzipped CA/FL CSV (100s of MB each) can be
-- uploaded directly; the ingest streams it, so this is just the upload ceiling.
insert into storage.buckets (id, name, public, file_size_limit)
values ('ph-ucc-uploads','ph-ucc-uploads', false, 2147483648)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- Admin/super_admin manage the bucket from the dashboard (upload + housekeeping).
-- Service-role edge functions bypass RLS entirely (that's how ph-ucc-file-ingest
-- streams the objects back out). Object path convention: <STATE>/<jobId>/<file>.
do $$
declare p text;
begin
  foreach p in array array[
    'ph_ucc_uploads_admin_select',
    'ph_ucc_uploads_admin_insert',
    'ph_ucc_uploads_admin_update',
    'ph_ucc_uploads_admin_delete'
  ] loop
    execute format('drop policy if exists %I on storage.objects', p);
  end loop;
end $$;
create policy ph_ucc_uploads_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'ph-ucc-uploads' and public.is_admin_or_super(auth.uid()));
create policy ph_ucc_uploads_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ph-ucc-uploads' and public.is_admin_or_super(auth.uid()));
create policy ph_ucc_uploads_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'ph-ucc-uploads' and public.is_admin_or_super(auth.uid()));
create policy ph_ucc_uploads_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'ph-ucc-uploads' and public.is_admin_or_super(auth.uid()));

-- ── 4. ph_ucc_ingest_jobs — one row per file-ingest run, with live progress ─────
create table if not exists public.ph_ucc_ingest_jobs (
  id             uuid primary key default gen_random_uuid(),
  state          text not null,                         -- 2-letter USPS
  source_id      uuid references public.ph_ucc_sources(id) on delete set null,
  origin         text not null default 'upload'
                   check (origin in ('upload','auto_fetch')),
  status         text not null default 'queued'
                   check (status in ('queued','processing','complete','error','canceled')),
  -- the uploaded object paths in ph-ucc-uploads, in the role order the profile
  -- expects (e.g. CA: [securedParties, filings, debtors]).
  storage_paths  text[] not null default '{}',
  -- streaming progress (resumable): which pass, and the byte offset reached.
  phase          text,                                  -- match_secured | enrich_filings | enrich_debtors | finalize
  phase_index    integer not null default 0,            -- index into the pass plan
  byte_offset    bigint  not null default 0,            -- resume position within the current pass's file
  bytes_total    bigint,                                -- size of the current pass's file (for a %)
  -- running tallies (survive the self-reinvoke chain)
  rows_scanned   bigint  not null default 0,
  sp_matched     integer not null default 0,            -- distinct matched (filing × party) staged
  filings_upserted integer not null default 0,
  leads_upserted integer not null default 0,
  -- idempotency: a fingerprint of the upload set (state|sorted paths|sizes). A
  -- re-run of the identical set is a no-op beyond the natural dedupe_hash upsert.
  fingerprint    text,
  error          text,
  message        text,                                  -- last human status line
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz
);
create index if not exists ph_ucc_ingest_jobs_state_idx on public.ph_ucc_ingest_jobs (state, created_at desc);
create index if not exists ph_ucc_ingest_jobs_status_idx on public.ph_ucc_ingest_jobs (status);
comment on table public.ph_ucc_ingest_jobs is
  'One row per bulk-FILE ingest run (UI upload or FL auto-fetch). Tracks the resumable multi-pass streaming progress (phase/byte_offset) so a run that hits the edge-fn wall clock resumes exactly where it stopped on self-reinvoke.';

-- ── 5. ph_ucc_ingest_matches — per-job staging of ONLY the funder-matched rows ──
-- This is the memory-bounding trick: at GB scale we NEVER hold the full file. Pass
-- 1 streams the secured-party file and stages ONLY rows whose normalized party
-- token-matches an active funder alias (a tiny fraction). Passes 2/3 enrich those
-- staged rows in place; finalize emits them into ph_ucc_filings with the freshness
-- + termination filter, then clears the staging for the job.
create table if not exists public.ph_ucc_ingest_matches (
  job_id            uuid not null references public.ph_ucc_ingest_jobs(id) on delete cascade,
  state             text not null,
  filing_no         text not null,
  secured_party_raw text not null,
  filed_date        date,
  lapse_date        date,
  status            text,
  debtor_name       text,
  debtor_address    text,
  debtor_city       text,
  debtor_state      text,
  debtor_zip        text,
  raw               jsonb not null default '{}'::jsonb,
  primary key (job_id, filing_no, secured_party_raw)
);
create index if not exists ph_ucc_ingest_matches_job_filing_idx
  on public.ph_ucc_ingest_matches (job_id, filing_no);
comment on table public.ph_ucc_ingest_matches is
  'Per-job staging holding ONLY funder-alias-matched (filing × secured party) rows during a file ingest. Enriched with dates/debtor across streaming passes, then flushed into ph_ucc_filings on finalize and cleared. Bounds edge-fn memory at GB file scale.';

-- ── 6. RLS: admin/super_admin read; service-role (edge fn) bypasses & writes ─────
alter table public.ph_ucc_ingest_jobs    enable row level security;
alter table public.ph_ucc_ingest_matches enable row level security;
do $$
declare t text;
begin
  foreach t in array array['ph_ucc_ingest_jobs','ph_ucc_ingest_matches'] loop
    execute format('drop policy if exists %I_admin_read on public.%I', t, t);
    execute format(
      'create policy %I_admin_read on public.%I for select to authenticated using (public.is_admin_or_super(auth.uid()))',
      t, t);
  end loop;
end $$;

-- keep updated_at honest on jobs (ph_touch_updated_at() already exists)
drop trigger if exists ph_ucc_ingest_jobs_touch on public.ph_ucc_ingest_jobs;
create trigger ph_ucc_ingest_jobs_touch before update on public.ph_ucc_ingest_jobs
  for each row execute function public.ph_touch_updated_at();
