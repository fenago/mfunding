-- ph_ucc_20: performance fix for ph_ucc_match_secured_parties (norm once per party).
-- =============================================================================
-- WHY: the ph_ucc_18 form put public.ph_ucc_norm(p.party) / ph_ucc_norm_full(p.party)
-- INSIDE the two EXISTS subqueries, so each is re-evaluated once PER alias row.
-- After the roster merge grew the dictionary to ~675 aliases, a 2000-party CT
-- ingest slice costs O(parties × 675) regexp_replace calls and blows the
-- statement_timeout ("canceling statement due to statement timeout").
--
-- FIX: normalize each party ONCE in a MATERIALIZED CTE, then test the cached
-- values against the aliases. Result set is IDENTICAL — same token predicate,
-- same exact predicate, same depository guard — only the norm calls are hoisted
-- out of the per-alias loop (O(parties) regexp calls instead of O(parties×aliases)).
-- MATERIALIZED forces the norm to be computed once (not re-inlined at each p.n use).
-- =============================================================================
create or replace function public.ph_ucc_match_secured_parties(p_parties text[])
returns setof text
language sql
stable
security definer
set search_path = public
as $function$
  with p as materialized (
    select party,
           public.ph_ucc_norm(party)      as n,
           public.ph_ucc_norm_full(party) as nf
    from unnest(p_parties) as party
  )
  select p.party
  from p
  where not public.ph_ucc_is_depository(p.n)
    and (
      exists (
        select 1
        from public.ph_ucc_funder_aliases a
        where a.active
          and a.match_mode = 'token'
          and length(a.alias_norm) >= 3
          and p.n like '%' || a.alias_norm || '%'
          and (' ' || p.n || ' ') like ('%' || ' ' || a.alias_norm || ' ' || '%')
      )
      or exists (
        select 1
        from public.ph_ucc_funder_aliases a
        where a.active
          and a.match_mode = 'exact'
          and a.alias_full_norm <> ''
          and p.nf = a.alias_full_norm
      )
    );
$function$;

grant execute on function public.ph_ucc_match_secured_parties(text[]) to service_role;
