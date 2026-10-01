-- The gate that closed the leak made the view LIE to service-role callers.
--
-- 20261001h gated funder_display_name/funder_current_destination behind
-- funder_lookup_allowed(), which is the funder_directives read predicate. That
-- closed a real leak. It also closes for any caller with no `auth.uid()` — which
-- is every service-role and edge-function read, and the SQL console. Those
-- callers bypass RLS by design and so still get all 25 rows, but now with:
--
--     company_name        NULL
--     current_destination NULL
--
-- and because needs_action compares new_email/retired_email against
-- `coalesce(current_destination, '')`, a REFUSED LOOKUP read as "no address on
-- file" and every comparison fell through to `else true`. The view reported
-- 14 rows needing action where an authenticated processor correctly saw 5.
--
-- That is this project's oldest failure wearing a new hat: an unreadable value
-- rendered as a fact. Not a leak and not silent corruption of stored data, but
-- any cron, report or edge function reading this view would have been told
-- every directive is outstanding, including the superseded Uplyft row naming
-- the dead inbox.
--
-- FIX: the predicate also admits a trusted non-user caller, identified from the
-- JWT CLAIMS and nothing else.
--
-- ⚠️ THE OBVIOUS VERSION OF THIS IS WRONG AND I SHIPPED IT FIRST.
-- `current_user in ('postgres','service_role',…)` inside a SECURITY DEFINER
-- function is the FUNCTION OWNER, not the caller — so it is unconditionally
-- true and the gate stops gating. Measured: with that clause in place, an
-- uncleared `authenticated` caller holding a merchant's sub got
-- 'Uplyft Capital' / 'submissions@uplyftcapital.com' straight back out of the
-- helpers, exactly the leak 20261001h closed. `session_user` is no better here,
-- because `set local role` does not change it.
--
-- So the test is on the claims instead:
--   role = 'service_role'  → an edge function using the service key.
--   no claims at all       → a direct database connection: psql, pg_cron, the
--                            SQL console. Every web request carries claims
--                            (role 'anon' or 'authenticated'), so a merchant
--                            cannot reach this branch.
-- Both already bypass RLS on funder_directives, so this grants nothing new; it
-- stops the decorated columns disagreeing with the rows they decorate.
--
-- Verified both directions after: service-role/console read 25 rows / 5 needing
-- action / 0 unpopulated, matching Kristine and the processor exactly; and an
-- uncleared authenticated caller gets 0 rows and NULL from both helpers.

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
    )
    -- A trusted non-user caller, read from the CLAIMS. Never current_user:
    -- inside SECURITY DEFINER that is the owner and the test is always true.
    or coalesce(
         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
         ''
       ) = 'service_role'
    -- No claims at all = not a web request (psql, pg_cron, the SQL console).
    or nullif(current_setting('request.jwt.claims', true), '') is null;
$$;

comment on function public.funder_lookup_allowed() is
  'The funder-directive read predicate, as a function. Kept deliberately identical to the SELECT policy on funder_directives, plus trusted non-user callers identified from the JWT claims (service_role, or no claims at all) — because a refused lookup returning NULL made needs_action default to true for every row. NEVER test current_user here: inside SECURITY DEFINER it is the owner, so the gate stops gating. Change this and the policy together.';
