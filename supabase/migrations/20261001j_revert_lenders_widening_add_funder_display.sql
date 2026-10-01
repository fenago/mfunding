-- ── Take the lenders widening back out, and give the board two columns ─────
--
-- I added `processor_read_lenders` (20261001d) so a processor whose profile role
-- is not 'closer' could see funder names on the chase board. Two things have
-- changed since, and both are reasons to remove it rather than keep it:
--
--   1. HALF MY JUSTIFICATION IS STALE. I measured it as fixing
--      funder_directives_actionable from 0 rows to 25. That view no longer joins
--      `lenders` at all — 20261001g replaced the join with funder_display_name()
--      / funder_current_destination(). Verified by reading the live view
--      definition, not by being told. So the grant now buys nothing there.
--
--   2. THE WHOLE-TABLE GRANT WAS THE WRONG SHAPE ANYWAY. A board that needs two
--      columns should be handed two columns. `lenders` carries submission
--      recipes, commission structures and free-text operational notes; a
--      processor surface wanting a company name is not a reason to hand over the
--      row. The ruling is that a processor surface gets a SECURITY DEFINER
--      helper returning the specific columns it needs, gated identically to the
--      surface's own policy. That is right independently of whether any
--      particular column currently holds a secret.
drop policy if exists processor_read_lenders on public.lenders;

-- ── The two columns, and nothing else ──────────────────────────────────────
--
-- A view, not a per-row function: FunderChaseTab reads EVERY submission in one
-- query, so a scalar helper per row would be one round trip per submission.
--
-- It bypasses RLS on `lenders` deliberately and correctly: a view runs as its
-- OWNER unless created with security_invoker, which is exactly the
-- SECURITY DEFINER property the ruling asks for. The gate is the WHERE clause,
-- and it is funder_lookup_allowed() — the SAME predicate the funder_directives
-- read policy uses, so these two surfaces can never disagree about who may see
-- a funder's name.
--
-- WHY company_name AND funding_speed, and nothing more: the board renders the
-- funder's name on each row and derives the chase clock's breach threshold from
-- the quoted turnaround. Those are the two. Contact details, recipes and notes
-- are NOT here; the disclosure block that wants them reads `lenders` directly
-- and will simply not render for a caller who cannot read that table, which is
-- the pre-existing behaviour and not something this view should paper over.
create or replace view public.funder_display as
  select l.id, l.company_name, l.funding_speed
  from public.lenders l
  where public.funder_lookup_allowed();

comment on view public.funder_display is
  'Two columns of public.lenders (company_name, funding_speed) for processor/closer '
  'surfaces, gated by funder_lookup_allowed() — the same predicate as the '
  'funder_directives read policy. Runs as owner (NOT security_invoker), so it is the '
  'SECURITY DEFINER path that replaces widening RLS on lenders itself. A MISSING row '
  'for a lender_id means UNREADABLE, which callers must render differently from a '
  'present row whose funding_speed is null.';

-- GRANTED DELIBERATELY, AND NOT TO anon.
--
-- A new view starts with no grants, so this is what makes it reachable at all.
-- `authenticated` includes all 316 merchant accounts — they are stopped by the
-- WHERE gate, not by the grant, so the gate is load-bearing and is tested.
revoke all on public.funder_display from public;
grant select on public.funder_display to authenticated, service_role;
