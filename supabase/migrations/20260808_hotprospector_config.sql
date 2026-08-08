-- HotProspector (hookscall.com PowerDialer) — vault config accessor.
--
-- Mirrors get_plaid_config() / get_ghl_config(): a SECURITY DEFINER, service-role-only
-- RPC that reads the API credentials out of the Supabase vault so no edge function ever
-- hardcodes them and no table stores them.
--
-- AUTH NOTE: the hookscall v2 API authenticates with api_uId + api_key ONLY
-- (POST /glu/api/v2/auth/token → a 6-hour access_token). HOTPROSPECTOR_USERNAME /
-- HOTPROSPECTOR_PASSWORD also live in the vault but the API does NOT use them, so they
-- are deliberately not returned here.

create or replace function public.get_hotprospector_config()
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_uid text;
  v_key text;
begin
  select decrypted_secret into v_uid from vault.decrypted_secrets where name = 'HOTPROSPECTOR_API_UID' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'HOTPROSPECTOR_API_KEY' limit 1;
  return jsonb_build_object(
    'api_uid', v_uid,
    'api_key', v_key
  );
end;
$$;

revoke all on function public.get_hotprospector_config() from public, anon, authenticated;
grant execute on function public.get_hotprospector_config() to service_role;
