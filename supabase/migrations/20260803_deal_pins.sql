-- Per-user "star / bookmark" on My Day cards. A closer keeps personal-relationship
-- merchants pinned to the top of the queue so they never get lost in the crush of
-- hundreds of leads. Pins are PRIVATE to each user — different closers star
-- different deals — enforced by RLS (a user only ever sees/writes their own rows).
-- Applied live via MCP 2026-08-03.
create table if not exists public.deal_pins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, deal_id)
);

-- The hot path is "all my pins" — scoped by user_id on every read.
create index if not exists deal_pins_user_id_idx on public.deal_pins(user_id);

alter table public.deal_pins enable row level security;

-- A user may only ever touch their OWN pins.
drop policy if exists deal_pins_select_own on public.deal_pins;
create policy deal_pins_select_own on public.deal_pins for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists deal_pins_insert_own on public.deal_pins;
create policy deal_pins_insert_own on public.deal_pins for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists deal_pins_delete_own on public.deal_pins;
create policy deal_pins_delete_own on public.deal_pins for delete to authenticated
  using (user_id = (select auth.uid()));
