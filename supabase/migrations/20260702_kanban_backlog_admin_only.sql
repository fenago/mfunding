-- Task Board: the Backlog column is admin/super_admin only.
-- Applied to project ehibjeonqpqskhcvizow via the Supabase MCP tool.
--
-- Employees and closers must not see backlog cards nor move a card into backlog.
-- (They already cannot INSERT tasks at all — that stays admin/super only.)

-- SELECT: admin/super see everything; employee/closer see all non-backlog cards.
alter policy "Admins can view all tasks" on public.kanban_tasks
  using (
    public.is_admin_or_super(auth.uid())
    or (
      (public.is_employee(auth.uid()) or public.is_closer(auth.uid()))
      and status <> 'backlog'
    )
  );

-- UPDATE (assignee path): employee/closer may update their own card, but never
-- act on a backlog card nor move a card into backlog.
alter policy "Assignees can update own tasks" on public.kanban_tasks
  using (
    assigned_to = (select auth.uid())
    and (public.is_employee(auth.uid()) or public.is_closer(auth.uid()))
    and status <> 'backlog'
  )
  with check (
    (public.is_employee(auth.uid()) or public.is_closer(auth.uid()))
    and status <> 'backlog'
  );
