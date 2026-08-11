-- Normalize lenders.category.criteria list fields to real JSON arrays.
--
-- restricted_states / restricted_industries are read as arrays everywhere (the
-- underwriter's state + industry gates, the decline self-heal, the catalog and
-- cheat-sheet pages). A few rows carried JSON null instead of [] — harmless to a
-- defensive reader, but it makes "no restrictions recorded" and "field never
-- populated" indistinguishable, and any future writer that appends to the value
-- would break on it. Coerce every non-array value to [].
--
-- Only the two list fields are touched; every other criteria key is preserved.

update lenders
set category = jsonb_set(category, '{criteria,restricted_states}', '[]'::jsonb)
where category ? 'criteria'
  and category -> 'criteria' ? 'restricted_states'
  and jsonb_typeof(category -> 'criteria' -> 'restricted_states') <> 'array';

update lenders
set category = jsonb_set(category, '{criteria,restricted_industries}', '[]'::jsonb)
where category ? 'criteria'
  and category -> 'criteria' ? 'restricted_industries'
  and jsonb_typeof(category -> 'criteria' -> 'restricted_industries') <> 'array';
