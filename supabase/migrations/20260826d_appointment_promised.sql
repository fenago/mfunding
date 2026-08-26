-- "Appointment promised" — the gap between a WAVV disposition and a real time.
--
-- WHY. The WAVV "Appointment Set" disposition carries NO time: the setter tells
-- the dialer an appointment happened, but the dialer has nowhere to put WHEN.
-- Guessing a time would be worse than useless — it would put a fake meeting on
-- the merchant-invited calendar and email the merchant about it. So the
-- disposition records a PROMISE, not an appointment:
--
--   appointment_promised_at  — when the setter said "appointment set" (no time yet)
--   appointment_at           — the real booked instant (20260826_deal_appointments)
--
-- The Calendar surfaces (promised AND not booked) as an amber "book the time"
-- alert list — never as a timed calendar item, because there is no time. Booking
-- a real time via scheduleAppointment clears the promise; that is the only way
-- the flag resolves, which is exactly the behaviour we want out of the setter.

alter table public.deals
  add column if not exists appointment_promised_at timestamptz;

comment on column public.deals.appointment_promised_at is
  'Set when a WAVV ''Appointment Set'' disposition fired but no real time is booked yet (the disposition carries no time). Cleared when appointment_at is booked. Never a calendar item on its own — it is the "still needs a time" flag.';

-- The alert set is tiny and always filtered the same way: promised, not booked.
create index if not exists deals_appointment_promised_idx
  on public.deals (appointment_promised_at)
  where appointment_promised_at is not null and appointment_at is null;

-- RLS: deals policies are row-level (no column policies), so this column is
-- covered by the existing "Admins manage deals" / closer_* policies exactly like
-- the appointment_* columns it sits beside. Nothing to add.
