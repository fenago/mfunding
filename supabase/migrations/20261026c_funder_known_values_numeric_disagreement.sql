-- Point funder_known_values' disagreement test at same_known_value.
--
-- Patched from the CATALOG (pg_get_functiondef), never rebuilt from migration
-- text — rebuilding from stale migration text has silently reverted five
-- migrations on this project before. This reads the live definition, swaps the
-- one comparison, and executes it, so every later change to the function is
-- carried forward untouched.
--
-- Idempotent and fail-loud: it patches exactly one occurrence, skips if the
-- fix is already in place, and raises rather than guessing if the function has
-- been reshaped underneath it.
do $outer$
declare d text; n int;
begin
  select pg_get_functiondef(p.oid) into d
  from pg_proc p join pg_namespace nsp on nsp.oid = p.pronamespace
  where nsp.nspname = 'public' and p.proname = 'funder_known_values';

  if d is null then raise exception 'funder_known_values not found in catalog'; end if;

  if position('same_known_value' in d) > 0 then
    raise notice 'funder_known_values already uses same_known_value — nothing to do';
    return;
  end if;

  n := (length(d) - length(replace(d, 'btrim(lower(dm.val)) <> btrim(lower(rr.val))', '')))
       / length('btrim(lower(dm.val)) <> btrim(lower(rr.val))');
  if n <> 1 then
    raise exception 'expected exactly 1 comparison to patch in funder_known_values, found %', n;
  end if;

  execute replace(d,
    'btrim(lower(dm.val)) <> btrim(lower(rr.val))',
    'not public.same_known_value(dm.val, rr.val)');
end
$outer$;
