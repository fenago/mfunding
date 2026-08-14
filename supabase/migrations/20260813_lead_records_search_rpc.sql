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
-- ── REGRESSION FIX (same day): the count re-created the bug it replaced ───────
--
-- total_count rode EVERY call as a count over the filtered set. With no filters
-- that counts all 249,923 rows before the LIMIT — re-creating INSIDE the RPC the
-- exact count-kills-the-rows failure we had just removed from PostgREST. The
-- owner's landing view (no filters, created_at desc) began intermittently 500ing
-- with 57014.
--
-- TWO costs were hiding in one symptom, and fixing only the count would not work:
--
--   1. THE COUNT. Now opt-out: p_with_count boolean default true. When false the
--      count never runs and total_count comes back NULL. The UI passes false
--      exactly where it can derive the total from batch counters instead
--      (no-filter / type-only / batch-only) — precisely the heavy cases.
--
--   2. THE ORDER BY. The old CASE-chain ordering CANNOT match an index, so even
--      with the count gone the default view still sorted all 249,923 rows. The
--      order is now chosen from a fixed whitelist and injected as a literal, so
--      `created_at desc nulls last, id` matches
--      lead_records_created_nullslast_id_idx exactly. p_order is validated against
--      that whitelist BEFORE it is used, so nothing user-supplied reaches the SQL
--      text; every other value is a bound parameter.
--
-- Measured as `authenticated`, landing view, 25 rows:
--      p_with_count := false   ->     97-142 ms
--      p_with_count := true    ->      4,679 ms   (the regression path)
--
-- Also added: a trigram index on secured_party. The browser's secured-party ILIKE
-- filter had no index, so COUNTING it full-scanned and timed out (57014). That
-- index is usable only from here — this function is SECURITY DEFINER and runs
-- without RLS; under RLS an ILIKE can never use a trigram index because
-- texticlike is not leakproof. Measured: RAPID 1,075 rows, timeout -> 0.24s warm.
create index if not exists lead_records_secured_party_trgm
  on public.lead_records using gin (secured_party gin_trgm_ops);

drop function if exists public.lead_records_search(
  text, text[], uuid[], text[], text[], numeric, numeric, text[], boolean, text, boolean, text, integer, integer);
drop function if exists public.lead_records_search(
  text, text[], uuid[], text[], text[], text, numeric, numeric, text[], boolean, text, boolean, text, integer, integer);

create or replace function public.lead_records_search(
  p_q text default null, p_lead_types text[] default null, p_batch_ids uuid[] default null,
  p_states text[] default null, p_line_types text[] default null,
  p_secured_party text default null,
  p_revenue_min numeric default null, p_revenue_max numeric default null,
  p_statuses text[] default null, p_has_email boolean default null,
  p_tag text default null, p_exclude_dups boolean default false,
  p_order text default 'created_at_desc', p_limit integer default 50, p_offset integer default 0,
  -- COUNT IS OPT-IN. NULL total_count means NOT REQUESTED, never zero.
  p_with_count boolean default false
)
returns table (
  id uuid, batch_id uuid, lead_type text, phone text, line_type text,
  first_name text, last_name text, email text, company text, title text,
  address text, city text, state text, zip text,
  employees integer, revenue numeric, sic_code text, sic_description text,
  filing_date date, secured_party text, extra_phones jsonb, extra_emails jsonb,
  has_any_email boolean, is_dup_of_prior boolean, status text, ghl_contact_id text,
  pushed_at timestamptz, push_tags text[], push_error text,
  matched_existing boolean, created_at timestamptz, total_count bigint
)
language plpgsql security definer set search_path = public
as $fn$
declare
  v_lim   integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
  v_off   integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint  := null;
  v_order text;
  -- ONE copy of the predicate, shared by the count and the row fetch, so the two
  -- can never disagree about which rows match.
  v_where constant text :=
    ' where ($1 is null or $1 = '''' or r.search_text ilike ''%'' || $1 || ''%'')'
    ' and ($2 is null or r.lead_type = any($2))'
    ' and ($3 is null or r.batch_id  = any($3))'
    ' and ($4 is null or r.state     = any($4))'
    ' and ($5 is null or r.line_type = any($5))'
    ' and ($6 is null or $6 = '''' or r.secured_party ilike ''%'' || $6 || ''%'')'
    ' and ($7 is null or r.revenue >= $7)'
    ' and ($8 is null or r.revenue <= $8)'
    ' and ($9 is null or r.status = any($9))'
    ' and ($10 is null or r.has_any_email = $10)'
    ' and ($11 is null or r.push_tags @> array[lower($11)])'
    ' and (not $12 or r.is_dup_of_prior = false)';
begin
  if not public.is_admin_or_super(auth.uid()) then
    raise exception 'Forbidden — admin only' using errcode = '42501';
  end if;

  v_order := case p_order
    when 'created_at_desc'  then 'r.created_at desc nulls last, r.id'
    when 'created_at_asc'   then 'r.created_at asc  nulls last, r.id'
    when 'company_asc'      then 'r.company asc  nulls last, r.id'
    when 'company_desc'     then 'r.company desc nulls last, r.id'
    when 'revenue_asc'      then 'r.revenue asc  nulls last, r.id'
    when 'revenue_desc'     then 'r.revenue desc nulls last, r.id'
    when 'state_asc'        then 'r.state asc  nulls last, r.id'
    when 'state_desc'       then 'r.state desc nulls last, r.id'
    when 'filing_date_asc'  then 'r.filing_date asc  nulls last, r.id'
    when 'filing_date_desc' then 'r.filing_date desc nulls last, r.id'
  end;
  -- An unrecognized sort FAILS LOUDLY, and this is also the whitelist that keeps
  -- p_order out of the SQL text: only these ten literals can ever reach it.
  if v_order is null then
    raise exception 'unknown p_order %', p_order using errcode = '22023';
  end if;

  if p_with_count then
    execute 'select count(*) from public.lead_records r' || v_where
      into v_total
      using p_q, p_lead_types, p_batch_ids, p_states, p_line_types, p_secured_party,
            p_revenue_min, p_revenue_max, p_statuses, p_has_email, p_tag, p_exclude_dups;
  end if;

  return query execute
    'select r.id, r.batch_id, r.lead_type, r.phone, r.line_type,'
    ' r.first_name, r.last_name, r.email, r.company, r.title,'
    ' r.address, r.city, r.state, r.zip, r.employees, r.revenue,'
    ' r.sic_code, r.sic_description, r.filing_date, r.secured_party,'
    ' r.extra_phones, r.extra_emails, r.has_any_email,'
    ' r.is_dup_of_prior, r.status, r.ghl_contact_id,'
    ' r.pushed_at, r.push_tags, r.push_error, r.matched_existing, r.created_at,'
    ' $13::bigint'
    ' from public.lead_records r' || v_where ||
    ' order by ' || v_order || ' limit $14 offset $15'
    using p_q, p_lead_types, p_batch_ids, p_states, p_line_types, p_secured_party,
          p_revenue_min, p_revenue_max, p_statuses, p_has_email, p_tag, p_exclude_dups,
          v_total, v_lim, v_off;
end;
$fn$;
revoke all on function public.lead_records_search from public, anon;
grant execute on function public.lead_records_search to authenticated;

-- ── CONTRACT CHANGE (deliberate hardening, team-lead approved) ────────────────
-- p_with_count now defaults to FALSE. Counting is opt-in.
--
-- Three separate production bugs on this table had the same shape: the expensive
-- thing was the DEFAULT and nobody chose it — PostgREST exact counts, the
-- lead_batch_overview live aggregate, and this RPC's own unconditional count,
-- which took the owner's landing view to 6,002 ms and intermittent 57014s.
-- Defaults should be the cheap, safe path.
--
-- The mirror-image risk is a caller who omits the flag and wanted a total. That
-- fails LOUD AND CHEAP — they get a NULL they must handle — rather than silent
-- and expensive. total_count is NULL for "not requested" and is never 0, so an
-- omitted flag can never be mistaken for "zero matches" and rendered as an empty
-- book.
--
-- Verified as `authenticated` after the flip:
--   omitted        -> total_count NULL, 131 ms
--   explicit false -> total_count NULL,  99 ms
--   explicit true  -> total_count 249,923 (the expensive path, now chosen)
comment on function public.lead_records_search is
  'Lead-browser search/fetch. SECURITY DEFINER with its own admin check, so it queries WITHOUT RLS and the trigram indexes become usable — under RLS no trigram index can serve ILIKE, because texticlike is not leakproof. COUNT IS OPT-IN (p_with_count, default FALSE): total_count NULL means NOT REQUESTED, never zero. Counting an unfiltered set scans all 249,923 rows, and three separate bugs on this table came from an expensive count being the default nobody chose. Ordering comes from a fixed whitelist injected as a literal so it can match an index; a CASE-chain ORDER BY cannot. Every ordering ends in the PK so OFFSET pagination cannot drop or duplicate rows.';
