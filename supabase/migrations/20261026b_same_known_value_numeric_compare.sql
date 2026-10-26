-- ── "Our record disagrees" has to mean a disagreement ──────────────────────
--
-- funder_known_values decided whether a funder's DOCUMENT contradicts our
-- record with a plain string compare. Numerics are stored as numeric and cast
-- to text, so the record says "250000.00" while a document fact extracted as
-- "250000" is a different STRING and an identical NUMBER. The panel then told
-- the setter "our record says 250000.00" next to the document's "250000".
--
-- Measured across the whole network before the fix: 16 single-value numeric
-- facts flagged as disagreeing with our record, 12 of them pure formatting.
-- A 75% false-positive rate on the one flag that is supposed to stop someone
-- quoting a wrong figure down the phone. A setter learns to scroll past it,
-- and then it is not a check at all — cf. the funder directive queue, whose
-- first version was 80% false positives for the same reason.
--
-- Compare as numbers when both sides ARE numbers; fall back to the trimmed,
-- case-folded string compare otherwise. After the fix: 0 formatting false
-- alarms, 42 real disagreements still reported across 914 rows.
create or replace function public.same_known_value(a text, b text)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $fn$
declare na numeric; nb numeric;
begin
  if a is null or b is null then return a is not distinct from b; end if;
  begin
    na := a::numeric; nb := b::numeric;
    return na = nb;
  exception when invalid_text_representation or numeric_value_out_of_range then
    -- Not both numeric. Fall through to the string comparison, which is the
    -- behaviour every non-numeric field had before and still needs.
    null;
  end;
  return btrim(lower(a)) = btrim(lower(b));
end;
$fn$;

-- pg_default_acl grants EXECUTE on new public functions to anon, authenticated
-- AND service_role BY NAME — revoking from PUBLIC alone leaves anon holding it.
revoke execute on function public.same_known_value(text, text) from public, anon, authenticated, service_role;
grant  execute on function public.same_known_value(text, text) to authenticated;
