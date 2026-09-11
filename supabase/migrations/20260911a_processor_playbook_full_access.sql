-- 20260911a — processors get the WHOLE BOARD inside Revenue Playbook.
--
-- Owner ruling 9/11 ("I need the processor to be able to get into Revenue
-- Playbook and see everything from there"), triggered by Kristine — processor
-- and the deal's actual worker — searching SIS Financial LLC (assigned to the
-- owner's book) and finding nothing.
--
-- The deals/mca_applications/customers/customer_documents processor policies
-- already exist (20260830 processor build); the client-side Mine/All clamp in
-- MyDayQueue is lifted in the same commit. This migration closes the remaining
-- RLS gaps a processor hits once they open a deal they don't own in the
-- Playbook: the funder-submissions panel, the activity timeline, and document
-- upload. Regular closers' money wall is UNTOUCHED — every policy here is
-- additive and gated on is_processor().

-- Funder submissions: read the panel, record sends, update statuses.
drop policy if exists processor_select_all_submissions on public.deal_submissions;
create policy processor_select_all_submissions on public.deal_submissions
  for select to authenticated
  using (public.is_processor((select auth.uid())));

drop policy if exists processor_insert_all_submissions on public.deal_submissions;
create policy processor_insert_all_submissions on public.deal_submissions
  for insert to authenticated
  with check (public.is_processor((select auth.uid())));

drop policy if exists processor_update_all_submissions on public.deal_submissions;
create policy processor_update_all_submissions on public.deal_submissions
  for update to authenticated
  using (public.is_processor((select auth.uid())))
  with check (public.is_processor((select auth.uid())));

-- Activity timeline: deal + customer history on any deal, and the ability to
-- log touches/notes there. Scoped to those two entity types on purpose — the
-- lender/vendor ledger is not a Playbook surface.
drop policy if exists processor_select_deal_customer_activity on public.activity_log;
create policy processor_select_deal_customer_activity on public.activity_log
  for select to authenticated
  using (
    public.is_processor((select auth.uid()))
    and entity_type in ('deal', 'customer')
  );

drop policy if exists processor_insert_deal_customer_activity on public.activity_log;
create policy processor_insert_deal_customer_activity on public.activity_log
  for insert to authenticated
  with check (
    public.is_processor((select auth.uid()))
    and entity_type in ('deal', 'customer')
  );

-- Document upload onto any merchant (statement chasing is the processor's job).
drop policy if exists processor_insert_all_docs on public.customer_documents;
create policy processor_insert_all_docs on public.customer_documents
  for insert to authenticated
  with check (public.is_processor((select auth.uid())));
