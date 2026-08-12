-- Closer (setter) merchant SEARCH: widen READ to ALL merchant rows.
--
-- Why: a setter on an inbound or dialed call has to be able to pull up whoever is
-- on the phone. The previous closer read policies scoped them to their own book
-- (created_by / assigned_closer_id / closers.user_id) plus unassigned deals, so a
-- merchant already worked by another setter was invisible and un-openable — the
-- playbook search returned nothing and the call died.
--
-- Scope of this change: SELECT only, and only on the two merchant tables the
-- setter search surfaces actually query (PlaybookCapture -> customers,
-- MyDayQueue / DealList / Calendar -> deals + customers). INSERT and UPDATE stay
-- own-book: closer_insert_deals, closer_update_own_deals,
-- closer_claim_unassigned_deals, closer_insert_customers,
-- closer_update_own_customers are all untouched. A setter can now FIND any
-- merchant, but still can only EDIT the ones they own or claim.
--
-- NOT touched (the 20260810_setter_closer_sensitive_lockdown.sql boundary holds):
-- lenders, funder_submission_profiles, lender_programs, commissions,
-- marketing_vendors, lead_sources. Setters still cannot see funder economics,
-- criteria, recipes, or payouts.
--
-- Also NOT widened (deliberate): activity_log and customer_documents remain
-- own-book. activity_log carries the funder correspondence markers
-- ('funder:sent — <LenderName>', 'ghl:funder-reply — <LenderName>'), so opening
-- it to all rows would leak the funder network through the back door — exactly
-- what the lockdown migration closed.

-- ---------------------------------------------------------------------------
-- deals
-- ---------------------------------------------------------------------------
-- The three policies below are strict subsets of the new one (each required
-- is_closer/has_closer_row AND an ownership or unassigned qualifier), so they are
-- dropped rather than left to be OR'd redundantly on every row scan.
DROP POLICY IF EXISTS closer_select_own_deals ON public.deals;
DROP POLICY IF EXISTS closer_row_select_own_deals ON public.deals;
DROP POLICY IF EXISTS closer_select_unassigned_deals ON public.deals;

CREATE POLICY closer_select_all_deals ON public.deals
  FOR SELECT TO authenticated
  USING (
    public.is_closer((select auth.uid()))
    OR public.has_closer_row((select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS closer_select_own_customers ON public.customers;
DROP POLICY IF EXISTS closer_row_select_own_customers ON public.customers;

CREATE POLICY closer_select_all_customers ON public.customers
  FOR SELECT TO authenticated
  USING (
    public.is_closer((select auth.uid()))
    OR public.has_closer_row((select auth.uid()))
  );
