-- Complete audit #17: give closers SCOPED access to the OPS pages they actually
-- use, limited to their own customers/deals via the ownership helpers. No DELETE.
-- Applied live via MCP 2026-06-29. (Launch Board + Referrals are instead hidden
-- from closers in the nav + route guards — they aren't closer-scoped data.)

-- activity_log: closers log + read calls/notes on THEIR customers (playbook,
-- deal Activity tab). Scoped to customer-entity rows they own.
drop policy if exists closer_select_own_activity on public.activity_log;
create policy closer_select_own_activity on public.activity_log for select to authenticated
  using ( is_closer((select auth.uid())) and entity_type = 'customer'
          and closer_owns_customer((select auth.uid()), entity_id) );

drop policy if exists closer_insert_own_activity on public.activity_log;
create policy closer_insert_own_activity on public.activity_log for insert to authenticated
  with check ( is_closer((select auth.uid())) and entity_type = 'customer'
               and closer_owns_customer((select auth.uid()), entity_id) );

-- deal_submissions: closers READ submissions for their own deals (deal page).
drop policy if exists closer_select_own_submissions on public.deal_submissions;
create policy closer_select_own_submissions on public.deal_submissions for select to authenticated
  using ( is_closer((select auth.uid())) and closer_owns_deal((select auth.uid()), deal_id) );

-- customer_documents: closers read + upload docs for their own customers
-- (Doc Review + deal docs / stip collection). No update/delete (admins manage).
drop policy if exists closer_select_own_customer_docs on public.customer_documents;
create policy closer_select_own_customer_docs on public.customer_documents for select to authenticated
  using ( is_closer((select auth.uid())) and closer_owns_customer((select auth.uid()), customer_id) );

drop policy if exists closer_insert_own_customer_docs on public.customer_documents;
create policy closer_insert_own_customer_docs on public.customer_documents for insert to authenticated
  with check ( is_closer((select auth.uid())) and closer_owns_customer((select auth.uid()), customer_id) );
