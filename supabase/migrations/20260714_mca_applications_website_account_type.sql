-- Two application fields the owner chose to COLLECT rather than delete from the 04B
-- template: the business website (optional, low value but free) and the bank account
-- type (checking/savings — funders genuinely care, and it costs the closer one word).
alter table public.mca_applications
  add column if not exists business_website  text,
  add column if not exists bank_account_type text
    check (bank_account_type in ('Checking', 'Savings'));
