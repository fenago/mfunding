-- live-transfer-intake — dedicated shared secret + config accessor extension.
--
-- The live-transfer-intake edge function runs verify_jwt = false (GHL workflow
-- webhooks can't send a Supabase JWT) and authenticates in code via a shared
-- secret passed as `?secret=…`, exactly like ghl-webhook. It uses its OWN secret
-- (LIVE_TRANSFER_SECRET) so it can be rotated independently of GHL_WEBHOOK_SECRET.
--
-- The secret VALUE lives in the Supabase vault (set via vault.create_secret /
-- vault.update_secret per environment) — never in this migration. This file only
-- teaches get_ghl_config() to return it alongside the other GHL config so the
-- edge function can read it through the existing service-role-only accessor.

CREATE OR REPLACE FUNCTION public.get_ghl_config()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_key text; v_loc text; v_secret text; v_lt text;
BEGIN
  SELECT decrypted_secret INTO v_key    FROM vault.decrypted_secrets WHERE name = 'GHL_API_KEY' LIMIT 1;
  SELECT decrypted_secret INTO v_loc    FROM vault.decrypted_secrets WHERE name = 'GHL_LOCATION_ID' LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'GHL_WEBHOOK_SECRET' LIMIT 1;
  SELECT decrypted_secret INTO v_lt     FROM vault.decrypted_secrets WHERE name = 'LIVE_TRANSFER_SECRET' LIMIT 1;
  RETURN jsonb_build_object(
    'api_key', v_key,
    'location_id', v_loc,
    'webhook_secret', v_secret,
    'live_transfer_secret', v_lt
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_ghl_config() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ghl_config() TO service_role;

-- Set the secret value once per environment (NOT committed here), e.g.:
--   select vault.create_secret('<64-hex>', 'LIVE_TRANSFER_SECRET', 'live-transfer-intake shared secret');
