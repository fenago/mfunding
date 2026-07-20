-- Pull-based per-lead email-open sync. Complements the webhook PUSH path (which
-- depends on a GHL workflow firing): a sweep actively reads each open-deal
-- merchant's recent outbound email RECORD status (delivered/opened) and persists it
-- into the same ledger + customers aggregate the Campaign Audit already reads.

-- Ledger now also carries the observed status and a delivered timestamp.
alter table public.email_open_events add column if not exists status text;
alter table public.email_open_events add column if not exists delivered_at timestamptz;

-- Record ONE email's status from the sweep. Idempotent / record-once: the customers
-- aggregate is bumped only the FIRST time an email is seen opened, so the sweep and
-- the webhook path can never double-count (both key on ghl_message_id = the email id).
create or replace function public.sync_email_open_status(
  p_email_id text,
  p_contact_id text,
  p_status text,
  p_event_at timestamptz default now()
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_customer_id uuid;
  v_prev_opened timestamptz;
  v_is_open boolean := lower(coalesce(p_status, '')) = 'opened';
  v_at timestamptz := coalesce(p_event_at, now());
begin
  if p_email_id is null or p_email_id = '' then return; end if;
  select id into v_customer_id from public.customers where ghl_contact_id = p_contact_id limit 1;
  select opened_at into v_prev_opened from public.email_open_events where ghl_message_id = p_email_id;

  insert into public.email_open_events (ghl_contact_id, customer_id, ghl_message_id, status, opened_at, delivered_at)
  values (
    p_contact_id, v_customer_id, p_email_id, p_status,
    case when v_is_open then v_at end,
    case when lower(coalesce(p_status, '')) = 'delivered' then v_at end
  )
  on conflict (ghl_message_id) where ghl_message_id is not null do update
    set status = excluded.status,
        customer_id = coalesce(email_open_events.customer_id, excluded.customer_id),
        opened_at = coalesce(email_open_events.opened_at, excluded.opened_at),
        delivered_at = coalesce(email_open_events.delivered_at, excluded.delivered_at);

  if v_is_open and v_prev_opened is null and v_customer_id is not null then
    update public.customers
      set email_open_count = coalesce(email_open_count, 0) + 1,
          email_last_opened_at = greatest(coalesce(email_last_opened_at, v_at), v_at)
    where id = v_customer_id;
  end if;
end $$;

grant execute on function public.sync_email_open_status(text, text, text, timestamptz) to service_role;

-- Every 15 minutes (same cadence as check-email-bounces), pull recent outbound email
-- statuses for open-deal merchants. Trusted via the shared GHL secret + anon bearer.
select cron.schedule(
  'ghl-email-open-sweep-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://ehibjeonqpqskhcvizow.supabase.co/functions/v1/ghl-email-open-sweep?secret='
           || (select decrypted_secret from vault.decrypted_secrets where name = 'GHL_WEBHOOK_SECRET'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_ANON_KEY')
    ),
    body := '{}'::jsonb
  );
  $$
);
