-- Backfill synergy_intake_log with the three REAL Synergy lead emails of 2026-07-13
-- (the incident day), so the ledger reflects reality from its first sweep onward and
-- the reconciler doesn't treat already-worked leads as gaps.
--
-- Verified against the live GHL conversation TMrisSNeRvpwb3Ha1SRC (robot contact
-- DNdRUMtvHdJb0n53f0PV / info@double-verified.com) and against public.deals:
--   3onQUtKHN5pS79HyNWGz  ECS Holdings LLC            → MF-2026-0017
--   ijR6Izve30Yad3b7bMl7  Detroit Mobile Car Repair   → MF-2026-0019  ← the dropped one
--   PIbV6YQELbOrGLdA98x2  Popular Contracting USA     → MF-2026-0018
--
-- Deal/customer ids are resolved BY DEAL NUMBER at apply time (no hardcoded uuids).

insert into public.synergy_intake_log
  (ghl_email_record_id, ghl_conversation_id, ghl_contact_id, from_email, subject,
   received_at, outcome, deal_id, customer_id, notes)
select v.rec, 'TMrisSNeRvpwb3Ha1SRC', 'DNdRUMtvHdJb0n53f0PV', 'Info@Double-Verified.com',
       v.subject, v.received_at::timestamptz, 'created', d.id, d.customer_id, v.notes
  from (values
    ('3onQUtKHN5pS79HyNWGz', 'MF-2026-0017',
     'Live Transfer! (708) 616-3446 - ECS Holdings LLC',
     '2026-07-13T15:08:46.580Z',
     'Backfilled from the live GHL conversation (pre-ledger intake).'),
    ('ijR6Izve30Yad3b7bMl7', 'MF-2026-0019',
     'Live Transfer! (843) 260-2494 - Detroit Mobile Car Repair LLC',
     '2026-07-13T15:28:44.848Z',
     'Backfilled — this is the lead the parser bug dropped; recovered by hand on 2026-07-13.'),
    ('PIbV6YQELbOrGLdA98x2', 'MF-2026-0018',
     'Live Transfer! (347) 898-6709 - Popular Contracting USA',
     '2026-07-13T15:52:52.905Z',
     'Backfilled from the live GHL conversation (pre-ledger intake).')
  ) as v(rec, deal_number, subject, received_at, notes)
  join public.deals d on d.deal_number = v.deal_number
on conflict (ghl_email_record_id) do nothing;
