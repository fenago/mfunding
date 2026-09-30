-- 20260929a_audit_lead_source_changes.sql
--
-- AUDIT EVERY CHANGE TO deals.lead_source.
--
-- WHY
-- MF-2026-0100 (Blockbuster Concrete) was created 2026-07-20 by the intake
-- function's REAL-TIME path — `realtime:intake` activity row at t+0s,
-- lead_source_detail "Synergy real-time · Agentic Voice Inc (Real Time) (RT)",
-- synergy_intake_log notes "realtime · …". It now reads lead_source
-- 'live_transfer'. Nothing recorded when, or by whom.
--
-- Every writer that leaves a trace was eliminated:
--   · live-transfer-intake's dedupe reclassification (index.ts:1539) writes a
--     ':dedupe' activity row on every flip — 0100 has neither
--     live-transfer:dedupe nor realtime:dedupe.
--   · playbook-open-contact's backfill (index.ts:1396) overwrites only
--     PLACEHOLDER_LEAD_SOURCES {ph_setter, other, unknown}; 'realtime_appt' is
--     meaningful and is refused.
--   · ghl-webhook writes lead_source only as 'ghl_other' on auto-create
--     (index.ts:1431); it never updates an existing deal's.
--   · 20260828_merge_duplicate_deal_pairs.sql targets MF-2026-0226…0273 by id
--     and preserves the survivor's lead_source by design.
--
-- What remains is the deal edit modal in src/pages/admin/PlaybooksPage.tsx,
-- which writes lead_source directly and logged nothing. Its hand-written option
-- list omitted realtime_appt (207 deals), ghl_other (60), ucc_list (35),
-- ph_setter (18) and aged_list (1) — 322 of 424 deals, 76% of the book — so a
-- <select> holding any of them rendered BLANK, and the nearest plausible repair
-- on the list was Live Transfer. (Fixed in the same change: the picker is now
-- derived from SOURCE_MAP and always carries the row's current value.)
--
-- THE POINT, stated plainly: no log line proves a human did this, BECAUSE THAT
-- LOG LINE DOES NOT EXIST ANYWHERE. `deals` carries 13 triggers and not one of
-- them audits the column that decides which product a deal belongs to. The
-- absence IS the defect. This migration ends it.
--
-- WHAT A SILENT FLIP COSTS
-- lead_source is not a label. It routes the auto-assign pool
-- (is_realtime_lead_source -> deals_auto_assign_closer), decides whether a
-- 5-minute first-call clock is owed, picks the Revenue Playbook script, and
-- selects the campaign a deal's cost is attributed to. MF-2026-0100 still
-- carries a live first_call_due_at (creation + 5 min) that SpeedToLead.tsx
-- cannot see, because that panel grades lead_source = 'realtime_appt'. A
-- real-time lead with a real clock has never been graded.
--
-- interaction_type is 'note' DELIBERATELY. activity_log's check constraint
-- allows only (call, email, sms, note, meeting, voicemail, document_uploaded,
-- status_change, application_submitted, follow_up_scheduled). 'system' is NOT
-- among them, and 'status_change' is reserved for deals.status. A rejected
-- value inside a best-effort insert is this very bug in miniature: an audit
-- that isn't written and doesn't complain.
--
-- This trigger does NOT swallow its errors, unlike the other best-effort
-- inserts on this table. If the audit row cannot be written, the reclassification
-- must not happen either — an unaudited lead_source change is exactly what this
-- exists to abolish, and "the write succeeded, the record of it didn't" is how
-- we got here. The insert is SECURITY DEFINER (no RLS in its path) against
-- constraint-valid values, so the realistic failure modes are catastrophic ones
-- that should abort the transaction anyway.

create or replace function public.deals_audit_lead_source()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_actor text;
begin
  -- Actor by name when we have one. auth.uid() is NULL for service-role callers
  -- (the intake functions, cron) — that is itself informative, so it is named
  -- rather than left blank.
  if v_uid is not null then
    select nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
      into v_actor
      from public.profiles p where p.id = v_uid;
  end if;

  insert into public.activity_log (
    entity_type, entity_id, interaction_type, subject, content,
    old_status, new_status, logged_by
  ) values (
    'deal', new.id, 'note', 'lead_source:changed',
    'Lead source changed from ' || coalesce(old.lead_source, '(none)')
      || ' to ' || coalesce(new.lead_source, '(none)')
      || ' by ' || coalesce(v_actor, v_uid::text, 'a server-side process (no auth.uid — intake function, cron or SQL)')
      || '. Lead source decides the auto-assign pool, whether a 5-minute first-call'
      || ' clock is owed, which Revenue Playbook script is truthful, and which campaign'
      || ' this deal''s cost is attributed to — so a change here moves the deal between'
      || ' products, not just between labels.',
    -- old_status/new_status are plain text columns; using them makes the change
    -- machine-readable, so a future audit can diff lead_source history with a
    -- query instead of parsing prose.
    old.lead_source, new.lead_source, v_uid
  );

  return null;  -- AFTER trigger; return value is ignored
end;
$function$;

comment on function public.deals_audit_lead_source() is
  'Writes a lead_source:changed activity_log row (old/new in old_status/new_status, '
  'actor in logged_by) on every change to deals.lead_source. Deliberately NOT '
  'best-effort: if the audit cannot be written the change is rolled back, because '
  'an unaudited lead_source flip is the defect this exists to prevent.';

drop trigger if exists zz_deals_audit_lead_source on public.deals;

-- zz_ prefix so it runs after the stamping/sync triggers, matching the existing
-- convention on this table (zz_deals_application_sender_trg,
-- zz_deals_refuse_stage_retreat).
create trigger zz_deals_audit_lead_source
after update on public.deals
for each row
when (old.lead_source is distinct from new.lead_source)
execute function public.deals_audit_lead_source();
