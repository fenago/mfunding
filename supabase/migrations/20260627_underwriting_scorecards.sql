-- Configurable underwriting scorecard (single active config row, weights as JSON).
CREATE TABLE IF NOT EXISTS underwriting_scorecards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Default',
  config JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE underwriting_scorecards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read scorecards" ON underwriting_scorecards
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin')));
CREATE POLICY "Super admins manage scorecards" ON underwriting_scorecards
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin'));
CREATE TRIGGER underwriting_scorecards_updated_at BEFORE UPDATE ON underwriting_scorecards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
