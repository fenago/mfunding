-- Plaid integration — bank connection for merchants (the #1 funnel leak: 14-day
-- statement chases). A merchant clicks a link, connects their bank in ~60s, and we
-- pull transactions/statements straight into the deal + the AI underwriter.
--
-- SECURITY MODEL
--   · Plaid API credentials (PLAID_CLIENT_ID, PLAID_SECRET_PRODUCTION,
--     PLAID_SECRET_SANDBOX) live ONLY in the Supabase vault and are read through
--     get_plaid_config() — a SECURITY DEFINER, service-role-only RPC (same shape as
--     get_ghl_config()). They never touch a table or a migration.
--   · Per-item ACCESS TOKENS are secrets too (they grant ongoing read access to a
--     merchant's bank). They are NEVER stored plaintext: plaid_store_item() puts each
--     one in the vault via vault.create_secret and plaid_items only keeps the vault
--     secret's uuid. plaid_get_access_token() decrypts it, service-role only.
--
-- All client access is READ-ONLY and least-privilege: ops staff can read everything;
-- a merchant can read only their own item/transactions. Every WRITE goes through the
-- service-role edge functions (plaid-exchange / plaid-webhook / plaid-pull).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Config accessor — Plaid API keys from the vault (service-role only).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_plaid_config()
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_client_id  text;
  v_secret_prod text;
  v_secret_sbx  text;
begin
  select decrypted_secret into v_client_id   from vault.decrypted_secrets where name = 'PLAID_CLIENT_ID'         limit 1;
  select decrypted_secret into v_secret_prod  from vault.decrypted_secrets where name = 'PLAID_SECRET_PRODUCTION' limit 1;
  select decrypted_secret into v_secret_sbx   from vault.decrypted_secrets where name = 'PLAID_SECRET_SANDBOX'    limit 1;
  return jsonb_build_object(
    'client_id',         v_client_id,
    'secret_production', v_secret_prod,
    'secret_sandbox',    v_secret_sbx
  );
end;
$$;
revoke all on function public.get_plaid_config() from public, anon, authenticated;
grant execute on function public.get_plaid_config() to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Tables
-- ─────────────────────────────────────────────────────────────────────────────

-- A connected bank item (one Plaid Item = one bank login for one merchant).
create table if not exists public.plaid_items (
  id                      uuid primary key default gen_random_uuid(),
  customer_id             uuid not null references public.customers(id) on delete cascade,
  deal_id                 uuid references public.deals(id) on delete set null,
  item_id                 text not null unique,               -- Plaid item_id
  institution_id          text,
  institution_name        text,
  environment             text not null default 'production'
                            check (environment in ('sandbox','production')),
  access_token_secret_id  uuid not null,                      -- vault secret uuid (NEVER the token itself)
  status                  text not null default 'active'
                            check (status in ('active','error','revoked','pending')),
  error_code              text,
  error_message           text,
  accounts                jsonb,                              -- cached account metadata after a pull
  consent_expiration_time timestamptz,
  last_pull_at            timestamptz,
  transactions_count      integer not null default 0,
  statements_count        integer not null default 0,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists idx_plaid_items_customer on public.plaid_items(customer_id);
create index if not exists idx_plaid_items_deal on public.plaid_items(deal_id);

-- Raw webhook + lifecycle log (observability, mirrors ghl_webhook_events).
create table if not exists public.plaid_events (
  id            uuid primary key default gen_random_uuid(),
  item_id       text,                                          -- Plaid item id (may be null for non-item events)
  plaid_item_pk uuid references public.plaid_items(id) on delete set null,
  webhook_type  text,
  webhook_code  text,
  payload       jsonb,
  handled       boolean not null default false,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_plaid_events_item on public.plaid_events(item_id);
create index if not exists idx_plaid_events_created on public.plaid_events(created_at desc);

-- Pulled transactions (fallback store when the Statements API is unavailable on our
-- plan; also feeds analytics). Statement PDFs, when available, go to customer-documents
-- storage as bank_statement instead so the EXISTING underwriter pipeline consumes them.
create table if not exists public.plaid_transactions (
  id              uuid primary key default gen_random_uuid(),
  plaid_item_pk   uuid not null references public.plaid_items(id) on delete cascade,
  customer_id     uuid references public.customers(id) on delete cascade,
  account_id      text,
  transaction_id  text not null unique,
  name            text,
  merchant_name   text,
  amount          numeric,                                     -- Plaid: positive = money OUT of the account
  iso_currency_code text,
  date            date,
  pending         boolean,
  category        text[],
  raw             jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists idx_plaid_tx_item on public.plaid_transactions(plaid_item_pk);
create index if not exists idx_plaid_tx_customer on public.plaid_transactions(customer_id);
create index if not exists idx_plaid_tx_date on public.plaid_transactions(date desc);

-- Public, single-purpose "connect your bank" link refs. A closer mints one (via
-- plaid-mint-link) and texts my.mfunding.net/connect-bank/<token>; the merchant opens
-- it with no login. The token maps to exactly one customer and expires. NEVER
-- readable by anon over the API — it is validated server-side by service role.
create table if not exists public.merchant_bank_link_tokens (
  token       text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  deal_id     uuid references public.deals(id) on delete set null,
  created_by  uuid references public.profiles(id) on delete set null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_bank_link_tokens_customer on public.merchant_bank_link_tokens(customer_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Access-token vault helpers (service-role only)
-- ─────────────────────────────────────────────────────────────────────────────

-- Store/refresh a Plaid item + its access token. The token is written to the vault
-- (create on first link, update on re-link) and only the vault uuid is kept on the
-- row. Returns the plaid_items.id. Idempotent by item_id.
create or replace function public.plaid_store_item(
  p_customer_id       uuid,
  p_deal_id           uuid,
  p_item_id           text,
  p_institution_id    text,
  p_institution_name  text,
  p_access_token      text,
  p_environment       text
)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_existing   public.plaid_items%rowtype;
  v_secret_id  uuid;
  v_row_id     uuid;
begin
  select * into v_existing from public.plaid_items where item_id = p_item_id limit 1;

  if found then
    -- Re-link of a known item: rotate the token in place, keep the same vault secret.
    perform vault.update_secret(v_existing.access_token_secret_id, p_access_token);
    update public.plaid_items
       set customer_id       = coalesce(p_customer_id, customer_id),
           deal_id           = coalesce(p_deal_id, deal_id),
           institution_id    = coalesce(p_institution_id, institution_id),
           institution_name  = coalesce(p_institution_name, institution_name),
           environment       = coalesce(p_environment, environment),
           status            = 'active',
           error_code        = null,
           error_message     = null,
           updated_at        = now()
     where id = v_existing.id
     returning id into v_row_id;
    return v_row_id;
  end if;

  -- New item: mint a vault secret for the token, store only its uuid.
  v_secret_id := vault.create_secret(
    p_access_token,
    'plaid_item_' || p_item_id || '_' || substr(md5(random()::text), 1, 8),
    'Plaid access token for item ' || p_item_id
  );
  insert into public.plaid_items (
    customer_id, deal_id, item_id, institution_id, institution_name,
    environment, access_token_secret_id, status
  ) values (
    p_customer_id, p_deal_id, p_item_id, p_institution_id, p_institution_name,
    coalesce(p_environment, 'production'), v_secret_id, 'active'
  )
  returning id into v_row_id;
  return v_row_id;
end;
$$;
revoke all on function public.plaid_store_item(uuid,uuid,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.plaid_store_item(uuid,uuid,text,text,text,text,text) to service_role;

-- Decrypt an item's access token (service-role only).
create or replace function public.plaid_get_access_token(p_item_id text)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
  v_token     text;
begin
  select access_token_secret_id into v_secret_id from public.plaid_items where item_id = p_item_id limit 1;
  if v_secret_id is null then return null; end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where id = v_secret_id limit 1;
  return v_token;
end;
$$;
revoke all on function public.plaid_get_access_token(text) from public, anon, authenticated;
grant execute on function public.plaid_get_access_token(text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) RLS — read-only, least privilege. All writes are service-role (edge fns).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.plaid_items                enable row level security;
alter table public.plaid_events               enable row level security;
alter table public.plaid_transactions         enable row level security;
alter table public.merchant_bank_link_tokens  enable row level security;

-- plaid_items: staff read all; merchant reads only their own connected bank.
drop policy if exists plaid_items_staff_read on public.plaid_items;
create policy plaid_items_staff_read on public.plaid_items
  for select using (public.is_ops_staff(auth.uid()));
drop policy if exists plaid_items_merchant_read on public.plaid_items;
create policy plaid_items_merchant_read on public.plaid_items
  for select using (
    customer_id in (select id from public.customers where user_id = auth.uid())
  );

-- plaid_events: staff read only (internal observability).
drop policy if exists plaid_events_staff_read on public.plaid_events;
create policy plaid_events_staff_read on public.plaid_events
  for select using (public.is_ops_staff(auth.uid()));

-- plaid_transactions: staff read all; merchant reads only their own.
drop policy if exists plaid_tx_staff_read on public.plaid_transactions;
create policy plaid_tx_staff_read on public.plaid_transactions
  for select using (public.is_ops_staff(auth.uid()));
drop policy if exists plaid_tx_merchant_read on public.plaid_transactions;
create policy plaid_tx_merchant_read on public.plaid_transactions
  for select using (
    customer_id in (select id from public.customers where user_id = auth.uid())
  );

-- merchant_bank_link_tokens: staff read for visibility; NEVER anon/merchant (the
-- public connect page validates the token through a service-role edge function).
drop policy if exists bank_link_tokens_staff_read on public.merchant_bank_link_tokens;
create policy bank_link_tokens_staff_read on public.merchant_bank_link_tokens
  for select using (public.is_ops_staff(auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Runtime config — environment toggle (Limited Production uses PRODUCTION keys).
--    Sandbox is switchable here for testing without touching code.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.platform_settings (key, value)
values ('plaid', jsonb_build_object(
  'environment', 'production',
  'products', jsonb_build_array('transactions'),
  'statements_enabled', true
))
on conflict (key) do nothing;
