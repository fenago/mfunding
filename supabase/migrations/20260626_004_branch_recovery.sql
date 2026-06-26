-- Branch/recovery model: a reason code on every lost deal, and a hard
-- do-not-contact suppression flag on the contact (TCPA / opt-out).

ALTER TABLE deals ADD COLUMN IF NOT EXISTS lost_reason TEXT;
ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_lost_reason_check;
ALTER TABLE deals ADD CONSTRAINT deals_lost_reason_check CHECK (lost_reason IS NULL OR lost_reason IN (
  'no_contact','disqualified','docs_not_provided','bank_data_fail','funders_declined_all',
  'merchant_declined','offer_expired','funding_fell_through','routed_to_vcf','duplicate',
  'opted_out','prohibited_industry','other'
));

-- Hard suppression: when true, exclude from ALL sequences/blasts. Set on STOP/opt-out.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS do_not_contact BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS do_not_contact_reason TEXT;
