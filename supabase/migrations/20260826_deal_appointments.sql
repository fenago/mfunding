-- Booked APPOINTMENTS on deals — a distinct concept from callbacks.
--
-- WHY NOT reuse callback_at: a callback is a soft promise the app is allowed to
-- settle on its own. Two behaviours prove it:
--   • logContactAttempt clears callback_at the moment a rep logs an attempt after
--     it came due (dealService ~1740) — the card existed to make that call happen.
--   • callback-calendar-sync EOD-expires merchant_stated windows at the end of
--     their Eastern day.
-- A BOOKED APPOINTMENT is neither. The merchant agreed to a specific meeting and
-- was emailed an invite; it must survive dials, survive midnight, and stand until
-- its own time arrives or a human cancels it. Giving it its own columns is what
-- makes that immunity structural instead of a growing pile of "unless" branches
-- inside the callback code.
--
-- Shape mirrors the callback projection columns 1:1 so callback-calendar-sync can
-- run the SAME proven POST/PUT/cancel logic over a second target:
--   appointment_at              — the promise (source of truth; UTC instant)
--   appointment_ghl_event_id    — GHL appointment id currently projecting it
--   appointment_ghl_calendar_id — which calendar that event lives on
--   appointment_synced_at       — ⚠️ the appointment_at INSTANT the event reflects,
--                                 NOT a sync clock. Drift is a column comparison.
--   appointment_sync_error      — last failure / soft warning, never thrown
--   appointment_owner_user_id   — the app user who booked it (the setter). Drives
--                                 assignedUserId on the GHL event.

alter table public.deals
  add column if not exists appointment_at              timestamptz,
  add column if not exists appointment_ghl_event_id    text,
  add column if not exists appointment_ghl_calendar_id text,
  add column if not exists appointment_synced_at       timestamptz,
  add column if not exists appointment_sync_error      text,
  add column if not exists appointment_owner_user_id   uuid references public.profiles(id) on delete set null;

comment on column public.deals.appointment_at is
  'A BOOKED appointment with the merchant (30 min, merchant-invited GHL calendar). Distinct from callback_at: immune to the post-due auto-clear and to end-of-day expiry — it stands until its time arrives or a human clears it.';
comment on column public.deals.appointment_ghl_event_id is
  'GHL appointment id projecting appointment_at. One-way DB→GHL; the sweeper overwrites GHL-side edits.';
comment on column public.deals.appointment_ghl_calendar_id is
  'GHL calendar id the current appointment_ghl_event_id was booked on (normally platform_settings.callback_calendar.invited_calendar_id).';
comment on column public.deals.appointment_synced_at is
  'The appointment_at INSTANT the GHL event currently reflects (NOT a sync timestamp). Drift = appointment_at IS DISTINCT FROM appointment_synced_at.';
comment on column public.deals.appointment_sync_error is
  'Last appointment calendar-sync failure or soft warning (e.g. booked unassigned because the booking user has no GHL user id). NULL = healthy. Never blocks the booking.';
comment on column public.deals.appointment_owner_user_id is
  'The app user (setter/closer) who booked the appointment — resolved to a GHL userId for assignedUserId. NULL books the appointment UNASSIGNED rather than failing.';

-- The sweep set is tiny: rows with a live appointment or a lingering event.
create index if not exists deals_appointment_sync_idx
  on public.deals (appointment_at, appointment_synced_at)
  where (appointment_at is not null or appointment_ghl_event_id is not null);

-- RLS: deals policies are row-level (no column policies), so the new columns are
-- covered by the existing "Admins manage deals" / closer_* policies exactly like
-- the callback columns. Nothing to add.

-- ── App user → GHL user mapping ────────────────────────────────────────────────
-- Lived only on closers.ghl_user_id (3 rows, 1 usable) — but the people who BOOK
-- appointments are setters with a profile and no closers row. The mapping belongs
-- on profiles, keyed by the identity every staff surface already has.
alter table public.profiles
  add column if not exists ghl_user_id text;

comment on column public.profiles.ghl_user_id is
  'GHL (location t7NmVR4WCy927j4Zon4b) user id for this staff member, matched by email. Used as assignedUserId when booking calendar appointments. NULL = book unassigned, never fail.';

-- Backfill by EMAIL from the live GHL user list. Only VERIFIED ids go in — an
-- invalid assignedUserId can 400 the appointment create, so a wrong id is worse
-- than no id.
update public.profiles p
   set ghl_user_id = m.ghl_user_id
  from (values
    ('cmarq2k8@gmail.com',      'UW2IiJjoAK1pTDRdeLz2'), -- Carlos Marquez
    ('cthrnzaragosa@gmail.com', 'GDOQHaUcwfrQTVhpXI31'), -- Catherine Zaragosa
    ('dlv.work.1@gmail.com',    'vr8HyuXAf43lfBNMMFpo'), -- Diego De La Vega
    ('socrates73@gmail.com',    '12xQ8Y3UvIkiGlZzRhaw'), -- Ernesto Lee
    ('khalillyons@gmail.com',   'tOWjFjnSMkrzdy269Cbw'), -- Khalil Lyons
    ('nicopaolotaruc@gmail.com','oZ6lN9yy1SIVfKD4JNfw')  -- Paola/Paolo Taruc
  ) as m(email, ghl_user_id)
 where lower(p.email) = m.email
   and p.ghl_user_id is distinct from m.ghl_user_id;

-- Keep the closers mirror truthful for the same people…
update public.closers c
   set ghl_user_id = p.ghl_user_id
  from public.profiles p
 where p.id = c.user_id
   and p.ghl_user_id is not null
   and c.ghl_user_id is distinct from p.ghl_user_id;

-- …and drop the DEAD id on the inactive closer row: 3la07qMrf2aTMcyz8gks 404s in
-- GHL, and sending it as assignedUserId is exactly the failure mode above.
update public.closers
   set ghl_user_id = null
 where ghl_user_id = '3la07qMrf2aTMcyz8gks';
