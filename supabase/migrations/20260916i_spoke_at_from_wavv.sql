-- spoke_at: the fourth WAVV blind spot. ═════════════════════════════════════
--
-- deals.spoke_at is written by exactly ONE thing: ghl_apply_call_telemetry, fed
-- by ghlCallSync's spokeCall() — status 'completed' AND duration >= 120s. WAVV,
-- the dialer the setters actually use, never wrote it. The column went silently
-- dead on 2026-09-07 while WAVV kept dialing; the most recent WAVV conversation
-- it failed to recognise was 2026-09-15 21:05Z, a 845-second call.
--
-- This is the fourth column in the same blind spot, after contact_attempts,
-- first_attempt_at and last_attempt_at — but it is the worst one to lose,
-- because spoke_at is the STRONGEST POSITIVE signal in the app. MyDayQueue and
-- HotLeadsPanel both render "🗣 Spoke ✓" from it, tooltipped "a human confirmed
-- it or a call ran 2+ minutes"; AssignmentsPanel calls it "the stronger signal".
-- A setter who had a fifteen-minute conversation through WAVV got no credit, and
-- the next person to open that deal saw no evidence anyone had ever spoken to
-- the merchant.
--
-- WHAT COUNTS AS A CONVERSATION, and why it is not just "seconds >= 120".
-- GHL's rule is duration + status='completed', and 'completed' is what excludes
-- a voicemail. WAVV's equivalent of that exclusion is its own outcome: 19 of the
-- 68 long outbound WAVV calls are outcome='VOICEMAIL' — a long recording left on
-- a machine, not a conversation, and 6 of those carry human=true, so WAVV's own
-- answer-machine detection would not have saved us. Duration alone would stamp
-- "🗣 Spoke ✓" on a merchant nobody has ever spoken to, which is a worse lie
-- than the missing badge.
--
-- Deliberately NOT gated on wavv_calls.human: it is an AMD heuristic, it is
-- false on 16 of the long HUNG_UP calls that are plainly real conversations, and
-- GHL's rule uses no such flag. Under-reporting a real conversation is the
-- failure this whole workstream exists to end.
--
-- The conversation test lives in deal_call_events rather than in the stamping
-- function, so every source answers "was this a real conversation" in ONE place,
-- and the deal-window scoping that function already does keeps a call from
-- stamping a deal it never belonged to.

-- ── 1. deal_call_events grows one column: is_conversation ────────────────────
-- Return type changes, so it must be dropped first. The three readers resolve it
-- by name at runtime and select named columns, so none of them need a change.

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
  -- TRUE only for a call we can stand behind as a real two-way conversation.
  -- Per source, because "completed" means something different in each system.
  is_conversation boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with windowed as (
    -- Where this deal's claim on the customer's phone history ends: the next
    -- deal the same customer opened. Calls from then on belong to THAT deal.
    select d.id, d.customer_id, d.created_at, c.phone,
           (select min(d2.created_at)
              from public.deals d2
             where d2.customer_id = d.customer_id
               and d2.created_at > d.created_at) as next_deal_at
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
           -- agent_name is NULL on every live wavv_calls row, so
           -- closers.ghl_user_id is the ONLY way this row can say who dialed.
           coalesce(
             nullif(btrim(w.agent_name), ''),
             nullif(btrim(concat_ws(' ', wc.first_name, wc.last_name)), '')
           )                                              as who,
           nullif(btrim(coalesce(w.note, '')), '')        as note,
           -- See the header: duration + outbound + NOT a voicemail.
           (    w.direction = 'outbound'
            and coalesce(w.seconds, 0) >= 120
            and upper(coalesce(w.outcome, '')) <> 'VOICEMAIL') as is_conversation
      from windowed x
      join public.wavv_calls w
        on x.phone is not null
       and right(regexp_replace(w.phone, '[^0-9]', '', 'g'), 10)
         = right(regexp_replace(x.phone, '[^0-9]', '', 'g'), 10)
       and right(regexp_replace(x.phone, '[^0-9]', '', 'g'), 10) <> ''
       and w.started_at >= x.created_at - interval '30 minutes'
       and (x.next_deal_at is null
            or w.started_at < x.next_deal_at - interval '30 minutes')
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
           -- A hand-logged row carries no duration, so it cannot meet the 2-minute
           -- bar. The OTHER half of the badge's promise — "a human confirmed it" —
           -- has no writer anywhere in the app today; see the migration notes.
           -- Claiming it here would let a setter self-certify the strongest signal
           -- in the product by clicking a button, which is a policy decision, not
           -- a data-plumbing one.
           false
      from windowed x
      join public.activity_log al
        on al.entity_type = 'deal' and al.entity_id = x.id
       and al.interaction_type = 'call'
      left join public.profiles ap on ap.id = al.logged_by
  )
  -- THE canonical dedupe: a row dies only to a STRICTLY higher-ranked row on the
  -- same deal within 180s plus the keeper's own duration. Never within a source,
  -- so two genuine dials logged a minute apart both count.
  select r.deal_id, r.at, r.source, r.src_rank, r.disposition, r.seconds, r.who,
         r.note, r.is_conversation
    from raw_calls r
   where not exists (
     select 1
       from raw_calls k
      where k.deal_id = r.deal_id
        and k.src_rank < r.src_rank
        and abs(extract(epoch from (k.at - r.at))) <= 180 + coalesce(k.seconds, 0)
   );
$function$;

revoke all on function public.deal_call_events(uuid[]) from public, anon, authenticated;
grant execute on function public.deal_call_events(uuid[]) to service_role;

comment on function public.deal_call_events(uuid[]) is
  'THE definition of the calls on a deal: wavv_calls (phone-matched inside the deal''s created_at window) + ghl_call_log + activity_log ''call'' rows, deduped rank wavv>ghl>activity by 180s + the keeper''s duration, never within a source. is_conversation marks a real two-way conversation per source (WAVV: outbound, >=120s, outcome <> VOICEMAIL; GHL: completed and >=120s; hand-logged: never, no duration exists). NO VISIBILITY CHECK — callers must authorise and filter the deal ids first, which is why it is granted to service_role only. Read by realtime_lead_call_history, processor_deal_detail, processor_pipeline_rows and apply_spoke_at_from_calls.';

-- ── 2. The stamper ──────────────────────────────────────────────────────────

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
    select e.deal_id, min(e.at) as first_conv_at
      from public.deal_call_events(p_deal_ids) e
     where e.is_conversation
     group by e.deal_id
  ),
  upd as (
    update public.deals d
       set spoke_at = c.first_conv_at
      from conv c
     where d.id = c.deal_id
       -- EARLIEST real conversation wins, and an existing stamp is never pushed
       -- LATER. ghl_apply_call_telemetry uses coalesce (strict write-once); this
       -- is that, plus the correction for a stamp we now know was too late.
       and (d.spoke_at is null or c.first_conv_at < d.spoke_at)
     returning d.id
  )
  select count(*) into v_n from upd;

  return coalesce(v_n, 0);
end;
$function$;

revoke all on function public.apply_spoke_at_from_calls(uuid[]) from public, anon, authenticated;
grant execute on function public.apply_spoke_at_from_calls(uuid[]) to service_role;

comment on function public.apply_spoke_at_from_calls(uuid[]) is
  'Stamps deals.spoke_at from the canonical call events (deal_call_events.is_conversation). Earliest real conversation wins; an existing stamp is never moved later. Returns the number of deals changed. Fired automatically by the wavv_calls triggers; also safe to run as a backfill over any set of deal ids.';

-- ── 3. Never let this source go blind again ─────────────────────────────────
-- A trigger on wavv_calls, not a call bolted onto wavv-sync: the stamp then
-- happens no matter which path writes a call row — the 10-minute sync, a
-- backfill, a manual correction — and cannot be forgotten by the next ingest
-- path somebody adds. That forgetting is exactly how the column died.
--
-- The phone match here is only a CANDIDATE filter, deliberately loose. The
-- authoritative decision (deal window, dedupe, conversation test) stays in
-- deal_call_events, so this is not a fifth hand-rolled copy of the matching
-- rule — it just narrows which deals are worth asking about.
--
-- Statement-level with a transition table, and it exits before touching a deal
-- when the batch holds no long call — which is almost every batch, since 49 of
-- the 34,941 outbound WAVV rows qualify. A normal sync pays one filtered scan of
-- its own transition table.

create or replace function public.wavv_calls_stamp_spoke_at()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ids uuid[];
begin
  select array_agg(distinct d.id) into v_ids
    from new_rows n
    join public.customers c
      on c.phone is not null
     and right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10)
       = right(regexp_replace(coalesce(n.phone, ''), '[^0-9]', '', 'g'), 10)
     and right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10) <> ''
    join public.deals d on d.customer_id = c.id
   where n.direction = 'outbound'
     and coalesce(n.seconds, 0) >= 120
     and upper(coalesce(n.outcome, '')) <> 'VOICEMAIL';

  if v_ids is not null then
    perform public.apply_spoke_at_from_calls(v_ids);
  end if;

  return null;
end;
$function$;

comment on function public.wavv_calls_stamp_spoke_at() is
  'Statement trigger on wavv_calls: when a batch lands a long outbound non-voicemail call, re-derive spoke_at for the candidate deals through apply_spoke_at_from_calls. The phone match is a candidate filter only; deal_call_events remains the authority.';

-- A trigger carrying a transition table may name only ONE event, so this is two
-- triggers over one function. UPDATE matters as much as INSERT: wavv-sync
-- upserts, and a call's `seconds` is frequently null on first sight and filled
-- in when the call finalises — that late fill is exactly when a call becomes a
-- conversation.
drop trigger if exists wavv_calls_spoke_at_ins on public.wavv_calls;
create trigger wavv_calls_spoke_at_ins
  after insert on public.wavv_calls
  referencing new table as new_rows
  for each statement execute function public.wavv_calls_stamp_spoke_at();

drop trigger if exists wavv_calls_spoke_at_upd on public.wavv_calls;
create trigger wavv_calls_spoke_at_upd
  after update on public.wavv_calls
  referencing new table as new_rows
  for each statement execute function public.wavv_calls_stamp_spoke_at();

-- ── 4. Backfill ─────────────────────────────────────────────────────────────
-- Same candidate-prefilter shape as the trigger, so the helper stays the single
-- authority over what actually gets stamped.

select public.apply_spoke_at_from_calls(array(
  select distinct d.id
    from public.deals d
    join public.customers c on c.id = d.customer_id
    join public.wavv_calls w
      on c.phone is not null
     and right(regexp_replace(w.phone, '[^0-9]', '', 'g'), 10)
       = right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10)
     and right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10) <> ''
   where w.direction = 'outbound'
     and coalesce(w.seconds, 0) >= 120
     and upper(coalesce(w.outcome, '')) <> 'VOICEMAIL'
)) as deals_stamped;
