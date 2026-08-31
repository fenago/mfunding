-- PROCESSOR whole-board WRITE so they can FILL + SEND any deal's application.
--
-- Processors got whole-board SELECT (20260830z) but filling an application writes
-- to mca_applications / deals / customers, which are own-deal-only for a closer —
-- so a processor on a non-own deal hit "new row violates row-level security policy
-- for table mca_applications". Owner ruling: a processor works the WHOLE board, so
-- they may complete + send applications on any deal. ADDITIVE policies gated on
-- is_processor(auth.uid()) ONLY — regular closers are unchanged (is_processor is
-- false for them, so their own-deal policies remain the only match).

-- mca_applications — insert a new app + update an existing one, any deal.
create policy "processor_insert_all_apps"
  on public.mca_applications for insert to authenticated
  with check ( public.is_processor((select auth.uid())) );

create policy "processor_update_all_apps"
  on public.mca_applications for update to authenticated
  using ( public.is_processor((select auth.uid())) )
  with check ( public.is_processor((select auth.uid())) );

-- deals — update any deal (stage move to Application Sent, ask/amount, etc.).
create policy "processor_update_all_deals"
  on public.deals for update to authenticated
  using ( public.is_processor((select auth.uid())) )
  with check ( public.is_processor((select auth.uid())) );

-- customers — update any customer (revenue + contact fields the app modal writes).
create policy "processor_update_all_customers"
  on public.customers for update to authenticated
  using ( public.is_processor((select auth.uid())) )
  with check ( public.is_processor((select auth.uid())) );
