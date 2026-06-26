-- Map GHL contacts onto customers (deals already carry ghl_contact_id/ghl_opportunity_id).
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS ghl_contact_id TEXT;
CREATE INDEX IF NOT EXISTS idx_customers_ghl_contact_id ON public.customers (ghl_contact_id);
