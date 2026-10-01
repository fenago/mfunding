-- The helpers that fixed the view opened a way around `lenders`' RLS.
--
-- 20261001g moved the view's lender name/address lookups into SECURITY DEFINER
-- functions so a processor who cannot read `lenders` would still see her own
-- directive queue instead of a silently empty one. That worked. It also made
-- the functions callable by anyone with an authenticated JWT, because EXECUTE
-- on a SQL function defaults to PUBLIC — and SECURITY DEFINER means they run as
-- the owner regardless of who calls.
--
-- Measured, as a caller with no clearance at all (role 'user', no `closers`
-- row, lenders unreadable, the view returning zero rows):
--
--     select funder_display_name('87237386-…')       -> 'Uplyft Capital'
--     select funder_current_destination('87237386-…') -> 'submissions@uplyftcapital.com'
--
-- Correctly refused by every table and by the view, and still handed a funder's
-- submission address. `lenders` is deliberately closed to role 'user' and there
-- are 316 of those accounts — merchants. UUIDs being unguessable is not an
-- access control.
--
-- A fix for one hole is where the next one gets introduced, so: the helpers now
-- make the SAME check the funder_directives read policy makes, and return NULL
-- to anyone else. EXECUTE cannot be narrowed instead, because the view is
-- security_invoker and so the real caller must hold it — the gate has to live
-- inside the function body.
--
-- The access rule is still written once, in the sense that matters: these
-- functions and the policy answer the same question — "can this person send a
-- submission" — and anyone who changes one must change the other. The comment
-- below says so, because that coupling is invisible from either side alone.

create or replace function public.funder_lookup_allowed()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  -- MUST stay in step with the "Staff who can submit read funder_directives"
  -- policy on public.funder_directives. Three independent tests, because
  -- is_processor() reads closers.is_processor and never consults profiles.role:
  -- a processor on a role='user' profile is a real row in this database.
  select
    public.is_ops_staff((select auth.uid()))
    or public.is_processor((select auth.uid()))
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'closer'::user_role
    );
$$;

comment on function public.funder_lookup_allowed() is
  'The funder-directive read predicate, as a function. Kept deliberately identical to the SELECT policy on funder_directives; change both together.';

create or replace function public.funder_display_name(p_lender_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select l.company_name from public.lenders l
  where l.id = p_lender_id and public.funder_lookup_allowed();
$$;

create or replace function public.funder_current_destination(p_lender_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  -- Resolved the SAME way submit-to-funders resolves it: the active recipe's
  -- to_email first, then the lenders row as the fallback.
  select case when public.funder_lookup_allowed() then coalesce(
    (select f.to_email from public.funder_submission_profiles f
      where f.lender_id = p_lender_id and f.active and f.to_email <> '' limit 1),
    (select l.submission_email from public.lenders l where l.id = p_lender_id)
  ) end;
$$;

comment on function public.funder_display_name(uuid) is
  'Funder name for a directive row. SECURITY DEFINER so the actionable view does not need the caller to hold lenders SELECT, and gated by funder_lookup_allowed() so it is not a way around that policy — it was, until this migration.';
comment on function public.funder_current_destination(uuid) is
  'The address submit-to-funders would actually send to. SECURITY DEFINER and gated by funder_lookup_allowed(), for the same reason as funder_display_name.';
