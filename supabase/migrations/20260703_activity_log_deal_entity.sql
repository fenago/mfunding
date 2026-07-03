-- activity_log predated deals: the entity_type check (customer/lender/
-- marketing_vendor) silently rejected every deal-scoped audit insert, and
-- closers had no read path for deal rows. Applied hot on 2026-07-03.
alter table public.activity_log drop constraint if exists activity_log_entity_type_check;
alter table public.activity_log add constraint activity_log_entity_type_check
  check (entity_type = any (array['customer','lender','marketing_vendor','deal']));

drop policy if exists closer_select_own_deal_activity on public.activity_log;
create policy closer_select_own_deal_activity on public.activity_log
  for select using (
    is_closer((select auth.uid()))
    and entity_type = 'deal'
    and closer_owns_deal((select auth.uid()), entity_id)
  );
