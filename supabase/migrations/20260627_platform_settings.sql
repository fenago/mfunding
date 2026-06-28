-- Key-value platform settings (white-label branding + misc super-admin config).
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads platform settings" ON platform_settings FOR SELECT USING (true);
CREATE POLICY "Super admins write platform settings" ON platform_settings
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin'));
CREATE TRIGGER platform_settings_updated_at BEFORE UPDATE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
