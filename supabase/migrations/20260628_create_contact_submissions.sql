-- contact_submissions: general intake for Contact page, Opt-in page, and the
-- closer-earnings recruiting calculator. (Applied to remote via MCP on 2026-06-28;
-- this file keeps it in version control. Idempotent.)

create table if not exists public.contact_submissions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  subject text,
  message text,
  status text not null default 'new',
  created_at timestamptz default now()
);

alter table public.contact_submissions enable row level security;

drop policy if exists "Anyone can submit contact submissions" on public.contact_submissions;
create policy "Anyone can submit contact submissions"
  on public.contact_submissions for insert
  to public
  with check (true);

drop policy if exists "Admins can view contact submissions" on public.contact_submissions;
create policy "Admins can view contact submissions"
  on public.contact_submissions for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin','super_admin')
    )
  );
