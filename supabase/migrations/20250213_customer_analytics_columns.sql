-- Add analytics-related columns to customers table
-- Links leads to source marketing vendor and enables funnel tracking

-- Link customers to their source marketing vendor
ALTER TABLE customers ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES marketing_vendors(id);

-- Fast filter for live transfer tracking
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_live_transfer BOOLEAN DEFAULT false;

-- Distinguish mini-app vs full-app completions in the funnel
ALTER TABLE customers ADD COLUMN IF NOT EXISTS application_type TEXT CHECK (application_type IN ('mini_app', 'full_app'));

-- Timestamp columns for funnel velocity and "Time to Fund" metrics
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contacted_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS application_submitted_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS funded_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ;

-- Indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_customers_vendor_id ON customers(vendor_id);
CREATE INDEX IF NOT EXISTS idx_customers_created_at ON customers(created_at);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_funded_at ON customers(funded_at) WHERE funded_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_live_transfer ON customers(is_live_transfer) WHERE is_live_transfer = true;
