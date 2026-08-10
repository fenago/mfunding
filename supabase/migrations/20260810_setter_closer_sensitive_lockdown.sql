-- Setter (role = closer) sensitive-data lockdown.
--
-- Setters run the Revenue Playbook early-pipeline flow (fill app, send 04B, Plaid,
-- docs) on deals they own or claim. They must NOT be able to read funder rates /
-- criteria / recipes. A pre-existing closer RLS scaffold (never used in prod — no
-- closer accounts exist yet) had granted closers SELECT on these funder-intel
-- tables. This migration REVOKES those grants while leaving admin / super_admin /
-- employee access completely untouched.
--
-- Tables that already deny closers (verified, unchanged here): marketing_vendors,
-- lead_sources, commissions (admin/super + own-closer only), ghl_webhook_events,
-- campaigns manage. compliance_disclosures (public active templates, shown on
-- merchant-facing pages) and platform_settings (broadly-read app config the
-- Playbook itself needs: company_voice, plaid) are intentionally left readable —
-- see the report; they hold no funder economics or payout data.

-- 1) lenders: remove the closer SELECT grant. Admin/employee/super_admin keep theirs.
DROP POLICY IF EXISTS closer_read_lenders ON public.lenders;

-- 2) funder_submission_profiles (submission recipes / stips / to_email): remove the
--    closer SELECT grant. admin_manage + employee_read remain.
DROP POLICY IF EXISTS closer_read_funder_profiles ON public.funder_submission_profiles;

-- 3) lender_programs (per-lender MCA criteria/economics): the old lp_read granted
--    SELECT to EVERY authenticated user (qual = true), which included closers AND
--    merchants (role user). Replace it with an ops-staff-only read (admin, super_admin,
--    employee via is_ops_staff) so closers and merchants are both denied. Admin
--    INSERT/UPDATE/DELETE policies (lp_ins/lp_upd/lp_del) are untouched.
DROP POLICY IF EXISTS lp_read ON public.lender_programs;
CREATE POLICY lp_read ON public.lender_programs
  FOR SELECT TO authenticated
  USING (public.is_ops_staff((select auth.uid())));
