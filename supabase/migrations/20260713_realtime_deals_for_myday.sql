-- realtime_deals_for_myday
--
-- The My Day queue is a live worklist: two closers working the same board must see
-- a deal disappear the moment the other one takes it. That needs deals (and the
-- customers rows the queue joins for names) on the realtime publication.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'deals'
  ) then
    alter publication supabase_realtime add table public.deals;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'customers'
  ) then
    alter publication supabase_realtime add table public.customers;
  end if;
end $$;
