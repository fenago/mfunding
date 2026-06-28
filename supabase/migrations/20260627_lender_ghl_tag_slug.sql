-- Per-funder GHL tag slug: app tags GHL contact `submit:<slug>` on submission,
-- firing that funder's GHL email workflow.
ALTER TABLE lenders ADD COLUMN IF NOT EXISTS ghl_tag_slug TEXT;
UPDATE lenders SET ghl_tag_slug = CASE
  WHEN company_name ILIKE '%corfin%'         THEN 'corfin'
  WHEN company_name ILIKE '%gokapital%'      THEN 'gokapital'
  WHEN company_name ILIKE '%reliant%'        THEN 'reliant'
  WHEN company_name ILIKE '%united capital%' THEN 'ucs'
  WHEN company_name ILIKE '%funderial%'      THEN 'funderial'
  WHEN company_name ILIKE '%guidant%'        THEN 'guidant'
  WHEN company_name ILIKE '%value capital%'  THEN 'vcf'
  ELSE ghl_tag_slug
END
WHERE status = 'live_vendor';
