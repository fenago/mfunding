-- 20260916b — Setter Performance counts EVERY dial, not just the WAVV ones.
--
-- WHY. Owner report 2026-09-16: "In the setter performance tab, I want to make
-- sure that dials include ALL of the dials, including dials from GHL, WAVV,
-- everything. It looks like we were underreporting stuff."
--
-- He is right, and the gap is one whole source. Measured on the live DB today,
-- last 30 days:
--
--   wavv_calls                    34,757 rows (34,716 outbound)  ← all the page read
--   ghl_call_log  outbound           473 rows                    ← counted NOWHERE
--   ghl_call_log  inbound             48 rows
--
--   Of those 473 GHL outbound dials, 458 are Kristine Gidoc's. Her scorecard
--   understated her by 458 calls in a month, and because every funnel rate on
--   that page divides by dials, the answer / conversation / positive rates were
--   computed on the wrong denominator too.
--
-- These are NOT the same physical calls twice. A wavv_calls row is a dialer
-- session inside VibeReach; a ghl_call_log row is a click-to-call placed from
-- the Revenue Playbook. They even use different outbound lines — WAVV dials from
-- 954 335 4964 / 954 245 0661, LeadConnector from 954 737 3440 / 954 737 5692.
--
-- ── DEDUPE (the one thing worse than undercounting) ─────────────────────────
-- A physical call CAN land in both tables, so a naive union would inflate a
-- person's scorecard — which is a worse failure than the undercount being fixed,
-- because an inflated dial count is a number somebody is paid against.
--
-- RULE, borrowed verbatim in shape from 20260916a_realtime_lead_call_history.sql
-- so this project has ONE definition of "the same call seen twice":
--   sources rank wavv(1) > ghl_call_log(2) — the dialer's own record wins — and a
--   GHL row is dropped when a WAVV outbound row to the SAME merchant phone (last
--   10 digits) started within 180 seconds of it, widened by the WAVV call's own
--   duration. The duration term matters because the two systems stamp different
--   ends of the call. Dedupe NEVER applies within a source: two WAVV rows 30
--   seconds apart are two genuine redials, and collapsing them would recreate the
--   undercount from the other direction.
-- Measured today: 3 of the 473 GHL outbound rows have a WAVV twin. Small, and
-- removed anyway.
--
-- ── WHAT A GHL ROW CAN AND CANNOT SAY ───────────────────────────────────────
-- ghl_call_log carries direction, call_status, duration_seconds and (in theory)
-- disposition. Measured: disposition is NULL on 519 of the 521 rows in 30 days.
-- So a GHL row can honestly answer "was this a dial" and "was it answered", and
-- it cannot answer "did a human pick up", "was it a conversation" or "what was
-- the outcome" — WAVV's dispositions are typed by the setter and GHL's UI never
-- asks for one.
--
-- This view therefore does NOT invent the missing concepts:
--   • outcome   = call_status VERBATIM, lower-case as GHL wrote it
--                 ('completed', 'no-answer', 'busy'). Deliberately NOT folded
--                 into WAVV's upper-case vocabulary (VOICEMAIL, NO_ANSWER, …):
--                 keeping the two spellings apart means the outcome breakdown
--                 shows them as separate rows instead of silently merging two
--                 different measurement systems under one label.
--   • human     = NULL (unknown), never false and never true.
--   • recorded  = NULL (unknown).
--   • disposition = whatever GHL actually has, i.e. almost always NULL, which is
--                 exactly what makes these rows drop out of the Conversations /
--                 Positives rungs by construction rather than by a special case.
-- SetterPerformancePage.tsx additionally excludes source='ghl' from the human
-- rung and from its step DENOMINATOR, and says so on the card.
--
-- ── ATTRIBUTION ─────────────────────────────────────────────────────────────
-- WAVV rows are attributed by caller_id through the admin-maintained
-- wavv_caller_setters map, because WAVV's call object names no agent. GHL rows
-- need none of that: GHL stamps the user on the call. ghl_user_id resolves to a
-- person through closers.ghl_user_id -> closers.user_id (= profiles.id), which is
-- the SAME id space setter_id already lives in, so a person's GHL dials land on
-- their existing scorecard row rather than on a second one.
-- A GHL user with no closers row (Khalil Lyons, 3 dials) keeps setter_name — we
-- genuinely know who dialed — but gets setter_id NULL and is_attributed false,
-- so his pipeline columns render "—" instead of an invented zero.
--
-- ── AUTHORIZATION ───────────────────────────────────────────────────────────
-- security_invoker, so both underlying RLS policies still govern. wavv_calls
-- grants read to closer/employee/admin/super_admin; ghl_call_log grants read to
-- is_ops_staff (admin/super_admin/employee). Setter Performance is an admin /
-- super_admin route, and admin+super_admin satisfy BOTH policies, so no session
-- that can open this page can read one source and silently miss the other.
-- No new SECURITY DEFINER function is introduced here and no money wall is
-- re-stated, so there is no is_processor()/is_ops_staff() gate to duplicate.
--
-- ── INBOUND ─────────────────────────────────────────────────────────────────
-- Excluded, on purpose. This page is "Dial funnel (OUTBOUND)" and an inbound
-- call is not a dial; folding the 48 inbound rows in would let a setter's
-- scorecard rise because merchants called THEM. The base WAVV view already
-- filters direction='outbound' for the same reason. Those inbound calls are not
-- lost — they are what realtime_lead_call_history() and the deal timeline show.

-- The view filters ghl_call_log by called_at, but the only index on that column
-- leads with deal_id, so the range scan degrades to a full index scan. The table
-- is 885 rows today and this costs nothing either way — it is here so that the
-- page's 18 parallel range queries stay cheap as the push hook keeps writing.
create index if not exists ghl_call_log_called_at_idx
  on public.ghl_call_log (called_at desc);

drop view if exists public.v_setter_dial_calls;

create view public.v_setter_dial_calls
with (security_invoker = true) as

  -- ── 1. WAVV: every column exactly as the page has always read it ──────────
  select
    v.wavv_call_id,
    'wavv'::text                as source,
    v.started_at,
    v.answered_at,
    v.ended_at,
    v.seconds,
    v.outcome,
    v.disposition,
    v.human,
    v.recorded,
    v.phone,
    v.contact_id,
    v.contact_name,
    v.campaign_id,
    v.caller_id,
    v.setter_id,
    v.caller_label,
    v.mapping_source,
    v.setter_name,
    v.setter_email,
    v.is_attributed,
    v.note,
    v.summary
  from public.v_wavv_outbound_setter_calls v

  union all

  -- ── 2. GHL / LeadConnector click-to-calls ─────────────────────────────────
  select
    -- Prefixed so the id space cannot collide with a WAVV call id. The page
    -- de-dupes its paged reads on this key, so it has to stay unique.
    'ghl:' || g.ghl_message_id  as wavv_call_id,
    'ghl'::text                 as source,
    g.called_at                 as started_at,
    -- ANSWERED = the line picked up, machine included — the same thing the
    -- Connects rung means ("INCLUDING answering machines"). 'no-answer',
    -- 'busy' and 'ringing' are not answers and stay NULL.
    case when g.call_status in ('completed', 'voicemail') then g.called_at end as answered_at,
    case
      when g.call_status in ('completed', 'voicemail') and coalesce(g.duration_seconds, 0) > 0
        then g.called_at + make_interval(secs => g.duration_seconds)
    end                         as ended_at,
    -- Measured: 103 of the 445 'completed' outbound rows carry no duration at
    -- all. NULL stays NULL (the page renders "—"); it is never coerced to 0,
    -- which would read as "answered and said nothing".
    g.duration_seconds          as seconds,
    g.call_status               as outcome,
    nullif(btrim(g.disposition), '') as disposition,
    null::boolean               as human,
    null::boolean               as recorded,
    -- Bare last-10 digits, matching how wavv_calls stores phone, so the call
    -- log's digit search and any phone join behave identically on both sources.
    nullif(right(regexp_replace(coalesce(g.to_number, ''), '[^0-9]', '', 'g'), 10), '') as phone,
    g.ghl_contact_id            as contact_id,
    coalesce(
      nullif(btrim(cu.business_name), ''),
      nullif(btrim(concat_ws(' ', cu.first_name, cu.last_name)), '')
    )                           as contact_name,
    null::text                  as campaign_id,
    -- The real LeadConnector line dialed FROM. NULL when GHL wrote a label
    -- instead of a number ('MFunding.net' on 2 rows) rather than storing junk.
    nullif(right(regexp_replace(coalesce(g.from_number, ''), '[^0-9]', '', 'g'), 10), '') as caller_id,
    cl.user_id                  as setter_id,
    'GHL / LeadConnector line'::text as caller_label,
    'ghl_user'::text            as mapping_source,
    -- GHL names the user on the call, so this is measured, not derived from the
    -- line. It is populated even when setter_id is NULL.
    coalesce(sd.name, nullif(btrim(g.ghl_user_name), '')) as setter_name,
    p.email                     as setter_email,
    cl.user_id is not null      as is_attributed,
    null::text                  as note,
    null::text                  as summary
  from public.ghl_call_log g
  left join public.deals d      on d.id = g.deal_id
  left join public.customers cu on cu.id = d.customer_id
  left join public.closers cl   on cl.ghl_user_id = g.ghl_user_id
  left join public.staff_directory sd on sd.id = cl.user_id
  left join public.profiles p   on p.id = cl.user_id
  where g.direction = 'outbound'
    and g.called_at is not null
    -- The dedupe. Uses wavv_calls_phone10_idx (an index on this exact
    -- expression), plus a 1-hour bound so the started_at index can help too;
    -- the 180s + duration test inside is the rule that actually decides.
    and not exists (
      select 1
        from public.wavv_calls w
       where w.direction = 'outbound'
         and w.phone is not null
         and right(regexp_replace(w.phone, '[^0-9]', '', 'g'), 10)
           = right(regexp_replace(coalesce(g.to_number, ''), '[^0-9]', '', 'g'), 10)
         and right(regexp_replace(coalesce(g.to_number, ''), '[^0-9]', '', 'g'), 10) <> ''
         and w.started_at between g.called_at - interval '1 hour'
                             and g.called_at + interval '1 hour'
         and abs(extract(epoch from (w.started_at - g.called_at))) <= 180 + coalesce(w.seconds, 0)
    );

revoke all on public.v_setter_dial_calls from public, anon;
grant select on public.v_setter_dial_calls to authenticated, service_role;

comment on view public.v_setter_dial_calls is
  'EVERY outbound setter dial, from both dialers: v_wavv_outbound_setter_calls unioned with outbound ghl_call_log click-to-calls, with the GHL rows deduped against WAVV (same merchant phone within 180s + the WAVV call''s duration; WAVV wins). `source` says which system the row came from. GHL rows carry honest NULLs where GHL has no equivalent concept — human, recorded, and (on 519 of 521 rows) disposition — so they drop out of the conversation / positive rungs by construction instead of scoring zero; SetterPerformancePage.tsx also excludes them from the Reached-a-human rung and its denominator. GHL attribution is direct (ghl_user_id -> closers.ghl_user_id -> closers.user_id), not via the caller_id map WAVV needs. security_invoker: both source tables'' RLS still applies, and admin/super_admin — the only roles that can open Setter Performance — satisfy both.';
