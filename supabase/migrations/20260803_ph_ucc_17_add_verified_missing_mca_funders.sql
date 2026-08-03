-- ph_ucc_17: Add 7 verified-missing MCA/RBF funders to the alias dictionary.
--
-- Discovered by auditing the RAW secured-party frequency distributions of the
-- CA (bizfile master unload), FL (floridaucc full file), and CT/CO/OR (Socrata)
-- UCC datasets against the active alias dictionary. Each name was confirmed a
-- genuine merchant-cash-advance / revenue-based-financing funder (evidence:
-- company websites, deBanked coverage, SEC filings, MCA-defense listings), and
-- each alias_norm (generated = ph_ucc_norm(alias)) was precision-tested against
-- the full 5-state secured-party universe to confirm it matches ONLY the intended
-- funder and no depository/other-lender names. The depository guard
-- (ph_ucc_is_depository) in ph_ucc_rebuild_leads / ph_ucc_match_secured_parties
-- still applies at match time.
--
-- Combined raw-universe filings these recover (before freshness/dedup):
--   Nu-Ko Capital  ~1323 (FL 977, CO 201, CA 101, CT 43)  -- MCA, Katy TX
--   McKenzie Cap    ~812 (FL 807)                          -- MCA, mckcap.com
--   SellersFunding  ~657 (FL 623)                          -- e-comm RBF (SellersFi)
--   Parkview Adv    ~327 (FL 204, CA 114)                  -- MCA, NY MCA suits
--   QFS Capital     ~308 (FL 217, CA 70, CT 21)            -- MCA, qfscapital.com
--   Barclays Adv    ~170 (CA 65, FL 62, CT 43)             -- MCA, Boca Raton
--   Agile Lending    ~43 (CT 24, FL 11, CA 8)              -- MCA (Agile Capital Funding)
--
-- NOT added (real MCA funders, but their distinctive word collapses to a generic
-- token under ph_ucc_norm which strips FUNDING/CAPITAL/GROUP, causing over-match):
--   Alternative Funding Group -> norm "ALTERNATIVE" (hits mortgage trusts, energy funds)
--   Agile Capital Funding     -> norm "AGILE"       (hits Agile Occupational Medicine, etc.)
--   Specialty Capital         -> norm "SPECIALTY"   (hits ASD Specialty Healthcare, insurers)
-- These need an exact-name match path or a norm tweak; flagged for owner review.

insert into public.ph_ucc_funder_aliases (alias, canonical_name, source, active) values
  ('Parkview Advance',    'Parkview Advance',  'curated', true),
  ('QFS Capital',         'QFS Capital',       'curated', true),
  ('McKenzie Capital',    'McKenzie Capital',  'curated', true),
  ('Nu-Ko Capital',       'Nu-Ko Capital',     'curated', true),
  ('Nuko Capital',        'Nu-Ko Capital',     'curated', true),
  ('SellersFunding Corp', 'SellersFunding',    'curated', true),
  ('Barclays Advance',    'Barclays Advance',  'curated', true),
  ('Agile Lending',       'Agile Lending',     'curated', true)
on conflict (alias) do update set
  canonical_name = excluded.canonical_name,
  source = excluded.source,
  active = true;
