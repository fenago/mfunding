-- Persist EMAIL DELIVERABILITY on the merchant record.
--
-- WHY (real incident, deal MF-2026-0029): a lead vendor handed us a syntactically
-- perfect but DEAD address. Its very first automated email hard-bounced in GHL
-- (email record status "failed", mailgun error "1 Requested mail action aborted,
-- mailbox not found" — a 550). From that moment GHL flagged the address and 400'd
-- every subsequent send. But nothing in this app ever LOOKED at an outbound email's
-- status, so the bounce was invisible: the closer discovered it only after filling
-- out the entire application, and 6 orphan e-sign document records had already been
-- minted against a mailbox that will never receive them.
--
-- A bounce is a FACT ABOUT THE ADDRESS, not about one send. So we store it on the
-- customer, once, and every surface reads it for free — no GHL round-trip per render.
--
--   email_status        NULL = never emailed / unknown · 'ok' = last send delivered
--                       · 'bounced' = the address is undeliverable, do not send
--   email_bounced_at    when GHL recorded the bounce
--   email_bounce_reason GHL's verbatim SMTP reason (what the closer is shown)
--   email_checked_at    last time we asked GHL (so a sweep can skip fresh rows)

alter table public.customers
  add column if not exists email_status        text,
  add column if not exists email_bounced_at    timestamptz,
  add column if not exists email_bounce_reason text,
  add column if not exists email_checked_at    timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'customers_email_status_check'
  ) then
    alter table public.customers
      add constraint customers_email_status_check
      check (email_status is null or email_status in ('ok', 'bounced'));
  end if;
end $$;

comment on column public.customers.email_status is
  'Deliverability of customers.email as last observed in GHL: null=unknown, ok, bounced. Set by the bounce sweep and by every send path.';

-- The chip / sweep both filter on this; a partial index keeps it free.
create index if not exists customers_email_bounced_idx
  on public.customers (email_status)
  where email_status = 'bounced';

-- A BOUNCE BELONGS TO AN ADDRESS, NOT TO A PERSON.
-- The whole point of the red chip is that the closer calls the merchant and puts a
-- WORKING email on the deal. The moment they do, the old verdict is meaningless —
-- and a stale 'bounced' flag would keep blocking sends to a perfectly good address
-- (worse than the bug we're fixing). So changing the email resets the verdict to
-- unknown, and the next send re-establishes it from GHL.
create or replace function public.reset_email_status_on_email_change()
returns trigger
language plpgsql
as $$
begin
  if new.email is distinct from old.email then
    new.email_status        := null;
    new.email_bounced_at    := null;
    new.email_bounce_reason := null;
    new.email_checked_at    := null;
  end if;
  return new;
end $$;

drop trigger if exists customers_reset_email_status on public.customers;
create trigger customers_reset_email_status
  before update of email on public.customers
  for each row
  execute function public.reset_email_status_on_email_change();
