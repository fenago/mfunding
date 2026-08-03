-- PH UCC — set-based helpers for ph-ucc-file-ingest.
--
-- These keep the GB-scale work in Postgres: the edge function streams the file(s)
-- and hands Postgres small JSONB batches (enrich) or fires a single set-based
-- flush (finalize). Nothing pulls the full file back into Deno memory.

-- ── Enrich staged matches from a batch of parsed rows (pass 2 / pass 3) ─────────
-- p_kind = 'filings' → fill filed_date / lapse_date / status by filing_no
-- p_kind = 'debtors' → fill debtor_* by filing_no
-- Only staged (funder-matched) filing_nos are touched; unmatched rows are ignored.
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
      filed_date = coalesce(d.filed_date, m.filed_date),
      lapse_date = coalesce(d.lapse_date, m.lapse_date),
      status     = coalesce(d.status,     m.status)
    from d
    where m.job_id = p_job_id and m.filing_no = d.filing_no;
    get diagnostics v = row_count;
  elsif p_kind = 'debtors' then
    with d as (
      select * from jsonb_to_recordset(p_rows)
        as x(filing_no text, debtor_name text, debtor_address text,
             debtor_city text, debtor_state text, debtor_zip text)
    )
    update public.ph_ucc_ingest_matches m set
      debtor_name    = coalesce(d.debtor_name,    m.debtor_name),
      debtor_address = coalesce(d.debtor_address, m.debtor_address),
      debtor_city    = coalesce(d.debtor_city,    m.debtor_city),
      debtor_state   = coalesce(d.debtor_state,   m.debtor_state),
      debtor_zip     = coalesce(d.debtor_zip,     m.debtor_zip)
    from d
    where m.job_id = p_job_id and m.filing_no = d.filing_no;
    get diagnostics v = row_count;
  end if;
  return v;
end $$;
comment on function public.ph_ucc_enrich_matches(uuid, text, jsonb) is
  'Batch-enrich per-job staged UCC matches (filings dates/status or debtor fields) from a JSONB row array. Only funder-matched filing_nos are affected.';

-- ── Flush staged matches into ph_ucc_filings (freshness + termination filter) ───
-- One set-based upsert. Keeps only non-terminated filings filed within p_window_days
-- (null filed_date kept — unknown date, don't over-drop). Idempotent via the
-- ph_ucc_filings dedupe_hash unique (re-uploading the same month never doubles).
-- Termination regex is the SQL twin of isTerminatedStatus() in _shared/uccFile.ts.
create or replace function public.ph_ucc_finalize_file_job(p_job_id uuid, p_window_days int)
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
    m.state, m.filing_no, m.filed_date, m.lapse_date, m.status,
    m.debtor_name, m.debtor_address, m.debtor_city, m.debtor_state, m.debtor_zip,
    m.secured_party_raw, m.raw, v_src
  from public.ph_ucc_ingest_matches m
  where m.job_id = p_job_id
    and m.debtor_name is not null and length(trim(m.debtor_name)) > 1
    and (m.filed_date is null or m.filed_date >= current_date - p_window_days)
    and not (coalesce(m.status,'') ~* '\y(TERMINAT|LAPSE|EXPIR|RELEAS|CLOSED|DEAD)')
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
comment on function public.ph_ucc_finalize_file_job(uuid, int) is
  'Flush a file-ingest job''s staged matches into ph_ucc_filings applying the freshness (p_window_days) + termination filter, then clear staging. Idempotent via dedupe_hash.';
