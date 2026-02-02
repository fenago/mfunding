-- =====================================================
-- ENHANCED MARKETING VENDORS
-- =====================================================

-- Add structured pricing as JSONB (array of products with prices)
ALTER TABLE marketing_vendors
ADD COLUMN IF NOT EXISTS pricing_products JSONB DEFAULT '[]'::jsonb;
-- Structure: [{ "product": "Live Transfer", "price": "$35-45/call", "minimum": "50 calls", "notes": "MCA only" }, ...]

-- Add other useful fields
ALTER TABLE marketing_vendors
ADD COLUMN IF NOT EXISTS minimum_order TEXT,
ADD COLUMN IF NOT EXISTS return_policy TEXT,
ADD COLUMN IF NOT EXISTS exclusivity TEXT,
ADD COLUMN IF NOT EXISTS lead_generation_method TEXT,
ADD COLUMN IF NOT EXISTS volume_available TEXT,
ADD COLUMN IF NOT EXISTS industries_served TEXT[],
ADD COLUMN IF NOT EXISTS additional_services TEXT[];

-- Add comment for clarity
COMMENT ON COLUMN marketing_vendors.pricing_products IS 'Array of products: [{product, price, minimum, notes}]';

-- =====================================================
-- ENHANCED LENDERS
-- =====================================================

-- Funding products offered
ALTER TABLE lenders
ADD COLUMN IF NOT EXISTS funding_products TEXT[] DEFAULT '{}';
-- Values: mca, term_loan, line_of_credit, equipment_financing, sba_loan, invoice_factoring, revenue_based

-- Funding range
ALTER TABLE lenders
ADD COLUMN IF NOT EXISTS min_funding_amount INTEGER,
ADD COLUMN IF NOT EXISTS max_funding_amount INTEGER;

-- Requirements
ALTER TABLE lenders
ADD COLUMN IF NOT EXISTS min_time_in_business INTEGER, -- months
ADD COLUMN IF NOT EXISTS min_monthly_revenue INTEGER,
ADD COLUMN IF NOT EXISTS min_daily_balance INTEGER,
ADD COLUMN IF NOT EXISTS requires_collateral BOOLEAN DEFAULT false;

-- Pricing/Terms
ALTER TABLE lenders
ADD COLUMN IF NOT EXISTS commission_structure TEXT, -- e.g., "2-4 points", "10% of funded amount"
ADD COLUMN IF NOT EXISTS factor_rate_range TEXT, -- e.g., "1.15-1.45"
ADD COLUMN IF NOT EXISTS term_lengths TEXT, -- e.g., "3-18 months"
ADD COLUMN IF NOT EXISTS advance_rate TEXT, -- e.g., "Up to 150% of monthly revenue"

-- Operations
ADD COLUMN IF NOT EXISTS funding_speed TEXT, -- e.g., "Same day", "24-48 hours"
ADD COLUMN IF NOT EXISTS stacking_policy TEXT, -- e.g., "No stacking", "2nd position OK", "Will stack"
ADD COLUMN IF NOT EXISTS industries_restricted TEXT[], -- industries they WON'T fund
ADD COLUMN IF NOT EXISTS industries_preferred TEXT[], -- industries they specialize in
ADD COLUMN IF NOT EXISTS states_available TEXT[], -- states they operate in (empty = all)
ADD COLUMN IF NOT EXISTS states_restricted TEXT[]; -- states they don't operate in

-- Submission info
ALTER TABLE lenders
ADD COLUMN IF NOT EXISTS submission_email TEXT,
ADD COLUMN IF NOT EXISTS submission_portal_url TEXT,
ADD COLUMN IF NOT EXISTS submission_notes TEXT;

-- Add comments
COMMENT ON COLUMN lenders.funding_products IS 'Array: mca, term_loan, line_of_credit, equipment_financing, sba_loan, invoice_factoring, revenue_based';
COMMENT ON COLUMN lenders.min_time_in_business IS 'Minimum months in business required';
COMMENT ON COLUMN lenders.min_monthly_revenue IS 'Minimum monthly revenue in dollars';
