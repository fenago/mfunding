-- get_rpv_token() — vault read for the RealPhoneValidation (RealValidation.com) token,
-- service_role only. Mirrors get_phone_validation_key (the Twilio credential reader):
-- SECURITY DEFINER, search_path pinned to public+vault, execute revoked from every
-- role except service_role so only edge functions (service key) can resolve it.
--
-- RealPhoneValidation is the SECOND phone-validation provider (Twilio stays default).
-- The token is licensed for the Scrub product only:
--   GET https://api.realvalidation.com/rpvWebService/RealPhoneValidationScrub.php
--       ?output=json&phone=<10-digit>&token=<TOKEN>
-- The vault entry REALPHONEVALIDATION_TOKEN is already staged; a null return is the
-- gate (the phone-validate fn treats null as { gated:true }).
create or replace function public.get_rpv_token()
returns text
language sql
security definer
set search_path to 'public', 'vault'
as $fn$
  select decrypted_secret
    from vault.decrypted_secrets
   where name = 'REALPHONEVALIDATION_TOKEN'
   limit 1;
$fn$;

revoke execute on function public.get_rpv_token() from public, anon, authenticated;
grant execute on function public.get_rpv_token() to service_role;

comment on function public.get_rpv_token() is
  'Vault read for the RealPhoneValidation (RealValidation.com) Scrub token (REALPHONEVALIDATION_TOKEN) used by the phone-validate edge fn as the realphonevalidation provider. service_role only. Returns null until the vault entry exists — that null is the gate.';
