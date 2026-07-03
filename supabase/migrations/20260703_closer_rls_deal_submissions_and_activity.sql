-- CLOSER-ROLE RLS AUDIT FIXES (2026-07-03)
-- is_ops_staff = admin/super_admin/employee ONLY (closers excluded), so several
-- closer browser writes silently no-op'd (RLS denies → 0 rows, no error). Grant
-- closers write access to their OWN deals' data via the same closer_owns_deal()
-- helper used by the read policies. Applied hot; recorded here for version control.

-- 1. deal_submissions: closers could READ their Step 7 board but not WRITE it, so
--    Log offer / Funder declined / Mark accepted / Merchant declined / Reopen
--    (all updateSubmission) silently did nothing.
drop policy if exists closer_update_own_submissions on public.deal_submissions;
create policy closer_update_own_submissions on public.deal_submissions
  for update to authenticated
  using (is_closer((select auth.uid())) and closer_owns_deal((select auth.uid()), deal_id))
  with check (is_closer((select auth.uid())) and closer_owns_deal((select auth.uid()), deal_id));

drop policy if exists closer_insert_own_submissions on public.deal_submissions;
create policy closer_insert_own_submissions on public.deal_submissions
  for insert to authenticated
  with check (is_closer((select auth.uid())) and closer_owns_deal((select auth.uid()), deal_id));

-- 2. activity_log: the closer insert policy only allowed entity_type='customer',
--    but the Step 7 board and picker log deal-scoped events (entity_type='deal'),
--    so closer-generated deal activity silently failed.
drop policy if exists closer_insert_own_deal_activity on public.activity_log;
create policy closer_insert_own_deal_activity on public.activity_log
  for insert to authenticated
  with check (
    is_closer((select auth.uid()))
    and entity_type = 'deal'
    and closer_owns_deal((select auth.uid()), entity_id)
  );

-- 3. Ownership robustness: created_by had no default, so a closer-created lead
--    was only "owned" if assigned_closer_id happened to be set to them. Stamp the
--    creator automatically (service-role edge inserts get NULL, which is fine).
alter table public.customers alter column created_by set default auth.uid();
alter table public.deals     alter column created_by set default auth.uid();
