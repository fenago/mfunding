-- smart_list_rollup: add 'suppressible' — the UNIQUE member count the suppress
-- action would flag. The per-flag cards (dead / dnc / litigator) can overlap (one
-- member can be dead AND a litigator), so summing them over-counted the suppress
-- button ("Suppress dead & DNC (7)" when only 6 unique members would be removed).

create or replace function public.smart_list_rollup(p_list uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  with m as (
    select
      slm.*,
      (coalesce(nullif(btrim(slm.best_phone), ''),
                nullif(btrim(slm.snapshot->>'phone'), ''),
                nullif(btrim(slm.snapshot->>'phone_number'), ''),
                nullif(btrim(slm.snapshot->>'mobile'), '')) is not null) as has_phone,
      (coalesce(nullif(btrim(slm.best_email), ''),
                nullif(btrim(slm.business_email), ''),
                nullif(btrim(slm.snapshot->>'email'), '')) is not null) as has_email
    from public.smart_list_members slm
    where slm.smart_list_id = p_list
  )
  select jsonb_build_object(
    'total',       count(*),
    'reachable',   count(*) filter (where phone_reachable is true),
    'dead',        count(*) filter (where phone_disconnected is true),
    'dnc',         count(*) filter (where best_phone_dnc is true),
    'litigator',   count(*) filter (where tcpa_litigator is true),
    'no_contact',  count(*) filter (where not has_phone and not has_email),
    'unvalidated', count(*) filter (where phone_validated_at is null),
    'excluded',    count(*) filter (where excluded),
    'suppressible', count(*) filter (
                      where not excluded
                        and (phone_disconnected is true
                          or best_phone_dnc is true
                          or tcpa_litigator is true)
                    ),
    'dialable',    count(*) filter (
                     where not excluded
                       and has_phone
                       and coalesce(phone_disconnected, false) = false
                       and coalesce(best_phone_dnc, false) = false
                       and coalesce(tcpa_litigator, false) = false
                   )
  )
  from m;
$function$;
