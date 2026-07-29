-- Plaid integration STATUS tracking — a human-maintained record of what Plaid has
-- granted us (per-product enablement, key-rotation state, notes) that lives next to
-- the runtime `plaid` config in platform_settings. The Integrations page reads it to
-- render the "Plaid Integration Status" card; live counts (connected banks, tx,
-- statements, last webhook) come from the real plaid_* tables, NOT from here.
--
-- WHY a separate key (not folded into 'plaid'): the 'plaid' key is RUNTIME config the
-- edge functions read on every pull (environment, products, statements_enabled). This
-- key is an operational LEDGER edited by super_admins in the UI. Keeping them apart
-- means a UI save can't accidentally flip a runtime flag, and plaid-pull's auto-detect
-- can update product statuses here without racing the config.
--
-- Product statuses are "as recorded" facts with dates — never fake live probes.
-- Values: enabled | requested | not_requested | not_eligible.
--
-- RLS: platform_settings already allows anyone to read and super_admin to write;
-- no new policies needed. plaid-pull (service role) updates products.statements when
-- the Statements API first succeeds (see the function's auto-detect note).

insert into public.platform_settings (key, value)
values ('plaid_status', jsonb_build_object(
  'products', jsonb_build_object(
    'auth',           jsonb_build_object('status', 'enabled',       'date', '2026-07-28'),
    'balance',        jsonb_build_object('status', 'enabled',       'date', '2026-07-28'),
    'identity',       jsonb_build_object('status', 'enabled',       'date', '2026-07-28'),
    'identity_match', jsonb_build_object('status', 'enabled',       'date', '2026-07-28'),
    'transactions',   jsonb_build_object('status', 'enabled',       'date', '2026-07-28'),
    'statements',     jsonb_build_object('status', 'requested',     'date', '2026-07-28'),
    'assets',         jsonb_build_object('status', 'not_requested', 'date', null),
    'signal',         jsonb_build_object('status', 'not_eligible',  'date', null)
  ),
  'statements_price_note', '$0.50 per statement — Statements bills on link-token creation, so we detect enablement passively via /statements/list (no probe cost).',
  'keys_rotated_at', null,
  'notes', 'Full Production granted 2026-07-28. API keys were shared through chat on 2026-07-28 — rotate at dashboard.plaid.com/developers/keys, then stamp keys_rotated_at. Statements requested 2026-07-28 (pending Plaid review).'
))
on conflict (key) do nothing;
