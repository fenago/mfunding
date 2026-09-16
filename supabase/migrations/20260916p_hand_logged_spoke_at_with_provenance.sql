-- A setter's word counts — and says so. ═════════════════════════════════════
--
-- Owner ruling: a hand-logged conversation DOES stamp spoke_at, but the
-- PROVENANCE is recorded, so a conversation attested by call duration stays
-- distinguishable from one a setter reported themselves. A real 90-second
-- conversation currently earns nothing, which is unfair; the condition is that
-- the quality signal must not quietly become self-reported.
--
-- Checked before building, because self-certification into a SCORED metric
-- would have been a different decision:
--   · The scored conversation funnel is WAVV-disposition-driven —
--     isConversation() reads a call row's disposition, and contact_rate /
--     app_per_conversation divide by scoredDials, which is WAVV-only. A
--     hand-logged stamp cannot reach any of it.
--   · spoke_at feeds exactly one thing: the funnel's Contacted rung
--     (pipelineDepth, `mark(d.spoke_at, "contacted")`). That rung is already
--     marked twice over by the same button — log_contact_attempt stamps
--     contacted_at AND advances the status — so this adds no new
--     self-certification anywhere. Verified on both live candidates:
--     MF-2026-0162 and MF-2026-0165 already carry contacted_at.
--
-- ── 1. is_conversation for a hand-logged row: STRUCTURAL, not a subject parse ─
--
-- activity_log already HAS a call_outcome column — text, no CHECK, and entirely
-- unused (0 rows populated before this migration). So the disposition can be
-- stored properly rather than recovered from prose. log_contact_attempt now
-- writes it, and deal_call_events reads it.
--
-- Vocabulary is the raw outcome, with ONE addition: a callback where the
-- merchant actually answered is stored as `callback_spoke`. That keeps the
-- p_spoke flag losslessly in one column with no schema change, instead of
-- needing a second boolean nobody would remember to read.
--
--   conversation:     reached · not_interested · callback_spoke
--   not a conversation: attempted · no_answer · left_voicemail · bad_number
--                       · callback (nobody picked up; a retry was scheduled)
--
-- not_interested counts. You only learn a merchant isn't interested by speaking
-- to them.
--
-- ── 2. The one-time fill of call_outcome on rows written before it existed ────
--
-- 23 rows carry `Logged call: <label>` subjects written by log_contact_attempt
-- itself earlier TODAY, before this migration added the column to its write
-- path, plus 3 legacy `Contact attempt — processor: <outcome>` rows. Their
-- call_outcome is filled from an EXACT match on the label strings our own code
-- emits — a deterministic map from our writer's own output, not an
-- interpretation of prose.
--
-- What is NOT filled, deliberately: 10 free-text rows on 8 deals, from before
-- the logger existed — "Live transfer taken at hello — by the owner",
-- "merchant says they never requested info", "Handoff flagged from board:
-- disconnected at handoff", "Call flagged: disconnected at handoff". The first
-- two read like a conversation happened and the last two like one didn't, but
-- none is evidence. An ambiguous old subject is not proof of a conversation and
-- an invented one is worse than a missing one, so they stay unstamped.
--
-- Net effect of the backfill: 2 deals gain a stamp — MF-2026-0162 and
-- MF-2026-0165, both from `Logged call: Not interested`. Zero existing stamps
-- move.
--
-- ── 3. Provenance ───────────────────────────────────────────────────────────
--
-- deals.spoke_at_source, written by apply_spoke_at_from_calls from the WINNING
-- event's source, so it moves with the stamp under earliest-wins — if a
-- hand-logged stamp is later superseded by an earlier attested WAVV
-- conversation, the provenance changes with it rather than going stale.

-- ── deals.spoke_at_source ───────────────────────────────────────────────────

alter table public.deals add column if not exists spoke_at_source text;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.deals'::regclass
                    and conname = 'deals_spoke_at_source_check') then
    alter table public.deals
      add constraint deals_spoke_at_source_check
      check (spoke_at_source is null
             or spoke_at_source = any (array['wavv'::text, 'ghl'::text, 'hand_logged'::text]));
  end if;
end $$;

comment on column public.deals.spoke_at_source is
  'How spoke_at was established: wavv or ghl = attested by call DURATION (>=120s on a connected, non-voicemail call); hand_logged = a setter reported the conversation themselves via log_contact_attempt. Written by apply_spoke_at_from_calls from the winning event''s source and moves with the stamp under earliest-wins. The owner accepted self-certification on condition it stays visibly distinguishable — this column is that condition, so every surface rendering "Spoke" must say which.';

-- ── activity_log.call_outcome: the structured disposition ───────────────────

comment on column public.activity_log.call_outcome is
  'Structured disposition for interaction_type = ''call'', written by log_contact_attempt. Vocabulary: attempted, no_answer, left_voicemail, bad_number, reached, not_interested, callback, callback_spoke (a callback where the merchant DID answer — keeps the p_spoke flag without a second column). deal_call_events derives is_conversation from this, never from the subject string. NULL on rows predating 20260916p and on the GHL hook''s mirror rows.';

-- One-time fill from our own writer's exact output. Nothing here interprets
-- prose: every mapping is a string this codebase emits deterministically.
update public.activity_log set call_outcome = 'reached'
 where entity_type = 'deal' and interaction_type = 'call' and call_outcome is null
   and subject = 'Logged call: Connected';
update public.activity_log set call_outcome = 'not_interested'
 where entity_type = 'deal' and interaction_type = 'call' and call_outcome is null
   and subject = 'Logged call: Not interested';
update public.activity_log set call_outcome = 'no_answer'
 where entity_type = 'deal' and interaction_type = 'call' and call_outcome is null
   and subject in ('Logged call: No answer', 'Contact attempt — processor: no_answer');
update public.activity_log set call_outcome = 'left_voicemail'
 where entity_type = 'deal' and interaction_type = 'call' and call_outcome is null
   and subject in ('Logged call: Left voicemail', 'Contact attempt — processor: left_voicemail');
update public.activity_log set call_outcome = 'bad_number'
 where entity_type = 'deal' and interaction_type = 'call' and call_outcome is null
   and subject in ('Logged call: Bad number', 'Contact attempt — processor: bad_number');
update public.activity_log set call_outcome = 'attempted'
 where entity_type = 'deal' and interaction_type = 'call' and call_outcome is null
   and subject = 'Logged call: Attempted';
-- A legacy processor 'reached'/'not_interested' row would also be a conversation.
update public.activity_log set call_outcome = 'reached'
 where entity_type = 'deal' and interaction_type = 'call' and call_outcome is null
   and subject like 'Contact attempt — processor: reached%';
update public.activity_log set call_outcome = 'not_interested'
 where entity_type = 'deal' and interaction_type = 'call' and call_outcome is null
   and subject like 'Contact attempt — processor: not_interested%';

-- ── deal_call_events: the activity branch can now say "a human spoke" ───────
drop function if exists public.deal_call_events(uuid[]);

create function public.deal_call_events(p_deal_ids uuid[])
returns table (
  deal_id         uuid,
  at              timestamptz,
  source          text,
  src_rank        int,
  disposition     text,
  seconds         int,
  who             text,
  note            text,
  is_conversation boolean,
  -- WHICH SOURCE ATTESTED the conversation — not which row survived the dedupe.
  -- A setter who dials through WAVV and logs "Not interested" leaves a 60-second
  -- WAVV row that survives and a hand-logged row that is absorbed. The call IS a
  -- conversation, on the setter's word, and saying 'wavv' there would claim it
  -- was attested by call DURATION — precisely the misrepresentation the owner's
  -- ruling exists to prevent. Duration wins when both attest.
  conversation_source text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with windowed as (
    select d.id, d.customer_id, d.created_at, c.phone,
           -- No time cap. Bounded only by the previous genuine RE-ENTRY: within
           -- one engagement this deal is the only record that can hold the
           -- merchant's history, so it holds all of it. A duplicate record
           -- minutes earlier is the same engagement and does not bound anything.
           (select max(d0.created_at) - interval '30 minutes'
              from public.deals d0
             where d0.customer_id = d.customer_id
               and d0.created_at < d.created_at - interval '24 hours') as win_lo,
           -- Up to the next genuine re-entry's claim.
           (select min(d2.created_at) - interval '30 minutes'
              from public.deals d2
             where d2.customer_id = d.customer_id
               and d2.created_at > d.created_at + interval '24 hours') as win_hi
      from public.deals d
      join public.customers c on c.id = d.customer_id
     where d.id = any (p_deal_ids)
  ),
  raw_calls as (
    -- 1. WAVV — the primary dialer. Phone-keyed, so attributed by the window.
    select x.id                                           as deal_id,
           w.started_at                                   as at,
           'wavv'::text                                   as source,
           1                                              as src_rank,
           -- WAVV writes the literal string 'None' when the setter hung up
           -- without picking a disposition row. Rendering "— None" next to a
           -- call reads as a result; falling through to the outcome says what
           -- actually happened.
           coalesce(
             nullif(nullif(btrim(w.disposition), ''), 'None'),
             initcap(replace(lower(coalesce(w.outcome, 'call')), '_', ' '))
           )                                              as disposition,
           w.seconds                                      as seconds,
           coalesce(
             nullif(btrim(w.agent_name), ''),
             nullif(btrim(concat_ws(' ', wc.first_name, wc.last_name)), '')
           )                                              as who,
           nullif(btrim(coalesce(w.note, '')), '')        as note,
           (    w.direction = 'outbound'
            and coalesce(w.seconds, 0) >= 120
            and upper(coalesce(w.outcome, '')) <> 'VOICEMAIL') as is_conversation
      from windowed x
      join public.wavv_calls w
        on x.phone is not null
       and right(regexp_replace(w.phone, '[^0-9]', '', 'g'), 10)
         = right(regexp_replace(x.phone, '[^0-9]', '', 'g'), 10)
       and right(regexp_replace(x.phone, '[^0-9]', '', 'g'), 10) <> ''
       and (x.win_lo is null or w.started_at >= x.win_lo)
       and (x.win_hi is null or w.started_at < x.win_hi)
      left join public.closers wc on wc.ghl_user_id = w.agent_key

    union all

    -- 2. GHL / LeadConnector calls, already keyed to the deal.
    select x.id, g.called_at, 'ghl', 2,
           coalesce(nullif(btrim(g.disposition), ''),
                    initcap(nullif(btrim(g.call_status), ''))),
           g.duration_seconds,
           coalesce(
             nullif(btrim(g.ghl_user_name), ''),
             nullif(btrim(concat_ws(' ', gc.first_name, gc.last_name)), '')
           ),
           null::text,
           -- spokeCall() in _shared/ghlCallSync.ts, restated. Keep in lockstep.
           (g.call_status = 'completed' and coalesce(g.duration_seconds, 0) >= 120)
      from windowed x
      join public.ghl_call_log g on g.deal_id = x.id
      left join public.closers gc on gc.ghl_user_id = g.ghl_user_id

    union all

    -- 3. activity_log call rows: every hand-logged dial (log_contact_attempt)
    --    plus the GHL hook's own mirror of (2), which the dedupe removes.
    select x.id, al.created_at, 'activity', 3,
           nullif(btrim(al.subject), ''),
           null::int,
           coalesce(
             nullif(btrim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
             (regexp_match(al.subject, '— by (.+)$'))[1]
           ),
           nullif(btrim(left(coalesce(al.content, ''), 160)), ''),
           -- A hand-logged row has no duration, so the 2-minute bar cannot
           -- apply. The OTHER half of the badge's promise — "a human confirmed
           -- it" — is answered here, from the STRUCTURED disposition the logger
           -- stores, never from the subject prose. Owner ruling 2026-09-16: a
           -- setter's own report counts, and deals.spoke_at_source records that
           -- it was theirs. NULL call_outcome (pre-20260916p rows, GHL hook
           -- mirrors) is not a conversation.
           (al.call_outcome in ('reached', 'not_interested', 'callback_spoke'))
      from windowed x
      join public.activity_log al
        on al.entity_type = 'deal' and al.entity_id = x.id
       and al.interaction_type = 'call'
      left join public.profiles ap on ap.id = al.logged_by
  )
  -- THE canonical dedupe: a row dies only to a STRICTLY higher-ranked row on the
  -- same deal within 180s plus the keeper's own duration. Never within a source.
  select k.deal_id, k.at, k.source, k.src_rank, k.disposition, k.seconds, k.who,
         k.note,
         (k.conversation_source is not null) as is_conversation,
         k.conversation_source
    from (
      select r.deal_id, r.at, r.source, r.src_rank, r.disposition, r.seconds,
             r.who, r.note,
             -- DEDUPE MERGES A CALL, IT DOES NOT FORGET WHAT WE KNEW ABOUT IT.
             -- The survivor inherits the attestation of any lower-ranked row it
             -- absorbed. Without this the feature would never fire in the one
             -- workflow that matters: a setter dials through WAVV and then logs
             -- the disposition, so the attestation lands ~60s after its own WAVV
             -- row, is dropped as a duplicate, and its "a human spoke" is lost —
             -- while the surviving WAVV row says false because the call ran under
             -- 120 seconds. Measured on MF-2026-0162 (WAVV 15:14:44, logged
             -- 15:15:47) and MF-2026-0165 (15:16:46 / 15:17:55): both stamped
             -- nothing until this was fixed. Dedupe exists to stop one call being
             -- COUNTED twice, never to discard evidence about it.
             coalesce(
               case when r.is_conversation then r.source end,
               (select k2.source
                  from raw_calls k2
                 where k2.deal_id = r.deal_id
                   and k2.src_rank > r.src_rank
                   and k2.is_conversation
                   and abs(extract(epoch from (r.at - k2.at)))
                       <= 180 + coalesce(r.seconds, 0)
                 order by k2.src_rank asc
                 limit 1)
             ) as conversation_source
        from raw_calls r
       where not exists (
         select 1
           from raw_calls k3
          where k3.deal_id = r.deal_id
            and k3.src_rank < r.src_rank
            and abs(extract(epoch from (k3.at - r.at))) <= 180 + coalesce(k3.seconds, 0)
       )
    ) k;
$function$;

revoke all on function public.deal_call_events(uuid[]) from public, anon, authenticated;
grant execute on function public.deal_call_events(uuid[]) to service_role;

comment on function public.deal_call_events(uuid[]) is
  'THE definition of the calls on a deal: wavv_calls (phone-matched inside the deal''s window) + ghl_call_log + activity_log ''call'' rows, deduped rank wavv>ghl>activity by 180s + the keeper''s duration, never within a source. ⚠ THE WINDOW (win_lo/win_hi) SCOPES THE WAVV BRANCH ONLY — WAVV is phone-keyed so it needs attribution; ghl_call_log and activity_log are deal-keyed and pass through unwindowed, so they CAN predate the deal''s own created_at (measured 2026-09-16: 91 deals, 110 GHL rows, worst 14). Any "since arrival" rule therefore belongs on the unified event stream, never inside the window. Window: the deal''s whole ENGAGEMENT — no time cap either way, bounded only by the previous and next genuine re-entry; a sibling within 24 HOURS is a DUPLICATE, not a re-entry. is_conversation marks a real two-way conversation per source — WAVV: outbound, >=120s, outcome <> VOICEMAIL; GHL: completed and >=120s; HAND-LOGGED: call_outcome in (reached, not_interested, callback_spoke), the structured disposition, never the subject string. NO VISIBILITY CHECK — callers must authorise and filter the deal ids first, hence service_role only.';

-- ── apply_spoke_at_from_calls: carry the provenance with the stamp ──────────

create or replace function public.apply_spoke_at_from_calls(p_deal_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n integer;
begin
  if p_deal_ids is null or array_length(p_deal_ids, 1) is null then
    return 0;
  end if;

  with conv as (
    -- The EARLIEST attested conversation, and what attested it. distinct on
    -- keeps the winning row's source rather than re-deriving it, so the stamp
    -- and its provenance can never disagree.
    select distinct on (e.deal_id)
           e.deal_id,
           e.at as first_conv_at,
           -- The ATTESTING source, not the surviving row's source: a 60-second
           -- WAVV call that is a conversation only because the setter said so
           -- must record hand_logged, never wavv.
           case e.conversation_source when 'activity' then 'hand_logged'
                                      else e.conversation_source end as src
      from public.deal_call_events(p_deal_ids) e
     where e.is_conversation
     order by e.deal_id, e.at asc
  ),
  upd as (
    update public.deals d
       set spoke_at        = c.first_conv_at,
           spoke_at_source = c.src
      from conv c
     where d.id = c.deal_id
       -- EARLIEST real conversation wins and a stamp is NEVER pushed later.
       -- The third clause fills or corrects provenance without moving the time,
       -- which is what lets this backfill the stamps that predate the column.
       and (d.spoke_at is null
            or c.first_conv_at < d.spoke_at
            or (d.spoke_at = c.first_conv_at
                and d.spoke_at_source is distinct from c.src))
     returning d.id
  )
  select count(*) into v_n from upd;

  return coalesce(v_n, 0);
end;
$function$;

revoke all on function public.apply_spoke_at_from_calls(uuid[]) from public, anon, authenticated;
grant execute on function public.apply_spoke_at_from_calls(uuid[]) to service_role;

comment on function public.apply_spoke_at_from_calls(uuid[]) is
  'Stamps deals.spoke_at AND deals.spoke_at_source from the canonical call events (deal_call_events.is_conversation). Earliest real conversation wins; a stamp is never moved later; provenance always travels with the winning event. Returns the number of deals changed. Fired by the wavv_calls triggers, by log_contact_attempt for a hand-logged conversation (no wavv row exists for those, so no trigger can fire), and safe to run as a backfill over any set of deal ids.';

-- ── log_contact_attempt: store the disposition, and drive its own stamp ─────
CREATE OR REPLACE FUNCTION public.log_contact_attempt(p_deal_id uuid, p_outcome text, p_channel text DEFAULT 'call'::text, p_label text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_callback_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_spoke boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      (entity_type, entity_id, interaction_type, subject, content, logged_by,
       call_outcome)
    values ('deal', p_deal_id, 'call', 'Logged call: ' || v_label,
            nullif(btrim(coalesce(p_note, '')), ''), v_uid,
            -- STRUCTURED disposition, so nothing downstream has to parse the
            -- subject prose to know whether a human actually spoke. A callback
            -- the merchant ANSWERED is its own value, which keeps p_spoke
            -- losslessly in one column.
            case when v_outcome = 'callback' and coalesce(p_spoke, false)
                 then 'callback_spoke' else v_outcome end);

    -- A hand-logged conversation is the setter's own attestation, and the
    -- wavv_calls triggers cannot see it — no WAVV row exists. So this path
    -- drives its own stamp. apply_spoke_at_from_calls keeps earliest-wins and
    -- never-forward in ONE place, and records spoke_at_source = 'hand_logged'
    -- so the badge can say whose word it is (owner ruling 2026-09-16: a
    -- setter's report counts, provided it stays visibly distinguishable from a
    -- conversation attested by call duration).
    if v_reached then
      perform public.apply_spoke_at_from_calls(array[p_deal_id]);
    end if;
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

-- ── Backfill: provenance for every existing stamp, and the 2 new ones ───────
select public.apply_spoke_at_from_calls(array(select id from public.deals)) as deals_changed;
