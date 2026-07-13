-- deals_first_touch_tracking
--
-- Speed-to-lead needs to know HOW a closer first reached a lead, because a
-- real-time lead's 5-minute SLA can be satisfied by an EMAIL (the phone call
-- goes at the merchant's stated best time). Without the channel you cannot tell
-- a fast email from a slow dial when reporting speed-to-lead.
--
-- NOTE: this migration originally also created deal_sla_met() and
-- deal_speed_to_lead_seconds() keyed off contacted_at. They are REDEFINED minutes
-- later in 20260713_deals_contact_attempts_and_callbacks.sql to key off
-- first_attempt_at, which is their live shape. They are deliberately NOT defined
-- here: these files sort alphabetically on replay ("deals_c..." < "deals_f..."), so
-- defining them here would let a from-scratch replay overwrite the good definition
-- with the stale one. Column-only migration; ordering cannot hurt it.

alter table public.deals
  add column if not exists first_touch_channel text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.deals'::regclass
      and conname = 'deals_first_touch_channel_check'
  ) then
    alter table public.deals
      add constraint deals_first_touch_channel_check
      check (first_touch_channel = any (array['call'::text, 'email'::text, 'sms'::text, 'other'::text]));
  end if;
end $$;

comment on column public.deals.first_touch_channel is
  'How the closer first reached this lead (call/email/sms). Stamped alongside contacted_at. On a REAL-TIME lead the 5-minute SLA is satisfied by an EMAIL — the phone call goes at the merchant''s stated best time — so the channel is what tells the two apart when reporting speed-to-lead.';
