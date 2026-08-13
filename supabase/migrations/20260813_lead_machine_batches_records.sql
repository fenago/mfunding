-- LEAD MACHINE — the general-purpose purchased-lead pipeline.
--
-- WHAT THIS IS: the owner buys lead files (UCC / AGED / TRIGGER, ~85k rows each).
-- They land in Supabase FIRST (permanent, filterable, auditable), and only a
-- FILTERED SELECTION is pushed to GoHighLevel with tags. HotProspector then syncs
-- by tag and campaigns dial by tag. This generalizes the proven PH UCC pipeline
-- (Supabase → GHL tagged upsert → HP → dialer) to any purchased list.
--
--   lead_batches   — one row per uploaded file, with resumable streaming progress
--   lead_records   — one row per lead line, with per-lead push state
--   lead_push_jobs — one row per filtered GHL push run (resumable, tag-stamped)
--   lead-uploads   — private storage bucket the UI uploads the raw CSV into
--
-- NAMING: lead_* / lead-* . This is INGEST + PUSH only. It never dials, never
-- skip-traces, never creates deals or customers (bulk-lead-import owns that path
-- and is untouched), and never touches ph_ucc_* beyond READING ph_ucc_leads.phone
-- for the cross-source duplicate flag.
--
-- BATCH CODE CONVENTION: {UCC|AGED|TRIG}-{YYYYMMDD}[-n] in America/New_York, n
-- starting at 2 for the second batch of the same type on the same day. Generated
-- SERVER-SIDE by next_lead_batch_code() so it can never drift or collide.

-- ── 1. lead_batches — one uploaded file ────────────────────────────────────────
create table if not exists public.lead_batches (
  id             uuid primary key default gen_random_uuid(),
  batch_code     text not null unique,                  -- UCC-20260813 / AGED-20260813-2
  lead_type      text not null check (lead_type in ('ucc','aged','trigger')),
  label          text,                                  -- owner's free-text name for the drop
  file_name      text,
  file_size      bigint,
  storage_path   text,                                  -- object path inside lead-uploads
  status         text not null default 'uploaded'
                   check (status in ('uploaded','ingesting','ready','failed')),
  total_rows     integer not null default 0,            -- data rows read from the file
  ingested_rows  integer not null default 0,            -- rows actually stored
  dup_rows       integer not null default 0,            -- rows dropped as in-batch phone dupes
  pushed_rows    integer not null default 0,            -- records ever pushed to GHL
  error          text,
  message        text,                                  -- last human status line
  -- resumable streaming progress (the file is streamed over Range, never buffered)
  byte_offset    bigint not null default 0,
  bytes_total    bigint,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz
);
create index if not exists lead_batches_type_idx   on public.lead_batches (lead_type, created_at desc);
create index if not exists lead_batches_status_idx on public.lead_batches (status);
comment on table public.lead_batches is
  'One row per purchased lead file uploaded to the lead-uploads bucket. Carries the resumable streaming ingest progress (byte_offset) so a run that hits the edge-function wall clock resumes exactly where it stopped on self-reinvoke.';

-- ── 2. lead_records — one lead line ────────────────────────────────────────────
create table if not exists public.lead_records (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null references public.lead_batches(id) on delete cascade,
  lead_type       text not null check (lead_type in ('ucc','aged','trigger')),
  -- identity / contact
  phone           text,                                 -- normalized to the last 10 digits
  line_type       text,                                 -- Mobile / Landline / VOIP (as supplied)
  first_name      text,
  last_name       text,
  email           text,
  company         text,
  title           text,
  address         text,
  city            text,
  state           text,
  zip             text,
  employees       integer,
  revenue         numeric,                              -- monthly revenue (trigger) / REVENUE (ucc)
  sic_code        text,
  sic_description text,
  filing_date     date,                                 -- ucc: FILING_YEAR/MONTH/DAY
  secured_party   text,                                 -- ucc: SEC PARTYNAME
  raw             jsonb not null default '{}'::jsonb,   -- the original row, verbatim
  -- cross-batch duplicate flag (phone seen in an EARLIER lead_batches batch, or in
  -- ph_ucc_leads). Set set-based at finalize; the UI filters on it.
  is_dup_of_prior boolean not null default false,
  -- push pipeline
  status          text not null default 'loaded'
                    check (status in ('loaded','pushed','skipped','error')),
  ghl_contact_id  text,
  pushed_at       timestamptz,
  push_tags       text[],
  push_error      text,                                 -- also carries the ingest skip reason
  created_at      timestamptz not null default now()
);
-- In-batch dedupe: the SAME phone never lands twice in one file. NULL phones (rows
-- with no dialable number) are distinct under Postgres NULL semantics, so every
-- unusable row is still kept, as status='skipped'.
create unique index if not exists lead_records_batch_phone_uidx
  on public.lead_records (batch_id, phone) where phone is not null;
create index if not exists lead_records_batch_idx   on public.lead_records (batch_id);
create index if not exists lead_records_phone_idx   on public.lead_records (phone);
create index if not exists lead_records_type_idx    on public.lead_records (lead_type);
create index if not exists lead_records_state_idx   on public.lead_records (state);
create index if not exists lead_records_status_idx  on public.lead_records (status);
create index if not exists lead_records_secparty_idx on public.lead_records (secured_party);
-- the push worker's hot path: "next N unpushed rows of this batch"
create index if not exists lead_records_batch_status_idx on public.lead_records (batch_id, status);
comment on table public.lead_records is
  'One row per line of a purchased lead file. status drives the GHL push (loaded → pushed), which makes a re-push naturally idempotent. raw keeps the original CSV row so no purchased data is ever lost to a mapping mistake.';
comment on column public.lead_records.is_dup_of_prior is
  'true when this phone already existed in an EARLIER lead_batches batch or in ph_ucc_leads. Set set-based when the batch finalizes; the push filter exclude_dups uses it.';

-- ── 3. lead_push_jobs — one filtered push run to GHL ───────────────────────────
create table if not exists public.lead_push_jobs (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid references public.lead_batches(id) on delete set null,
  lead_ids     uuid[],                                  -- explicit selection (optional)
  filters      jsonb not null default '{}'::jsonb,
  tags         text[] not null,                         -- the USER tags (type + batch tag are added per-lead)
  limit_n      integer,
  status       text not null default 'queued'
                 check (status in ('queued','running','complete','error','canceled')),
  target_count integer not null default 0,              -- eligible rows at start
  pushed       integer not null default 0,
  errored      integer not null default 0,
  skipped      integer not null default 0,
  message      text,
  error        text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index if not exists lead_push_jobs_batch_idx  on public.lead_push_jobs (batch_id, created_at desc);
create index if not exists lead_push_jobs_status_idx on public.lead_push_jobs (status);
comment on table public.lead_push_jobs is
  'One row per filtered Supabase→GHL push run. Resumable: the worker only ever selects lead_records with status=''loaded'', so a re-invoke can never double-push a contact.';

-- ── 4. Server-side batch code ──────────────────────────────────────────────────
create or replace function public.next_lead_batch_code(p_lead_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_base   text;
  v_n      integer;
  v_code   text;
begin
  v_prefix := case lower(p_lead_type)
                when 'ucc' then 'UCC'
                when 'aged' then 'AGED'
                when 'trigger' then 'TRIG'
              end;
  if v_prefix is null then
    raise exception 'next_lead_batch_code: unknown lead_type %', p_lead_type;
  end if;

  v_base := v_prefix || '-' || to_char(now() at time zone 'America/New_York', 'YYYYMMDD');

  select count(*) into v_n
    from public.lead_batches
   where batch_code = v_base or batch_code like v_base || '-%';

  if v_n = 0 then
    return v_base;
  end if;

  loop
    v_n := v_n + 1;                                  -- second batch of the day → -2
    v_code := v_base || '-' || v_n;
    exit when not exists (select 1 from public.lead_batches where batch_code = v_code);
  end loop;
  return v_code;
end;
$$;
comment on function public.next_lead_batch_code(text) is
  'Server-side batch code generator: {UCC|AGED|TRIG}-{YYYYMMDD}[-n] in America/New_York, n starting at 2. Called by lead-file-ingest; never generate a batch code client-side.';

-- ── 5. Cross-source duplicate flag (set-based, run once at finalize) ───────────
create or replace function public.lead_batch_mark_dups(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created timestamptz;
  v_marked  integer;
begin
  select created_at into v_created from public.lead_batches where id = p_batch_id;
  if v_created is null then
    raise exception 'lead_batch_mark_dups: no batch %', p_batch_id;
  end if;

  update public.lead_records r
     set is_dup_of_prior = true
   where r.batch_id = p_batch_id
     and r.phone is not null
     and (
       exists (
         select 1
           from public.lead_records o
           join public.lead_batches b on b.id = o.batch_id
          where o.phone = r.phone
            and o.batch_id <> p_batch_id
            and b.created_at < v_created
       )
       or exists (select 1 from public.ph_ucc_leads l where l.phone = r.phone)
     );
  get diagnostics v_marked = row_count;
  return v_marked;
end;
$$;
comment on function public.lead_batch_mark_dups(uuid) is
  'Stamps lead_records.is_dup_of_prior for a batch: phone already present in an EARLIER batch or in ph_ucc_leads. Set-based (indexed on phone) so an 85k batch is one statement.';

-- ── 6. Batch overview for the UI (counts without shipping 85k rows) ────────────
create or replace view public.lead_batch_overview as
select
  b.id,
  b.batch_code,
  b.lead_type,
  b.label,
  b.file_name,
  b.file_size,
  b.status,
  b.total_rows,
  b.ingested_rows,
  b.dup_rows,
  b.message,
  b.error,
  b.byte_offset,
  b.bytes_total,
  b.created_at,
  b.finished_at,
  coalesce(r.records, 0)      as records,
  coalesce(r.dialable, 0)     as dialable,
  coalesce(r.pushed, 0)       as pushed,
  coalesce(r.errored, 0)      as errored,
  coalesce(r.skipped, 0)      as skipped,
  coalesce(r.dup_of_prior, 0) as dup_of_prior
from public.lead_batches b
left join lateral (
  select
    count(*)                                              as records,
    count(*) filter (where lr.phone is not null)          as dialable,
    count(*) filter (where lr.status = 'pushed')          as pushed,
    count(*) filter (where lr.status = 'error')           as errored,
    count(*) filter (where lr.status = 'skipped')         as skipped,
    count(*) filter (where lr.is_dup_of_prior)            as dup_of_prior
  from public.lead_records lr
  where lr.batch_id = b.id
) r on true;
comment on view public.lead_batch_overview is
  'Per-batch roll-up for the Lead Machine UI. Inherits lead_batches/lead_records RLS (security_invoker), so closers/merchants see nothing.';
alter view public.lead_batch_overview set (security_invoker = on);

-- ── 7. RLS — admin / super_admin only. Closers and merchants are denied. ───────
alter table public.lead_batches   enable row level security;
alter table public.lead_records   enable row level security;
alter table public.lead_push_jobs enable row level security;

do $$
declare t text;
begin
  foreach t in array array['lead_batches','lead_records','lead_push_jobs'] loop
    execute format('drop policy if exists %I_admin_all on public.%I', t, t);
    execute format(
      'create policy %I_admin_all on public.%I for all to authenticated '
      || 'using (public.is_admin_or_super(auth.uid())) '
      || 'with check (public.is_admin_or_super(auth.uid()))',
      t, t);
  end loop;
end $$;
-- Edge functions run service-role and bypass RLS entirely (that is how
-- lead-file-ingest writes and lead-push-ghl stamps).

-- keep updated_at honest (ph_touch_updated_at() already exists project-wide)
drop trigger if exists lead_batches_touch on public.lead_batches;
create trigger lead_batches_touch before update on public.lead_batches
  for each row execute function public.ph_touch_updated_at();
drop trigger if exists lead_push_jobs_touch on public.lead_push_jobs;
create trigger lead_push_jobs_touch before update on public.lead_push_jobs
  for each row execute function public.ph_touch_updated_at();

-- ── 8. lead-uploads bucket (private) ───────────────────────────────────────────
-- 512MB ceiling: an 85k-row purchased CSV is ~20MB, so this is generous headroom
-- without inviting a multi-GB upload into a table-shaped ingest.
insert into storage.buckets (id, name, public, file_size_limit)
values ('lead-uploads','lead-uploads', false, 536870912)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

do $$
declare p text;
begin
  foreach p in array array[
    'lead_uploads_admin_select',
    'lead_uploads_admin_insert',
    'lead_uploads_admin_update',
    'lead_uploads_admin_delete'
  ] loop
    execute format('drop policy if exists %I on storage.objects', p);
  end loop;
end $$;
create policy lead_uploads_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'lead-uploads' and public.is_admin_or_super(auth.uid()));
create policy lead_uploads_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'lead-uploads' and public.is_admin_or_super(auth.uid()));
create policy lead_uploads_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'lead-uploads' and public.is_admin_or_super(auth.uid()));
create policy lead_uploads_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'lead-uploads' and public.is_admin_or_super(auth.uid()));
