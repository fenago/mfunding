-- Multiple phones / emails per lead.
--
-- Vendor files ship Phone 1 / Phone 2 / Cell columns, and the setter script's
-- first question captures a cell + email that are almost always DIFFERENT from
-- the list data. Keeping only the first number throws away paid-for data.
--
-- PRIMARY IS UNCHANGED. phone/email keep their exact current meaning and the
-- in-batch dedupe key is still the primary phone. Extras are strictly
-- ADDITIONAL and never repeat the primary, so a "+2" badge means 2 extra
-- numbers (3 in total). Extra columns are found by HEADER, and all three real
-- files resolve ZERO extra columns -- verified against the actual CSVs -- so
-- existing batches are byte-identical.
--
-- SHAPES (deliberately different, because the data is different):
--   extra_phones : [{phone:"3055551212", line_type?:"Mobile", label?:"PHONE 2"}]
--                  phone normalized exactly like the primary (bare last-10);
--                  label is the source column header, so the owner can see where
--                  a number came from.
--   extra_emails : ["someone@example.com"] -- plain validated lowercase strings.
--                  An email carries no line_type, so an object would be noise.
--
-- NO NEW INDEXES: nothing queries these columns directly; search goes through
-- search_text. House law -- an index the ingest must maintain for a query nobody
-- runs is a cost, not a win.
alter table public.lead_records
  add column if not exists extra_phones jsonb not null default '[]'::jsonb,
  add column if not exists extra_emails jsonb not null default '[]'::jsonb;

comment on column public.lead_records.extra_phones is
  'Additional phones beyond the primary: [{phone, line_type?, label?}]. phone is bare last-10 like the primary; label is the source CSV header. STRICTLY ADDITIONAL — the primary never appears here, so a "+2" badge means 2 extra numbers, 3 in total.';
comment on column public.lead_records.extra_emails is
  'Additional validated lowercase emails beyond the primary, as plain strings. STRICTLY ADDITIONAL — the primary is not repeated here.';

-- search_text is rebuilt to cover every extra phone and email, so the browser
-- finds a lead by ANY of its numbers. Regenerating a generated column requires
-- dropping it, which takes the GIN index with it; both are recreated.
drop index if exists public.lead_records_search_trgm;
alter table public.lead_records drop column if exists search_text;
alter table public.lead_records add column search_text text
  generated always as (
    coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' ||
    coalesce(company,'')    || ' ' || coalesce(email,'')     || ' ' || coalesce(phone,'') || ' ' ||
    coalesce(jsonb_path_query_array(extra_phones, '$[*].phone')::text, '') || ' ' ||
    coalesce(extra_emails::text, '')
  ) stored;
create index lead_records_search_trgm
  on public.lead_records using gin (search_text gin_trgm_ops);
comment on column public.lead_records.search_text is
  'Generated: first/last/company/email/phone PLUS every extra phone and extra email, GIN-trigram indexed. NOTE: under RLS this index is NOT usable — ILIKE (texticlike) is not leakproof, so Postgres cannot evaluate it before the row-security qual. Search from the browser therefore seq-scans; a SECURITY DEFINER RPC is the escape hatch if it needs to be fast.';
