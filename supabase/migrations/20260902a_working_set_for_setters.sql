-- Working-set ★ for SETTERS (2026-09-02)
--
-- The processor_working claim table becomes the shared "working set" for anyone
-- with a closers row (setters + processors). Claims stay strictly PER-PERSON
-- (profile_id = auth.uid()); a setter can star only their own working set. The
-- processor/ops whole-board SELECT stays; setters additionally read THEIR OWN
-- claims so the star renders on their My-deals list.

-- Own-claim reads for setters (processors/ops keep their existing broad select).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='processor_working' and policyname='working_select_own') then
    create policy working_select_own on public.processor_working
      for select to authenticated
      using (profile_id = (select auth.uid()));
  end if;
end$$;

-- processor_toggle_working: widen the gate from processor/ops to ANYONE with a
-- closers row (the claim is still forced to the caller's own profile_id inside).
create or replace function public.processor_toggle_working(p_deal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_existing uuid;
begin
  if v_uid is null or not (
    public.is_processor(v_uid) or public.is_ops_staff(v_uid)
    or exists (select 1 from public.closers c where c.user_id = v_uid)
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.deals d where d.id = p_deal_id) then
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;

  select id into v_existing from public.processor_working
   where deal_id = p_deal_id and profile_id = v_uid;

  if v_existing is not null then
    delete from public.processor_working where id = v_existing;
    return jsonb_build_object('working', false);
  end if;

  insert into public.processor_working (deal_id, profile_id) values (p_deal_id, v_uid);
  return jsonb_build_object('working', true);
end;
$function$;
