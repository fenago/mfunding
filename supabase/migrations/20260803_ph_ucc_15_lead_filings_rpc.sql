-- ph_ucc_lead_filings(p_lead_id): every filing (UCC position) for a lead's
-- debtor, joined on the SAME normalized debtor key the matcher uses
-- (ph_ucc_leads.dedupe_key = lower(state) | norm2(debtor_name)). norm2 mirrors
-- supabase/functions/_shared/uccFile.ts: strip corporate-form suffixes only,
-- keep descriptive words. SECURITY INVOKER so the caller's ph_ucc_filings RLS
-- (staff-read) still applies. Read-only; powers the /admin/ph-ucc debtor
-- drill-down drawer (full stack history).
--
-- NOTE: the normalization is duplicated from uccFile.ts here in SQL. If the
-- matcher's debtor normalizer changes, update this regex to match, or replace
-- this function with a call into the canonical normalizer.
create or replace function public.ph_ucc_lead_filings(p_lead_id uuid)
returns setof public.ph_ucc_filings
language sql
stable
security invoker
as $$
  select f.*
  from public.ph_ucc_filings f
  join public.ph_ucc_leads l on l.id = p_lead_id
  where f.state = l.state
    and lower(f.state) || '|' || btrim(regexp_replace(regexp_replace(regexp_replace(
          upper(coalesce(f.debtor_name, '')),
          '\y(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LP|LLP|LTD|THE)\y', ' ', 'g'),
          '[^A-Z0-9]+', ' ', 'g'),
          '\s+', ' ', 'g')) = l.dedupe_key
  order by f.filed_date desc nulls last;
$$;

grant execute on function public.ph_ucc_lead_filings(uuid) to authenticated;
