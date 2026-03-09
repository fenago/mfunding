-- Create deals table (4.1) — Individual Funding Deals
CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  deal_number TEXT UNIQUE, -- MF-2026-0001
  deal_type TEXT NOT NULL CHECK (deal_type IN ('mca', 'term_loan', 'line_of_credit', 'sba', 'equipment_financing')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new', 'contacted', 'qualifying', 'application_sent', 'docs_collected',
    'submitted_to_funder', 'offer_received', 'offer_presented', 'funded',
    'renewal_eligible', 'declined', 'dead'
  )),
  amount_requested NUMERIC,
  amount_funded NUMERIC,
  use_of_funds TEXT,
  urgency TEXT,
  application_type TEXT CHECK (application_type IN ('mini_app', 'full_app')),
  -- Timestamps for each stage
  contacted_at TIMESTAMPTZ,
  qualified_at TIMESTAMPTZ,
  application_sent_at TIMESTAMPTZ,
  docs_collected_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  offer_received_at TIMESTAMPTZ,
  offer_presented_at TIMESTAMPTZ,
  funded_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  -- Assignment
  assigned_closer_id UUID REFERENCES profiles(id),
  lead_source TEXT,
  lead_source_detail TEXT,
  market TEXT, -- indianapolis, phoenix, columbus, dc, sacramento, south_florida
  -- Renewal tracking
  is_renewal BOOLEAN DEFAULT false,
  original_deal_id UUID REFERENCES deals(id),
  renewal_count INTEGER DEFAULT 0,
  paydown_percentage NUMERIC DEFAULT 0,
  renewal_eligible_date DATE,
  -- GHL sync
  ghl_contact_id TEXT,
  ghl_opportunity_id TEXT,
  --
  notes TEXT,
  tags TEXT[] DEFAULT '{}',
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create deal_submissions table (4.2) — Submissions to Individual Funders
CREATE TABLE IF NOT EXISTS deal_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id),
  lender_id UUID NOT NULL REFERENCES lenders(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'submitted', 'under_review', 'approved', 'declined',
    'offer_made', 'offer_accepted', 'offer_declined', 'funded', 'withdrawn'
  )),
  submitted_at TIMESTAMPTZ,
  response_at TIMESTAMPTZ,
  submitted_by UUID REFERENCES profiles(id),
  -- Offer details (populated when funder responds)
  offer_amount NUMERIC,
  factor_rate NUMERIC,
  term_months INTEGER,
  daily_payment NUMERIC,
  weekly_payment NUMERIC,
  total_payback NUMERIC,
  commission_points NUMERIC,
  commission_amount NUMERIC,
  -- Decline details
  decline_reason TEXT,
  -- Notes
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_deals_customer_id ON deals(customer_id);
CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
CREATE INDEX IF NOT EXISTS idx_deals_assigned_closer_id ON deals(assigned_closer_id);
CREATE INDEX IF NOT EXISTS idx_deals_market ON deals(market);
CREATE INDEX IF NOT EXISTS idx_deals_created_at ON deals(created_at);
CREATE INDEX IF NOT EXISTS idx_deals_deal_number ON deals(deal_number);
CREATE INDEX IF NOT EXISTS idx_deal_submissions_deal_id ON deal_submissions(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_submissions_lender_id ON deal_submissions(lender_id);
CREATE INDEX IF NOT EXISTS idx_deal_submissions_status ON deal_submissions(status);

-- Enable RLS
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_submissions ENABLE ROW LEVEL SECURITY;

-- RLS policies for deals
CREATE POLICY "Authenticated users can view deals" ON deals
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert deals" ON deals
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update deals" ON deals
  FOR UPDATE TO authenticated USING (true);

-- RLS policies for deal_submissions
CREATE POLICY "Authenticated users can view deal_submissions" ON deal_submissions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert deal_submissions" ON deal_submissions
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update deal_submissions" ON deal_submissions
  FOR UPDATE TO authenticated USING (true);

-- Function to auto-generate deal numbers
CREATE OR REPLACE FUNCTION generate_deal_number()
RETURNS TRIGGER AS $$
DECLARE
  year_str TEXT;
  next_num INTEGER;
BEGIN
  year_str := to_char(now(), 'YYYY');
  SELECT COALESCE(MAX(CAST(SUBSTRING(deal_number FROM 9) AS INTEGER)), 0) + 1
    INTO next_num
    FROM deals
    WHERE deal_number LIKE 'MF-' || year_str || '-%';
  NEW.deal_number := 'MF-' || year_str || '-' || LPAD(next_num::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_deal_number
  BEFORE INSERT ON deals
  FOR EACH ROW
  WHEN (NEW.deal_number IS NULL)
  EXECUTE FUNCTION generate_deal_number();

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_deals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deals_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW
  EXECUTE FUNCTION update_deals_updated_at();

CREATE TRIGGER deal_submissions_updated_at
  BEFORE UPDATE ON deal_submissions
  FOR EACH ROW
  EXECUTE FUNCTION update_deals_updated_at();
