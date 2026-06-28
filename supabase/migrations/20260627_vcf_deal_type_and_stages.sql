-- VCF (debt relief / consolidation) as a real product line on the deals table.
ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_deal_type_check;
ALTER TABLE deals ADD CONSTRAINT deals_deal_type_check CHECK (deal_type = ANY (ARRAY[
  'mca','term_loan','line_of_credit','sba','equipment_financing','vcf'
]));

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_status_check;
ALTER TABLE deals ADD CONSTRAINT deals_status_check CHECK (status = ANY (ARRAY[
  'new','contacted','qualifying','application_sent','docs_collected','bank_statements',
  'submitted_to_funder','offer_received','offer_presented','offer_accepted','funded',
  'renewal_eligible',
  'new_distressed','hardship_consult','positions_analysis','strategy_proposal',
  'agreement_sent','submitted_to_vcf','restructure_executed','servicing',
  'nurture','declined','dead'
]));

ALTER TABLE deals ADD COLUMN IF NOT EXISTS vcf_active_positions INTEGER;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS vcf_total_balance NUMERIC;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS vcf_daily_debit NUMERIC;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS vcf_current_funders TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS vcf_hardship_reason TEXT;
