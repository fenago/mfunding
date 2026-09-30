-- deal_row_for_caller: say WHAT WAS WITHHELD, not just null.
--
-- ── THE BUG THIS CLOSES ─────────────────────────────────────────────────────
--
-- For a staff reader who is not ops-staff / the creator / the assigned closer,
-- this function does NOT omit the money columns. It writes JSON null over them:
--
--     select v_out || jsonb_object_agg(k, 'null'::jsonb) from unnest(deal_money_keys()) k;
--
-- So the key is PRESENT and null. A null that means "YOU ARE NOT ALLOWED TO KNOW
-- THIS" arrives downstream indistinguishable from one that means "THE ANSWER IS
-- NOTHING", and gets rendered as the second. Verified in node, because the two
-- halves behave in opposite ways and it is easy to brief backwards:
--
--     'amount_requested' in deal   -> true      presence checks PASS
--     deal.x === undefined          -> false     undefined guards SAIL THROUGH
--     deal.x ?? 0                   -> 0         coalescing FIRES
--     deal.x || 0                   -> 0         ditto
--     Number(deal.x)                -> 0
--     !deal.x                       -> true
--
-- Note the second group carefully: `??` and `||` DO fire on null, so adding a
-- fallback is not a fix — it is the mechanism that turns "withheld" into a
-- confident zero. A consumer has to know the field was WITHHELD before it
-- coalesces, which no amount of defensive defaulting can tell it.
--
-- Measured consequences on 2026-09-30 (see the sweep in the session log):
--   • the funder scorer skipped its amount-range check entirely, so funders whose
--     box the real ask would FAIL came back on the shortlist with a clean score
--     and no "outside typical range" flag — a wrong answer a human submits from;
--   • QuickAppModal seeded a blank ask and wrote `amount_requested: null` into
--     mca_applications, the row that reaches funders and e-sign;
--   • FunderPicker read a masked ai_lender_recommendations as "never run".
--
-- ── WHY A MARKER AND NOT A SENTINEL VALUE ───────────────────────────────────
--
-- A sentinel (-1, a magic string) is still a VALUE a consumer can forget to
-- check, which is exactly how we got here. `masked_fields` is a marker the
-- consumer must read through a typed accessor (src/lib/maskedDeal.ts) that
-- returns a third state it cannot destructure past — and, because the accessor
-- is a grep-able call site, a bare `deal.amount_requested` becomes lintable for
-- the first time.
--
-- ── TWO INVARIANTS, BOTH LOAD-BEARING ───────────────────────────────────────
--
-- 1. `masked_fields` is derived from `deal_money_keys()` IN THE SAME STATEMENT
--    that does the nulling — the same `unnest(...) k` feeds both the null-agg
--    and the name-agg. It is never a second hand-maintained list. A parallel
--    list is precisely the `isAdmin` / `is_ops_staff` shape that made the
--    RenewalProjectionEditor overwrite "unreachable" by coincidence rather than
--    by design.
--
-- 2. The UNMASKED branch returns `masked_fields: []` explicitly. It must never
--    omit the key, or "no masked_fields property" becomes a third ambiguous
--    state and we have rebuilt the original bug one level up. Absent, empty and
--    populated must mean exactly one thing each — and absent is not a state this
--    function is allowed to produce.
--
-- NAMING A WITHHELD FIELD IS NOT DISCLOSING IT. This returns key NAMES only —
-- never the value, never its magnitude, never a bucket. The set of names is the
-- same for every masked reader and is already public in `deal_money_keys()`.

create or replace function public.deal_row_for_caller(d deals, uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_full jsonb := to_jsonb(d);
  v_out  jsonb;
begin
  if public.is_ops_staff(uid)
     or d.created_by = uid
     or d.assigned_closer_id = uid
     or d.assigned_closer_id = any (public.my_closer_ids(uid))
  then
    -- Nothing withheld — say so explicitly. An absent `masked_fields` would be a
    -- third state, and the whole point of this change is that there are two.
    return v_full || jsonb_build_object('masked_fields', '[]'::jsonb);
  end if;

  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    into v_out
  from jsonb_each(v_full) e
  where e.key = any (public.deal_safe_keys());

  -- ONE statement, ONE source: the nulls and the list of what was nulled are
  -- both aggregated from the same `unnest(deal_money_keys())`, so they cannot
  -- drift apart.
  select v_out
         || coalesce(jsonb_object_agg(k, 'null'::jsonb), '{}'::jsonb)
         || jsonb_build_object('masked_fields', coalesce(jsonb_agg(k order by k), '[]'::jsonb))
    into v_out
  from unnest(public.deal_money_keys()) k;

  return v_out;
end;
$function$;

comment on function public.deal_row_for_caller(deals, uuid) is
  'Deal row shaped for the caller. For a non-privileged staff reader the money columns are nulled AND named in masked_fields, derived from deal_money_keys() in the same statement. Privileged readers get the full row with masked_fields: []. The key is always present: absent is never a valid state. Read through src/lib/maskedDeal.ts — a bare null on one of these keys cannot be distinguished from a real one.';
