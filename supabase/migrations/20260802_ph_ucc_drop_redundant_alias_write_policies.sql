-- Single owner of PH-UCC staff write policies (aliases + leads).
--
-- History / race: I first shipped granular INSERT/UPDATE/DELETE alias policies +
-- a leads UPDATE policy in c13450c. ph-ucc-machine's frontend-reconcile (05) added
-- an overlapping FOR ALL alias policy. De-duplicating, we raced twice and briefly
-- left ph_ucc_funder_aliases with no write policy. This migration is the agreed
-- convergence point and the SINGLE owner of ph_ucc write policies:
--   • ph_ucc_funder_aliases: ONE FOR ALL policy `ph_ucc_funder_aliases_admin_write`
--   • ph_ucc_leads:          `ph_ucc_leads_admin_update`
-- Both is_admin_or_super, with check. Migration 05 defensively drops the stray
-- overlapping alias policy and defers here; this file runs after 05 (filename sorts
-- later), so the end state is exactly one write policy per table on any full replay.
-- The superseded c13450c create-file was deleted, so nothing else creates these.
-- Idempotent (drop-if-exists + create) — safe to re-run.

-- ph_ucc_funder_aliases — one canonical FOR ALL write policy (drop the old granular
-- trio if a prior apply left them behind).
drop policy if exists ph_ucc_funder_aliases_admin_insert on public.ph_ucc_funder_aliases;
drop policy if exists ph_ucc_funder_aliases_admin_update on public.ph_ucc_funder_aliases;
drop policy if exists ph_ucc_funder_aliases_admin_delete on public.ph_ucc_funder_aliases;

drop policy if exists ph_ucc_funder_aliases_admin_write on public.ph_ucc_funder_aliases;
create policy ph_ucc_funder_aliases_admin_write on public.ph_ucc_funder_aliases
  for all to authenticated
  using (is_admin_or_super(auth.uid()))
  with check (is_admin_or_super(auth.uid()));

-- ph_ucc_leads — admins suppress/restore (status flip). Owned here now that the
-- c13450c file that used to create it is gone; without this a fresh replay would
-- leave the lead book un-suppressable. (INSERT stays service-role only — the
-- matcher writes leads.)
drop policy if exists ph_ucc_leads_admin_update on public.ph_ucc_leads;
create policy ph_ucc_leads_admin_update on public.ph_ucc_leads
  for update to authenticated
  using (is_admin_or_super(auth.uid()))
  with check (is_admin_or_super(auth.uid()));
