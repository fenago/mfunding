-- Harden deals / deal_submissions RLS.
-- The 001 migration created permissive "authenticated can view/insert/update" policies,
-- but merchants log into the customer portal as authenticated users too — so those
-- policies would let any merchant read/modify ALL deals via the API. Restrict
-- management to admin/super_admin, and let customers see only their own deals.

DROP POLICY IF EXISTS "Authenticated users can view deals" ON deals;
DROP POLICY IF EXISTS "Authenticated users can insert deals" ON deals;
DROP POLICY IF EXISTS "Authenticated users can update deals" ON deals;

CREATE POLICY "Admins manage deals" ON deals FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin')));

CREATE POLICY "Customers view own deals" ON deals FOR SELECT TO authenticated
  USING (customer_id IN (SELECT id FROM customers WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can view deal_submissions" ON deal_submissions;
DROP POLICY IF EXISTS "Authenticated users can insert deal_submissions" ON deal_submissions;
DROP POLICY IF EXISTS "Authenticated users can update deal_submissions" ON deal_submissions;

CREATE POLICY "Admins manage deal_submissions" ON deal_submissions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin')));

-- Make analytics views run with the querying user's RLS (not the definer's),
-- clearing the security_definer_view advisor ERROR. Idempotent.
ALTER VIEW v_cost_per_funded_deal  SET (security_invoker = true);
ALTER VIEW v_pipeline_velocity     SET (security_invoker = true);
ALTER VIEW v_closer_performance    SET (security_invoker = true);
ALTER VIEW v_lender_approval_rates SET (security_invoker = true);
ALTER VIEW v_monthly_revenue       SET (security_invoker = true);
ALTER VIEW v_market_performance    SET (security_invoker = true);

-- Pin search_path on the Phase-1 trigger functions (clears function_search_path_mutable).
ALTER FUNCTION generate_deal_number()          SET search_path = public;
ALTER FUNCTION update_deals_updated_at()        SET search_path = public;
ALTER FUNCTION update_updated_at_column()        SET search_path = public;
ALTER FUNCTION update_lead_sources_updated_at()  SET search_path = public;
