-- Campaign Audit needs to read e-sign completions per campaign from the client
-- (admin-only page). ghl_doc_completions had RLS enabled but ZERO policies, so it
-- was service-role-only. Grant ops staff SELECT so the audit can count completions.
-- Write path stays edge-function/service-role only (no insert/update/delete policy).
create policy admin_select_ghl_doc_completions
  on public.ghl_doc_completions
  for select
  using (is_ops_staff(auth.uid()));
