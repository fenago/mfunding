-- Internal underwriting: a scored risk assessment per deal (from the bank analysis
-- + customer profile) with the underwriter's decision. Reads the bank_analyses
-- one-source so it works with or without Plaid.
CREATE TABLE IF NOT EXISTS underwriting_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  bank_analysis_id UUID REFERENCES bank_analyses(id) ON DELETE SET NULL,
  score NUMERIC,
  recommendation TEXT CHECK (recommendation IN ('approve','review','decline')),
  decision TEXT DEFAULT 'pending' CHECK (decision IN ('pending','approved','declined','review')),
  risk_flags JSONB DEFAULT '[]'::jsonb,
  breakdown JSONB,
  notes TEXT,
  assessed_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_uw_assessments_deal_id ON underwriting_assessments(deal_id);

ALTER TABLE underwriting_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage underwriting_assessments" ON underwriting_assessments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin')));

CREATE TRIGGER uw_assessments_updated_at BEFORE UPDATE ON underwriting_assessments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
