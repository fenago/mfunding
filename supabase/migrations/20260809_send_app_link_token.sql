-- send-app-link: a GET-safe, independently-rotatable link token for the setter's
-- one-press "Send Application" control. SEPARATE from GHL_SEND_APP_SECRET so a
-- leaked link token can be rotated without touching (or exposing) the master webhook
-- secret. The value is generated here (never printed / never committed) and stored in
-- the Supabase vault; get_ghl_config() is taught to return it as `send_app_link_token`.
--
-- Applied to the live DB on 2026-08-09 via the management API; this file keeps the
-- repo in sync. Idempotent: it only mints the secret if it does not already exist, so
-- re-running never rotates the live token.

do $$
declare v_token text;
begin
  if not exists (select 1 from vault.secrets where name = 'SEND_APP_LINK_TOKEN') then
    -- 64 hex chars (two v4 UUIDs, dashes stripped) = ample entropy, no extension dep.
    v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
    perform vault.create_secret(
      v_token,
      'SEND_APP_LINK_TOKEN',
      'send-app-link setter link token (GET-safe; rotatable independently of GHL_SEND_APP_SECRET)'
    );
  end if;
end $$;

create or replace function public.get_ghl_config()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'vault'
as $function$
declare
  v_key text; v_loc text; v_secret text; v_lt text; v_sendapp text; v_linktok text;
begin
  select decrypted_secret into v_key     from vault.decrypted_secrets where name = 'GHL_API_KEY' limit 1;
  select decrypted_secret into v_loc     from vault.decrypted_secrets where name = 'GHL_LOCATION_ID' limit 1;
  select decrypted_secret into v_secret  from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET' limit 1;
  select decrypted_secret into v_lt      from vault.decrypted_secrets where name = 'LIVE_TRANSFER_SECRET' limit 1;
  select decrypted_secret into v_sendapp from vault.decrypted_secrets where name = 'GHL_SEND_APP_SECRET' limit 1;
  select decrypted_secret into v_linktok from vault.decrypted_secrets where name = 'SEND_APP_LINK_TOKEN' limit 1;
  return jsonb_build_object(
    'api_key', v_key,
    'location_id', v_loc,
    'webhook_secret', v_secret,
    'live_transfer_secret', v_lt,
    'send_app_secret', v_sendapp,
    'send_app_link_token', v_linktok
  );
end;
$function$;

revoke all on function public.get_ghl_config() from public, anon, authenticated;
grant execute on function public.get_ghl_config() to service_role;
