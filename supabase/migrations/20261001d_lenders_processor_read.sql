-- ── lenders: the last read in the chain that follows the profile role ───────
--
-- `closer_read_lenders` keys on `profiles.role = 'closer'`. `is_processor()`
-- keys on the `closers` row and is independent of the profile role, so a
-- processor who is not role='closer' reads 38 submissions and 426 deals and
-- ZERO lenders. Measured, in a rolled-back transaction, as the one profile in
-- this project that is role='user' WITH a closers row.
--
-- The two surfaces that break are not equally loud, which is the point:
--
--   * funder_directives_actionable INNER-joins lenders, so the funder-
--     instructions queue renders EMPTY — no error, no explanation, just a page
--     that says there is nothing to do. (funder-instruction-alert found this
--     after adding is_processor to the table itself and watching the view stay
--     at zero.)
--   * FunderChaseTab and FunderResponsesBoard LEFT-join it, so a delivery
--     failure still shows its ⛔ chip and its SMTP reply — those live on
--     deal_submissions — but the funder's NAME degrades to the literal string
--     "Funder" and funding_speed nulls, which silently turns every quoted
--     turnaround into "no quoted turnaround on file". A chase board that cannot
--     name the funder or time the breach.
--
-- A strict no-op today: both processors are role='closer' and already read every
-- lender through closer_read_lenders. This only stops the grant from depending
-- on a second, unrelated field agreeing with the first. READ only — writes stay
-- super-admin.
--
-- Neither this agent nor funder-instruction-alert owns this table; it is
-- widened here because it is the shared dependency of both our surfaces and the
-- same defect class we each just fixed one layer up.
drop policy if exists processor_read_lenders on public.lenders;
create policy processor_read_lenders
  on public.lenders for select
  using ((select public.is_processor((select auth.uid()))));
