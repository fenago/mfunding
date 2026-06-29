-- Link lenders/vendors to their GHL Business + primary contact so the app can
-- keep the business→person hierarchy in sync with GHL/VibeReach.
-- (Applied live via MCP 2026-06-29; kept in version control.)
alter table public.lenders
  add column if not exists ghl_business_id text,
  add column if not exists ghl_contact_id text;
alter table public.marketing_vendors
  add column if not exists ghl_business_id text,
  add column if not exists ghl_contact_id text;
comment on column public.lenders.ghl_business_id is 'GHL Business object id (groups this funder''s contacts in GHL/VibeReach)';
comment on column public.lenders.ghl_contact_id is 'GHL contact id for the primary contact';
comment on column public.marketing_vendors.ghl_business_id is 'GHL Business object id (groups this vendor''s contacts in GHL/VibeReach)';
comment on column public.marketing_vendors.ghl_contact_id is 'GHL contact id for the primary contact';
