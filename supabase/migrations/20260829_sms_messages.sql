-- sms_messages — the DB layer for the JMP.chat SMS feature.
--
-- ⚠️ NAMING: this is `sms_messages`, NOT `messages`. public.messages already
-- exists and is the INTERNAL staff messaging system — it is untouched here.
--
-- SHAPE OF THE FEATURE. A droplet bridge holds the JMP.chat XMPP session and
-- writes INBOUND rows with the service key. Staff send by calling the `sms-send`
-- edge function (also service_role), which writes an OUTBOUND row as 'queued'
-- and flips it to sent/failed. The Vite SPA (Text Messages page) only ever
-- READS, over realtime + a plain select, with the staff member's own JWT.
-- That is why there is a SELECT policy and deliberately NO insert/update policy:
-- every write path already bypasses RLS via service_role, so an authenticated
-- write policy would only be an attack surface.

create table if not exists public.sms_messages (
  id          uuid primary key default gen_random_uuid(),
  direction   text not null check (direction in ('inbound','outbound')),
  phone       text not null,
  body        text not null default '',
  media_url   text,
  status      text not null default 'received'
                check (status in ('received','queued','sending','sent','failed')),
  error       text,
  customer_id uuid references public.customers(id),
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

comment on table public.sms_messages is
  'JMP.chat SMS log (inbound + outbound). NOT public.messages (internal staff messaging). Written only by service_role: the droplet XMPP bridge (inbound) and the sms-send edge function (outbound). Staff read via RLS; the SPA never writes.';
comment on column public.sms_messages.phone is
  'The MERCHANT-side number in E.164 (+1XXXXXXXXXX) for BOTH directions — inbound sender, outbound recipient. It is the conversation key, so a thread is just: where phone = $1 order by created_at.';
comment on column public.sms_messages.media_url is
  'Inbound MMS out-of-band URL as handed over by JMP. Not proxied or re-hosted — treat as expiring.';
comment on column public.sms_messages.status is
  'Inbound rows are born ''received'' and never move. Outbound rows walk queued -> sending -> sent|failed. ''failed'' rows carry `error`.';
comment on column public.sms_messages.customer_id is
  'Best-effort link, stamped by trg_sms_messages_link_customer on insert (last-10-digit phone match). NULL means "no customer matched", never "not a real message" — an unknown number still gets a row.';
comment on column public.sms_messages.created_by is
  'Staff profile that sent an outbound message. Always NULL on inbound.';

-- Reading a thread = (phone, newest first). Both the page and the outbound
-- opt-out guard hit exactly this.
create index if not exists sms_messages_phone_created_at_idx
  on public.sms_messages (phone, created_at desc);
-- The send worker's claim query only ever looks at the queue, which is tiny
-- next to the full log — partial index so it stays O(queue), not O(history).
create index if not exists sms_messages_queued_idx
  on public.sms_messages (created_at)
  where status = 'queued';
create index if not exists sms_messages_customer_id_idx
  on public.sms_messages (customer_id);
-- sms-send rate-limits on three windows: per-sender, per-recipient, and
-- line-wide. Per-recipient rides the (phone, created_at desc) index above;
-- these cover the other two. They are counted on every single send, so they
-- must not degrade into a scan of the whole history.
create index if not exists sms_messages_created_by_created_at_idx
  on public.sms_messages (created_by, created_at desc);
create index if not exists sms_messages_created_at_idx
  on public.sms_messages (created_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.sms_messages enable row level security;

-- Same OPS set the sidebar/roleAccess use and the same shape as
-- wavv_calls_staff_read: closer, employee, admin, super_admin. Never merchants
-- (role 'user'), never anon. No INSERT/UPDATE/DELETE policy exists on purpose —
-- writes are service_role only (bridge + sms-send edge fn).
drop policy if exists sms_messages_staff_read on public.sms_messages;
create policy sms_messages_staff_read on public.sms_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('closer','employee','admin','super_admin')
    )
  );

-- Supabase's default privileges hand BOTH anon and authenticated a full
-- INSERT/UPDATE/DELETE grant on every new public table. RLS already denies
-- those (there is no write policy), but a standing write grant is one policy
-- mistake away from being live, so strip it down to exactly what is used:
-- anon gets nothing at all, authenticated gets SELECT only.
revoke all on table public.sms_messages from anon;
revoke all on table public.sms_messages from authenticated;
grant select on table public.sms_messages to authenticated;
grant all    on table public.sms_messages to service_role;

-- Live-updating Text Messages page. Realtime still applies the SELECT policy
-- above per subscriber, so this exposes nothing the page could not already read.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sms_messages'
  ) then
    alter publication supabase_realtime add table public.sms_messages;
  end if;
end $$;

-- ── TRIGGER 1 — best-effort customer link ────────────────────────────────────
-- Phones reach us in whatever shape the far end used, so match on the last ten
-- digits rather than the literal string. SECURITY DEFINER because customers is
-- RLS'd and this must resolve identically no matter who inserted the row.
--
-- BEST-EFFORT IS LOAD-BEARING: an SMS from an unknown number is still a real
-- message that staff must see. A lookup failure must never eat it, so the whole
-- body is wrapped and any error degrades to customer_id = NULL.
create or replace function public.sms_messages_link_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last10 text;
begin
  if new.customer_id is not null then
    return new;
  end if;

  v_last10 := right(regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g'), 10);
  if length(v_last10) < 10 then
    return new;                       -- short code / non-NANP: nothing to match
  end if;

  begin
    select c.id into new.customer_id
      from public.customers c
     where c.phone is not null
       and right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10) = v_last10
     order by c.created_at desc nulls last
     limit 1;                         -- ambiguous number -> most recent wins
  exception when others then
    new.customer_id := null;
  end;

  return new;
end;
$$;

comment on function public.sms_messages_link_customer() is
  'BEFORE INSERT on sms_messages: resolves phone -> customers.id on last-10 digits (most recent on ties). Best-effort — never blocks the insert; failure degrades to NULL.';

drop trigger if exists trg_sms_messages_link_customer on public.sms_messages;
create trigger trg_sms_messages_link_customer
  before insert on public.sms_messages
  for each row execute function public.sms_messages_link_customer();

-- Keeps the last-10 match an index lookup instead of a seq scan as the book
-- grows. regexp_replace/right are both IMMUTABLE, so this is indexable.
create index if not exists customers_phone_last10_idx
  on public.customers (right(regexp_replace(phone, '[^0-9]', '', 'g'), 10))
  where phone is not null;

-- ── TRIGGER 2 — STOP opt-out (COMPLIANCE, must be reliable) ──────────────────
-- This is the legal opt-out path. Unlike trigger 1 it does NOT swallow errors:
-- if the DNC flag cannot be written we want the insert to fail loudly so the
-- bridge retries, rather than silently keeping a merchant who said STOP in the
-- dialable pool. A dropped message is recoverable; an ignored STOP is a TCPA
-- violation.
--
-- Matching is on the punctuation-stripped uppercase body, so "Stop." and
-- "STOP!" count — a deliberate (small) widening of an exact keyword match.
-- "STOP ALL" normalises to STOPALL, which is already in the list. Whole-string
-- comparison only, so "please stop texting" does NOT trip it.
create or replace function public.sms_messages_stop_optout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keyword    text;
  v_prev_dnc   boolean;
  v_prev_reason text;
begin
  if new.direction <> 'inbound' then
    return null;
  end if;

  v_keyword := upper(regexp_replace(coalesce(new.body, ''), '[^A-Za-z]', '', 'g'));
  if v_keyword not in ('STOP','STOPALL','UNSUBSCRIBE','CANCEL','QUIT','END','OPTOUT') then
    return null;
  end if;

  -- No matched customer: the sms_messages row IS the record of the opt-out, and
  -- the outbound path is expected to consult it by phone. Nothing to flag here.
  if new.customer_id is null then
    return null;
  end if;

  select c.do_not_contact, c.do_not_contact_reason
    into v_prev_dnc, v_prev_reason
    from public.customers c
   where c.id = new.customer_id;

  -- The legal opt-out outranks any earlier DNC reason, so the reason is set
  -- unconditionally; the prior value is preserved in the audit entry below.
  update public.customers
     set do_not_contact        = true,
         do_not_contact_reason = 'SMS opt-out (STOP)',
         updated_at            = now()
   where id = new.customer_id;

  -- entity_type/interaction_type are CHECK-constrained; 'sms' is a permitted
  -- interaction_type and is literally what this was. A bad value here would
  -- abort the insert, which is the intended loudness for this trigger.
  insert into public.activity_log (entity_type, entity_id, interaction_type, subject, content, logged_by)
  values (
    'customer',
    new.customer_id,
    'sms',
    'SMS opt-out (STOP)',
    format(
      'Inbound SMS from %s matched opt-out keyword %s. do_not_contact set to true. Message body: %L. Previous do_not_contact=%s, previous reason=%s.',
      new.phone, v_keyword, new.body,
      coalesce(v_prev_dnc::text, 'unknown'),
      coalesce(quote_literal(v_prev_reason), 'none')
    ),
    null
  );

  return null;
end;
$$;

comment on function public.sms_messages_stop_optout() is
  'AFTER INSERT on sms_messages: an inbound STOP/STOPALL/UNSUBSCRIBE/CANCEL/QUIT/END/OPTOUT flips customers.do_not_contact and writes an activity_log entry. Compliance path — intentionally does NOT swallow errors so a failed opt-out surfaces as a failed insert the bridge retries.';

drop trigger if exists trg_sms_messages_stop_optout on public.sms_messages;
create trigger trg_sms_messages_stop_optout
  after insert on public.sms_messages
  for each row execute function public.sms_messages_stop_optout();

-- Trigger functions are invoked by the trigger manager, not by callers, so
-- neither needs an EXECUTE grant. Both are SECURITY DEFINER — do not leave
-- them directly callable.
revoke all on function public.sms_messages_link_customer() from public, anon, authenticated;
revoke all on function public.sms_messages_stop_optout()   from public, anon, authenticated;

-- ── TRIGGER 3 — row immutability (protects the rate limiter) ─────────────────
-- sms-send rate-limits by COUNTING ROWS in this table: per-destination,
-- per-user, and line-wide, all as
--   count(*) where direction='outbound' and created_at > now() - <window>.
--
-- That makes the send caps a derived property of this table's history rather
-- than state held anywhere else, which quietly couples them to two things a
-- send worker would otherwise consider its own business:
--   * rewriting created_at to the SEND time instead of the queue time would
--     slide every row out of its window and weaken every cap;
--   * mutating phone/direction after the fact would move a row between buckets.
-- Either one makes the caps evaporate SILENTLY — no error, no failed send, just
-- an unprotected consumer line. A comment is not enough protection for that, so
-- the invariant is enforced here instead of documented and hoped for.
--
-- body is locked for a second reason: the STOP opt-out audit trail quotes it,
-- and a rewritable body means a rewritable record of who opted out.
--
-- A worker may still do its actual job: status, sent_at, error, customer_id and
-- media_url all stay mutable.
create or replace function public.sms_messages_immutable_columns()
returns trigger
language plpgsql
set search_path = ''   -- touches no schema objects; pinned so it adds no advisor warning
as $$
begin
  if new.created_at is distinct from old.created_at
     or new.direction  is distinct from old.direction
     or new.phone      is distinct from old.phone
     or new.body       is distinct from old.body
     or new.created_by is distinct from old.created_by then
    raise exception
      'sms_messages: created_at/direction/phone/body/created_by are immutable (row %). The send rate limits are computed by counting rows over created_at, so rewriting these silently disables them. Update only status, sent_at, error, customer_id or media_url.',
      old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.sms_messages_immutable_columns() is
  'BEFORE UPDATE on sms_messages: freezes created_at/direction/phone/body/created_by. sms-send derives its per-destination/per-user/line-wide caps by counting rows over created_at, so mutating those columns would disable the caps with no visible error.';

drop trigger if exists trg_sms_messages_immutable_columns on public.sms_messages;
create trigger trg_sms_messages_immutable_columns
  before update on public.sms_messages
  for each row execute function public.sms_messages_immutable_columns();

revoke all on function public.sms_messages_immutable_columns() from public, anon, authenticated;

-- NOTE — the one coupling that CANNOT be enforced here: deleting or archiving
-- sent rows also erases the rate-limit history and reopens the caps. There is
-- no way to distinguish a worker's cleanup from legitimate retention pruning at
-- the row level, so this stays a rule the bridge must honour: rows stay put
-- after sending; move `status` and stamp `sent_at`, never DELETE. If retention
-- becomes a real requirement, it needs a counters table so the caps stop
-- depending on history being kept forever.
comment on column public.sms_messages.created_at is
  'Queue time, NOT send time (that is sent_at). sms-send counts rows over this column for its send caps, so it is immutable — see trg_sms_messages_immutable_columns. Deleting sent rows also erases rate-limit history: do not prune this table without replacing the caps first.';
