-- TextMagic credentials read — vault-only, service_role-only.
--
-- The Playbook's "Text — company line" chip now SENDS an SMS through TextMagic
-- (edge function `textmagic-send`). TextMagic's REST v2 auth is a PAIR
-- (X-TM-Username + X-TM-Key), so one RPC returns both rather than two round
-- trips. Same shape as get_instantly_key / get_ph_skiptrace_key: SECURITY
-- DEFINER over vault.decrypted_secrets, execute granted to service_role only,
-- so nothing but an edge function running with the service key can read it.
--
-- The secrets themselves (TEXTMAGIC_USERNAME, TEXTMAGIC_API_KEY) already live in
-- the vault — this migration only exposes the read path.
create or replace function public.get_textmagic_creds()
returns jsonb
language sql
security definer
set search_path to 'public', 'vault'
as $fn$
  select jsonb_build_object(
    'username', (select decrypted_secret from vault.decrypted_secrets where name = 'TEXTMAGIC_USERNAME' limit 1),
    'api_key',  (select decrypted_secret from vault.decrypted_secrets where name = 'TEXTMAGIC_API_KEY'  limit 1)
  );
$fn$;

revoke execute on function public.get_textmagic_creds() from public, anon, authenticated;
grant execute on function public.get_textmagic_creds() to service_role;

comment on function public.get_textmagic_creds() is
  'Vault read for the TextMagic REST v2 credential PAIR (username + api key). service_role only — used by the textmagic-send edge function.';
