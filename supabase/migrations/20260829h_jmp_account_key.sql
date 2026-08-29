-- jmp_account_key — a SECURE store for the JMP/Cheogram ACCOUNT PASSWORD.
--
-- The owner wants his JMP account key viewable inside the admin section, but it
-- must NEVER live in the repo/source. So it lives in the Supabase VAULT (encrypted
-- at rest), reached only through two SECURITY DEFINER RPCs that are granted to
-- service_role ONLY. The `jmp-account-key` edge function (verify_jwt + an in-code
-- super_admin check, same shape as jmp-command) is the ONLY caller: it uses the
-- service-role client to read/write, and the RPCs are invisible to anon /
-- authenticated. Defense in depth: gateway JWT → in-code super_admin → service-role
-- RPC → vault.
--
-- ⚠️ NO SECRET VALUE IS SET HERE. This migration only creates the plumbing. The
-- vault entry starts ABSENT; the owner types/pastes the value in the admin UI,
-- which POSTs it to the edge fn, which calls set_jmp_account_key(). Nothing in this
-- file, in git, or in any commit ever contains the password.
--
-- Vault name: 'JMP_ACCOUNT_KEY'. Mirrors the get_ghl_config() vault pattern used
-- across this project (see 20260809_send_app_link_token.sql).
--
-- Applied to the live DB (ehibjeonqpqskhcvizow) via the management API; this file
-- keeps the repo in sync. Idempotent — safe to re-run (never overwrites a value).

-- ── WRITE: upsert the vault secret ──────────────────────────────────────────
-- create_secret on first set, update_secret thereafter (create_secret errors on a
-- duplicate name). Rejects an empty value so the store can't be silently blanked.
create or replace function public.set_jmp_account_key(p_value text)
returns void
language plpgsql
security definer
set search_path to 'public', 'vault'
as $$
declare
  v_id uuid;
  v_val text := btrim(coalesce(p_value, ''));
begin
  if length(v_val) = 0 then
    raise exception 'JMP account key cannot be empty';
  end if;
  select id into v_id from vault.secrets where name = 'JMP_ACCOUNT_KEY' limit 1;
  if v_id is null then
    perform vault.create_secret(
      v_val,
      'JMP_ACCOUNT_KEY',
      'JMP/Cheogram account password — set by super-admin via the Text Message Administration UI; never in repo.'
    );
  else
    perform vault.update_secret(v_id, v_val);
  end if;
end;
$$;

-- ── READ: return the decrypted value (empty string when unset) ───────────────
create or replace function public.get_jmp_account_key()
returns text
language plpgsql
security definer
set search_path to 'public', 'vault'
as $$
declare v text;
begin
  select decrypted_secret into v from vault.decrypted_secrets where name = 'JMP_ACCOUNT_KEY' limit 1;
  return coalesce(v, '');
end;
$$;

-- Lock both down to service_role — the edge fn is the only legitimate caller, and
-- it applies its own super_admin gate before invoking these.
revoke all on function public.set_jmp_account_key(text) from public, anon, authenticated;
revoke all on function public.get_jmp_account_key()      from public, anon, authenticated;
grant execute on function public.set_jmp_account_key(text) to service_role;
grant execute on function public.get_jmp_account_key()      to service_role;
