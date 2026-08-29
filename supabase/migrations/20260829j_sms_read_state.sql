-- sms_messages read-state — the "unread merchant text" signal for the shared line.
--
-- The Text Messages page (/admin/text-messages) is ONE JMP.chat number the whole
-- floor shares. So "unread" is an ORG-WIDE property, not a per-user one: if any
-- staff member opens a thread, it is read for everyone. That is exactly the
-- behaviour a shared support line wants — nobody re-works a text a colleague
-- already answered.
--
-- read_at is NULL = unread, and it is only ever meaningful on INBOUND rows
-- (merchant -> us). Outbound rows are things WE sent; they are never "unread".
--
-- ⚠️ IMMUTABILITY: trg_sms_messages_immutable_columns (20260829_sms_messages.sql)
-- freezes ONLY created_at/direction/phone/body/created_by. read_at is not in that
-- set, so it is freely updatable — same class as status/sent_at/error/customer_id/
-- media_url, which that trigger explicitly leaves mutable. No trigger change needed.

alter table public.sms_messages
  add column if not exists read_at timestamptz;

comment on column public.sms_messages.read_at is
  'When an inbound (merchant->us) text was marked read on the SHARED line. NULL = unread. Org-wide, not per-user: the line is shared, so once anyone opens the thread it is read for the whole floor. Set by sms_mark_read(); never meaningful on outbound rows. Deliberately NOT frozen by trg_sms_messages_immutable_columns.';

-- The unread badge counts exactly `direction='inbound' and read_at is null`. A
-- partial index on that predicate keeps both the count and the mark-read update
-- O(unread), not O(history) — the unread set is tiny next to the full log.
create index if not exists sms_messages_unread_inbound_idx
  on public.sms_messages (direction, read_at)
  where read_at is null;

-- ── RPC 1 — mark a thread read ───────────────────────────────────────────────
-- Staff have SELECT on sms_messages but NO update grant (see 20260829_sms_messages:
-- authenticated is granted SELECT only, and there is no UPDATE policy). So the
-- only way to stamp read_at is through this SECURITY DEFINER function, gated on the
-- same staff role set the SELECT policy uses. It marks every UNREAD inbound row for
-- the given phone (last-10-digit match, identical rule to trg_sms_messages_link_
-- customer) and returns how many rows it flipped.
create or replace function public.sms_mark_read(p_phone text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   text;
  v_last10 text;
  v_marked integer;
begin
  select role into v_role from public.profiles where id = auth.uid();
  if v_role is null or v_role not in ('closer','employee','admin','super_admin') then
    raise exception 'not authorized: staff only' using errcode = '42501';
  end if;

  v_last10 := right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10);
  if length(v_last10) < 10 then
    return 0;   -- short code / non-NANP: nothing addressable to mark
  end if;

  update public.sms_messages
     set read_at = now()
   where direction = 'inbound'
     and read_at is null
     and right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = v_last10;
  get diagnostics v_marked = row_count;

  return v_marked;
end;
$$;

comment on function public.sms_mark_read(text) is
  'Marks every UNREAD inbound sms_messages row for p_phone (last-10-digit match) as read (read_at = now()); returns the count flipped. SECURITY DEFINER because staff have SELECT-only on the table; gated on the staff role set. Org-wide read on the shared JMP line — called once when a staff member opens a thread.';

revoke all on function public.sms_mark_read(text) from public, anon;
grant execute on function public.sms_mark_read(text) to authenticated;

-- ── RPC 2 — cheap unread count for the sidebar badge ─────────────────────────
-- A single integer for the whole floor. Rides sms_messages_unread_inbound_idx, so
-- it costs the size of the UNREAD set, never the full history. SECURITY DEFINER +
-- the same staff gate so it returns a consistent number regardless of any future
-- RLS narrowing, and never leaks to non-staff.
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
     and read_at is null;

  return coalesce(v_count, 0);
end;
$$;

comment on function public.sms_unread_count() is
  'Count of unread inbound sms_messages rows (org-wide, shared line). Drives the sidebar "Text Messages" badge. SECURITY DEFINER + staff-gated; rides sms_messages_unread_inbound_idx so it costs O(unread), not O(history).';

revoke all on function public.sms_unread_count() from public, anon;
grant execute on function public.sms_unread_count() to authenticated;
