-- PH UCC — one-time TCPA-litigator backfill over already-traced leads (2026-08-02).
--
-- Canonical path is ph-ucc-skiptrace action:"reparse" (re-derives phones[]/best_phone/
-- status from stored ph_ucc_contacts.raw with no BatchData spend). This SQL is the exact
-- same computation, run directly against the DB because the project hit a free-tier
-- exceed_egress_quota cap that day and the edge-function gateway returned HTTP 402, so the
-- fn couldn't be invoked. Idempotent — safe to re-run; it recomputes to the same result.
--
-- Rule: a number is DIALABLE only when NOT dnc AND NOT suppressed_tcpa. TCPA is a
-- person-level signal on BatchData's skip-trace response: raw.litigator (bool) and
-- raw.dnc.tcpa (bool); neither is on the phone object. We stamp both onto every number
-- the person owns, then recompute the lead's best_phone/status.

-- STAGE 1 — stamp tcpa_litigator + suppressed_tcpa onto every ph_ucc_contacts phone.
update public.ph_ucc_contacts c
set phones = coalesce((
  select jsonb_agg(
    elem || jsonb_build_object(
      'tcpa_litigator', ((c.raw->>'litigator')::boolean is true),
      'suppressed_tcpa', (((c.raw->>'litigator')::boolean is true) or ((c.raw#>>'{dnc,tcpa}')::boolean is true))
    )
  )
  from jsonb_array_elements(c.phones) elem
), '[]'::jsonb)
where c.raw is not null and jsonb_array_length(c.phones) > 0;

-- STAGE 2 — recompute lead.phone/status/status_reason from the TCPA-stamped contacts.
with a as (
  select l.id as lead_id, l.status as old_status, l.phone as old_phone,
    (select ph->>'number' from public.ph_ucc_contacts c, jsonb_array_elements(c.phones) ph
       where c.lead_id=l.id and coalesce((ph->>'dnc')::boolean,false)=false
         and coalesce((ph->>'suppressed_tcpa')::boolean,false)=false
       order by coalesce((ph->>'score')::numeric,-1) desc limit 1) as best_phone,
    exists(select 1 from public.ph_ucc_contacts c, jsonb_array_elements(c.phones) ph
       where c.lead_id=l.id and coalesce((ph->>'dnc')::boolean,false)=false
         and coalesce((ph->>'suppressed_tcpa')::boolean,false)=false) as has_dialable,
    exists(select 1 from public.ph_ucc_contacts c where c.lead_id=l.id and jsonb_array_length(c.emails)>0) as has_email,
    (select count(*) from public.ph_ucc_contacts c, jsonb_array_elements(c.phones) ph
       where c.lead_id=l.id and coalesce((ph->>'suppressed_tcpa')::boolean,false)=true) as tcpa_cnt,
    (select count(*) from public.ph_ucc_contacts c, jsonb_array_elements(c.phones) ph
       where c.lead_id=l.id and coalesce((ph->>'dnc')::boolean,false)=true) as dnc_cnt,
    (select count(*) from public.ph_ucc_contacts c, jsonb_array_elements(c.phones) ph
       where c.lead_id=l.id and coalesce((ph->>'dnc')::boolean,false)=false
         and coalesce((ph->>'suppressed_tcpa')::boolean,false)=false) as dialable_cnt
  from public.ph_ucc_leads l where l.traced_at is not null
),
b as (
  select a.*, (case when a.has_dialable then 'needs_scrub' when a.has_email then 'email_only' else 'no_match' end)::ph_ucc_lead_status as new_status
  from a
)
update public.ph_ucc_leads l
set phone = b.best_phone,
    status = b.new_status,
    status_reason = case
      when b.has_dialable then b.dialable_cnt||' dialable number(s) found; '||b.dnc_cnt||' DNC-suppressed.'||
           case when b.tcpa_cnt>0 then ' '||b.tcpa_cnt||' suppressed as TCPA-litigator.' else '' end||' Awaiting TCPA cell-scrub.'
      when b.has_email then b.dnc_cnt||' DNC + '||b.tcpa_cnt||' TCPA-litigator number(s) suppressed. Routed to cold-email.'
      else 'No dialable number and no email ('||b.dnc_cnt||' DNC, '||b.tcpa_cnt||' TCPA-litigator).' end
from b where l.id=b.lead_id
  and (b.old_status is distinct from b.new_status or b.old_phone is distinct from b.best_phone or b.tcpa_cnt>0);
