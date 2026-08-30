-- Data Hygiene — per-list capability counts for the enrichment action cards.
--
-- Every source now offers all four providers, but each provider only PRODUCES
-- results where the list holds the input it needs:
--   • BatchData skip-trace  → a mailing ADDRESS (name+address → phones/emails)
--   • Apollo enrich         → a company name OR an email
--   • Twilio / RealValidation phone-validate → a phone number
-- The action cards grey a provider out (before you spend a click) when the list
-- has nothing for it to work on. Member rows keep only a `snapshot` (no street),
-- so address availability must be read from each member's SOURCE row.
--
-- Returns one jsonb: { total, with_phone, with_company_or_email, with_address,
-- ghl_members }. `with_address` covers only the three Supabase source books;
-- VibeReach (source='ghl') address availability is unknown without a GHL call,
-- so those members are reported separately as `ghl_members` and the UI leaves
-- skip-trace enabled when any exist (the edge fn skips no-address members at no
-- charge). Cheap: counts over one list's membership, not the whole book.

create or replace function public.smart_list_capability_counts(p_list_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_total bigint;
  v_phone bigint;
  v_biz   bigint;
  v_ghl   bigint;
  v_addr  bigint;
begin
  -- Staff gate — mirror smart_list_source (admin/super_admin only).
  if not exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin', 'super_admin')
  ) then
    raise exception 'forbidden: admin only';
  end if;

  select count(*) into v_total
    from public.smart_list_members where smart_list_id = p_list_id;

  -- Phone present: snapshot phone OR a resolved best_phone from enrichment.
  select count(*) into v_phone
    from public.smart_list_members m
   where m.smart_list_id = p_list_id
     and coalesce(nullif(m.snapshot->>'phone', ''), m.best_phone) is not null;

  -- Apollo-capable: a company name OR an email (snapshot or enriched).
  select count(*) into v_biz
    from public.smart_list_members m
   where m.smart_list_id = p_list_id
     and (
          nullif(m.snapshot->>'business', '') is not null
       or coalesce(nullif(m.snapshot->>'email', ''), m.best_email, m.business_email) is not null
       or nullif(m.company, '') is not null
     );

  select count(*) into v_ghl
    from public.smart_list_members
   where smart_list_id = p_list_id and source = 'ghl';

  -- Members with a street address on their SOURCE row. Each subselect narrows to
  -- one db source FIRST so source_id (uuid text) is always safely castable — the
  -- ghl source (non-uuid contact ids) is never reached by these casts.
  select
      coalesce((
        select count(*) from (
          select source_id from public.smart_list_members
           where smart_list_id = p_list_id and source = 'ph_ucc'
        ) m join public.ph_ucc_leads s on s.id = m.source_id::uuid
        where nullif(btrim(s.debtor_address), '') is not null
      ), 0)
    + coalesce((
        select count(*) from (
          select source_id from public.smart_list_members
           where smart_list_id = p_list_id and source = 'lead_records'
        ) m join public.lead_records s on s.id = m.source_id::uuid
        where nullif(btrim(s.address), '') is not null
      ), 0)
    + coalesce((
        select count(*) from (
          select source_id from public.smart_list_members
           where smart_list_id = p_list_id and source = 'customers'
        ) m join public.customers s on s.id = m.source_id::uuid
        where nullif(btrim(s.address_street), '') is not null
      ), 0)
  into v_addr;

  return jsonb_build_object(
    'total', coalesce(v_total, 0),
    'with_phone', coalesce(v_phone, 0),
    'with_company_or_email', coalesce(v_biz, 0),
    'with_address', coalesce(v_addr, 0),
    'ghl_members', coalesce(v_ghl, 0)
  );
end;
$fn$;

grant execute on function public.smart_list_capability_counts(uuid) to authenticated, service_role;
