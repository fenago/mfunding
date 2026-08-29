-- sms_messages soft-delete — reversible, super-admin-only, retention-safe.
--
-- The owner needs to remove specific texts from the shared inbox (a mis-sent
-- draft, a test, noise). But sms_messages is a COMPLIANCE record (TCPA opt-out
-- trail lives here, and the send rate-limits are derived by counting rows over
-- created_at — see trg_sms_messages_immutable_columns). So a hard DELETE is off
-- the table: it would (a) erase a compliance record and (b) silently reopen the
-- send caps. This is a SOFT delete instead — the row stays, it just stops being
-- shown and stops counting toward the unread badge. Fully reversible.
--
-- ⚠️ IMMUTABILITY: trg_sms_messages_immutable_columns freezes ONLY
-- created_at/direction/phone/body/created_by. deleted_at/deleted_by are NOT in
-- that set (same class as read_at/status/sent_at/error/customer_id/media_url,
-- which the trigger leaves mutable), so the SECURITY DEFINER functions below can
-- update them without any trigger change. Verified against the deployed trigger.

alter table public.sms_messages
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id);

comment on column public.sms_messages.deleted_at is
  'Soft-delete marker. NULL = live. When set, the row is HIDDEN from the inbox and EXCLUDED from sms_unread_count(), but retained on disk for TCPA/compliance and to keep the send rate-limit history intact. Reversible via sms_restore_message(). Set only by sms_delete_message() (super_admin). Deliberately NOT frozen by trg_sms_messages_immutable_columns.';
comment on column public.sms_messages.deleted_by is
  'The super_admin profile that soft-deleted this row (auth.uid() at delete time). Cleared on restore.';

-- The live inbox reads `deleted_at is null`; the deleted set is tiny next to the
-- full log, so a partial index on the DELETED rows keeps any "show deleted"/
-- restore lookup O(deleted) without adding weight to the hot path.
create index if not exists sms_messages_deleted_idx
  on public.sms_messages (deleted_at)
  where deleted_at is not null;

-- ── RPC — soft-delete a single message (super_admin only) ────────────────────
-- SECURITY DEFINER because staff have SELECT-only on sms_messages (no UPDATE
-- grant, no UPDATE policy); the super_admin check inside is the real gate, and
-- it matches sms_admin_unsuppress's gate exactly. Best-effort audit to
-- activity_log — but, unlike sms_admin_unsuppress (whose audit uses a
-- non-existent entity_type and omits the NOT NULL entity_id, so it silently
-- fails), this one writes a CHECK-valid row: entity_type='customer',
-- interaction_type='note', entity_id = the message's customer_id. If the message
-- isn't linked to a customer there is no valid entity to audit against, so the
-- audit is skipped (still best-effort; never fails the delete).
create or replace function public.sms_delete_message(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role     text;
  v_cust     uuid;
  v_phone    text;
  v_updated  int;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'super_admin' then
    raise exception 'not authorized: super_admin only' using errcode = '42501';
  end if;

  update public.sms_messages
     set deleted_at = now(),
         deleted_by = auth.uid()
   where id = p_id
     and deleted_at is null
  returning customer_id, phone into v_cust, v_phone;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    -- Either no such row, or already deleted. Distinguish so a caller sees the
    -- truth rather than a false success.
    if not exists (select 1 from public.sms_messages where id = p_id) then
      raise exception 'sms message not found: %', p_id using errcode = 'no_data_found';
    end if;
    return;  -- already soft-deleted: idempotent no-op
  end if;

  -- Best-effort audit: never let a logging hiccup fail the delete itself.
  begin
    if v_cust is not null then
      insert into public.activity_log
        (entity_type, entity_id, interaction_type, subject, content, logged_by)
      values
        ('customer', v_cust, 'note',
         'SMS message soft-deleted',
         'Super-admin soft-deleted an SMS row (id ' || p_id || ', phone ' ||
           coalesce(v_phone, 'unknown') || '). Row retained for compliance; reversible via restore.',
         auth.uid());
    end if;
  exception when others then
    null;
  end;
end;
$$;

comment on function public.sms_delete_message(uuid) is
  'Soft-deletes one sms_messages row (deleted_at=now(), deleted_by=auth.uid()). super_admin ONLY. Idempotent; raises if the id does not exist. Best-effort activity_log audit (customer/note) when the row is linked to a customer. Row is retained (TCPA/compliance + rate-limit history) and reversible via sms_restore_message().';

revoke all on function public.sms_delete_message(uuid) from public, anon;
grant execute on function public.sms_delete_message(uuid) to authenticated;

-- ── RPC — restore a soft-deleted message (super_admin only) ──────────────────
-- Makes the soft delete truly reversible: clears both markers so the row rejoins
-- the inbox and the unread count.
create or replace function public.sms_restore_message(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role     text;
  v_cust     uuid;
  v_phone    text;
  v_updated  int;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is distinct from 'super_admin' then
    raise exception 'not authorized: super_admin only' using errcode = '42501';
  end if;

  update public.sms_messages
     set deleted_at = null,
         deleted_by = null
   where id = p_id
     and deleted_at is not null
  returning customer_id, phone into v_cust, v_phone;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    if not exists (select 1 from public.sms_messages where id = p_id) then
      raise exception 'sms message not found: %', p_id using errcode = 'no_data_found';
    end if;
    return;  -- not deleted: idempotent no-op
  end if;

  begin
    if v_cust is not null then
      insert into public.activity_log
        (entity_type, entity_id, interaction_type, subject, content, logged_by)
      values
        ('customer', v_cust, 'note',
         'SMS message restored',
         'Super-admin restored a soft-deleted SMS row (id ' || p_id || ', phone ' ||
           coalesce(v_phone, 'unknown') || ').',
         auth.uid());
    end if;
  exception when others then
    null;
  end;
end;
$$;

comment on function public.sms_restore_message(uuid) is
  'Reverses sms_delete_message: clears deleted_at/deleted_by so the row rejoins the inbox and unread count. super_admin ONLY. Idempotent; raises if the id does not exist. Best-effort activity_log audit.';

revoke all on function public.sms_restore_message(uuid) from public, anon;
grant execute on function public.sms_restore_message(uuid) to authenticated;

-- ── Update the unread badge to ignore soft-deleted rows ──────────────────────
-- A deleted inbound must NOT keep the sidebar badge lit. Everything else about
-- this function is unchanged from 20260829j_sms_read_state.sql (staff gate,
-- SECURITY DEFINER). sms_mark_read is intentionally left as-is.
create or replace function public.sms_unread_count()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role  text;
  v_count integer;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('closer','employee','admin','super_admin') then
    raise exception 'not authorized: staff only' using errcode = '42501';
  end if;

  select count(*) into v_count
    from public.sms_messages
   where direction = 'inbound'
     and read_at is null
     and deleted_at is null;

  return coalesce(v_count, 0);
end;
$$;

comment on function public.sms_unread_count() is
  'Count of unread inbound sms_messages rows (org-wide, shared line), EXCLUDING soft-deleted rows. Drives the sidebar "Text Messages" badge. SECURITY DEFINER + staff-gated.';

revoke all on function public.sms_unread_count() from public, anon;
grant execute on function public.sms_unread_count() to authenticated;
