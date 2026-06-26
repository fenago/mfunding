-- Phase 3: bank-data "one source" for underwriting (manual now, Plaid later) +
-- Plaid connection storage (schema-ready; Plaid is optional/deferred).

CREATE TABLE IF NOT EXISTS bank_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','plaid')),
  months_analyzed INTEGER,
  average_daily_balance NUMERIC,
  avg_monthly_deposits NUMERIC,
  avg_monthly_revenue NUMERIC,
  deposit_count INTEGER,
  nsf_count INTEGER,
  negative_days INTEGER,
  existing_mca_positions INTEGER,
  existing_mca_payments NUMERIC,
  largest_deposit NUMERIC,
  notes TEXT,
  raw JSONB,
  entered_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_analyses_deal_id ON bank_analyses(deal_id);
CREATE INDEX IF NOT EXISTS idx_bank_analyses_customer_id ON bank_analyses(customer_id);

ALTER TABLE bank_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage bank_analyses" ON bank_analyses FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin')));

CREATE TRIGGER bank_analyses_updated_at BEFORE UPDATE ON bank_analyses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS plaid_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  item_id TEXT,
  access_token_encrypted TEXT,
  institution_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disconnected','error')),
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plaid_connections_customer_id ON plaid_connections(customer_id);
CREATE INDEX IF NOT EXISTS idx_plaid_connections_deal_id ON plaid_connections(deal_id);

ALTER TABLE plaid_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage plaid_connections" ON plaid_connections FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin')));

CREATE TRIGGER plaid_connections_updated_at BEFORE UPDATE ON plaid_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
