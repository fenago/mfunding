-- jmp_bot_messages — the DB layer for the JMP command console.
--
-- ⚠️ SCOPE: this table is ONLY the conversation with the JMP/Cheogram ACCOUNT BOT
-- (the bare JID `cheogram.com`) — read-only account commands the owner runs from
-- the Text Message Administration page: `info`, `cdrs`, `transactions`,
-- `plan settings`, `referral codes`, `sims`. It is NOT public.sms_messages and it
-- is NOT public.messages. Merchant/phone SMS keeps flowing to sms_messages exactly
-- as before — the bridge routes bot traffic here and everything else there.
--
-- SHAPE OF THE FEATURE (mirrors the sms_messages model, but for the bot channel):
--   · OUTBOUND — the `jmp-command` edge function (super_admin only) writes a
--     'queued' row {direction:'outbound', command, body}. A second pump in the
--     droplet bridge polls queued rows, sends `body` as an XMPP chat message to
--     `cheogram.com`, and flips the row to 'sent'.
--   · INBOUND — a message FROM the bare JID `cheogram.com` (the account bot's
--     reply) is inserted by the bridge as {direction:'inbound', status:'received'}.
--
-- WRITES ARE SERVICE_ROLE ONLY, exactly like sms_messages: the edge function and
-- the droplet bridge both use the service key. The SPA only READS, with the
-- super_admin's own JWT — hence a SELECT policy and deliberately NO write policy.

create table if not exists public.jmp_bot_messages (
  id         uuid primary key default gen_random_uuid(),
  direction  text not null check (direction in ('outbound','inbound')),
  body       text,
  command    text,                          -- the command word for an outbound row (e.g. 'info'); NULL on inbound replies
  status     text not null default 'queued'
               check (status in ('queued','sent','failed','received')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);

comment on table public.jmp_bot_messages is
  'JMP/Cheogram ACCOUNT BOT command console log (bare JID cheogram.com). NOT sms_messages (merchant SMS) and NOT messages (internal staff). Written only by service_role: the jmp-command edge fn (outbound, queued) and the droplet bridge (inbound replies + flipping outbound to sent). super_admin reads via RLS; the SPA never writes.';
comment on column public.jmp_bot_messages.direction is
  'outbound = a command we send to the bot; inbound = the bot''s reply.';
comment on column public.jmp_bot_messages.command is
  'The allowlisted command word for an outbound row (info/cdrs/transactions/plan settings/referral codes/sims). NULL on inbound replies. body carries the exact text sent/received.';
comment on column public.jmp_bot_messages.status is
  'Outbound rows walk queued -> sent (or failed). Inbound rows are born ''received'' and never move.';

-- The bridge pump only ever scans the (tiny) queue; partial index keeps it O(queue).
create index if not exists jmp_bot_messages_queued_idx
  on public.jmp_bot_messages (created_at)
  where status = 'queued';
-- The console panel reads newest-first.
create index if not exists jmp_bot_messages_created_at_idx
  on public.jmp_bot_messages (created_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Tighter than sms_messages: this is an ACCOUNT-management channel, so even the
-- READ is super_admin only. Same super_admin gate shape as sms_lines /
-- sms_admin_unsuppress. Never merchants, never anon. No INSERT/UPDATE/DELETE
-- policy exists on purpose — every write path is service_role (edge fn + bridge).
alter table public.jmp_bot_messages enable row level security;

drop policy if exists jmp_bot_messages_superadmin_read on public.jmp_bot_messages;
create policy jmp_bot_messages_superadmin_read on public.jmp_bot_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'super_admin'
    )
  );

-- Supabase hands anon + authenticated a full write grant on every new public
-- table. RLS already denies writes (no write policy), but strip the standing
-- grant down to exactly what is used: anon nothing, authenticated SELECT only,
-- service_role full (edge fn + bridge).
revoke all on table public.jmp_bot_messages from anon;
revoke all on table public.jmp_bot_messages from authenticated;
grant select on table public.jmp_bot_messages to authenticated;
grant all    on table public.jmp_bot_messages to service_role;

-- Live-updating console panel. Realtime still applies the SELECT policy above per
-- subscriber, so this exposes nothing a super_admin could not already read.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'jmp_bot_messages'
  ) then
    alter publication supabase_realtime add table public.jmp_bot_messages;
  end if;
end $$;
