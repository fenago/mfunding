-- Setter Performance is now a whole-company page (owner request 2026-08-26:
-- "everybody in the company needs to see this page"). The page reads wavv_calls
-- through two security_invoker views, so the viewer's own RLS on wavv_calls
-- governs every row. Previously only admin/super could read it, so closers and
-- other staff saw an empty page. Open SELECT to ALL STAFF roles (the same OPS
-- set the sidebar/roleAccess use: closer, employee, admin, super_admin) — never
-- merchants (role 'user') and never anon. Writes stay service-role only
-- (there is no INSERT/UPDATE/DELETE policy; the sync uses the service key).
drop policy if exists wavv_calls_admin_read on public.wavv_calls;

create policy wavv_calls_staff_read on public.wavv_calls
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('closer','employee','admin','super_admin')
    )
  );
