-- Time tracking v2 (owner request 2026-08-23): clock in/out + lunch/breaks so
-- hours can be derived from real shift times, and a tamper-proof edit-history
-- trail so a hours-changed-after-the-fact edit (e.g. logged 2h, bumped to 4h
-- four days later) is always visible to the owner.
-- Applied to prod via the management API on 2026-08-23.

alter table public.time_entries
  add column if not exists clock_in timestamptz,
  add column if not exists clock_out timestamptz,
  add column if not exists break_minutes numeric(6,2) not null default 0 check (break_minutes >= 0);

-- Audit log: one row per change, written ONLY by the SECURITY DEFINER trigger
-- below, so no client can insert, alter, or skip it. changed_by is whoever was
-- authenticated when the change landed.
create table if not exists public.time_entry_audit (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid,
  user_id uuid not null,
  work_date date not null,
  action text not null check (action in ('insert','update','delete')),
  old_hours numeric(5,2), new_hours numeric(5,2),
  old_clock_in timestamptz, new_clock_in timestamptz,
  old_clock_out timestamptz, new_clock_out timestamptz,
  old_break_minutes numeric(6,2), new_break_minutes numeric(6,2),
  old_note text, new_note text,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index if not exists time_entry_audit_user_idx on public.time_entry_audit (user_id, changed_at desc);
create index if not exists time_entry_audit_entry_idx on public.time_entry_audit (time_entry_id, changed_at desc);

create or replace function public.log_time_entry_change()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'INSERT' then
    insert into public.time_entry_audit(time_entry_id,user_id,work_date,action,
      new_hours,new_clock_in,new_clock_out,new_break_minutes,new_note,changed_by)
    values (new.id,new.user_id,new.work_date,'insert',
      new.hours,new.clock_in,new.clock_out,new.break_minutes,new.note,auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    if new.hours is distinct from old.hours
       or new.clock_in is distinct from old.clock_in
       or new.clock_out is distinct from old.clock_out
       or new.break_minutes is distinct from old.break_minutes
       or new.note is distinct from old.note then
      insert into public.time_entry_audit(time_entry_id,user_id,work_date,action,
        old_hours,new_hours,old_clock_in,new_clock_in,old_clock_out,new_clock_out,
        old_break_minutes,new_break_minutes,old_note,new_note,changed_by)
      values (new.id,new.user_id,new.work_date,'update',
        old.hours,new.hours,old.clock_in,new.clock_in,old.clock_out,new.clock_out,
        old.break_minutes,new.break_minutes,old.note,new.note,auth.uid());
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.time_entry_audit(time_entry_id,user_id,work_date,action,
      old_hours,old_clock_in,old_clock_out,old_break_minutes,old_note,changed_by)
    values (old.id,old.user_id,old.work_date,'delete',
      old.hours,old.clock_in,old.clock_out,old.break_minutes,old.note,auth.uid());
    return old;
  end if;
  return null;
end $fn$;

drop trigger if exists trg_time_entry_audit on public.time_entries;
create trigger trg_time_entry_audit
  after insert or update or delete on public.time_entries
  for each row execute function public.log_time_entry_change();

alter table public.time_entry_audit enable row level security;
drop policy if exists audit_worker_read_own on public.time_entry_audit;
create policy audit_worker_read_own on public.time_entry_audit for select to authenticated
  using (user_id = auth.uid());
drop policy if exists audit_super_read_all on public.time_entry_audit;
create policy audit_super_read_all on public.time_entry_audit for select to authenticated
  using (is_super_admin(auth.uid()));
