-- ONE contact-logging path. ══════════════════════════════════════════════════
--
-- Until today there were two, and they disagreed:
--
--   A. logContactAttempt() in src/services/dealService.ts — client-side TS, used
--      by every setter surface (SetterCallOutcome, Hot Leads, Text/Email panels).
--      Read-then-write increment (two fast logs lose one), its own inline
--      new→contacted advance, no audit row until 2026-09-16, and — because the
--      closer UPDATE policies only cover a deal the closer OWNS — an outright
--      RLS failure when a setter logged a call on an UNASSIGNED hot lead, which
--      is most of the Hot Leads board.
--
--   B. processor_log_contact() — SQL, used by the processor drawer. Atomic,
--      guarded advance, its own activity_log subject format, and gated to
--      is_processor/is_ops_staff, so a plain setter could never call it.
--
-- One event, two implementations, two subject formats, two definitions of
-- "counts as contact". A setter logged a call, the counter moved, and no row
-- existed for any reading surface — the bug survived precisely because fixing
-- one path left the other alone.
--
-- This file makes public.log_contact_attempt() the single source of truth and
-- turns both callers into thin shims over it.
--
-- RECONCILED SEMANTICS (the divergences, decided):
--
--   · not_interested COUNTS AS CONTACT. B's reading is the right one — you only
--     learn a merchant isn't interested by speaking to them. Adopting it raises
--     counted contacts slightly on the setter side. That is a correction.
--   · Atomic increment everywhere (B's), so two fast logs can't lose one.
--   · ONE activity_log subject: 'Logged call: <label>'. Both readers of these
--     rows (realtime_lead_call_history, processor_deal_detail) render the
--     subject verbatim as the call's disposition, so it has to read like one —
--     "Logged call: Left voicemail" does, "Contact attempt — processor:
--     left_voicemail" does not. Note the deliberate absence of the ' — by '
--     suffix: realtime_lead_call_history regexes that out of the subject to name
--     the caller when logged_by is null, and we always set logged_by.
--   · ONE status advance, through the guarded deals_advance_status() helper
--     (refuses VCF deals, terminal statuses, and any backwards move).
--   · first_touch_channel is now WRITE-ONCE. The column name and its own comment
--     both say "first"; A overwrote it on every attempt, which quietly made it
--     last_touch_channel.
--   · A settled a DUE callback when the rep logged an attempt afterwards. That
--     now applies to every non-contact outcome, not just the one A spelled
--     'attempted' — a processor's "No answer" is the same demonstrated try.
--
-- processor_touches: NOT written any more, by either path. ─────────────────────
-- The table holds exactly ONE row in its lifetime, and that row already has an
-- activity_log twin (processor_log_contact always wrote both). It carries no
-- field activity_log lacks — deal, instant, outcome, note, actor all live there.
-- Keeping both is what makes processor_deal_detail.touches_total and
-- processor_pipeline_rows.touches_total read 2 for a single logged call, while
-- realtime_lead_call_history's 180s fuzzy dedupe hides the duplicate in that one
-- surface and not the others — "two stores that agree for now" in miniature.
-- So: activity_log is the event row, and every existing reader keeps its
-- processor_touches branch as inert history (one row, already counted through
-- its twin on one deal). The single reader that would have gone to ZERO —
-- processor_scoreboard.calls — is repointed at activity_log below.

-- ── 1. The one function ──────────────────────────────────────────────────────

create or replace function public.log_contact_attempt(
  p_deal_id     uuid,
  p_outcome     text,
  p_channel     text        default 'call',
  p_label       text        default null,
  p_note        text        default null,
  p_callback_at timestamptz default null,
  p_spoke       boolean     default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid       uuid    := auth.uid();
  v_outcome   text    := lower(nullif(btrim(p_outcome), ''));
  v_channel   text    := lower(coalesce(nullif(btrim(p_channel), ''), 'call'));
  v_label     text;
  v_reached   boolean;
  v_advanced  boolean := false;
  v_cb_touched boolean := false;
  v_status    text;
  v_cb_old    timestamptz;
  v_cb_new    timestamptz;
  v_attempts  integer;
  v_now       timestamptz := now();
begin
  if v_uid is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  -- Existence first, so "deal not found" never masquerades as "not authorized".
  select d.status, d.callback_at into v_status, v_cb_old
    from public.deals d where d.id = p_deal_id;
  if not found then
    raise exception 'Deal not found' using errcode = 'P0002';
  end if;

  -- AUTHORIZATION — three doors, and the processor door is the one that keeps
  -- getting left out (three surfaces broke this week from omitting it):
  --   · ops staff  → any deal
  --   · processor  → any deal (owner ruling; same exemption the deals RLS and
  --                  every other processor_* RPC already carries)
  --   · plain closer/setter → the MONEY WALL, restated verbatim from the
  --                  closer_select_own_deals policy: own book + unassigned.
  -- The wall's SELECT predicate is the right test, not its UPDATE predicate: a
  -- setter is supposed to be able to work an unassigned hot lead without
  -- claiming it, and the UPDATE policies do not allow that — which is exactly
  -- why path A threw an RLS error on the most common Hot Leads row.
  if not (public.is_ops_staff(v_uid) or public.is_processor(v_uid)) then
    if not exists (
      select 1 from public.deals d
       where d.id = p_deal_id
         and (public.is_closer(v_uid) or public.has_closer_row(v_uid))
         and (d.assigned_closer_id is null
              or d.assigned_closer_id = v_uid
              or d.created_by = v_uid
              or d.assigned_closer_id = any (public.my_closer_ids(v_uid)))
    ) then
      raise exception 'Not authorized' using errcode = '42501';
    end if;
  end if;

  if v_channel not in ('call', 'email', 'sms', 'other') then
    raise exception 'Unknown channel: %', p_channel using errcode = '22023';
  end if;

  -- The union of both vocabularies. An unknown value RAISES rather than falling
  -- through as "not a contact": a typo that silently under-counts contact is the
  -- failure mode this whole change exists to end.
  if v_outcome is null or v_outcome not in (
    'attempted', 'no_answer', 'left_voicemail', 'bad_number',
    'reached', 'not_interested', 'callback'
  ) then
    raise exception 'Unknown contact outcome: %', p_outcome using errcode = '22023';
  end if;

  -- Human disposition for the audit row. `outcome` alone cannot say it:
  -- 'attempted' covers both no-answer and voicemail on the setter side.
  v_label := coalesce(nullif(btrim(p_label), ''), case v_outcome
    when 'attempted'      then 'Attempted'
    when 'no_answer'      then 'No answer'
    when 'left_voicemail' then 'Left voicemail'
    when 'bad_number'     then 'Bad number'
    when 'reached'        then 'Connected'
    when 'not_interested' then 'Not interested'
    when 'callback'       then 'Callback'
  end);

  -- Did a conversation happen? reached and not_interested both mean yes (you
  -- learn "not interested" by talking). A callback counts only when the rep
  -- ticked "they answered and asked me to call back" — a voicemail with a retry
  -- scheduled is not a contact.
  v_reached := v_outcome in ('reached', 'not_interested')
               or (v_outcome = 'callback' and coalesce(p_spoke, false));

  update public.deals d
     set last_attempt_at    = v_now,
         first_attempt_at   = coalesce(d.first_attempt_at, v_now),
         -- Atomic. The read-then-write this replaces lost one of any two logs
         -- that landed inside the same round trip.
         contact_attempts   = coalesce(d.contact_attempts, 0) + 1,
         -- Write-once: the FIRST channel, as the column name and its comment say.
         first_touch_channel = coalesce(d.first_touch_channel, v_channel),
         contacted_at       = case when v_reached then coalesce(d.contacted_at, v_now)
                                   else d.contacted_at end,
         callback_at        = case
                                -- We got them; nothing left to call back for.
                                when v_outcome = 'reached' then null
                                when v_outcome = 'callback' then p_callback_at
                                -- ANY attempt logged AFTER the callback came due
                                -- settles it. The card existed to make this call
                                -- happen; the call happened, answered or not.
                                -- Leaving the DUE badge up after the rep
                                -- demonstrably tried is how red badges stop
                                -- meaning anything.
                                when v_cb_old is not null and v_cb_old <= v_now then null
                                else d.callback_at
                              end,
         callback_source    = case when v_outcome = 'callback' then 'closer_promised'
                                   else d.callback_source end,
         updated_at         = v_now
   where d.id = p_deal_id
   returning d.contact_attempts, d.callback_at into v_attempts, v_cb_new;

  -- Sync the calendar only when the promise actually MOVED. A's "did the patch
  -- mention callback_at" test fired on null→null too.
  v_cb_touched := (v_cb_new is distinct from v_cb_old);

  if v_reached then
    v_advanced := public.deals_advance_status(p_deal_id, 'contacted');
  end if;

  -- ── LEAVE A ROW, NOT JUST A COUNTER ───────────────────────────────────────
  -- CALLS ONLY, deliberately. A text or an email is an attempt worth counting on
  -- the deal, but the text/email panels already leave their own trail, and an
  -- 'sms'/'email' row here would double up on their surfaces. Nothing reads
  -- those interaction types as dials, so the call row is the only one that
  -- closes a real gap.
  --
  -- interaction_type MUST be 'call' — activity_log's check constraint has no
  -- 'system', and a bad value fails the insert.
  if v_channel = 'call' then
    insert into public.activity_log
      (entity_type, entity_id, interaction_type, subject, content, logged_by)
    values ('deal', p_deal_id, 'call', 'Logged call: ' || v_label,
            nullif(btrim(coalesce(p_note, '')), ''), v_uid);
  end if;

  return jsonb_build_object(
    'ok', true,
    'reached', v_reached,
    'advanced', v_advanced,
    'attempts', v_attempts,
    'label', v_label,
    'status_before', v_status,
    -- Tells the caller whether to project the callback onto the GHL calendar.
    'callback_touched', v_cb_touched
  );
end;
$function$;

revoke all on function public.log_contact_attempt(uuid, text, text, text, text, timestamptz, boolean) from public, anon;
grant execute on function public.log_contact_attempt(uuid, text, text, text, text, timestamptz, boolean) to authenticated, service_role;

comment on function public.log_contact_attempt(uuid, text, text, text, text, timestamptz, boolean) is
  'THE contact-logging path. Atomic attempt counter, contacted_at on reached/not_interested/callback+spoke, guarded new->contacted advance, callback set/settle, and one ''Logged call: <label>'' activity_log row for call-channel logs. Authorization: ops staff or processor on any deal; a plain closer/setter on a deal the money wall lets them SELECT (own book + unassigned). Callers: logContactAttempt() in dealService.ts and the deprecated processor_log_contact() shim.';

-- ── 2. processor_log_contact — deprecated shim, not a second implementation ───
-- Kept ONLY so the live bundle does not 404 between this migration and the
-- Netlify deploy that repoints the drawer. Delete once that has shipped.
-- Signature is unchanged, so no `drop function` is needed and no PGRST203
-- overload can appear.

create or replace function public.processor_log_contact(
  p_deal_id uuid, p_outcome text, p_note text default null::text
)
returns jsonb
language sql
security invoker
set search_path to 'public'
as $function$
  select public.log_contact_attempt(p_deal_id, p_outcome, 'call', null, p_note, null, false);
$function$;

revoke all on function public.processor_log_contact(uuid, text, text) from public, anon;
grant execute on function public.processor_log_contact(uuid, text, text) to authenticated, service_role;

comment on function public.processor_log_contact(uuid, text, text) is
  'DEPRECATED shim over public.log_contact_attempt(). Exists only to keep the deployed processor drawer working across the 20260916c deploy window. No logic of its own — delete once no client calls it.';

-- ── 3. processor_touches — nothing writes it any more ────────────────────────

comment on table public.processor_touches is
  'DEPRECATED (2026-09-16). Superseded by activity_log ''call'' rows written by log_contact_attempt(). One historical row, already twinned in activity_log. Readers keep their branches so that row stays visible; nothing writes here.';

-- ── 4. processor_scoreboard.calls — the one reader that would have gone to 0 ──
-- It counted processor_touches rows by touched_by. Nothing writes those now, so
-- it is repointed at the hand-logged activity_log rows. Both subject formats are
-- matched: the new 'Logged call:' one and the 3 legacy 'Contact attempt —
-- processor:' rows. The GHL event hook's mirrored call rows ('GHL call: …') are
-- deliberately NOT matched — a dial the hook observed is not work this processor
-- logged, and counting it here would credit the scoreboard for the dialer.

create or replace function public.processor_scoreboard(p_from timestamp with time zone, p_to timestamp with time zone)
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
    select al.logged_by as uid, al.entity_id as deal_id, al.subject, al.content,
           al.created_at, al.interaction_type
    from public.activity_log al
    where al.entity_type = 'deal' and al.created_at >= p_from and al.created_at < p_to
      and al.logged_by in (select user_id from procs)
  ),
  per as (
    select pr.user_id, pr.name,
      (select count(*) from acts a where a.uid = pr.user_id
        and a.interaction_type = 'call'
        and (a.subject like 'Logged call:%'
             or a.subject like 'Contact attempt — processor:%')) as calls,
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
