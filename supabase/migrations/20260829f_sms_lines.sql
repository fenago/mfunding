-- sms_lines — the registry of company SMS numbers (multi-line data layer).
--
-- WHY THIS EXISTS. The JMP.chat SMS feature launched with a SINGLE hard-coded
-- number (+1 786 504-1159, JID mfunding@xmpp.chat). The owner now wants to ADD
-- MORE numbers and choose which line a message sends from. This table is that
-- registry; sms_messages.line_id (added below) stamps every message with the
-- line it came in on / went out from.
--
-- TODAY there is still exactly one live XMPP account, so exactly one row here is
-- is_active AND is_default. The droplet bridge is NOT yet an N-account process
-- (see the comment block in sms-bridge/index.js). Adding a real second number is
-- an operational runbook (sms-bridge/DEPLOY.md → "Adding another number"), not a
-- code change — this table + line_id is the schema that makes it a data change.

create table if not exists public.sms_lines (
  id         uuid primary key default gen_random_uuid(),
  phone      text not null unique,          -- E.164 (+1XXXXXXXXXX); the sending/receiving number
  label      text,                          -- human name, e.g. 'Main line'
  provider   text not null default 'jmp',   -- carrier/bridge behind it; only 'jmp' today
  jid        text,                          -- XMPP Jabber ID for the JMP account, e.g. mfunding@xmpp.chat
  is_active  boolean not null default true, -- a paused/retired number stays for history but can't send
  is_default boolean not null default false,-- the line sms-send falls back to when none is specified
  created_at timestamptz not null default now()
);

comment on table public.sms_lines is
  'Registry of company SMS numbers for the JMP.chat feature. One row per number. sms_messages.line_id references this. Exactly one active default at a time (sms_lines_one_default_idx). Staff read; super_admin writes.';
comment on column public.sms_lines.phone is
  'The company-side number in E.164 (+1XXXXXXXXXX). Unique. This is the FROM number, not the merchant number (that lives on sms_messages.phone).';
comment on column public.sms_lines.provider is
  'The carrier/bridge behind the number. Only ''jmp'' today (JMP.chat over XMPP via the droplet bridge).';
comment on column public.sms_lines.jid is
  'XMPP Jabber ID of the JMP account for this number (e.g. mfunding@xmpp.chat). The droplet .env holds the matching password; never stored here.';
comment on column public.sms_lines.is_active is
  'False = retired/paused. sms-send refuses to queue on an inactive line (fail-closed), and the bridge should not send from it.';
comment on column public.sms_lines.is_default is
  'The single line sms-send resolves to when the request names no line_id. Enforced to at most one true row by sms_lines_one_default_idx.';

-- AT MOST ONE default. Every row with is_default=true carries the same value in
-- the indexed column, so a UNIQUE index restricted to those rows permits exactly
-- one of them. Rows with is_default=false are not indexed and are unconstrained.
create unique index if not exists sms_lines_one_default_idx
  on public.sms_lines (is_default)
  where is_default = true;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Mirrors the sibling SMS tables (sms_messages, sms_opt_outs): staff read only,
-- never merchants (role 'user'), never anon. Writes are locked tighter than the
-- read — super_admin only — since a bad default/active flag here silently redirects
-- or blocks the whole line. Same super_admin gate shape as sms_admin_unsuppress().
alter table public.sms_lines enable row level security;

drop policy if exists sms_lines_staff_read on public.sms_lines;
create policy sms_lines_staff_read on public.sms_lines
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('closer','employee','admin','super_admin')
    )
  );

drop policy if exists sms_lines_superadmin_insert on public.sms_lines;
create policy sms_lines_superadmin_insert on public.sms_lines
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'super_admin'
    )
  );

drop policy if exists sms_lines_superadmin_update on public.sms_lines;
create policy sms_lines_superadmin_update on public.sms_lines
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'super_admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'super_admin'
    )
  );

drop policy if exists sms_lines_superadmin_delete on public.sms_lines;
create policy sms_lines_superadmin_delete on public.sms_lines
  for delete to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'super_admin'
    )
  );

-- Strip the default blanket grant, then hand back exactly what the policies use:
-- authenticated gets SELECT + the three write verbs (RLS gates writes to
-- super_admin); anon gets nothing; service_role keeps full access (bridge + fns).
revoke all on table public.sms_lines from anon;
revoke all on table public.sms_lines from authenticated;
grant select, insert, update, delete on table public.sms_lines to authenticated;
grant all on table public.sms_lines to service_role;

-- ── Seed the one existing line ───────────────────────────────────────────────
-- The number the bridge already runs. Idempotent on the unique phone.
insert into public.sms_lines (phone, label, provider, jid, is_active, is_default)
values ('+17865041159', 'Main line', 'jmp', 'mfunding@xmpp.chat', true, true)
on conflict (phone) do nothing;

-- ── sms_messages.line_id ─────────────────────────────────────────────────────
-- Which line the message belongs to. Nullable so historical rows and any future
-- provider that can't be attributed don't break; new rows always get stamped
-- (bridge on inbound, sms-send on outbound). NOT frozen by
-- trg_sms_messages_immutable_columns, so the backfill below is permitted.
alter table public.sms_messages
  add column if not exists line_id uuid references public.sms_lines(id);

comment on column public.sms_messages.line_id is
  'The company SMS line (sms_lines.id) this message came in on / went out from. NULL only for pre-multi-line history that could not be attributed; stamped on every new row by the bridge (inbound) and sms-send (outbound).';

-- Multi-line claim/read will filter by line_id; keep it an index lookup.
create index if not exists sms_messages_line_id_idx
  on public.sms_messages (line_id);

-- Backfill ALL existing rows to the seeded default line. There was only one
-- number when these were written, so every historical message is on it.
update public.sms_messages
   set line_id = (select id from public.sms_lines where is_default = true limit 1)
 where line_id is null;
