-- The read policy tested two ways of being staff. There are three.
--
-- THE GAP, MEASURED. `is_processor(uid)` reads `closers.is_processor` and is
-- INDEPENDENT of the profile role — it does not consult `profiles.role` at all.
-- So "ops staff OR role = 'closer'" is not a superset of "can submit":
--
--   stephaniedecker0611@gmail.com — profiles.role = 'user', and a `closers` row.
--
-- Flip that one boolean and she gets the whole-pipeline processor board while
-- this queue refuses her. She would be sending submissions with every
-- funder-instruction warning invisible — which is precisely the failure this
-- table was built to prevent, reintroduced through a role she does not happen
-- to hold. Verified before the fix, with `is_processor` actually flipped inside
-- a rolled-back transaction so the test was of a real processor and not a
-- hypothetical one: she saw 0 of the 25 rows.
--
-- The other two non-closer `closers` rows are both super_admin and were already
-- covered by is_ops_staff.
--
-- This is the same lesson as the original closer clause, one predicate along:
-- the question is never "what role is this person" but "can this person send a
-- submission". Three independent tests answer yes, so the policy makes three.
-- Found by email-stats-wiring, who hit it on their own table first.
--
-- READS ONLY. Writes stay ops-staff: dismissing a directive is the click that
-- stops it warning anybody, and that authority is not widening here.

drop policy if exists "Ops staff and closers read funder_directives" on public.funder_directives;

create policy "Staff who can submit read funder_directives"
  on public.funder_directives for select
  using (
    (select public.is_ops_staff((select auth.uid())))
    or (select public.is_processor((select auth.uid())))
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'closer'::user_role
    )
  );
