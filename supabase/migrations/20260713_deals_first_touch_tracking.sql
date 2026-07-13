-- deals_first_touch_tracking
--
-- Speed-to-lead needs to know HOW a closer first reached a lead, because a
-- real-time lead's 5-minute SLA can be satisfied by an EMAIL (the phone call
-- goes at the merchant's stated best time). Without the channel you cannot tell
-- a fast email from a slow dial when reporting speed-to-lead.
--
-- Also adds the two generated-column-style helpers the analytics pages read.
-- NOTE: these two functions are REDEFINED in 20260713_deals_contact_attempts_and_callbacks.sql
-- to key off first_attempt_at instead of contacted_at. This file records the
-- original shape; run both in order.

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

-- Computed accessors (Postgrest exposes these as virtual columns on deals).
create or replace function public.deal_sla_met(d deals)
returns boolean
language sql
immutable
as $function$
  select case
    when d.first_call_due_at is null then null      -- live transfer: nothing to be late for
    when d.contacted_at is null then null           -- not yet worked
    else d.contacted_at <= d.first_call_due_at
  end;
$function$;

create or replace function public.deal_speed_to_lead_seconds(d deals)
returns integer
language sql
immutable
as $function$
  select case
    when d.contacted_at is null then null
    else greatest(0, extract(epoch from (d.contacted_at - d.created_at))::int)
  end;
$function$;
