-- Add renewal tracking columns to customers table
-- Enables the "Renewed" stage in the funding funnel

ALTER TABLE customers ADD COLUMN IF NOT EXISTS renewal_count INTEGER DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_renewal_date TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS original_deal_id UUID REFERENCES customers(id);
