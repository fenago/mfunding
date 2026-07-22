-- Track which product(s) each merchant is shopping for on the DEAL (deal-scoped
-- truth). Multi-select: a merchant can want several. Every current deal is MCA,
-- so the default is '{mca}'; ADD COLUMN backfills all existing rows to it.
ALTER TABLE public.deals
  ADD COLUMN products_interested text[] NOT NULL DEFAULT '{mca}';

-- Validated set (values match the app's ProductInterest union exactly). At least
-- one product must always be selected, and only known values are allowed.
-- cardinality() (not array_length, which returns NULL for '{}' and would let an
-- empty array slip past, since a NULL CHECK is treated as satisfied).
ALTER TABLE public.deals
  ADD CONSTRAINT deals_products_interested_valid CHECK (
    cardinality(products_interested) >= 1
    AND products_interested <@ ARRAY[
      'mca','term_loan','sba_loan','line_of_credit',
      'equipment_financing','cre','debt_relief'
    ]::text[]
  );

-- Backfill: debt-relief (VCF) deals default to '{debt_relief}'. No VCF rows exist
-- today (all 102 deals are MCA), so this is a correctness no-op now but keeps the
-- rule true for any VCF rows already present.
UPDATE public.deals
  SET products_interested = '{debt_relief}'
  WHERE deal_type = 'vcf';

COMMENT ON COLUMN public.deals.products_interested IS
  'Products the merchant is shopping for (multi-select). Deal-scoped truth. Values: mca, term_loan, sba_loan, line_of_credit, equipment_financing, cre, debt_relief. Synced to product-* tags on the GHL contact.';
