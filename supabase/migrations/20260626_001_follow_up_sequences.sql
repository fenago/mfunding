-- GHL follow-up sequence enrollment tracking (the 6 sequences A–F) + the
-- service-role-only accessor for GHL credentials stored in the Supabase vault.

CREATE TABLE IF NOT EXISTS follow_up_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('customer','deal')),
  entity_id UUID NOT NULL,
  sequence_key TEXT NOT NULL CHECK (sequence_key IN (
    'stips_docs','no_answer','soft_no','offer_declined','renewal','reactivation'
  )),
  sequence_label TEXT,
  ghl_workflow_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','stopped','re_engaged')),
  current_step INTEGER DEFAULT 0,
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  last_action_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fus_entity ON follow_up_sequences(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_fus_status ON follow_up_sequences(status);
CREATE INDEX IF NOT EXISTS idx_fus_sequence_key ON follow_up_sequences(sequence_key);

ALTER TABLE follow_up_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage follow_up_sequences" ON follow_up_sequences FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin','super_admin')));

CREATE TRIGGER fus_updated_at BEFORE UPDATE ON follow_up_sequences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Service-role-only accessor for GHL credentials (api key, location id, webhook secret)
-- stored in the Supabase vault. Edge functions (service_role) call this; anon/authenticated cannot.
CREATE OR REPLACE FUNCTION public.get_ghl_config()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_key text; v_loc text; v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_key    FROM vault.decrypted_secrets WHERE name = 'GHL_API_KEY' LIMIT 1;
  SELECT decrypted_secret INTO v_loc    FROM vault.decrypted_secrets WHERE name = 'GHL_LOCATION_ID' LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'GHL_WEBHOOK_SECRET' LIMIT 1;
  RETURN jsonb_build_object('api_key', v_key, 'location_id', v_loc, 'webhook_secret', v_secret);
END;
$$;
REVOKE ALL ON FUNCTION public.get_ghl_config() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ghl_config() TO service_role;

-- NOTE: the secret VALUES (GHL_API_KEY, GHL_LOCATION_ID, GHL_WEBHOOK_SECRET) live in the
-- Supabase vault, not in this migration. Set them via vault.create_secret(...) per environment.
