-- Referral partner program (CPAs, bookkeepers, RE agents, equipment vendors).
CREATE TABLE IF NOT EXISTS referral_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  company TEXT,
  partner_type TEXT NOT NULL DEFAULT 'other',
  email TEXT,
  phone TEXT,
  referral_count INTEGER NOT NULL DEFAULT 0,
  funded_count INTEGER NOT NULL DEFAULT 0,
  total_paid NUMERIC NOT NULL DEFAULT 0,
  reward_per_funded NUMERIC NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE referral_partners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage referral partners" ON referral_partners
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin')));
CREATE TRIGGER referral_partners_updated_at BEFORE UPDATE ON referral_partners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
