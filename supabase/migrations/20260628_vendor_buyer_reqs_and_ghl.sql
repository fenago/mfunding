-- Add structured vendor fields: buyer eligibility requirements + GHL/CRM integration.
-- (Applied live via MCP 2026-06-28; kept in version control.)
alter table public.marketing_vendors
  add column if not exists buyer_requirements text,
  add column if not exists ghl_integration text;
comment on column public.marketing_vendors.buyer_requirements is 'Eligibility to BUY from this vendor (e.g., 3+ reps, 2+ yrs in business)';
comment on column public.marketing_vendors.ghl_integration is 'Whether/how leads can be delivered into GHL/CRM (webhook/forms/email-CRM)';
