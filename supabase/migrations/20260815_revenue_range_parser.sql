-- Parse the vendor's revenue TEXT into a band. (low, high); high NULL = open
-- ended ("OVER $1 BILLION"); both NULL = nothing usable ("UNKNOWN", "0") or a
-- plain scalar, which needs no band because the number is already real.
--
-- EACH SIDE CARRIES ITS OWN UNIT. A first attempt took one unit for the whole
-- string and turned "$500 MILLION TO $1 BILLION" into 500 BILLION — caught by
-- testing every distinct value in the book before touching a row. So the string
-- is split at TO and each side parsed independently, inheriting the other's unit
-- only when it has none of its own ("$1 TO 2.5 MILLION" -> both millions).
--
-- A number carrying a comma, or already >= 1000, is LITERAL and never scaled:
-- that is what separates "$500,000 TO $1 MILLION" (literal, then scaled) from
-- "$1 TO 2.5 MILLION" (both scaled). Getting it backwards turns half a million
-- dollars into one dollar.
create or replace function public.parse_revenue_band(txt text)
returns table(band_low numeric, band_high numeric)
language plpgsql immutable parallel safe as $fn$
declare
  t text := upper(btrim(coalesce(txt, '')));
  lhs text; rhs text;
  u_l numeric; u_r numeric;
  a numeric; b numeric;
begin
  if t = '' or t = 'UNKNOWN' or t = '0' then
    return query select null::numeric, null::numeric; return;
  end if;
  if t ~ '^\$?[0-9,]+(\.[0-9]+)?$' then          -- a real scalar, not a range
    return query select null::numeric, null::numeric; return;
  end if;

  if position(' TO ' in t) > 0 then
    lhs := split_part(t, ' TO ', 1);
    rhs := split_part(t, ' TO ', 2);
  else
    lhs := t; rhs := null;
  end if;

  u_l := public.money_unit(lhs);
  u_r := public.money_unit(rhs);
  -- a side with no unit of its own inherits the other's
  if u_l is null then u_l := coalesce(u_r, 1); end if;
  if u_r is null then u_r := coalesce(u_l, 1); end if;

  a := public.money_scalar(lhs, u_l);
  b := public.money_scalar(rhs, u_r);

  if t like 'LESS THAN%' or t like 'UNDER%' then
    return query select 0::numeric, a; return;
  end if;
  if t like 'OVER%' or t like 'MORE THAN%' or t like '%+' then
    return query select a, null::numeric; return;
  end if;
  return query select a, b;
end;
$fn$;

create or replace function public.money_unit(s text) returns numeric
language sql immutable parallel safe as $fn$
  select case
    when s is null then null
    when s like '%BILLION%'  then 1000000000
    when s like '%MILLION%'  then 1000000
    when s like '%THOUSAND%' then 1000
    else null end;
$fn$;

create or replace function public.money_scalar(s text, unit numeric) returns numeric
language sql immutable parallel safe as $fn$
  select case
    when s is null then null
    when (select m[1] from regexp_matches(s, '([0-9][0-9,]*(?:\.[0-9]+)?)') m) is null then null
    else (
      with n as (select (select m[1] from regexp_matches(s, '([0-9][0-9,]*(?:\.[0-9]+)?)') m) as raw)
      select replace(n.raw, ',', '')::numeric
             * case when position(',' in n.raw) > 0 or replace(n.raw, ',', '')::numeric >= 1000
                    then 1 else coalesce(unit, 1) end
      from n)
  end;
$fn$;

-- ── Columns the parser fills ─────────────────────────────────────────────────
alter table public.lead_records
  add column if not exists revenue_band_low   numeric,
  add column if not exists revenue_band_high  numeric,
  add column if not exists revenue_text       text,
  add column if not exists revenue_band_basis text;

comment on column public.lead_records.revenue_band_low is
  'Low edge of the vendor''s stated revenue RANGE, parsed from the original text '
  '(kept in revenue_text). The `revenue` scalar is NULL for these rows because '
  'the digit-stripping parse fabricated it: "$500,000 TO $1 MILLION" became '
  '5000001 — the "1" of "$1 MILLION" glued to "500,000".';
comment on column public.lead_records.revenue_band_high is
  'High edge; NULL means open-ended ("OVER $1 BILLION").';
comment on column public.lead_records.revenue_band_basis is
  'Which column the band came from, in the VENDOR''S OWN WORDS: "annual" for the '
  'UCC file''s REVENUE, "monthly" for the trigger file''s "Monthly Revenue". '
  'Recorded rather than reconciled — see the note below.';

-- ── Band -> the GHL monthly_revenue PICKER ───────────────────────────────────
-- A range mapping to a range is the one place this data is a native fit: that
-- field is MULTIPLE_OPTIONS and cannot take a number at all. Bucket from the
-- band MIDPOINT; annual bands are divided by 12 first; an open top uses the low
-- edge. The buckets are coarse enough that a midpoint cannot land materially
-- wrong.
create or replace function public.revenue_picker_bucket(
  low numeric, high numeric, basis text
) returns text
language sql immutable parallel safe as $fn$
  select case
    when low is null then null
    else (
      with m as (
        select (case when high is null then low else (low + high) / 2 end)
               / (case when basis = 'annual' then 12 else 1 end) as monthly
      )
      select case
        when m.monthly <  25000 then 'Under $25K'
        when m.monthly <  50000 then '$25K - $50K'
        when m.monthly < 100000 then '$50K - $100K'
        when m.monthly < 250000 then '$100K - $250K'
        else '$250K +' end
      from m)
  end;
$fn$;

alter table public.lead_records
  add column if not exists revenue_bucket text
  generated always as (public.revenue_picker_bucket(revenue_band_low, revenue_band_high, revenue_band_basis)) stored;

-- ⚠️ OPEN QUESTION, DELIBERATELY NOT RESOLVED IN CODE: the trigger file's column
-- is named "Monthly Revenue" and its values run to millions. Read as monthly,
-- 14,396 of 18,839 rows (76%) land in the top bucket — $3M+/month, $36M+/year.
-- That is not the shape of an SMB book. Read as ANNUAL, the same rows produce
-- 11,795 Under $25K tapering upward, which matches the UCC file's annual
-- distribution almost exactly. The evidence says the vendor mislabelled the
-- column; the decision is the owner's, so the basis is recorded as stated and
-- the monthly-basis buckets are held back from GHL until it is ruled on.
