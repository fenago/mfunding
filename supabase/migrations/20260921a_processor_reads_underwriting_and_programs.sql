-- PROCESSOR can READ an existing AI underwriting result, and the funder programs
-- that drive funder availability (2026-09-21).
--
-- Kristine opened Miami Concierge (MF-2026-0385) — a deal the OWNER had already
-- run underwriting on — and the panel said "No AI underwriting yet. Ask an admin
-- to run underwriting on this deal." The result existed. She could not READ it.
--
--   deal_underwriting SELECT was: is_admin_or_super OR closer_owns_deal
--
-- A processor is role=closer and does not own the deal, so the read returned
-- nothing and the panel rendered that as "not run yet" — an empty read printed
-- as a fact, and one that costs real money: the owner's explicit concern was
-- "I don't want to pay for tokens every time", and a processor who cannot see a
-- completed run has no option but to spend another one.
--
-- Same shape on the funder panel: lender_programs SELECT was is_ops_staff only,
-- so she saw "No live MCA funders with structured requirements yet" where the
-- owner saw 27 fit & ready. `lenders` itself was already readable by closers
-- (closer_read_lenders) — it was the PROGRAMS, which carry the structured
-- criteria, that were ops-only.
--
-- ADDITIVE and gated on is_processor() ONLY. RLS policies are OR'd, so this
-- grants processors these reads WITHOUT loosening anything for a regular closer
-- — is_processor() returns false for them and their existing policies remain the
-- only thing that matches. The money wall is untouched. This follows the same
-- pattern as 20260830z_processor_wholeboard_read.
--
-- No write policy is added here. Underwriting rows are written by the
-- underwrite-deal edge function under the service role, which already permits
-- processors to RUN it (it checks is_processor before the ownership test) —
-- the only thing still blocking the button was a client-side
-- `canRun = isAdmin || isSuperAdmin` in AIUnderwritingPanel.tsx.
--
-- Verified as Kristine (set role authenticated + her sub) AFTER applying:
--   deal_underwriting  125 rows visible (was 0 for deals she doesn't own)
--   lender_programs    112 rows visible (was 0)
--   MF-2026-0385       1 underwriting row visible — the one she was told
--                      did not exist

create policy "processor_select_all_underwriting"
  on public.deal_underwriting
  for select
  to authenticated
  using ( public.is_processor((select auth.uid())) );

create policy "processor_select_lender_programs"
  on public.lender_programs
  for select
  to authenticated
  using ( public.is_processor((select auth.uid())) );
