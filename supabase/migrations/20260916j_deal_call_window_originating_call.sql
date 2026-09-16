-- The deal window hid the call that created the deal. ═══════════════════════
--
-- deal_call_events attributes a phone-keyed WAVV call to a deal by a window
-- around the deal's created_at. Two bounds, and BOTH were wrong at the edges:
--
--   lower  created_at - 30 minutes
--   upper  next_sibling_created_at - 30 minutes   (same CUSTOMER's next deal)
--
-- THE UPPER BOUND INVERTS ON DUPLICATE ENTRIES. When a merchant is entered
-- twice minutes apart — which is what every sibling pair in this book actually
-- is, median gap 7 minutes — `next_created - 30m` lands BEFORE this deal's own
-- creation. The window then covers only a sliver strictly before the deal
-- existed, and no call at or after its creation can ever belong to it:
--
--   MF-2026-0236 created 19:41:39, sibling 0237 created 14 min later
--     -> window [19:11:39 .. 19:25:26), closing 16 minutes before it is born
--     -> its 305s originating conversation at 19:40:22 lands on 0237 only.
--
-- 0237 is DEAD and holds the proof of conversation; 0236 is live and shows
-- none. MF-2026-0255 is worse — docs_collected, a merchant who has submitted
-- documents, with no evidence anyone ever spoke to them, while its dead
-- duplicate 0256 holds the stamp.
--
-- THE LOWER BOUND IS TOO SHORT FOR A LATE-CREATED DEAL. A setter has the
-- conversation and then makes the record, so the originating call is always
-- before created_at. 30 minutes covers 18 of the 21 such conversations we have;
-- the other 3 run 124, 147 and 423 minutes early — the setter wrote the deal up
-- later in the same shift.
--
-- FIXED BOUNDS:
--   lower  greatest(prev_sibling_created_at - 30m, created_at - 8 hours)
--   upper  next_sibling is null ? unbounded
--                               : greatest(next_created - 30m, created_at)
--
-- 8 hours is one working shift — the concept the bound is actually reaching
-- for, and comfortably over the 423-minute worst case observed. It is short
-- enough that a prior campaign's calls (days or weeks earlier) still cannot
-- reach, which is what TouchTracker's "older history stays out of this deal"
-- comment depends on. And it is clamped by the PREVIOUS sibling, so a lookback
-- can never reach into an earlier deal's era no matter how long the shift.
--
-- The upper clamp makes the two windows OVERLAP when siblings are created less
-- than 30 minutes apart, so one conversation attaches to BOTH duplicate records.
-- That is deliberate and it is the point: a conversation with a merchant is
-- evidence on every open record for that merchant, and the alternative —
-- picking one winner — leaves the loser looking untouched, which is the exact
-- symptom this work exists to kill. Nothing sums touches ACROSS deals today;
-- every surface reports them per deal. Anything that ever does sum across deals
-- must dedupe the duplicate-merchant case itself.
--
-- MEASURED BEFORE APPLYING, whole book: 558 WAVV events visible before, 585
-- after. 27 gained, ZERO lost, 18 deals affected, 7 conversations newly visible
-- on 7 deals. The "must be 0" check on lost events caught a real bug in the
-- first draft of this expression — greatest(NULL, created_at) collapses the
-- unbounded upper window to the creation instant and would have hidden 498
-- events.

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
  is_conversation boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with windowed as (
    select d.id, d.customer_id, d.created_at, c.phone,
           -- A call can belong to this deal from one shift before it was
           -- written up, but never back into a previous deal's era.
           greatest(
             (select max(d0.created_at) from public.deals d0
               where d0.customer_id = d.customer_id
                 and d0.created_at < d.created_at) - interval '30 minutes',
             d.created_at - interval '8 hours'
           ) as win_lo,
           -- Up to the next deal's claim — but NEVER before this deal existed.
           (select case when min(d2.created_at) is null then null
                        else greatest(min(d2.created_at) - interval '30 minutes',
                                      d.created_at)
                   end
              from public.deals d2
             where d2.customer_id = d.customer_id
               and d2.created_at > d.created_at) as win_hi
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
       and w.started_at >= x.win_lo
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
           -- A hand-logged row carries no duration, so it cannot meet the
           -- 2-minute bar. The other half of the badge's promise — "a human
           -- confirmed it" — is an open policy question, not plumbing.
           false
      from windowed x
      join public.activity_log al
        on al.entity_type = 'deal' and al.entity_id = x.id
       and al.interaction_type = 'call'
      left join public.profiles ap on ap.id = al.logged_by
  )
  -- THE canonical dedupe: a row dies only to a STRICTLY higher-ranked row on the
  -- same deal within 180s plus the keeper's own duration. Never within a source.
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
  'THE definition of the calls on a deal: wavv_calls (phone-matched inside the deal''s window) + ghl_call_log + activity_log ''call'' rows, deduped rank wavv>ghl>activity by 180s + the keeper''s duration, never within a source. Window: from one shift (8h) before created_at but never into a previous sibling deal''s era, up to the next sibling''s claim but NEVER before this deal existed — that clamp is what lets a duplicate-entry pair BOTH carry the conversation that created them, instead of the dead duplicate holding the only proof. is_conversation marks a real two-way conversation per source (WAVV: outbound, >=120s, outcome <> VOICEMAIL; GHL: completed and >=120s; hand-logged: never). NO VISIBILITY CHECK — callers must authorise and filter the deal ids first, hence service_role only.';

-- Re-derive spoke_at over every deal the widened window can now see a
-- conversation for. Same candidate prefilter as the trigger; the helper decides.
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
)) as deals_restamped;
