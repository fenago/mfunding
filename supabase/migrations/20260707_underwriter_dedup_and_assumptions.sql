-- AI INTERNAL UNDERWRITER — robustness follow-up (dedup + questionable income).
--
-- Two additive columns, both safe on re-run:
--
--   underwriting_settings.owner_payroll_treatment — how to handle recurring
--     third-party PAYROLL deposits paid to the OWNER's own name (a judgment call
--     between "business commission income" and "personal W-2 pay"). Values:
--       'count'              — treat it as true business revenue, no flag.
--       'flag_and_discount'  — DEFAULT. Count it in true revenue BUT flag it and
--                              compute the conservative downside (revenue if the
--                              owner-payroll were excluded).
--       'exclude'            — remove it from true revenue entirely.
--
--   deal_underwriting.assumptions — the judgment calls the underwriter made from
--     the docs alone (so underwriting is complete before funder submission, no
--     merchant round-trip). Array of
--       { item, assumed, basis, impact_if_wrong }.

alter table public.underwriting_settings
  add column if not exists owner_payroll_treatment text not null default 'flag_and_discount';

alter table public.deal_underwriting
  add column if not exists assumptions jsonb not null default '[]'::jsonb;
