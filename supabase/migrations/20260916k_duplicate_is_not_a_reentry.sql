-- A duplicate is not a re-entry. ═══════════════════════════════════════════════
--
-- 20260916j clamped the upper bound so it could not precede a deal's own birth.
-- That stopped the window INVERTING, but it left it a 30-minute sliver ending at
-- the deal's creation — so MF-2026-0255 (docs_collected) saw 2 of the 18 calls
-- placed to that merchant and its DEAD duplicate kept the other 16. A live deal
-- showing 2 calls when 18 were placed is the same lie at lower volume.
--
-- The real error is upstream of both bounds: the window partitions on the next
-- deal for the same CUSTOMER, whatever that deal is. Partitioning is right for a
-- genuine re-entry — a merchant who comes back weeks later is a new engagement
-- and must not inherit the first deal's calls. It is wrong for a DUPLICATE, one
-- merchant entered twice minutes apart inside a single engagement, because there
-- is only one conversation history and both records need it.
--
-- So partition only on a genuine re-entry. The sibling-gap distribution decides
-- where that line goes, and it is not a close call:
--
--     1.3 min · 1.8 · 1.9 · 7.4 · 10.1 · 13.8 min   <- six duplicates
--     53,774.8 min (37.34 days)                     <- one genuine re-entry
--
-- Any threshold between 14 minutes and 37 days gives the same answer on today's
-- data — the decision boundary is three orders of magnitude wide. I picked 24
-- HOURS, not to fit these rows but to survive new ones: it sits ~100x above the
-- largest duplicate we have, so a slower duplicate entry (same merchant keyed
-- again after lunch, or at end of shift) is still absorbed without re-tuning;
-- it sits 37x below the observed genuine re-entry, so real repeat business is
-- never swallowed; and it means something operationally — two records made the
-- same day are one engagement, a record made on a later day is new work.
--
-- Note the clamp from 20260916j is now REDUNDANT and has been removed rather
-- than left as dead insurance: a partitioning sibling is by definition more than
-- 24h later, so `next_real - 30 minutes` is always well after created_at and the
-- window can no longer invert. That invariant holds for any threshold above 30
-- minutes.
--
-- OVERLAP IS THE POINT, and it is on the record as accepted: two records of one
-- merchant both show the conversation, because a setter opening either one needs
-- the history. Nothing sums touches across deals today. If cross-deal
-- aggregation is ever added it must dedupe by CUSTOMER there — never by
-- re-narrowing this window.
--
-- MEASURED BEFORE APPLYING, whole book: 585 WAVV events visible before, 622
-- after. 37 gained, ZERO lost, and exactly the 6 duplicate-pair deals move.
-- Per deal (calls on the phone -> visible before -> visible after):
--   MF-2026-0255 docs_collected  18 -> 2 -> 17
--   MF-2026-0226 application_sent 8 -> 1 -> 8
--   MF-2026-0267                  7 -> 1 -> 7
--   MF-2026-0236                  9 -> 3 -> 8
--   MF-2026-0272 nurture         16 -> 1 -> 4   (see the note below)
-- Control: MF-2026-0033/0034 (7 min apart) stop partitioning each other, while
-- MF-2026-0242 at 37 days still does — its 2026-09-08 call stays on 0242 alone.
--
-- MF-2026-0272 RECOVERS ONLY 4 OF 16, and that is a DIFFERENT problem, left
-- alone deliberately. Its other calls precede created_at - 8h entirely: it is a
-- ucc_list lead dialed 12 times over 8 days BEFORE anyone made a deal record,
-- which is the aged-lead pattern, not live transfer. No time offset from
-- created_at can fix that, because on an aged lead created_at says nothing about
-- when work began. The honest lower bound there is "everything back to the
-- previous genuine re-entry, with no time cap" — measured at +94 events across
-- 44 deals, 0 lost, no deal gaining more than 20. That is a change to every
-- deal, not to these six, so it is reported rather than slipped in here.

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
           -- A call can belong to this deal from one shift before it was written
           -- up, but never back into a previous ENGAGEMENT's era. A duplicate
           -- record minutes earlier is the same engagement and does not bound it.
           greatest(
             (select max(d0.created_at) from public.deals d0
               where d0.customer_id = d.customer_id
                 and d0.created_at < d.created_at - interval '24 hours') - interval '30 minutes',
             d.created_at - interval '8 hours'
           ) as win_lo,
           -- Up to the next genuine RE-ENTRY's claim. A duplicate entered the
           -- same day does not partition: both records share one history.
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
  'THE definition of the calls on a deal: wavv_calls (phone-matched inside the deal''s window) + ghl_call_log + activity_log ''call'' rows, deduped rank wavv>ghl>activity by 180s + the keeper''s duration, never within a source. Window: from one shift (8h) before created_at, bounded by the previous genuine re-entry, up to the next genuine re-entry. A sibling deal for the same customer within 24 HOURS is a DUPLICATE, not a re-entry: it does not partition, so both records carry the one conversation history. is_conversation marks a real two-way conversation per source (WAVV: outbound, >=120s, outcome <> VOICEMAIL; GHL: completed and >=120s; hand-logged: never). NO VISIBILITY CHECK — callers must authorise and filter the deal ids first, hence service_role only.';

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
