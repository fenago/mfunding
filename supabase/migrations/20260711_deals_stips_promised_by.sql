-- Merchant's committed date for sending bank statements / stips.
-- Captured in the Revenue Playbook at the docs-collection step ("When can you
-- get those statements over to me? Can I count on that?") and used by My Day to
-- escalate the follow-up once the promised date passes.
alter table public.deals add column if not exists stips_promised_by date;

comment on column public.deals.stips_promised_by is 'Date the merchant committed to sending their bank statements/stips ("when can you get those over to me?"). Captured inline at the docs-collection step of the Revenue Playbook and used by My Day to escalate follow-up once the promised date passes.';
