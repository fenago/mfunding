-- v_wavv_outbound_setter_calls: carry the per-call NOTE and SUMMARY.
--
-- WHY: the Setter Performance call log renders the setter's call note as its own
-- column, and falls back to the mirrored `summary` when an on-demand transcript
-- fetch returns none. Both live on public.wavv_calls but were missing from the
-- view, which forced the page to read wavv_calls directly and hand-join the
-- caller_id -> setter mapping. Adding them here lets the page use the view as its
-- single outbound read path (attribution + direction filter already handled),
-- with no second query and no client-side join to drift out of sync.
--
-- Additive only: both columns are APPENDED, which is the one shape
-- CREATE OR REPLACE VIEW permits (it cannot rename, reorder, or drop). No
-- existing column moves, so nothing already reading this view is affected.
-- security_invoker is preserved, so wavv_calls RLS (admin/super_admin select)
-- still governs every row — this widens the projection, never the audience.

create or replace view public.v_wavv_outbound_setter_calls
with (security_invoker = true) as
select
  c.id,
  c.wavv_call_id,
  c.started_at,
  c.answered_at,
  c.ended_at,
  c.seconds,
  c.outcome,
  c.disposition,
  c.human,
  c.recorded,
  c.phone,
  c.contact_id,
  c.contact_name,
  c.campaign_id,
  c.caller_id,
  m.setter_id,
  m.label       as caller_label,
  m.source      as mapping_source,
  p.display_name as setter_name,
  p.email        as setter_email,
  (m.setter_id is not null) as is_attributed,
  -- ── appended 2026-08-26 ──
  c.note,
  c.summary
from public.wavv_calls c
left join public.wavv_caller_setters m on m.caller_id = c.caller_id
left join public.profiles p on p.id = m.setter_id
where c.direction = 'outbound';

comment on view public.v_wavv_outbound_setter_calls is
  'OUTBOUND wavv_calls resolved to a setter via caller_id -> wavv_caller_setters -> profiles. is_attributed=false means the caller_id has no setter assigned yet. Carries the per-call note and summary so the Setter Performance log needs no second read of wavv_calls.';

grant select on public.v_wavv_outbound_setter_calls to authenticated;
