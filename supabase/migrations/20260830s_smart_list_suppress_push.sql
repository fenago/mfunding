-- Data Hygiene — final wave: RESULTS ROLLUP + SUPPRESS (don't-call) + PUSH TO SETTERS.
--
-- Adds the "take action on a cleaned list" layer on top of the enrichment columns
-- that already live on smart_list_members (phone_reachable / phone_disconnected /
-- best_phone_dnc / tcpa_litigator / best_phone / …). Three schema changes plus two
-- read-model RPCs that are the SINGLE source of truth for the dialability predicate,
-- so the rollup card, the suppress action and the setter push all agree on what
-- "dialable" means (defined once, in SQL, below).
--
-- 1) smart_list_members.excluded / excluded_reason / excluded_at
--       the "don't dial these" flag the Suppress action sets (reversible).
-- 2) smart_lists.dial_tag / pushed_to_setters_at / pushed_count
--       stamped by the setter push so the list card shows what was handed off.
-- 3) smart_list_rollup(list)      → jsonb of the results counts.
--    smart_list_dialable(list)    → the dialable members with a RESOLVED GHL
--                                    contact id (source='ghl' → source_id itself;
--                                    the uuid sources → their row's ghl_contact_id).
--
-- All adds are `if not exists` / `create or replace` — safe to re-run.
-- Edge fn: supabase/functions/smart-list-action. Service-role only (bypasses RLS),
-- so the RPCs are granted to service_role.

-- ── 1. smart_list_members — the exclusion (don't-dial) flag ──────────────────────
alter table public.smart_list_members
  add column if not exists excluded        boolean not null default false,
  add column if not exists excluded_reason text,     -- 'disconnected' | 'dnc' | 'litigator' | 'manual'
  add column if not exists excluded_at     timestamptz;

comment on column public.smart_list_members.excluded is
  'When true the member is removed from the dialable set (Suppress action). Reversible via smart-list-action unsuppress.';
comment on column public.smart_list_members.excluded_reason is
  'Why the member was excluded: disconnected | dnc | litigator (system, set by Suppress) or manual.';

create index if not exists smart_list_members_excluded_idx
  on public.smart_list_members (smart_list_id, excluded);

-- ── 2. smart_lists — setter-handoff stamps ───────────────────────────────────────
alter table public.smart_lists
  add column if not exists dial_tag            text,        -- the GHL tag pushed to setters
  add column if not exists pushed_to_setters_at timestamptz,
  add column if not exists pushed_count        int;         -- contacts tagged on the last push

comment on column public.smart_lists.dial_tag is
  'GHL tag the dialable members were tagged with for the setters (point a VibeReach campaign at it).';

-- ── 3a. Results rollup ────────────────────────────────────────────────────────────
-- One pass over the list's members. The DIALABLE predicate lives HERE and in
-- smart_list_dialable() below — keep the two identical.
--   dialable = not excluded AND a phone is present AND not dead AND not dnc AND not litigator.
create or replace function public.smart_list_rollup(p_list uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  with m as (
    select
      slm.*,
      -- phone present: best_phone (skip-trace) OR a snapshot phone field
      (coalesce(nullif(btrim(slm.best_phone), ''),
                nullif(btrim(slm.snapshot->>'phone'), ''),
                nullif(btrim(slm.snapshot->>'phone_number'), ''),
                nullif(btrim(slm.snapshot->>'mobile'), '')) is not null) as has_phone,
      -- email present: best_email / business_email (enrichment) OR the snapshot email
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
    'dialable',    count(*) filter (
                     where not excluded
                       and has_phone
                       and coalesce(phone_disconnected, false) = false
                       and coalesce(best_phone_dnc, false) = false
                       and coalesce(tcpa_litigator, false) = false
                   )
  )
  from m;
$fn$;

revoke execute on function public.smart_list_rollup(uuid) from public, anon;
grant execute on function public.smart_list_rollup(uuid) to service_role;

comment on function public.smart_list_rollup(uuid) is
  'Data Hygiene results rollup for one smart_list: total/reachable/dead/dnc/litigator/no_contact/unvalidated/excluded/dialable. Single source of the dialable predicate (mirrored in smart_list_dialable).';

-- ── 3b. Dialable members with a RESOLVED GHL contact id ──────────────────────────
-- Same DIALABLE predicate as smart_list_rollup. Resolves the GHL contact id so the
-- push knows who can be tagged (has an id) vs who still needs a Lead-Machine push
-- (ghl_contact_id is null). source='ghl' stores the contact id directly in source_id;
-- the uuid sources are joined by their id::text (source_id is text, and a GHL id is
-- NOT a uuid, so we compare on the uuid side cast to text).
create or replace function public.smart_list_dialable(p_list uuid)
returns table (
  member_id      uuid,
  source         text,
  source_id      text,
  ghl_contact_id text
)
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select
    slm.id,
    slm.source,
    slm.source_id,
    case slm.source
      when 'ghl'          then slm.source_id
      when 'ph_ucc'       then u.ghl_contact_id
      when 'lead_records' then l.ghl_contact_id
      when 'customers'    then c.ghl_contact_id
    end as ghl_contact_id
  from public.smart_list_members slm
  left join public.ph_ucc_leads u on slm.source = 'ph_ucc'       and u.id::text = slm.source_id
  left join public.lead_records l on slm.source = 'lead_records' and l.id::text = slm.source_id
  left join public.customers    c on slm.source = 'customers'    and c.id::text = slm.source_id
  where slm.smart_list_id = p_list
    and not slm.excluded
    and coalesce(nullif(btrim(slm.best_phone), ''),
                 nullif(btrim(slm.snapshot->>'phone'), ''),
                 nullif(btrim(slm.snapshot->>'phone_number'), ''),
                 nullif(btrim(slm.snapshot->>'mobile'), '')) is not null
    and coalesce(slm.phone_disconnected, false) = false
    and coalesce(slm.best_phone_dnc, false) = false
    and coalesce(slm.tcpa_litigator, false) = false;
$fn$;

revoke execute on function public.smart_list_dialable(uuid) from public, anon;
grant execute on function public.smart_list_dialable(uuid) to service_role;

comment on function public.smart_list_dialable(uuid) is
  'Dialable members of a smart_list (same predicate as smart_list_rollup) with the GHL contact id resolved per source. ghl_contact_id null = member not in GHL yet (needs a Lead-Machine push).';
