-- ─────────────────────────────────────────────────────────────────────────────
-- Funder portal credentials — 26 of 76 active funders submit through a broker
-- portal and the logins currently live nowhere, so nobody can log in.
--
-- The obvious shape (a `password` column on a table staff can read) is the
-- thing that was just cleaned up: `lenders.notes` / `lenders.submission_notes`
-- held live plaintext passwords until 2026-10-01, readable by all 14 `closer`
-- accounts, and `src/lib/funderDisclosure.ts` now carries a purpose-built guard
-- that withholds any note which merely LOOKS like it contains one. A SELECTable
-- password column would hand every closer the whole set in one query.
--
-- So the row is safe to read and carries NO secret. The password lives in
-- Supabase Vault (`vault.secrets`, same mechanism as `plaid_store_item`); the
-- row holds only its `secret_id`. Plaintext crosses the wire exactly once, out
-- of `reveal_funder_portal_password()`, and that call writes an audit row
-- BEFORE it returns.
--
-- Vault over pgcrypto: `supabase_vault` 0.3.1 is installed and `postgres` (the
-- owner of every function below) holds EXECUTE WITH GRANT OPTION on
-- vault.create_secret / vault.update_secret and SELECT on
-- vault.decrypted_secrets. pgcrypto would need a key of its own kept somewhere,
-- which is the same problem one layer down.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.funder_portal_credentials (
  id                uuid primary key default gen_random_uuid(),
  lender_id         uuid not null references public.lenders(id) on delete cascade,
  -- A funder can have more than one portal (submission vs. rate sheets vs. a
  -- white-label sub-portal), so the label is part of the key, not decoration.
  label             text not null,
  portal_url        text,
  username          text,
  -- The Vault secret holding the password. NOT the password. Readable by
  -- everyone on the SELECT policy and useless to all of them: resolving it
  -- needs vault.decrypted_secrets, which `authenticated` cannot read.
  secret_id         uuid,
  -- Most of these portals now require MFA, so a username/password pair alone
  -- may not get you in. Say WHERE the code goes (whose phone, which inbox).
  mfa_note          text,
  login_note        text,
  last_confirmed_on date,
  updated_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint funder_portal_credentials_lender_label_key unique (lender_id, label)
);

create index if not exists funder_portal_credentials_lender_idx
  on public.funder_portal_credentials (lender_id);

drop trigger if exists update_funder_portal_credentials_updated_at on public.funder_portal_credentials;
create trigger update_funder_portal_credentials_updated_at
  before update on public.funder_portal_credentials
  for each row execute function public.update_updated_at_column();

alter table public.funder_portal_credentials enable row level security;

-- Read: anyone who has to actually log in to a funder portal — Ops
-- (admin/super_admin/employee via is_ops_staff), a Processor, or a setter.
drop policy if exists funder_portal_credentials_select on public.funder_portal_credentials;
create policy funder_portal_credentials_select on public.funder_portal_credentials
  for select using (
    is_ops_staff((select auth.uid()))
    or is_processor((select auth.uid()))
    or is_closer((select auth.uid()))
  );

-- Write: Ops staff only. (is_ops_staff already covers super_admin; the second
-- arm is kept so a future narrowing of is_ops_staff cannot lock out the owner.)
drop policy if exists funder_portal_credentials_insert on public.funder_portal_credentials;
create policy funder_portal_credentials_insert on public.funder_portal_credentials
  for insert with check (
    is_ops_staff((select auth.uid())) or is_super_admin((select auth.uid()))
  );

drop policy if exists funder_portal_credentials_update on public.funder_portal_credentials;
create policy funder_portal_credentials_update on public.funder_portal_credentials
  for update using (
    is_ops_staff((select auth.uid())) or is_super_admin((select auth.uid()))
  ) with check (
    is_ops_staff((select auth.uid())) or is_super_admin((select auth.uid()))
  );

drop policy if exists funder_portal_credentials_delete on public.funder_portal_credentials;
create policy funder_portal_credentials_delete on public.funder_portal_credentials
  for delete using (
    is_ops_staff((select auth.uid())) or is_super_admin((select auth.uid()))
  );


-- ── The audit log ────────────────────────────────────────────────────────────
-- Written ONLY by reveal_funder_portal_password(), which runs as `postgres`
-- (the table owner) and so is the one writer RLS lets through: there is no
-- INSERT, UPDATE or DELETE policy at all, which means no authenticated client
-- can forge, amend or erase a row. `revealed_by_label` is captured at reveal
-- time so the log still names a person after the profile is gone, and the two
-- FKs are ON DELETE SET NULL rather than CASCADE so deleting a credential
-- cannot quietly delete the record of who read it.
create table if not exists public.funder_portal_credential_reveals (
  id                uuid primary key default gen_random_uuid(),
  credential_id     uuid references public.funder_portal_credentials(id) on delete set null,
  lender_id         uuid references public.lenders(id) on delete set null,
  revealed_by       uuid not null,
  revealed_by_label text,
  revealed_at       timestamptz not null default now()
);

create index if not exists funder_portal_credential_reveals_cred_idx
  on public.funder_portal_credential_reveals (credential_id, revealed_at desc);
create index if not exists funder_portal_credential_reveals_who_idx
  on public.funder_portal_credential_reveals (revealed_by, revealed_at desc);

alter table public.funder_portal_credential_reveals enable row level security;

drop policy if exists funder_portal_credential_reveals_select on public.funder_portal_credential_reveals;
create policy funder_portal_credential_reveals_select on public.funder_portal_credential_reveals
  for select using (is_admin_or_super((select auth.uid())));
-- Deliberately no INSERT / UPDATE / DELETE policy. See above.


-- ── Set the password ─────────────────────────────────────────────────────────
-- SECURITY DEFINER, so it runs as `postgres` and can reach Vault. Two things
-- this project has already been bitten by, both handled below:
--   • EXECUTE on a new function in `public` is granted to anon, authenticated
--     AND service_role by Supabase's DEFAULT PRIVILEGES — by name, not through
--     PUBLIC. `revoke ... from public` alone leaves anon holding it. Revoke
--     each one explicitly.
--   • `current_user` inside a DEFINER body is the OWNER, not the caller. Every
--     gate below is on auth.uid().
create or replace function public.set_funder_portal_password(p_cred_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $fn$
declare
  v_uid       uuid := auth.uid();
  v_secret_id uuid;
  v_lender    uuid;
  v_label     text;
begin
  if v_uid is null or not (is_ops_staff(v_uid) or is_super_admin(v_uid)) then
    raise exception 'not authorized to set funder portal passwords'
      using errcode = '42501';
  end if;

  if p_password is null or btrim(p_password) = '' then
    raise exception 'password cannot be empty' using errcode = '22023';
  end if;

  select secret_id, lender_id, label
    into v_secret_id, v_lender, v_label
    from public.funder_portal_credentials
   where id = p_cred_id;

  if not found then
    raise exception 'no such funder portal credential: %', p_cred_id
      using errcode = 'P0002';
  end if;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      p_password,
      'funder_portal_' || p_cred_id::text,
      'Funder portal password — lender ' || coalesce(v_lender::text, '?') ||
      ' / ' || coalesce(v_label, '?') || '. Set via set_funder_portal_password().'
    );
    update public.funder_portal_credentials
       set secret_id = v_secret_id, updated_by = v_uid, updated_at = now()
     where id = p_cred_id;
  else
    perform vault.update_secret(v_secret_id, p_password);
    update public.funder_portal_credentials
       set updated_by = v_uid, updated_at = now()
     where id = p_cred_id;
  end if;
end;
$fn$;

-- ── Reveal the password ──────────────────────────────────────────────────────
-- The ONLY path by which plaintext leaves the database, and it logs first.
-- The audit insert is not best-effort: it is in the same transaction as the
-- return, so a log that cannot be written is a reveal that does not happen.
create or replace function public.reveal_funder_portal_password(p_cred_id uuid)
returns text
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $fn$
declare
  v_uid       uuid := auth.uid();
  v_secret_id uuid;
  v_lender    uuid;
  v_label     text;
  v_password  text;
begin
  if v_uid is null or not (
       is_ops_staff(v_uid) or is_processor(v_uid) or is_closer(v_uid)
     ) then
    raise exception 'not authorized to reveal funder portal passwords'
      using errcode = '42501';
  end if;

  select secret_id, lender_id
    into v_secret_id, v_lender
    from public.funder_portal_credentials
   where id = p_cred_id;

  if not found then
    raise exception 'no such funder portal credential: %', p_cred_id
      using errcode = 'P0002';
  end if;

  select coalesce(nullif(btrim(coalesce(p.display_name, '')), ''), p.email, v_uid::text)
    into v_label
    from public.profiles p
   where p.id = v_uid;

  -- Before, not after. An audit row written only on the happy path is an audit
  -- row that is missing exactly when it matters.
  insert into public.funder_portal_credential_reveals
    (credential_id, lender_id, revealed_by, revealed_by_label)
  values (p_cred_id, v_lender, v_uid, coalesce(v_label, v_uid::text));

  if v_secret_id is null then
    return null;  -- no password recorded yet; the look is still logged
  end if;

  select decrypted_secret into v_password
    from vault.decrypted_secrets
   where id = v_secret_id;

  return v_password;
end;
$fn$;

-- Supabase's default privileges hand EXECUTE to anon, authenticated and
-- service_role by name. Take all three back, then grant only what we mean.
revoke execute on function public.set_funder_portal_password(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public.reveal_funder_portal_password(uuid) from public, anon, authenticated, service_role;
grant  execute on function public.set_funder_portal_password(uuid, text) to authenticated;
grant  execute on function public.reveal_funder_portal_password(uuid) to authenticated;

comment on table public.funder_portal_credentials is
  'Broker-portal logins per funder. Holds NO password — only the Vault secret_id. Plaintext comes back solely from reveal_funder_portal_password(), which audits every call.';
comment on column public.funder_portal_credentials.secret_id is
  'vault.secrets.id of the password. Resolving it requires vault.decrypted_secrets, which authenticated roles cannot read.';
comment on table public.funder_portal_credential_reveals is
  'Append-only audit of every reveal_funder_portal_password() call. No INSERT/UPDATE/DELETE policy exists; the SECURITY DEFINER function is the only writer.';
