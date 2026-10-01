-- ── The ledger must follow is_processor, not profiles.role ──────────────────
--
-- The read policy keyed on `profiles.role = 'closer'`. Every OTHER table in this
-- failure's path keys on `is_processor()`, and the two are NOT the same test:
--
--   is_processor(uid) := exists (select 1 from closers where user_id = uid and is_processor)
--
-- It lives on the `closers` row and says nothing about the profile's role. Today
-- both processors happen to be role='closer', so this is a no-op — but a
-- `closers` row already exists on a role='user' profile in this project
-- (stephaniedecker0611@gmail.com, is_processor false). The day someone flips
-- that flag, that person gets the whole-pipeline processor board on
-- /admin/processor and a BLANK delivery ledger: every other read in the chain
-- (deal_submissions, deals, activity_log) admits them and this one alone does
-- not. That is the same shape as the defect this table was built to close — a
-- fact recorded where the person who needs it cannot open it — just waiting on
-- one boolean.
--
-- So the policy now admits whoever the rest of the chain admits. Writes stay
-- service-role only; this widens READ only.
drop policy if exists "Ops staff and closers read email_delivery_events" on public.email_delivery_events;
drop policy if exists "Ops staff, closers and processors read email_delivery_events" on public.email_delivery_events;
create policy "Ops staff, closers and processors read email_delivery_events"
  on public.email_delivery_events for select
  using (
    (select public.is_ops_staff((select auth.uid())))
    or (select public.is_closer((select auth.uid())))
    or (select public.is_processor((select auth.uid())))
  );
