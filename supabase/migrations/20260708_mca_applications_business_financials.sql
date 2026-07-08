-- MCA_APPLICATIONS — Business Financial Information (2026-07-08)
-- The real "Merchant Funding Application" PDF has a Business Financial Information
-- section the in-app form didn't capture yet: annual gross revenue, average
-- monthly deposits (distinct from monthly revenue), number of employees, and the
-- two derogatory disclosures (prior bankruptcy, open tax liens / judgments) each
-- with a free-text details field. All optional — the PDF treats them as fill-ins
-- and gating the send on them would hurt speed.

alter table public.mca_applications
  add column if not exists annual_gross_revenue     numeric,
  add column if not exists average_monthly_deposits numeric,
  add column if not exists number_of_employees      integer,
  add column if not exists has_bankruptcy            boolean,
  add column if not exists bankruptcy_details        text,
  add column if not exists has_tax_liens             boolean,
  add column if not exists tax_lien_details          text;
