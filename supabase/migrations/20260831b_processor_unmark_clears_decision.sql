-- processor_unmark_ready now also CLEARS the go/no-go decision (2026-08-31)
-- "Pull back" on a GO or NO-GO fully resets the verdict so the processor can
-- re-decide, instead of leaving a stale decision behind the cleared ready flag.

create or replace function public.processor_unmark_ready(p_deal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not (public.is_processor(v_uid) or public.is_ops_staff(v_uid)) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if not exists (select 1 from public.deals d where d.id = p_deal_id) then
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;

  update public.deal_processor_qa
     set submission_ready_at = null,
         submission_ready_by = null,
         decision            = null,
         decision_at         = null,
         decision_by         = null,
         decision_reason     = null,
         updated_at          = now()
   where deal_id = p_deal_id;

  insert into public.activity_log(entity_type, entity_id, interaction_type, subject, content, logged_by)
  values ('deal', p_deal_id, 'note', 'Cleared QA verdict (ready / go-no-go) — processor', null, v_uid);

  return jsonb_build_object('ok', true);
end;
$function$;
