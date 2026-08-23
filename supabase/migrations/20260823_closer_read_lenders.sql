-- Closers get read access to the funder network so the Funder Cheat Sheet
-- (/admin/cheat-sheet) renders for them. Owner request 2026-08-23: "make the
-- funder cheat sheet available to the closers." Route + sidebar were already
-- staff-wide; this was the missing piece (SELECT on lenders was admin/
-- employee/super only, so the page came up empty for role `closer`).
-- Applied to prod via the management API on 2026-08-23.
create policy closer_read_lenders on public.lenders
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'closer'
    )
  );
