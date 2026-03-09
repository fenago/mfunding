-- Commission & Financial Engine tables
-- Creates: commissions, closers, sub_isos
-- Note: deals and deal_submissions tables are created by the Deal Pipeline agent

-- ============================================
-- 1. closers — 1099 Independent Contractor Sales Reps
-- ============================================
CREATE TABLE IF NOT EXISTS closers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  -- Commission structure
  company_lead_split NUMERIC DEFAULT 50, -- percentage
  self_gen_split NUMERIC DEFAULT 70,
  renewal_split NUMERIC DEFAULT 35,
  draw_amount NUMERIC, -- monthly draw (if any)
  draw_start_date DATE,
  draw_end_date DATE,
  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'terminated')),
  start_date DATE,
  end_date DATE,
  -- Assignment
  markets TEXT[] DEFAULT '{}', -- which markets they handle
  max_leads_per_month INTEGER DEFAULT 50,
  -- Performance (calculated/cached)
  total_deals_funded INTEGER DEFAULT 0,
  total_commission_earned NUMERIC DEFAULT 0,
  close_rate NUMERIC DEFAULT 0,
  --
  agreement_signed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 2. sub_isos — Sub-ISO Partner Management
-- ============================================
CREATE TABLE IF NOT EXISTS sub_isos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  -- Agreement terms
  override_points NUMERIC DEFAULT 2,
  platform_fee_monthly NUMERIC, -- $99, $149, $199
  agreement_start_date DATE,
  agreement_end_date DATE,
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'active', 'suspended', 'terminated'
  )),
  -- GHL
  ghl_sub_account_id TEXT,
  ghl_location_id TEXT,
  -- Performance
  total_deals_submitted INTEGER DEFAULT 0,
  total_deals_funded INTEGER DEFAULT 0,
  total_commission_earned NUMERIC DEFAULT 0,
  total_override_earned NUMERIC DEFAULT 0,
  -- Stripe
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  --
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES profiles(id)
);

-- ============================================
-- 3. commissions — Commission Tracking
-- ============================================
CREATE TABLE IF NOT EXISTS commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id),
  deal_submission_id UUID REFERENCES deal_submissions(id),
  -- Amounts
  gross_commission NUMERIC NOT NULL, -- Total from funder
  commission_points NUMERIC NOT NULL,
  -- Splits
  closer_id UUID REFERENCES closers(id),
  closer_split_percentage NUMERIC, -- 50% or 70%
  closer_amount NUMERIC,
  company_amount NUMERIC,
  -- Sub-ISO (if applicable)
  sub_iso_id UUID REFERENCES sub_isos(id),
  override_points NUMERIC, -- typically 2
  override_amount NUMERIC,
  -- Sales manager override
  manager_override_percentage NUMERIC,
  manager_override_amount NUMERIC,
  -- Payment tracking
  payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN (
    'pending', 'funder_paid', 'closer_paid', 'completed', 'clawback'
  )),
  funder_paid_at TIMESTAMPTZ,
  closer_paid_at TIMESTAMPTZ,
  -- Clawback
  clawback_amount NUMERIC DEFAULT 0,
  clawback_reason TEXT,
  --
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_closers_status ON closers(status);
CREATE INDEX IF NOT EXISTS idx_closers_user_id ON closers(user_id);

CREATE INDEX IF NOT EXISTS idx_sub_isos_status ON sub_isos(status);
CREATE INDEX IF NOT EXISTS idx_sub_isos_user_id ON sub_isos(user_id);

CREATE INDEX IF NOT EXISTS idx_commissions_deal_id ON commissions(deal_id);
CREATE INDEX IF NOT EXISTS idx_commissions_closer_id ON commissions(closer_id);
CREATE INDEX IF NOT EXISTS idx_commissions_sub_iso_id ON commissions(sub_iso_id);
CREATE INDEX IF NOT EXISTS idx_commissions_payment_status ON commissions(payment_status);
CREATE INDEX IF NOT EXISTS idx_commissions_created_at ON commissions(created_at);

-- ============================================
-- RLS Policies
-- ============================================
ALTER TABLE closers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_isos ENABLE ROW LEVEL SECURITY;
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;

-- Closers: admins can read all, super_admins can write
CREATE POLICY "Admins can view closers"
  ON closers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Super admins can manage closers"
  ON closers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- Closers can view their own record
CREATE POLICY "Closers can view own record"
  ON closers FOR SELECT
  USING (user_id = auth.uid());

-- Sub-ISOs: admins can read, super_admins can write
CREATE POLICY "Admins can view sub_isos"
  ON sub_isos FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Super admins can manage sub_isos"
  ON sub_isos FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- Sub-ISOs can view their own record
CREATE POLICY "Sub-ISOs can view own record"
  ON sub_isos FOR SELECT
  USING (user_id = auth.uid());

-- Commissions: admins can read, super_admins can write
CREATE POLICY "Admins can view commissions"
  ON commissions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Super admins can manage commissions"
  ON commissions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'super_admin'
    )
  );

-- Closers can view their own commissions
CREATE POLICY "Closers can view own commissions"
  ON commissions FOR SELECT
  USING (
    closer_id IN (
      SELECT id FROM closers WHERE user_id = auth.uid()
    )
  );

-- ============================================
-- Updated_at triggers
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_closers_updated_at
  BEFORE UPDATE ON closers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_sub_isos_updated_at
  BEFORE UPDATE ON sub_isos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_commissions_updated_at
  BEFORE UPDATE ON commissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
