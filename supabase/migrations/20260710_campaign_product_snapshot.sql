-- Campaign onboarding, reimagined around Synergy Direct's real product catalog.
--
-- The "New campaign" wizard now picks a Synergy product (aged / UCC / trigger /
-- web / aged live transfers / real-time / live transfers / telemarketing), and
-- the tier + unit price + planned budget come straight from the catalog. We
-- persist WHAT was bought so a campaign can always be traced back to the exact
-- product + tier + quantity the owner selected.
--
-- Additive only.
--   campaigns.product_id        the catalog product key (e.g. 'live_transfers')
--   campaigns.pricing_snapshot  the full computed selection at create time

begin;

alter table public.campaigns
  add column if not exists product_id text,
  add column if not exists pricing_snapshot jsonb;

comment on column public.campaigns.product_id is 'Synergy catalog product key the campaign was created from (e.g. live_transfers, aged_leads).';
comment on column public.campaigns.pricing_snapshot is 'Snapshot of the catalog selection at create time: {product_id, product_name, pricing_model, unit_price, quantity, tier_label, age_band, hours_per_week, weeks, budget, bonus_pct, bonus_leads, math}.';

commit;
