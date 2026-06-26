-- Stage 13: Nurture / Re-engage — the recoverable-loss pool, kept Open and worked
-- by reactivation. Truly-dead deals stay 'declined'/'dead' and sync as GHL Lost status.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS nurture_at TIMESTAMPTZ;

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_status_check;
ALTER TABLE deals ADD CONSTRAINT deals_status_check CHECK (status = ANY (ARRAY[
  'new','contacted','qualifying','application_sent','docs_collected','bank_statements',
  'submitted_to_funder','offer_received','offer_presented','offer_accepted','funded',
  'renewal_eligible','nurture','declined','dead'
]));
