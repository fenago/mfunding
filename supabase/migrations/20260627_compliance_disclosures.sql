-- State-specific compliance disclosures (content store). Readable when active so
-- the app + the GHL workflow can pull the right one for a merchant's state.
CREATE TABLE IF NOT EXISTS compliance_disclosures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT NOT NULL,
  state_name TEXT NOT NULL,
  product_type TEXT NOT NULL DEFAULT 'all',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (state, product_type)
);
ALTER TABLE compliance_disclosures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read active disclosures" ON compliance_disclosures
  FOR SELECT USING (is_active = true);
CREATE POLICY "Super admins manage disclosures" ON compliance_disclosures
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin'));
CREATE TRIGGER compliance_disclosures_updated_at BEFORE UPDATE ON compliance_disclosures
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
INSERT INTO compliance_disclosures (state, state_name, product_type, title, body) VALUES
 ('NY','New York','all','New York Commercial Financing Disclosure','TODO: Insert NY commercial financing disclosure (estimated APR, total cost, payment schedule).'),
 ('CA','California','all','California SB 1235 Disclosure','TODO: Insert CA SB 1235 commercial financing disclosure.'),
 ('VA','Virginia','all','Virginia Commercial Financing Disclosure','TODO: Insert VA commercial financing disclosure.'),
 ('UT','Utah','all','Utah Commercial Financing Disclosure','TODO: Insert UT commercial financing registration/disclosure.'),
 ('FL','Florida','all','Florida Broker Disclosure','TODO: Insert FL broker disclosure.'),
 ('CT','Connecticut','all','Connecticut Commercial Financing Disclosure','TODO: Insert CT disclosure.'),
 ('GA','Georgia','all','Georgia Commercial Financing Disclosure','TODO: Insert GA disclosure.'),
 ('KS','Kansas','all','Kansas Commercial Financing Disclosure','TODO: Insert KS disclosure.'),
 ('TX','Texas','all','Texas Commercial Financing Disclosure','TODO: Insert TX broker registration/disclosure.'),
 ('MO','Missouri','all','Missouri Commercial Financing Disclosure','TODO: Insert MO disclosure.')
ON CONFLICT (state, product_type) DO NOTHING;
