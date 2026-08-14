-- The lead-browser search/fetch RPC.
--
-- WHY THIS EXISTS: on an RLS table, no trigram index can serve an ILIKE search.
-- texticlike (the function behind ILIKE) is NOT leakproof, so Postgres may not
-- evaluate it before the row-security qual and therefore cannot push it into the
-- index. Measured on the real 249,923 rows: as postgres the GIN index answers in
-- 4.7ms; as `authenticated` the same query seq-scans, and with enable_seqscan=off
-- it STILL seq-scans with the disable penalty -- proof there is no index path at
-- all. Adding indexes cannot fix this.
--
-- THE COST IS NOT ACADEMIC. A RARE search term is the worst case, because LIMIT
-- cannot stop early -- the scan has to read everything to prove there are no more
-- matches. Measured, as `authenticated`, searching a term with zero matches:
--     PostgREST path : 16,903 ms   (Rows Removed by Filter: 249,923)
--     this RPC       :      22 ms
-- `authenticated` has statement_timeout=8s, so the PostgREST path does not merely
-- run slowly for a rare term -- IT FAILS. Searching for anything uncommon in the
-- lead browser was timing out in production before this landed.
--
-- SECURITY DEFINER is the escape hatch: the function does its OWN admin check and
-- then queries without RLS, so the index becomes usable again. Safe precisely
-- because the first thing it does is reject anyone who is not admin/super_admin --
-- the same rule the RLS policy enforces.
--
-- Cost now scales with MATCHES, not with table size, so it keeps working as the
-- book grows; the seq-scan path gets strictly worse.
--
-- Scoped to the lead browser's CURRENT deployed filter surface. Every ordering
-- ends in the PK: OFFSET pagination over a non-unique sort key silently drops and
-- duplicates rows, which would corrupt an export.
-- Dropped first because the return type changed (has_any_email added): Postgres
-- refuses CREATE OR REPLACE when the OUT-parameter row type differs.
-- Dropped first because both the parameter list (p_secured_party) and the return
-- type (has_any_email) changed; Postgres refuses CREATE OR REPLACE for either, and
-- a new default-arg overload would make calls ambiguous rather than fail.
drop function if exists public.lead_records_search(
  text, text[], uuid[], text[], text[], numeric, numeric, text[], boolean, text, boolean, text, integer, integer);
drop function if exists public.lead_records_search(
  text, text[], uuid[], text[], text[], text, numeric, numeric, text[], boolean, text, boolean, text, integer, integer);

create or replace function public.lead_records_search(
  p_q             text    default null,
  p_lead_types    text[]  default null,
  p_batch_ids     uuid[]  default null,
  p_states        text[]  default null,
  p_line_types    text[]  default null,
  p_secured_party text    default null,
  p_revenue_min   numeric default null,
  p_revenue_max   numeric default null,
  p_statuses      text[]  default null,
  p_has_email     boolean default null,
  p_tag           text    default null,
  p_exclude_dups  boolean default false,
  p_order         text    default 'created_at_desc',
  p_limit         integer default 50,
  p_offset        integer default 0
)
returns table (
  id uuid, batch_id uuid, lead_type text, phone text, line_type text,
  first_name text, last_name text, email text, company text, title text,
  address text, city text, state text, zip text,
  employees integer, revenue numeric, sic_code text, sic_description text,
  filing_date date, secured_party text,
  extra_phones jsonb, extra_emails jsonb, has_any_email boolean,
  is_dup_of_prior boolean, status text, ghl_contact_id text,
  pushed_at timestamptz, push_tags text[], push_error text,
  matched_existing boolean, created_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $fn$
declare v_lim integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
begin
  -- The access control. Everything below runs WITHOUT RLS, so this check is the
  -- boundary: it must mirror the table's policy exactly.
  if not public.is_admin_or_super(auth.uid()) then
    raise exception 'Forbidden — admin only' using errcode = '42501';
  end if;

  -- An unrecognized sort FAILS LOUDLY. It used to fall through every CASE to bare
  -- PK order, so a user sorting by State got arbitrary rows under a header showing
  -- a sort arrow — a wrong answer that looks right, the same class as
  -- count=estimated and line_type='Voip'.
  if coalesce(p_order,'') not in (
    'created_at_asc','created_at_desc','company_asc','company_desc',
    'revenue_asc','revenue_desc','state_asc','state_desc',
    'filing_date_asc','filing_date_desc'
  ) then
    raise exception 'unknown p_order %', p_order using errcode = '22023';
  end if;

  return query
  with filtered as (
    select r.*
      from public.lead_records r
     where (p_q is null or p_q = '' or r.search_text ilike '%' || p_q || '%')
       and (p_lead_types  is null or r.lead_type = any(p_lead_types))
       and (p_batch_ids   is null or r.batch_id  = any(p_batch_ids))
       and (p_states      is null or r.state     = any(p_states))
       and (p_line_types  is null or r.line_type = any(p_line_types))
       -- Dropping this filter returns MORE rows, not fewer, and buildFilteredQuery
       -- also feeds the PUSH id-gather — so a missing secured_party could push
       -- leads the owner had filtered OUT. It is not optional.
       and (p_secured_party is null or p_secured_party = ''
            or r.secured_party ilike '%' || p_secured_party || '%')
       and (p_revenue_min is null or r.revenue >= p_revenue_min)
       and (p_revenue_max is null or r.revenue <= p_revenue_max)
       and (p_statuses    is null or r.status    = any(p_statuses))
       -- ONE definition of has_email, shared with lead-push-ghl {action:count}
       -- and the export: the generated has_any_email column (primary OR any
       -- extra). An email campaign can mail any address on the record, so "has
       -- an email" must mean "is reachable by email".
       and (p_has_email is null or r.has_any_email = p_has_email)
       and (p_tag is null or r.push_tags @> array[lower(p_tag)])
       and (not p_exclude_dups or r.is_dup_of_prior = false)
  ), counted as (
    select count(*) as n from filtered
  )
  select f.id, f.batch_id, f.lead_type, f.phone, f.line_type,
         f.first_name, f.last_name, f.email, f.company, f.title,
         f.address, f.city, f.state, f.zip,
         f.employees, f.revenue, f.sic_code, f.sic_description,
         f.filing_date, f.secured_party,
         f.extra_phones, f.extra_emails, f.has_any_email,
         f.is_dup_of_prior, f.status, f.ghl_contact_id,
         f.pushed_at, f.push_tags, f.push_error,
         f.matched_existing, f.created_at,
         c.n
    from filtered f cross join counted c
   -- NULLS LAST everywhere, matching the UI's nullsFirst:false on every sort.
   -- state and filing_date are frequently NULL (aged files carry no state, only
   -- UCC rows have a filing date), so nulls-first would open those sorts on a wall
   -- of blank rows — and look broken on exactly the lists that use them.
   order by
     case when p_order = 'created_at_asc'   then f.created_at  end asc  nulls last,
     case when p_order = 'created_at_desc'  then f.created_at  end desc nulls last,
     case when p_order = 'company_asc'      then f.company     end asc  nulls last,
     case when p_order = 'company_desc'     then f.company     end desc nulls last,
     case when p_order = 'revenue_asc'      then f.revenue     end asc  nulls last,
     case when p_order = 'revenue_desc'     then f.revenue     end desc nulls last,
     case when p_order = 'state_asc'        then f.state       end asc  nulls last,
     case when p_order = 'state_desc'       then f.state       end desc nulls last,
     case when p_order = 'filing_date_asc'  then f.filing_date end asc  nulls last,
     case when p_order = 'filing_date_desc' then f.filing_date end desc nulls last,
     f.id  -- every ordering ends in the PK: OFFSET over a non-unique key drops rows
   limit v_lim offset greatest(coalesce(p_offset, 0), 0);
end;
$fn$;
comment on function public.lead_records_search is
  'Lead-browser search/fetch. SECURITY DEFINER with its own admin check, so it queries WITHOUT RLS and the search_text GIN index becomes usable — under RLS no trigram index can serve ILIKE, because texticlike is not leakproof. A rare term via PostgREST measured 16,903ms (over the 8s authenticated timeout — it FAILED); via this RPC, 22ms. Returns total_count on every row (one pass, no second count query). Every ordering ends in the PK so OFFSET pagination cannot drop or duplicate rows.';
revoke all on function public.lead_records_search from public, anon;
grant execute on function public.lead_records_search to authenticated;
