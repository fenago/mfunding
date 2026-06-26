-- Expand the MCA pipeline: dedicated "Bank Statements" stage (separate from Docs
-- Collected) and an "Offer Accepted" stage (merchant accepts before funding).
ALTER TABLE deals ADD COLUMN IF NOT EXISTS bank_statements_at TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS offer_accepted_at TIMESTAMPTZ;

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_status_check;
ALTER TABLE deals ADD CONSTRAINT deals_status_check CHECK (status = ANY (ARRAY[
  'new','contacted','qualifying','application_sent','docs_collected','bank_statements',
  'submitted_to_funder','offer_received','offer_presented','offer_accepted','funded',
  'renewal_eligible','declined','dead'
]));
