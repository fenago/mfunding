-- PH-UCC: admin write policies (additive reconciliation).
--
-- The ph_ucc_* tables shipped with SELECT-only RLS, but the live UCC Machine
-- dashboard (src/pages/admin/PhUccMachinePage.tsx) writes directly with the
-- signed-in admin's JWT via mustWrite:
--   • add / disable / delete funder aliases  → ph_ucc_funder_aliases INSERT/UPDATE/DELETE
--   • suppress / restore a lead              → ph_ucc_leads UPDATE
-- Without write policies those buttons 403 for admins. This adds the missing
-- write policies for admin/super_admin only (service-role bypasses RLS as before).
-- Purely additive: it does NOT touch the existing *_admin_read SELECT policies.

-- funder aliases: admins add / edit / remove dictionary entries from the UI
drop policy if exists ph_ucc_funder_aliases_admin_insert on public.ph_ucc_funder_aliases;
create policy ph_ucc_funder_aliases_admin_insert on public.ph_ucc_funder_aliases
  for insert to authenticated with check (is_admin_or_super(auth.uid()));

drop policy if exists ph_ucc_funder_aliases_admin_update on public.ph_ucc_funder_aliases;
create policy ph_ucc_funder_aliases_admin_update on public.ph_ucc_funder_aliases
  for update to authenticated using (is_admin_or_super(auth.uid())) with check (is_admin_or_super(auth.uid()));

drop policy if exists ph_ucc_funder_aliases_admin_delete on public.ph_ucc_funder_aliases;
create policy ph_ucc_funder_aliases_admin_delete on public.ph_ucc_funder_aliases
  for delete to authenticated using (is_admin_or_super(auth.uid()));

-- leads: admins suppress / restore rows (status flip) from the lead book
drop policy if exists ph_ucc_leads_admin_update on public.ph_ucc_leads;
create policy ph_ucc_leads_admin_update on public.ph_ucc_leads
  for update to authenticated using (is_admin_or_super(auth.uid())) with check (is_admin_or_super(auth.uid()));
