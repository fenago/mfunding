-- AI INTERNAL UNDERWRITER — first-class AFFORDABILITY block (daily vs weekly).
--
-- Adds the admin-tunable knobs the deterministic affordability math needs. All
-- additive with defaults, safe on re-run. The affordability RESULTS themselves
-- (max daily/weekly payment, max advance both ways, per-month table) live inside
-- the existing deal_underwriting.metrics jsonb — no result-column migration needed,
-- so old rows simply lack the new keys and the UI hides those sections.
--
--   max_payment_pct_of_revenue — the total debt-service ceiling (existing positions
--     + the new advance's daily/weekly pull) as a % of TRUE monthly revenue.
--     Industry sizing runs 8–15%; we default to 10% (middle of the band).
--   balance_buffer_pct — a SECOND guard independent of revenue: the new payment may
--     not exceed this % of the worst month's average daily balance, so a thin-balance
--     merchant can't be sized on revenue math alone (e.g. a $579 avg balance can't
--     absorb a $500/day pull even if revenue "allows" it).
--   affordability_factor_rate / term_daily_biz_days / term_weekly_weeks — the
--     assumed MCA structure used to convert a sustainable payment into an advance
--     size: advance = payment × term ÷ factor. Defaults: 1.35 factor, 120 business
--     days on a daily remit, 26 weeks on a weekly remit.

alter table public.underwriting_settings
  add column if not exists max_payment_pct_of_revenue numeric not null default 10,
  add column if not exists balance_buffer_pct numeric not null default 50,
  add column if not exists affordability_factor_rate numeric not null default 1.35,
  add column if not exists term_daily_biz_days int not null default 120,
  add column if not exists term_weekly_weeks int not null default 26;
