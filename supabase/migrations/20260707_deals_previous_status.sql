-- "Bring back" (reactivate) support: remember the last active stage a deal was in
-- before it got parked (nurture / declined / dead), so one click can restore it.
alter table public.deals add column if not exists previous_status text;
