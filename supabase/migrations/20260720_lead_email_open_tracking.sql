-- Per-LEAD email open tracking (going forward). ghl-webhook already receives GHL
-- EmailOpened/LCEmailStats events but only stamped FUNDER-submission opens; this
-- adds a merchant-side ledger + a cheap denormalized aggregate on customers so the
-- Campaign Audit can show a per-campaign open signal.
--
-- Tracking starts at deploy time; opens before then are not available (GHL exposes
-- open status per email record but we never persisted per-lead opens historically).

-- 1) Event ledger. customer_id is nullable so an open from a contact we can't map
--    (or a funder) is still recorded for debugging without polluting lead metrics.
create table if not exists public.email_open_events (
  id uuid primary key default gen_random_uuid(),
  ghl_contact_id text not null,
  customer_id uuid references public.customers(id) on delete set null,
  ghl_message_id text,                       -- email/message id for dedupe (when GHL sends one)
  opened_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Dedupe repeat opens of the SAME email; opens of different emails still count.
create unique index if not exists email_open_events_message_uidx
  on public.email_open_events (ghl_message_id) where ghl_message_id is not null;
create index if not exists email_open_events_customer_idx
  on public.email_open_events (customer_id) where customer_id is not null;

alter table public.email_open_events enable row level security;
-- Ops staff can read; writes happen via the service-role webhook / SECURITY DEFINER fn only.
drop policy if exists admin_select_email_open_events on public.email_open_events;
create policy admin_select_email_open_events
  on public.email_open_events for select using (is_ops_staff(auth.uid()));

-- 2) Cheap denormalized aggregate the audit reads alongside email health.
alter table public.customers add column if not exists email_last_opened_at timestamptz;
alter table public.customers add column if not exists email_open_count integer not null default 0;

-- 3) Atomic recorder: insert the event (dedupe on message id), and on a genuinely
--    new open for a mapped customer, bump the aggregate. Returns what happened so
--    the webhook can log it. SECURITY DEFINER so the service-role webhook is enough.
create or replace function public.record_lead_email_open(
  p_contact_id text,
  p_message_id text default null
) returns table(matched boolean, is_new boolean, customer_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_customer_id uuid;
  v_rows integer := 0;
  v_new boolean := false;
begin
  if p_contact_id is null or p_contact_id = '' then
    return query select false, false, null::uuid;
    return;
  end if;

  select id into v_customer_id from public.customers where ghl_contact_id = p_contact_id limit 1;

  if p_message_id is not null and p_message_id <> '' then
    insert into public.email_open_events (ghl_contact_id, customer_id, ghl_message_id, opened_at)
    values (p_contact_id, v_customer_id, p_message_id, now())
    on conflict (ghl_message_id) where ghl_message_id is not null do nothing;
    get diagnostics v_rows = row_count;
    v_new := v_rows > 0;
  else
    insert into public.email_open_events (ghl_contact_id, customer_id, ghl_message_id, opened_at)
    values (p_contact_id, v_customer_id, null, now());
    v_new := true;
  end if;

  if v_new and v_customer_id is not null then
    update public.customers
      set email_open_count = coalesce(email_open_count, 0) + 1,
          email_last_opened_at = greatest(coalesce(email_last_opened_at, now()), now())
    where id = v_customer_id;
  end if;

  return query select (v_customer_id is not null), v_new, v_customer_id;
end $$;

grant execute on function public.record_lead_email_open(text, text) to service_role, authenticated;
