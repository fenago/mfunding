-- Carry the purchased-data fields onto the merchant.
--
-- The field-map audit found four columns that never left Supabase (revenue,
-- sic_description, employees, title) plus the whole address block, so a deal
-- opened from an aged/UCC lead arrived blank and 04B sends were blocked on
-- industry_doc / avg_monthly_revenue_doc. These give playbook-open-contact
-- somewhere to put them.
--
-- annual_revenue is SEPARATE from monthly_revenue on purpose. The trigger file
-- ships "Monthly Revenue"; the UCC file ships "REVENUE" with values from 46,241
-- to 12,000,000 — annual, plainly. One column for both would understate a
-- merchant's capacity by 12x on the field underwriting reads.
alter table public.customers
  add column if not exists annual_revenue numeric,
  add column if not exists employees      integer,
  add column if not exists entity_type    text,
  add column if not exists owner_title    text,
  add column if not exists sic_code       text,
  add column if not exists website        text;

comment on column public.customers.annual_revenue is
  'Annual gross revenue. NEVER store a monthly figure here — the UCC list''s '
  'REVENUE column is annual, the trigger list''s is monthly.';
comment on column public.customers.entity_type is
  'Derived from the company-name suffix (LLC / LLP / Corporation / Ltd / '
  'Professional Entity). NULL when the name carries no recognizable suffix — a '
  'guessed entity type is a liability on a funding application.';
