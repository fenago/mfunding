-- Processor scoreboard — "what did the processors DO in this range", per person +
-- role total. Counts WORK EVENTS by author (not book ownership), all from records
-- the processor RPCs already write:
--   calls          processor_touches
--   deals worked   distinct deals with any activity_log authored by them
--   apps sent ($)  activity 'application:pushed-to-ghl' NOT starting 'BLOCKED'
--   GO / NO-GO     the QA-verdict activity subjects
--   callbacks/appts/DND/nurture   their subjects
--   statements in  bank-statement docs that ARRIVED in range on deals they worked
--                  in range (arrival is the merchant's act; "on a deal they worked"
--                  is the honest attribution)
create or replace function public.processor_scoreboard(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null or not (public.is_processor(v_uid) or public.is_ops_staff(v_uid)) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  with procs as (
    select c.user_id, concat_ws(' ', p.first_name, p.last_name) as name
    from public.closers c join public.profiles p on p.id = c.user_id
    where c.is_processor = true and c.user_id is not null
  ),
  acts as (
    select al.logged_by as uid, al.entity_id as deal_id, al.subject, al.content, al.created_at
    from public.activity_log al
    where al.entity_type = 'deal' and al.created_at >= p_from and al.created_at < p_to
      and al.logged_by in (select user_id from procs)
  ),
  per as (
    select pr.user_id, pr.name,
      (select count(*) from public.processor_touches t
        where t.touched_by = pr.user_id and t.touched_at >= p_from and t.touched_at < p_to) as calls,
      (select count(distinct a.deal_id) from acts a where a.uid = pr.user_id) as deals_worked,
      (select count(*) from acts a where a.uid = pr.user_id
        and a.subject = 'application:pushed-to-ghl' and a.content not ilike 'BLOCKED%') as apps_sent,
      (select coalesce(sum(d.amount_requested), 0) from (
          select distinct a.deal_id from acts a
          where a.uid = pr.user_id and a.subject = 'application:pushed-to-ghl'
            and a.content not ilike 'BLOCKED%') x
        join public.deals d on d.id = x.deal_id) as ask_total,
      (select count(*) from acts a where a.uid = pr.user_id
        and a.subject like 'QA verdict: GO%') as go_verdicts,
      (select count(*) from acts a where a.uid = pr.user_id
        and a.subject like 'QA verdict: NO-GO%') as no_go_verdicts,
      (select count(*) from acts a where a.uid = pr.user_id
        and a.subject = 'Callback set — processor') as callbacks_set,
      (select count(*) from acts a where a.uid = pr.user_id
        and a.subject = 'Appointment set — processor') as appointments_set,
      (select count(*) from acts a where a.uid = pr.user_id
        and a.subject in ('Marked Do-Not-Contact — processor', 'Moved to long-term nurture — processor')) as cleaned,
      (select count(distinct d.id)
         from public.deals d
        where exists (select 1 from acts a where a.uid = pr.user_id and a.deal_id = d.id)
          and exists (select 1 from public.customer_documents cd
                       where cd.customer_id = d.customer_id
                         and cd.document_type = 'bank_statement'
                         and cd.created_at >= p_from and cd.created_at < p_to)) as statements_in
    from procs pr
  )
  select jsonb_build_object(
    'processors', coalesce(jsonb_agg(to_jsonb(per) order by per.name), '[]'::jsonb),
    'totals', (select to_jsonb(t) from (
      select sum(calls)::int as calls, sum(deals_worked)::int as deals_worked,
             sum(apps_sent)::int as apps_sent, sum(ask_total)::numeric as ask_total,
             sum(go_verdicts)::int as go_verdicts, sum(no_go_verdicts)::int as no_go_verdicts,
             sum(callbacks_set)::int as callbacks_set, sum(appointments_set)::int as appointments_set,
             sum(cleaned)::int as cleaned, sum(statements_in)::int as statements_in
      from per) t)
  ) into v_out from per;

  return coalesce(v_out, jsonb_build_object('processors', '[]'::jsonb, 'totals', null));
end;
$function$;

revoke all on function public.processor_scoreboard(timestamptz, timestamptz) from public, anon;
grant execute on function public.processor_scoreboard(timestamptz, timestamptz) to authenticated, service_role;
