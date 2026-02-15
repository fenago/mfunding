-- Unified Activity Log table for tracking all interactions across entities
-- Supports: customers, lenders, marketing_vendors

CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('customer', 'lender', 'marketing_vendor')),
  entity_id UUID NOT NULL,
  interaction_type TEXT NOT NULL CHECK (interaction_type IN (
    'call', 'email', 'sms', 'note', 'meeting', 'voicemail',
    'document_uploaded', 'status_change', 'application_submitted', 'follow_up_scheduled'
  )),
  subject TEXT,
  content TEXT,
  old_status TEXT,
  new_status TEXT,
  call_duration INTEGER,
  call_outcome TEXT,
  follow_up_date DATE,
  follow_up_completed BOOLEAN DEFAULT false,
  logged_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary query: fetch all activity for a given entity
CREATE INDEX idx_activity_log_entity ON activity_log(entity_type, entity_id, created_at DESC);

-- User-centric queries: "what did I log today?"
CREATE INDEX idx_activity_log_logged_by ON activity_log(logged_by, created_at DESC);

-- Follow-up queries
CREATE INDEX idx_activity_log_follow_up ON activity_log(follow_up_date)
  WHERE follow_up_date IS NOT NULL AND follow_up_completed = false;

-- RLS
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view activity_log"
  ON activity_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Admins can insert activity_log"
  ON activity_log FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Admins can update activity_log"
  ON activity_log FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'super_admin')
    )
  );
