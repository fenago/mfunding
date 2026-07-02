-- Employee role: helper functions, Task Board assignee RPC, and RLS grants.
-- Applied to project ehibjeonqpqskhcvizow via the Supabase MCP tool.
--
-- Access model: an 'employee' gets the same app access as 'admin' EXCEPT the
-- super-admin-only screens. At the DB layer we are conservative — employees get
-- full access only to the operational tables a closer needs, read-only on the
-- funder network, and Task-Board access scoped to their own assigned cards.

-- Helper: employee counts as operational staff alongside admin/super_admin.
create or replace function public.is_ops_staff(uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.profiles
    where id = uid and role = any (array['admin','super_admin','employee']::user_role[])
  );
$$;

create or replace function public.is_employee(uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.profiles where id = uid and role = 'employee');
$$;

-- Assignable users for the Task Board card-assignment dropdown.
-- SECURITY DEFINER so any staff member can enumerate assignable teammates
-- without broadening the restrictive profiles SELECT policy. Returns only
-- id/name/role (no sensitive columns) for admin/super_admin/employee profiles
-- plus anyone with a closers row.
create or replace function public.list_assignable_users()
returns table (id uuid, name text, role user_role)
language sql stable security definer set search_path to 'public' as $$
  select p.id,
         coalesce(nullif(btrim(p.display_name), ''),
                  nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
                  nullif(split_part(coalesce(p.email, ''), '@', 1), ''),
                  'Unnamed') as name,
         p.role
  from public.profiles p
  where exists (
    select 1 from public.profiles me
    where me.id = auth.uid()
      and me.role = any (array['closer','admin','super_admin','employee']::user_role[])
  )
  and (
    p.role = any (array['admin','super_admin','employee']::user_role[])
    or exists (select 1 from public.closers c where c.user_id = p.id)
  )
  order by name;
$$;

grant execute on function public.list_assignable_users() to authenticated;

-- === Operational tables: employee gets the same access as admin ===
alter policy "admin_all_customers" on public.customers
  using (public.is_ops_staff(auth.uid())) with check (public.is_ops_staff(auth.uid()));

alter policy "admin_all_customer_docs" on public.customer_documents
  using (public.is_ops_staff(auth.uid())) with check (public.is_ops_staff(auth.uid()));

alter policy "Admins manage deals" on public.deals
  using (public.is_ops_staff(auth.uid())) with check (public.is_ops_staff(auth.uid()));

alter policy "Admins manage deal_submissions" on public.deal_submissions
  using (public.is_ops_staff(auth.uid())) with check (public.is_ops_staff(auth.uid()));

alter policy "Admins can insert activity_log" on public.activity_log
  with check (public.is_ops_staff(auth.uid()));
alter policy "Admins can view activity_log" on public.activity_log
  using (public.is_ops_staff(auth.uid()));
alter policy "Admins can update activity_log" on public.activity_log
  using (public.is_ops_staff(auth.uid()));

-- === Read-only grants for employee ===
create policy "employee_read_lenders" on public.lenders
  for select using (public.is_employee(auth.uid()));

create policy "employee_read_funder_profiles" on public.funder_submission_profiles
  for select using (public.is_employee(auth.uid()));

-- === Task Board (kanban) ===
-- All staff (admin/super/employee/closer) may read all cards.
alter policy "Admins can view all tasks" on public.kanban_tasks
  using (public.is_ops_staff(auth.uid()) or public.is_closer(auth.uid()));

-- Employees/closers may update a card assigned to them (status/assignee/etc).
-- Admin/super_admin keep full update via "Admins can update tasks".
create policy "Assignees can update own tasks" on public.kanban_tasks
  for update
  using (
    assigned_to = (select auth.uid())
    and (public.is_employee(auth.uid()) or public.is_closer(auth.uid()))
  )
  with check (public.is_employee(auth.uid()) or public.is_closer(auth.uid()));

-- Task comments/activity: all staff can read + write so the board works for them.
alter policy "Admins can view comments" on public.task_comments
  using (public.is_ops_staff(auth.uid()) or public.is_closer(auth.uid()));
alter policy "Admins can insert comments" on public.task_comments
  with check (public.is_ops_staff(auth.uid()) or public.is_closer(auth.uid()));
alter policy "Admins can view activity" on public.task_activity
  using (public.is_ops_staff(auth.uid()) or public.is_closer(auth.uid()));
alter policy "Admins can insert activity" on public.task_activity
  with check (public.is_ops_staff(auth.uid()) or public.is_closer(auth.uid()));
