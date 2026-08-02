-- Converge ph_ucc_funder_aliases on ONE canonical admin write policy.
--
-- Background / race: I shipped separate INSERT/UPDATE/DELETE admin policies in
-- c13450c to unblock the dashboard's alias writes. ph-ucc-machine's
-- 20260802_ph_ucc_05_frontend_reconcile.sql then added a single FOR ALL policy
-- `ph_ucc_funder_aliases_admin_write` that supersedes all three. When we each went
-- to de-duplicate, we raced: they dropped their _admin_write (assuming mine
-- covered it) at the same time I dropped mine (assuming theirs covered it) — and
-- the table was briefly left with NO write policy (dashboard alias writes 403).
--
-- This migration is the idempotent convergence point: drop my three redundant
-- policies AND (re)create the single canonical `ph_ucc_funder_aliases_admin_write`
-- (is_admin_or_super, with check) that ph-ucc-machine's reconcile defines. Running
-- this and/or their reconcile in any order yields exactly one write policy.
-- (ph_ucc_leads_admin_update converged on its own — same name in both files.)

drop policy if exists ph_ucc_funder_aliases_admin_insert on public.ph_ucc_funder_aliases;
drop policy if exists ph_ucc_funder_aliases_admin_update on public.ph_ucc_funder_aliases;
drop policy if exists ph_ucc_funder_aliases_admin_delete on public.ph_ucc_funder_aliases;

drop policy if exists ph_ucc_funder_aliases_admin_write on public.ph_ucc_funder_aliases;
create policy ph_ucc_funder_aliases_admin_write on public.ph_ucc_funder_aliases
  for all to authenticated
  using (is_admin_or_super(auth.uid()))
  with check (is_admin_or_super(auth.uid()));
