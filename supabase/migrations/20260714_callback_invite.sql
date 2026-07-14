-- Merchant invitations for scheduled calls (Phase 3 of PLAN_followups_calendar.md §3).
--
-- Two calendars, one flag. "Callbacks — Internal" (AylxRmWspFl9hFIyNzlj) has NO
-- contact-facing notifications — every ordinary callback books there silently.
-- "Scheduled Calls — Merchant Invited" (iP6k0cdcyeABY6qvWbX1, created via the API
-- 2026-07-14) carries contact email confirmation + a 60-minute email reminder with
-- compliance-neutral copy ("call about your funding options" — never "loan").
-- deals.callback_invite picks which calendar callback-calendar-sync books on, and
-- toNotify follows it. Per-send, explicit, DEFAULT OFF — set only from the Calendar
-- page's schedule dialog this wave.

alter table public.deals
  -- TRUE = the merchant asked for / agreed to a calendar invitation for this
  -- callback: book on the invited calendar with contact notifications ON.
  add column if not exists callback_invite boolean not null default false,
  -- Which GHL calendar the current event (callback_ghl_event_id) was booked on.
  -- Needed so a flipped invite flag (or a reconfigured calendar id) moves the
  -- event: cancel on the old calendar, recreate on the target one.
  add column if not exists callback_ghl_calendar_id text;

comment on column public.deals.callback_invite is
  'Merchant asked for a calendar invitation for this callback. TRUE = book on the "Scheduled Calls — Merchant Invited" GHL calendar with contact confirmation/reminder emails (toNotify true); FALSE (default) = silent internal calendar. Per-send choice, set in the Calendar page schedule dialog.';
comment on column public.deals.callback_ghl_calendar_id is
  'GHL calendar id the current callback_ghl_event_id was booked on. The sweeper compares it to the invite flag''s target calendar and moves the event when they differ.';

-- Register the invited calendar next to the internal one (config, not code).
update public.platform_settings
   set value = value || jsonb_build_object('invited_calendar_id', 'iP6k0cdcyeABY6qvWbX1'),
       updated_at = now()
 where key = 'callback_calendar';
