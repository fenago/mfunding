-- GHL custom-field id map for the UCC/MCA structured fields.
--
-- A UCC-sourced merchant's EXISTING MCA positions, current funders, and MCA score
-- must live in STRUCTURED GHL contact custom fields (not just a text note), so
-- workflows/filters/segments can use them. The three field ids are surfaced through
-- get_ghl_config() under STABLE keys so every push path (ph-ucc-push-ghl,
-- push-application-to-ghl) and the playbook-open-contact upsert read the SAME ids
-- from one place — the decoupling handshake. Field ids are account-scoped but NOT
-- secret, so they live in public.platform_settings (a plain key/value jsonb store),
-- not the vault; get_ghl_config() merges them onto its returned blob.
--
-- Field ids (MFunding location t7NmVR4WCy927j4Zon4b), verified live via the GHL API:
--   cf_existing_positions = iqp4xxbM71Qkpn8xTQrK  ("Active MCA Positions", NUMERICAL) — REUSED
--   cf_current_funders    = p0xvS7mp5uSdSlIAj0sy  ("Current Funder Names", TEXT)      — REUSED
--   cf_mca_score          = b48wwC1GP96tuvq2PS3u  ("MCA Score", NUMERICAL)            — CREATED 2026-08-13
--
-- "Active MCA Positions" is reused for "Existing MCA Positions": for a UCC merchant
-- the count of active liens IS the existing-position count, and push-application-to-ghl
-- already writes existing_positions into this same field (F.active_mca_positions).
--
-- Applied to the live DB via the management API; this file keeps the repo in sync.

insert into public.platform_settings (key, value)
values (
  'ghl_custom_field_map',
  jsonb_build_object(
    'cf_existing_positions', 'iqp4xxbM71Qkpn8xTQrK',
    'cf_current_funders',    'p0xvS7mp5uSdSlIAj0sy',
    'cf_mca_score',          'b48wwC1GP96tuvq2PS3u'
  )
)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Re-teach get_ghl_config() to merge the field-id map onto its blob. Keeps every
-- existing key (api_key/location_id/webhook_secret/…); adds cf_* from platform_settings.
create or replace function public.get_ghl_config()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'vault'
as $function$
declare
  v_key text; v_loc text; v_secret text; v_lt text; v_sendapp text; v_linktok text;
  v_cf jsonb;
begin
  select decrypted_secret into v_key     from vault.decrypted_secrets where name = 'GHL_API_KEY' limit 1;
  select decrypted_secret into v_loc     from vault.decrypted_secrets where name = 'GHL_LOCATION_ID' limit 1;
  select decrypted_secret into v_secret  from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET' limit 1;
  select decrypted_secret into v_lt      from vault.decrypted_secrets where name = 'LIVE_TRANSFER_SECRET' limit 1;
  select decrypted_secret into v_sendapp from vault.decrypted_secrets where name = 'GHL_SEND_APP_SECRET' limit 1;
  select decrypted_secret into v_linktok from vault.decrypted_secrets where name = 'SEND_APP_LINK_TOKEN' limit 1;
  select value into v_cf from public.platform_settings where key = 'ghl_custom_field_map' limit 1;
  return jsonb_build_object(
    'api_key', v_key,
    'location_id', v_loc,
    'webhook_secret', v_secret,
    'live_transfer_secret', v_lt,
    'send_app_secret', v_sendapp,
    'send_app_link_token', v_linktok
  ) || coalesce(v_cf, '{}'::jsonb);
end;
$function$;

revoke all on function public.get_ghl_config() from public, anon, authenticated;
grant execute on function public.get_ghl_config() to service_role;
