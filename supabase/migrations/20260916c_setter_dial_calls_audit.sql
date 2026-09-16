-- 20260916c — the Call log can be AUDITED by source, including what dedupe removed.
--
-- WHY. Owner, 2026-09-16, on the union shipped in 20260916b: "let's make sure
-- that we have a way to drill into the calls and see what was called from WAVV
-- and what was called from GHL."
--
-- Correct totals are not enough. The reason the 473 GHL dials went unnoticed for
-- months is that no surface on the page could be asked "which system produced
-- this row?" — so the number had no way of being checked. `source` (added in
-- 20260916b) answers that for every surviving row.
--
-- This migration closes the remaining hole: the rows dedupe DELETED. A GHL row
-- with a WAVV twin is dropped from the union entirely, so from inside the Call
-- log it is indistinguishable from a GHL call that never happened. That is
-- exactly the shape of the bug being fixed — a real call that no surface admits
-- to — just three orders of magnitude smaller (3 rows in 30 days).
--
-- WHAT THIS ADDS. `also_seen_in`: on a surviving WAVV row, 'ghl' when that row
-- is the reason at least one GHL row was dropped; NULL otherwise. The predicate
-- is the EXACT MIRROR of the NOT EXISTS in the GHL branch — same phone match,
-- same 180s + duration window, same 1-hour sargable bound — so the two can never
-- disagree about what a duplicate is. Every dropped GHL row is therefore
-- accounted for by a surviving row that says so, and the Call log renders it as
-- "WAVV · also in GHL" instead of letting a copy vanish without trace.
--
-- (A WAVV row can in principle absorb more than one GHL row, and one GHL row can
-- be claimed by more than one WAVV row. The column says a fold happened, not how
-- many — which is what the wording in the UI claims, and no more.)
--
-- ── COST ────────────────────────────────────────────────────────────────────
-- This is a correlated EXISTS on the WAVV branch, i.e. one probe per WAVV row —
-- measured at 40ms over a 7-day slice of 9,174 rows, riding
-- ghl_call_log_called_at_idx. That is cheap but NOT free, and the page's
-- aggregate pass reads this view in 18 parallel pages, so it must not pay for a
-- column it never renders.
--
-- It does not: Postgres prunes an unreferenced scalar subquery from the select
-- list when the view is flattened, so a query that does not SELECT
-- `also_seen_in` plans without the SubPlan at all. SetterPerformancePage.tsx
-- relies on this — CALL_COLS (the aggregate pass) omits the column and LOG_COLS
-- (the Call log, 50 rows a page) asks for it. Verified on the live plan, not
-- assumed. If that ever regresses, the symptom is a slower Funnel tab, not a
-- wrong number.
--
-- Everything else about the view — the union, the dedupe rule, the honest NULLs
-- on GHL rows, the attribution paths, security_invoker — is unchanged from
-- 20260916b, which carries the full reasoning and the measurements.

-- Makes the mirrored EXISTS an index probe from either direction.
create index if not exists ghl_call_log_to_phone10_idx
  on public.ghl_call_log ((right(regexp_replace(coalesce(to_number, ''), '[^0-9]', '', 'g'), 10)))
  where direction = 'outbound';

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
    v.summary,
    -- The audit trail for dedupe. Mirror of the NOT EXISTS below.
    case when exists (
      select 1
        from public.ghl_call_log g2
       where g2.direction = 'outbound'
         and g2.called_at is not null
         and v.phone is not null
         and right(regexp_replace(coalesce(g2.to_number, ''), '[^0-9]', '', 'g'), 10)
           = right(regexp_replace(v.phone, '[^0-9]', '', 'g'), 10)
         and right(regexp_replace(v.phone, '[^0-9]', '', 'g'), 10) <> ''
         and g2.called_at between v.started_at - interval '1 hour'
                              and v.started_at + interval '1 hour'
         and abs(extract(epoch from (v.started_at - g2.called_at))) <= 180 + coalesce(v.seconds, 0)
    ) then 'ghl'::text end      as also_seen_in
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
    null::text                  as summary,
    -- A GHL row that had a WAVV twin is not here at all (see the NOT EXISTS),
    -- so a surviving GHL row never absorbed anything.
    null::text                  as also_seen_in
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
  'EVERY outbound setter dial, from both dialers: v_wavv_outbound_setter_calls unioned with outbound ghl_call_log click-to-calls, with the GHL rows deduped against WAVV (same merchant phone within 180s + the WAVV call''s duration; WAVV wins). `source` says which system wrote each row, so the Call log can be filtered and audited by dialer. `also_seen_in` = ''ghl'' on a WAVV row that absorbed a GHL duplicate, so nothing dedupe removes disappears without a trace — it is a correlated EXISTS, pruned from the plan when not selected, so only the 50-row Call log pays for it. GHL rows carry honest NULLs where GHL has no equivalent concept — human, recorded, and (on 519 of 521 rows) disposition — so they drop out of the conversation / positive rungs by construction instead of scoring zero; SetterPerformancePage.tsx also excludes them from the Reached-a-human rung and its denominator. GHL attribution is direct (ghl_user_id -> closers.ghl_user_id -> closers.user_id), not via the caller_id map WAVV needs. security_invoker: both source tables'' RLS still applies, and admin/super_admin — the only roles that can open Setter Performance — satisfy both.';
