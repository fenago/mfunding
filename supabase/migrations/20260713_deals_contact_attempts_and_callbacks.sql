-- deals_contact_attempts_and_callbacks
--
-- A closer who dials three times and never gets an answer is NOT slow — but
-- contacted_at only moves when the merchant actually picks up, so judging the
-- speed-to-lead SLA against contacted_at punished closers for merchants not
-- answering the phone. Split the two ideas apart:
--
--   first_attempt_at  — when we FIRST reached out (answered or not) → the SLA clock
--   contacted_at      — when we actually got them on the line     → the funnel rung
--
-- and redefine deal_sla_met / deal_speed_to_lead_seconds to key off the attempt.

alter table public.deals
  add column if not exists first_attempt_at timestamptz,
  add column if not exists last_attempt_at  timestamptz,
  add column if not exists contact_attempts integer not null default 0,
  add column if not exists callback_at      timestamptz;

comment on column public.deals.first_attempt_at is
  'When a closer FIRST reached out (call or email), answered or not. The speed-to-lead SLA is judged against THIS, not contacted_at — a merchant not picking up does not make us slow.';
comment on column public.deals.contact_attempts is
  'How many times we have tried. Drives the "tried 3x" chip and the give-up decision.';
comment on column public.deals.callback_at is
  'The merchant asked to be called at this time. While it is in the future the deal is SNOOZED out of the urgent queue, and it resurfaces at the top the moment it comes due.';

-- Partial index: the queue only ever asks "which callbacks are due?".
create index if not exists deals_callback_at_idx
  on public.deals using btree (callback_at)
  where (callback_at is not null);

-- Backfill: every deal we already reached was, by definition, attempted at least
-- once — at or before the moment we got them.
update public.deals
set first_attempt_at = coalesce(first_attempt_at, contacted_at),
    last_attempt_at  = coalesce(last_attempt_at, contacted_at),
    contact_attempts = greatest(contact_attempts, 1)
where contacted_at is not null;

-- Redefined: the SLA and speed-to-lead now hang off the ATTEMPT, not the answer.
create or replace function public.deal_sla_met(d deals)
returns boolean
language sql
immutable
as $function$
  select case
    when d.first_call_due_at is null then null      -- live transfer: nothing to be late for
    when d.first_attempt_at is null then null       -- not yet worked
    else d.first_attempt_at <= d.first_call_due_at
  end;
$function$;

create or replace function public.deal_speed_to_lead_seconds(d deals)
returns integer
language sql
immutable
as $function$
  select case
    when d.first_attempt_at is null then null
    else greatest(0, extract(epoch from (d.first_attempt_at - d.created_at))::int)
  end;
$function$;
