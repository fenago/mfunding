-- Staff NAME directory, so setter names resolve for every staff viewer.
--
-- WHY: public.profiles is RLS-locked to "super_admin or self" (policies
-- "Super admins can read all profiles" / "Users can read own profile"). Setter
-- Performance is now a whole-company page (see 20260826c_wavv_calls_staff_read),
-- so a closer/employee session can read the CALLS but not the NAMES of other
-- setters — every teammate renders as "Setter · <id fragment>".
--
-- FIX: expose ONLY (id, name) through a definer-backed directory. No email, no
-- phone, no address, no role — a display name is the least sensitive field on
-- the profile, and every staff member already sees these names on the shared
-- boards. Merchants (role 'user') and anon get ZERO rows.
--
-- Shape: SECURITY DEFINER *function* + a security_invoker VIEW over it. The view
-- is what the frontend and other views select from; the function is where the
-- privilege escalation and the caller gate live. A SECURITY DEFINER view would
-- trip the Supabase `security_definer_view` advisor — this shape does not.

-- ---------------------------------------------------------------------------
-- 1. The definer function: the ONLY thing that reads profiles unfiltered.
-- ---------------------------------------------------------------------------
create or replace function public.staff_directory_list()
returns table (id uuid, name text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    p.id,
    -- Prefer the curated display_name, fall back to first+last. Deliberately
    -- NULL when neither exists: a NULL lets the caller keep its own
    -- disambiguating fallback ("Setter · <id fragment>"), whereas a generic
    -- literal would collapse several nameless staff into one identical label.
    coalesce(
      nullif(btrim(p.display_name), ''),
      nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
    ) as name
  from public.profiles p
  where
    -- WHO IS LISTED: staff only. A merchant profile is never in the directory.
    p.role = any (array['closer','employee','admin','super_admin']::user_role[])
    -- WHO MAY READ: staff only (same OPS set the sidebar/roleAccess use), plus
    -- the service key for server-side callers. Anon has no auth.uid() and no
    -- service claim, so it matches neither branch and gets nothing.
    and (
      coalesce(auth.jwt() ->> 'role', '') = 'service_role'
      or exists (
        select 1
        from public.profiles me
        where me.id = (select auth.uid())
          and me.role = any (array['closer','employee','admin','super_admin']::user_role[])
      )
    );
$$;

comment on function public.staff_directory_list() is
  'Staff name directory (id + display name ONLY). SECURITY DEFINER so staff can '
  'resolve each others'' names without opening public.profiles, which stays '
  'locked to super_admin-or-self. Returns zero rows for merchants and anon. '
  'Read it through the public.staff_directory view.';

revoke all on function public.staff_directory_list() from public;
-- This project runs ALTER DEFAULT PRIVILEGES granting EXECUTE on new functions to
-- anon/authenticated/service_role (pg_default_acl, defaclobjtype 'f'), and that
-- explicit anon=X grant survives `revoke ... from public`. Revoke it by name or
-- the function stays reachable at /rest/v1/rpc/staff_directory_list for anon and
-- the `anon_security_definer_function_executable` advisor fires.
revoke execute on function public.staff_directory_list() from anon;
grant execute on function public.staff_directory_list() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The view the app actually queries.
-- ---------------------------------------------------------------------------
drop view if exists public.staff_directory;

create view public.staff_directory
with (security_invoker = true)
as select d.id, d.name from public.staff_directory_list() d;

comment on view public.staff_directory is
  'Staff-readable name directory: (id uuid, name text). name is NULL when the '
  'profile has neither display_name nor first/last — callers should keep their '
  'own fallback. Exposes NO email/phone/role/address. Empty for merchants and anon.';

-- Default privileges hand anon full rights on every new view in this project, so
-- "don't grant anon" is not enough — it must be revoked by name. Two independent
-- stops for anon now: no SELECT on the view, no EXECUTE on the function.
revoke all on public.staff_directory from anon;
grant select on public.staff_directory to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Repoint the calls view's setter_name at the directory.
--    ZERO frontend change: same 23 columns, same order, same types. Only the
--    SOURCE of setter_name moves (profiles -> staff_directory) so it stops
--    coming back NULL for non-super-admin staff.
--    setter_email deliberately still comes from the RLS-governed profiles join:
--    the page does not use it, and this migration must not widen email access.
-- ---------------------------------------------------------------------------
create or replace view public.v_wavv_outbound_setter_calls
with (security_invoker = true)
as
select
  c.id,
  c.wavv_call_id,
  c.started_at,
  c.answered_at,
  c.ended_at,
  c.seconds,
  c.outcome,
  c.disposition,
  c.human,
  c.recorded,
  c.phone,
  c.contact_id,
  c.contact_name,
  c.campaign_id,
  c.caller_id,
  m.setter_id,
  m.label as caller_label,
  m.source as mapping_source,
  sd.name as setter_name,
  p.email as setter_email,
  m.setter_id is not null as is_attributed,
  c.note,
  c.summary
from public.wavv_calls c
  left join public.wavv_caller_setters m on m.caller_id = c.caller_id
  left join public.staff_directory sd on sd.id = m.setter_id
  left join public.profiles p on p.id = m.setter_id
where c.direction = 'outbound'::text;

comment on view public.v_wavv_outbound_setter_calls is
  'Outbound WAVV calls with setter attribution. security_invoker: the viewer''s '
  'own RLS on wavv_calls governs which rows appear (all staff, per '
  '20260826c_wavv_calls_staff_read). setter_name resolves via '
  'public.staff_directory so it is populated for EVERY staff viewer, not just '
  'super admins. setter_email still follows profiles RLS (self/super_admin only).';

grant select on public.v_wavv_outbound_setter_calls to authenticated;
