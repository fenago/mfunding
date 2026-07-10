-- Two writers can now create a commission for a funded deal (app-side
-- autoCreateCommissionForFundedDeal + the ghl-webhook funded mirror). Both are
-- idempotent by SELECT-then-insert, but a narrow race could double-insert.
-- Enforce one commission per deal at the DB level. (Applied live 2026-07-10.)
create unique index if not exists commissions_deal_id_uniq
  on commissions (deal_id)
  where deal_id is not null;
