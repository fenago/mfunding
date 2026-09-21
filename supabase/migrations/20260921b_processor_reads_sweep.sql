-- PROCESSOR read sweep (2026-09-21) — the rest of what the role needs.
--
-- Found empirically rather than by reading policies: ran identical counts as
-- Kristine (set role authenticated + her sub) and as the service role, and
-- compared. Three tables came back 0 for her where real rows exist.
--
--   customer_interactions        8 rows -> 0   admin_all_interactions only
--   funder_submission_profiles  37 rows -> 0   admin or is_employee only
--   bank_analyses                0 rows -> 0   admin-only ALL; UNDETECTABLE by
--                                              counting (the table is empty
--                                              book-wide), found by reading the
--                                              policy after UnderwritingCard was
--                                              seen calling getBankAnalysisForDeal
--
-- All three are read-only and gated on is_processor() ONLY. Policies are OR'd,
-- so a regular closer matches nothing new and the money wall is untouched.
-- bank_analyses gets SELECT only — the existing admin policy keeps ALL.
--
-- NOT CHANGED, deliberately: activity_log already has
-- processor_select_deal_customer_activity, scoped to entity_type IN
-- ('deal','customer'). She sees 4,285 of 4,517 rows; the 232 missing are lender,
-- vendor and campaign activity — not merchant work, and the scope is correct.
-- That looked like a gap in the count comparison and is not one.
--
-- Verified as her AFTER applying: customer_interactions 8, funder profiles 37,
-- deal_underwriting 125, lender_programs 112, deals 370, customers 364.

create policy "processor_select_customer_interactions"
  on public.customer_interactions
  for select
  to authenticated
  using ( public.is_processor((select auth.uid())) );

create policy "processor_select_funder_profiles"
  on public.funder_submission_profiles
  for select
  to authenticated
  using ( public.is_processor((select auth.uid())) );

create policy "processor_select_bank_analyses"
  on public.bank_analyses
  for select
  to authenticated
  using ( public.is_processor((select auth.uid())) );
