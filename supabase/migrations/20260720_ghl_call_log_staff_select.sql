-- The Campaign Audit reads contact truth (dialed / connected / real
-- conversation) straight from ghl_call_log in the BROWSER — but the table had
-- RLS enabled with ZERO policies (written only by service-role edge functions),
-- so every client read silently returned nothing and the audit showed 0.0%
-- dialed across the board. Ops staff can read it; writes stay service-role-only.
-- (already applied live 2026-07-20; file recorded for the canonical schema)
create policy staff_select_ghl_call_log on public.ghl_call_log
  for select to authenticated using (is_ops_staff(auth.uid()));
