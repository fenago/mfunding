-- PH UCC — extend the file-ingest RPCs to faithfully mirror the CA/FL loaders'
-- per-state semantics (descriptor-preserving vs blocklist matching happens in the
-- edge fn; this migration adds the DB-side precision the loaders use):
--   • CA: filed_date from the ORIGINAL filing only, MAX lapse across rows,
--     termination via FilingAmendments (Termination minus Erroneous Termination),
--     drop if the effective lapse date is in the past.
--   • FL: best-debtor pick (company/original/longest); non-'Filed' rows are dropped
--     in the edge fn during the filings pass.

-- ── staging: rank + amendment flags ────────────────────────────────────────────
alter table public.ph_ucc_ingest_matches add column if not exists debtor_rank integer;
alter table public.ph_ucc_ingest_matches add column if not exists amend_term boolean not null default false;
alter table public.ph_ucc_ingest_matches add column if not exists amend_err  boolean not null default false;

-- ── enrich: filings (max-lapse) / debtors (rank-gated) / amendments (flags) ──────
create or replace function public.ph_ucc_enrich_matches(p_job_id uuid, p_kind text, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare v int := 0;
begin
  if p_kind = 'filings' then
    with d as (
      select * from jsonb_to_recordset(p_rows)
        as x(filing_no text, filed_date date, lapse_date date, status text)
    )
    update public.ph_ucc_ingest_matches m set
      -- filed_date is sent only for the ORIGINAL filing → keep first non-null
      filed_date = coalesce(m.filed_date, d.filed_date),
      lapse_date = greatest(m.lapse_date, d.lapse_date),
      status     = coalesce(d.status, m.status)
    from d
    where m.job_id = p_job_id and m.filing_no = d.filing_no;
    get diagnostics v = row_count;

  elsif p_kind = 'debtors' then
    with d as (
      select * from jsonb_to_recordset(p_rows)
        as x(filing_no text, rank int, debtor_name text, debtor_address text,
             debtor_city text, debtor_state text, debtor_zip text)
    )
    update public.ph_ucc_ingest_matches m set
      debtor_name    = d.debtor_name,
      debtor_address = d.debtor_address,
      debtor_city    = d.debtor_city,
      debtor_state   = d.debtor_state,
      debtor_zip     = d.debtor_zip,
      debtor_rank    = d.rank
    from d
    where m.job_id = p_job_id and m.filing_no = d.filing_no
      and (m.debtor_rank is null or d.rank < m.debtor_rank);
    get diagnostics v = row_count;

  elsif p_kind = 'amendments' then
    with d as (
      select * from jsonb_to_recordset(p_rows)
        as x(filing_no text, is_term boolean, is_err boolean)
    )
    update public.ph_ucc_ingest_matches m set
      amend_term = m.amend_term or coalesce(d.is_term, false),
      amend_err  = m.amend_err  or coalesce(d.is_err,  false)
    from d
    where m.job_id = p_job_id and m.filing_no = d.filing_no;
    get diagnostics v = row_count;
  end if;
  return v;
end $$;
comment on function public.ph_ucc_enrich_matches(uuid, text, jsonb) is
  'Batch-enrich per-job staged UCC matches: filings (keep original filed_date, max lapse), debtors (rank-gated best pick), amendments (OR termination/reversal flags). Only funder-matched filing_nos are affected.';

-- ── finalize: freshness + termination flush into ph_ucc_filings ─────────────────
-- p_drop_lapsed  : CA — drop rows whose effective lapse date is in the past.
-- p_use_amend    : CA — drop rows terminated (amend_term) and not un-terminated
--                  (amend_err). FL passes false (it dropped non-'Filed' upstream).
-- Requires a non-null filed_date within the window (both loaders require an
-- original/Filed date). Idempotent via ph_ucc_filings.dedupe_hash.
drop function if exists public.ph_ucc_finalize_file_job(uuid, int); -- retire the 2-arg overload
create or replace function public.ph_ucc_finalize_file_job(
  p_job_id uuid, p_window_days int, p_drop_lapsed boolean default false, p_use_amend boolean default false)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_src uuid; v_upserted int := 0;
begin
  select source_id into v_src from public.ph_ucc_ingest_jobs where id = p_job_id;

  insert into public.ph_ucc_filings as f (
    state, filing_no, filed_date, lapse_date, status,
    debtor_name, debtor_address, debtor_city, debtor_state, debtor_zip,
    secured_party_raw, raw, source_id)
  select
    m.state, m.filing_no, m.filed_date, m.lapse_date, coalesce(m.status,'Active'),
    m.debtor_name, m.debtor_address, m.debtor_city, m.debtor_state, m.debtor_zip,
    m.secured_party_raw, m.raw, v_src
  from public.ph_ucc_ingest_matches m
  where m.job_id = p_job_id
    and m.debtor_name is not null and length(trim(m.debtor_name)) > 1
    and m.filed_date is not null
    and m.filed_date >= current_date - p_window_days
    and (not p_use_amend or not (m.amend_term and not m.amend_err))
    and (not p_drop_lapsed or m.lapse_date is null or m.lapse_date >= current_date)
  on conflict (dedupe_hash) do update set
    filed_date     = coalesce(excluded.filed_date, f.filed_date),
    lapse_date     = coalesce(excluded.lapse_date, f.lapse_date),
    status         = coalesce(excluded.status, f.status),
    debtor_name    = coalesce(excluded.debtor_name, f.debtor_name),
    debtor_address = coalesce(excluded.debtor_address, f.debtor_address),
    debtor_city    = coalesce(excluded.debtor_city, f.debtor_city),
    debtor_state   = coalesce(excluded.debtor_state, f.debtor_state),
    debtor_zip     = coalesce(excluded.debtor_zip, f.debtor_zip),
    raw            = excluded.raw,
    source_id      = coalesce(excluded.source_id, f.source_id),
    ingested_at    = now();
  get diagnostics v_upserted = row_count;

  delete from public.ph_ucc_ingest_matches where job_id = p_job_id;
  return v_upserted;
end $$;
comment on function public.ph_ucc_finalize_file_job(uuid, int, boolean, boolean) is
  'Flush a file-ingest job''s staged matches into ph_ucc_filings: require non-null filed_date within p_window_days; optionally drop lapsed (CA) and amend-terminated (CA). Clears staging. Idempotent via dedupe_hash.';
