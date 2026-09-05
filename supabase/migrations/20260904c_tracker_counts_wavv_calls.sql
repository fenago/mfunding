-- 20260904c — the 14-day call tracker counts WAVV dialer calls.
--
-- WHY. MF-2026-0313 (Glass Glow Equities): Catherine made a real 6½-minute WAVV
-- call at 2:16 PM ET, dispositioned "Appointment Set" — the very call that
-- CREATED the deal — and the drawer's 14-day tracker still showed
-- "0 calls · 1 day missed" with day 1 red. The tracker's sources were
-- processor_touches (the drawer's manual log buttons) and activity_log
-- interaction_type='call' rows (the GHL/LeadConnector mirror). Setters dial
-- through WAVV, whose calls land in wavv_calls keyed by PHONE, in neither
-- source — so the surface claimed "never called" about merchants who were
-- called. Same misleading-surface class as the Handoff MISSED bug.
--
-- FIX. processor_deal_detail unions a third source: wavv_calls matched on the
-- last-10-digit phone of the deal's customer. Every dial counts (a no-answer
-- attempt is still an attempt — the manual buttons already count "No answer").
-- An expression index makes the phone match cheap.

create index if not exists wavv_calls_phone10_idx
  on public.wavv_calls (right(regexp_replace(phone, '[^0-9]', '', 'g'), 10));

create or replace function public.processor_deal_detail(p_deal_id uuid)
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

  select jsonb_build_object(
    'deal', to_jsonb(d),
    'customer', to_jsonb(c),
    'application', (select to_jsonb(a) from public.mca_applications a where a.deal_id = d.id limit 1),
    'documents', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', cd.id,
          'file_name', cd.filename,
          'category', cd.document_type::text,
          'created_at', cd.created_at,
          'storage_path', cd.storage_path,
          'is_bank_statement', (cd.document_type = 'bank_statement')
        ) order by cd.created_at desc
      ), '[]'::jsonb)
      from public.customer_documents cd
      where cd.customer_id = d.customer_id
    ),
    'qa', jsonb_build_object(
      'checklist', coalesce(q.checklist, '{}'::jsonb),
      'qa_passed', coalesce(q.qa_passed, false),
      'qa_passed_at', q.qa_passed_at,
      'qa_passed_by_name', nullif(btrim(concat_ws(' ', qpa.first_name, qpa.last_name)), ''),
      'submission_ready_at', q.submission_ready_at,
      'submission_ready_by_name', nullif(btrim(concat_ws(' ', qra.first_name, qra.last_name)), ''),
      'decision', q.decision,
      'decision_reason', q.decision_reason,
      'decision_at', q.decision_at,
      'decision_by_name', nullif(btrim(concat_ws(' ', qda.first_name, qda.last_name)), ''),
      'notes', q.notes
    ),
    'touches_total', (
      (select count(*) from public.processor_touches t where t.deal_id = d.id)
      + (select count(*) from public.activity_log al
          where al.entity_type = 'deal' and al.entity_id = d.id
            and al.interaction_type = 'call')
      + (select count(*) from public.wavv_calls w
          where c.phone is not null
            and right(regexp_replace(w.phone, '[^0-9]', '', 'g'), 10)
              = right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10))
    ),
    'touches', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'touched_at', x.touched_at,
        'outcome', x.outcome,
        'note', x.note,
        'by_name', x.by_name
      ) order by x.touched_at desc), '[]'::jsonb)
      from (
        select t.touched_at, t.outcome, t.note,
               nullif(btrim(concat_ws(' ', tp.first_name, tp.last_name)), '') as by_name
          from public.processor_touches t
          left join public.profiles tp on tp.id = t.touched_by
         where t.deal_id = d.id
        union all
        -- REAL calls mirrored by the GHL event hook. logged_by is usually null on
        -- these, so fall back to the '— by <name>' suffix the hook writes in the
        -- subject line.
        select al.created_at, al.subject, left(coalesce(al.content, ''), 160),
               coalesce(nullif(btrim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
                        (regexp_match(al.subject, '— by (.+)$'))[1])
          from public.activity_log al
          left join public.profiles ap on ap.id = al.logged_by
         where al.entity_type = 'deal' and al.entity_id = d.id
           and al.interaction_type = 'call'
        union all
        -- WAVV dialer calls, matched by the customer's phone (WAVV knows phones,
        -- not deals). Every dial is an attempt, answered or not — the tracker
        -- measures effort, exactly like the manual "No answer" button.
        select w.started_at,
               'WAVV ' || lower(coalesce(w.direction, 'call')) || ': '
                 || coalesce(w.disposition, initcap(replace(lower(coalesce(w.outcome, 'call')), '_', ' '))),
               nullif(btrim(coalesce(w.note, '')), ''),
               w.agent_name
          from public.wavv_calls w
         where c.phone is not null
           and right(regexp_replace(w.phone, '[^0-9]', '', 'g'), 10)
             = right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10)
      ) x
    )
  )
    into v_out
  from public.deals d
  join public.customers c on c.id = d.customer_id
  left join public.deal_processor_qa q on q.deal_id = d.id
  left join public.profiles qpa on qpa.id = q.qa_passed_by
  left join public.profiles qra on qra.id = q.submission_ready_by
  left join public.profiles qda on qda.id = q.decision_by
  where d.id = p_deal_id;

  if v_out is null then
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;
  return v_out;
end;
$function$;
