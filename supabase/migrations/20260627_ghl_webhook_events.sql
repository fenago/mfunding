-- Inbound GHL webhook event log — observability for the Gap A/B integration.
CREATE TABLE IF NOT EXISTS ghl_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT,
  ghl_contact_id TEXT,
  ghl_opportunity_id TEXT,
  outcome TEXT NOT NULL DEFAULT 'received',
  detail TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ghl_webhook_events_created ON ghl_webhook_events (created_at DESC);
ALTER TABLE ghl_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read webhook events" ON ghl_webhook_events
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin')));
