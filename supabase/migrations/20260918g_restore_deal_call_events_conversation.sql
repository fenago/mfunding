-- 🚨 REGRESSION FIX: I dropped five migrations' worth of deal_call_events and
-- took wavv-sync down with it.
--
-- WHAT HAPPENED. 20260918d needed to add `disposition_source` to
-- deal_call_events. A return-type change means drop + create, and I rebuilt the
-- body from the definition I had read — 20260916h — without checking whether it
-- was still the CURRENT one. It was not. Five later migrations had rewritten
-- that function, and recreating it from the old text silently reverted all of
-- them:
--
--   20260916i  is_conversation (per-source, the lockstep dialer rules)
--   20260916j  the engagement WINDOW (win_lo/win_hi) replacing created_at-30min
--   20260916k  a sibling deal within 24h is a DUPLICATE, not a re-entry
--   20260916n  the window scopes the WAVV branch ONLY
--   20260916p  conversation_source + the hand-logged structured disposition,
--              and the dedupe INHERITANCE rule
--
-- THE OUTAGE. apply_spoke_at_from_calls() reads e.is_conversation and
-- e.conversation_source. Both vanished, so the function raised 42703 — and it is
-- called by the statement triggers on wavv_calls. Every INSERT or UPDATE whose
-- new rows contained an outbound call of 120s+ therefore FAILED, which is most
-- of a working dial floor. wavv-sync stopped ingesting at 19:50Z:
--
--   last_error: "upsert failed: column e.conversation_source does not exist"
--   watermark : stuck at 2026-09-18T19:40:00Z while the floor kept dialling
--
-- The sync behaved correctly under the failure — it refused to advance the
-- watermark past data it had not read, so NOTHING IS LOST; it just stopped. The
-- calls are still in WAVV and the next successful run walks the window from the
-- stuck watermark. That is the design working exactly as its comments promise.
--
-- HOW IT SURFACED. Not from a monitor — from the stub re-pull failing on the two
-- rows it was built to recover, with "errors: 2" and no reason attached, because
-- I had also not recorded the error text. Two readability failures stacked: a
-- function silently losing columns, and a sweep reporting a count without a
-- cause. The second one is fixed in the same breath (see wavv-sync).
--
-- THE LESSON, and it is the one already written down: THE REPO IS THE RECORD OF
-- INTENT, THE CATALOG IS THE RECORD OF TRUTH. Before re-creating any function,
-- read the LIVE definition (pg_get_functiondef), not the migration that first
-- introduced it. A `create or replace` that only ADDS a column would have failed
-- loudly on the return type instead; `drop + create` from stale text fails
-- silently and takes the newest behaviour with it.
--
-- ── WHAT THIS RESTORES ──────────────────────────────────────────────────────
-- 20260916p's body, VERBATIM, plus the only two things 20260918d/e legitimately
-- added:
--   • the WAVV branch may take a DERIVED disposition when the setter typed none
--     (v_wavv_derived_dispositions, which is itself unaffected by this bug), and
--   • `disposition_source` — 'typed' | 'derived' | NULL — so no surface can
--     print a derived value as though a setter typed it.
-- Nothing else about the function changes from 20260916p.

begin;

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
  conversation_source text,
  -- 'typed' | 'derived' | NULL. Separate from conversation_source on purpose:
  -- that one says who ATTESTED A CONVERSATION, this one says whether the
  -- DISPOSITION was chosen by a human or inferred from an artifact.
  disposition_source text
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
           -- actually happened. A DERIVED disposition sits between the two: it
           -- is not what the setter typed, but it is better evidence than the
           -- raw outcome, and disposition_source keeps the difference visible.
           coalesce(
             nullif(nullif(btrim(w.disposition), ''), 'None'),
             dd.derived_disposition,
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
            and upper(coalesce(w.outcome, '')) <> 'VOICEMAIL') as is_conversation,
           case
             when nullif(nullif(btrim(w.disposition), ''), 'None') is not null then 'typed'
             when dd.derived_disposition is not null                           then 'derived'
           end                                            as disposition_source
      from windowed x
      join public.wavv_calls w
        on x.phone is not null
       and right(regexp_replace(w.phone, '[^0-9]', '', 'g'), 10)
         = right(regexp_replace(x.phone, '[^0-9]', '', 'g'), 10)
       and right(regexp_replace(x.phone, '[^0-9]', '', 'g'), 10) <> ''
       and (x.win_lo is null or w.started_at >= x.win_lo)
       and (x.win_hi is null or w.started_at < x.win_hi)
      left join public.closers wc on wc.ghl_user_id = w.agent_key
      left join public.v_wavv_derived_dispositions dd on dd.wavv_call_id = w.wavv_call_id

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
           (g.call_status = 'completed' and coalesce(g.duration_seconds, 0) >= 120),
           case when nullif(btrim(g.disposition), '') is not null then 'typed' end
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
           (al.call_outcome in ('reached', 'not_interested', 'callback_spoke')),
           -- A hand-logged row IS somebody's typed record of the call.
           case when nullif(btrim(al.subject), '') is not null then 'typed' end
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
         k.conversation_source,
         k.disposition_source
    from (
      select r.deal_id, r.at, r.source, r.src_rank, r.disposition, r.seconds,
             r.who, r.note, r.disposition_source,
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
  'THE definition of the calls on a deal: wavv_calls (phone-matched inside the deal''s window) + ghl_call_log + activity_log ''call'' rows, deduped rank wavv>ghl>activity by 180s + the keeper''s duration, never within a source. ⚠ THE WINDOW (win_lo/win_hi) SCOPES THE WAVV BRANCH ONLY — WAVV is phone-keyed so it needs attribution; ghl_call_log and activity_log are deal-keyed and pass through unwindowed. Window: the deal''s whole ENGAGEMENT — bounded only by the previous and next genuine re-entry; a sibling within 24 HOURS is a DUPLICATE, not a re-entry. is_conversation marks a real two-way conversation per source — WAVV: outbound, >=120s, outcome <> VOICEMAIL; GHL: completed and >=120s; HAND-LOGGED: call_outcome in (reached, not_interested, callback_spoke), never the subject string — and a dedupe survivor INHERITS it from any row it absorbed. conversation_source names the source that ATTESTED. disposition_source (''typed''|''derived''|NULL) is a DIFFERENT question: whether the disposition was chosen by a human or inferred from an artifact by v_wavv_derived_dispositions. NO VISIBILITY CHECK — callers must authorise and filter the deal ids first, hence service_role only.';

commit;
