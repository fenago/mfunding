-- PH UCC: load the deBanked MCA UCC funder→shell-company alias list into the
-- matcher dictionary so merchants stacked with a funder hiding behind a shell name
-- (e.g. Credibly filing as "Death Valley LLC") are no longer missed.
--
-- SOURCE: https://debanked.com/merchant-cash-advance-resource/merchant-cash-advance-ucc/
--   (the canonical public "UCC Filing Alias List", scraped 2026-08-02). Every row
--   is a deBanked-attributed {shell/alias -> real funder} pair. source='debanked'.
--
-- PRECISION: the matcher (ph_ucc_rebuild_leads) does a TOKEN-BOUNDARY match of
-- ph_ucc_norm(alias) inside ph_ucc_norm(secured_party_raw); a false MCA-position
-- tag feeds a dialer, so we DELIBERATELY EXCLUDED from deBanked's list:
--   * the Corporation Service Company / CT Corporation / CHTD / Financial Agent
--     Services block — these are UCC filing AGENTS for thousands of non-MCA
--     creditors, not funders;
--   * single generic-word shells that would over-match ("Prosperity",
--     "Merchant" (Greenbox), "Options"/"Capital Options", "Capital Stack",
--     "The Advance Funding Company"->ADVANCE, "Business Credit & Capital",
--     "American Capital Advance" (ambiguous — its own funder AND a Boca alias));
--   * short/ambiguous acronyms (GCP, FLC, VWM Group, ASF Capital, BC Funding, H
--     Capital, Knight (famous non-MCA), Strategic Funding Partners).
-- canonical_name is linked to a lenders row (lender_id) when the real funder is
-- in our network; otherwise the funder name is stored as-is.

-- 1) allow the new provenance value
alter table public.ph_ucc_funder_aliases
  drop constraint if exists ph_ucc_funder_aliases_source_check;
alter table public.ph_ucc_funder_aliases
  add constraint ph_ucc_funder_aliases_source_check
  check (source in ('lenders','curated','debanked'));

-- 2) load the aliases (idempotent on unique(alias); lender_id linked by company_name)
insert into public.ph_ucc_funder_aliases (alias, canonical_name, lender_id, source, active)
select v.alias, v.canonical,
       (select l.id from public.lenders l where l.company_name = nullif(v.lender_name,'')),
       'debanked', true
from (values
  ('EZ Business Cash Advance','Yellowstone Capital',''),
  ('Yellowstone Capital','Yellowstone Capital',''),
  ('Global Merchant Cash','Wall Funding',''),
  ('Colonial Funding Network','Kapitus','Kapitus Partners'),
  ('Quik Capital','Sterling Funding',''),
  ('Tango Capital','Snap Advances',''),
  ('Zulu Capital','Snap Advances',''),
  ('Universal Funds','Romi Merchant Services',''),
  ('Universal Merchant Solutions','Romi Merchant Services',''),
  ('Death Valley LLC','Credibly','Credibly Partners'),
  ('Red River Ridge LLC','Credibly','Credibly Partners'),
  ('SBFN','Rapid Finance','Rapid Finance'),
  ('SBFS LLC','Rapid Finance','Rapid Finance'),
  ('Mopsley Solutions','Rapid Finance','Rapid Finance'),
  ('First Funds','Principis Capital',''),
  ('Premium Merchant Funding','Premium Merchant Funding One',''),
  ('Pearl Capital Rivis Venturs, LLC','Pearl Capital','Pearl Capital'),
  ('Pearl Cash','Pearl Capital','Pearl Capital'),
  ('Horizon Business Funding','Pearl Capital','Pearl Capital'),
  ('Complete Business Solutions Group','Par Funding',''),
  ('Genesis Capital Enterprises','Nextwave Enterprises',''),
  ('Genesis Capital Partners','Nextwave Enterprises',''),
  ('Rockwall Capital','Mother Funding',''),
  ('MCA Fixed Payment LLC','Merchants Capital Access',''),
  ('Lendingclub Corporation','Lending Club',''),
  ('Last Chance Funding','The LCF Group','The LCF Group'),
  ('Merchant Rewards Network','IRN Payment Systems',''),
  ('IOU Central Inc.','IOU Financial','IOU Financial'),
  ('Infinity Capital Advisors','Infinity Capital Funding',''),
  ('Green Growth Partners','Green Growth Funding',''),
  ('Greystone Business Resources','GBR Funding',''),
  ('FC Marketplace','Funding Circle','Funding Circle'),
  ('Fundation Group LLC','Fundation',''),
  ('Empire Merchant Advance','Fora Financial','Fora Financial'),
  ('Fora Financial Advance, LLC','Fora Financial','Fora Financial'),
  ('Fora Financial Business Loans, LLC','Fora Financial','Fora Financial'),
  ('Fora Financial West, LLC','Fora Financial','Fora Financial'),
  ('First Data Merchant Cash Advance','First Data',''),
  ('Nexus Payment Systems','Direct Merchant Funding',''),
  ('Duvera Billing Services','DF Merchant Advance',''),
  ('WindShadow','Capital For Merchants',''),
  ('Garden Ventures','Capital For Merchants',''),
  ('250 Ventures','Capital For Merchants',''),
  ('International Channel Systems','Capital For Merchants',''),
  ('The Benjamins','Capital For Merchants',''),
  ('AdvanceMe','CAN Capital','CAN Capital'),
  ('Minglewood Services','CAN Capital','CAN Capital'),
  ('Sound Garden','CAN Capital','CAN Capital'),
  ('Rhino Services','CAN Capital','CAN Capital'),
  ('Birdsong Services','CAN Capital','CAN Capital'),
  ('Aureolin Services','CAN Capital','CAN Capital'),
  ('APZB Industries','CAN Capital','CAN Capital'),
  ('VCE Enterprises','CAN Capital','CAN Capital'),
  ('Byzfunder NY LLC','Byzfunder','Byzfunder'),
  ('Faton Inc','Business Financial Services',''),
  ('BFS West Inc.','Business Financial Services',''),
  ('BOLSTR, INC','Bolstr',''),
  ('Receivables Advance','Balboa Capital','Balboa Capital'),
  ('Merchants Advance','Capify',''),
  ('Apex Advance, LLC','Capify',''),
  ('Nectar Advances','American Merchant Receivables',''),
  ('Kabbage','Kabbage','')
) as v(alias, canonical, lender_name)
on conflict (alias) do nothing;

-- After this migration, re-run public.ph_ucc_rebuild_leads() to fold the newly-
-- recognized shell positions into ph_ucc_leads (done at load time 2026-08-02).
