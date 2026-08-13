-- LEAD MACHINE — browse performance + state hygiene, both found by the first real
-- 250k-row load. Applied live; recorded here so a rebuild reproduces it.
--
-- The synthetic 20-row fixtures could not surface any of this: every plan is a seq
-- scan at 20 rows and every seq scan is instant. It took real volume.

-- ── 1. Browse indexes ─────────────────────────────────────────────────────────
-- The UI's default browse is `where is_dup_of_prior = false order by created_at
-- desc limit 25`. With no index on created_at that was a Parallel Seq Scan + top-N
-- sort: 3,062ms measured on 193k rows. With the index it is an Index Scan: 4.7ms.
--
-- Sorting by the PK instead was NOT an option: id is a random uuid, so "newest
-- first" by id is arbitrary — a correctness bug wearing a performance fix's
-- clothes.
create index if not exists lead_records_created_at_idx
  on public.lead_records (created_at desc);

-- "Open a batch, browse its leads" is the dominant real path, and the
-- single-column index above cannot serve it well.
create index if not exists lead_records_batch_created_idx
  on public.lead_records (batch_id, created_at desc);

-- ── 2. One search column instead of a five-way OR ─────────────────────────────
-- The browse searched `company ilike %q% or first_name ilike %q% or ...` across
-- five columns. That cannot use a single-column trigram index; the planner would
-- need a BitmapOr across four separate GIN indexes. Measured 2,474ms.
--
-- Four more GIN indexes is the wrong fix: GIN maintenance is expensive on bulk
-- insert, and an 85k ingest already hit both a statement timeout and a worker kill
-- during this load. One generated column + ONE GIN index gives a single index scan
-- and leaves the ingest one index to maintain instead of four. Measured 358ms.
--
-- The UI searches this column directly: .ilike('search_text', '%q%')
alter table public.lead_records add column if not exists search_text text
  generated always as (
    coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' ||
    coalesce(company,'')    || ' ' || coalesce(email,'')     || ' ' || coalesce(phone,'')
  ) stored;
create index if not exists lead_records_search_trgm
  on public.lead_records using gin (search_text gin_trgm_ops);
comment on column public.lead_records.search_text is
  'Generated concatenation of first_name/last_name/company/email/phone, GIN-trigram indexed. The UI browse searches THIS one column (.ilike) instead of OR-ing five: one index scan instead of a four-way BitmapOr, and one index for the ingest to maintain instead of four.';

-- ── 3. State normalization ────────────────────────────────────────────────────
-- Purchased files are dirty in this column. The real UCC file carried ~250 rows
-- with full names ('TEXAS' x24, 'CALIFORNIA' x34, 'FLORIDA' x37), trailing commas
-- ('TX,'), the literal string 'NULL', city names ('FRANKFORT'), bare numbers
-- ('1072') and non-US values ('CANADA').
--
-- Storing those verbatim is WORSE than storing nothing: a user filtering state=TX
-- silently missed the 24 rows spelled 'TEXAS' — a wrong answer that looks like a
-- right one. Recognized code or name -> the 2-letter code; everything else -> NULL.
-- Nothing is lost by nulling, because lead_records.raw keeps the original row.
--
-- upperState() in supabase/functions/_shared/leadCsv.ts is AUTHORITATIVE for new
-- ingests; this function mirrors it to backfill rows loaded before it existed.
create or replace function public.lead_normalize_state(p_raw text)
returns text language sql immutable as $fn$
  with clean as (
    select trim(regexp_replace(regexp_replace(upper(coalesce(p_raw,'')),'[^A-Z ]+',' ','g'),'\s+',' ','g')) as s
  )
  select case
    when s = '' or s in ('NULL','NA','N A') then null
    when s in ('AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
               'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
               'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
               'WI','WY','DC','PR','VI','GU','AS','MP') then s
    else (select code from (values
      ('ALABAMA','AL'),('ALASKA','AK'),('ARIZONA','AZ'),('ARKANSAS','AR'),('CALIFORNIA','CA'),
      ('COLORADO','CO'),('CONNECTICUT','CT'),('DELAWARE','DE'),('FLORIDA','FL'),('GEORGIA','GA'),
      ('HAWAII','HI'),('IDAHO','ID'),('ILLINOIS','IL'),('INDIANA','IN'),('IOWA','IA'),('KANSAS','KS'),
      ('KENTUCKY','KY'),('LOUISIANA','LA'),('MAINE','ME'),('MARYLAND','MD'),('MASSACHUSETTS','MA'),
      ('MICHIGAN','MI'),('MINNESOTA','MN'),('MISSISSIPPI','MS'),('MISSOURI','MO'),('MONTANA','MT'),
      ('NEBRASKA','NE'),('NEVADA','NV'),('NEW HAMPSHIRE','NH'),('NEW JERSEY','NJ'),('NEW MEXICO','NM'),
      ('NEW YORK','NY'),('NORTH CAROLINA','NC'),('NORTH DAKOTA','ND'),('OHIO','OH'),('OKLAHOMA','OK'),
      ('OREGON','OR'),('PENNSYLVANIA','PA'),('RHODE ISLAND','RI'),('SOUTH CAROLINA','SC'),
      ('SOUTH DAKOTA','SD'),('TENNESSEE','TN'),('TEXAS','TX'),('UTAH','UT'),('VERMONT','VT'),
      ('VIRGINIA','VA'),('WASHINGTON','WA'),('WEST VIRGINIA','WV'),('WISCONSIN','WI'),('WYOMING','WY'),
      ('DISTRICT OF COLUMBIA','DC'),('WASHINGTON DC','DC'),('PUERTO RICO','PR'),
      ('US VIRGIN ISLANDS','VI'),('VIRGIN ISLANDS','VI'),('GUAM','GU'),('AMERICAN SAMOA','AS'),
      ('NORTHERN MARIANA ISLANDS','MP')) as m(name,code) where m.name = s)
  end from clean;
$fn$;
comment on function public.lead_normalize_state(text) is
  'Mirrors upperState() in supabase/functions/_shared/leadCsv.ts (authoritative for new ingests). Recognized USPS code or full state name -> 2-letter code; anything else -> NULL. Used to backfill rows loaded before the normalizer existed.';

update public.lead_records
   set state = public.lead_normalize_state(state)
 where state is not null and state !~ '^[A-Z]{2}$';
