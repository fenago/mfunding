-- Owner-supplied free-text context for the AI underwriter.
--
-- Things the bank statements can't tell — seasonality, a baseline the analyzed
-- months undershoot, expected upcoming volume, one-off events. Injected into the
-- underwrite-deal JUDGE prompt as a clearly-labeled OWNER CONTEXT block: weighed in
-- the verdict/paths and referenced in the reasoning, but it NEVER overrides the
-- statement-derived affordability math (a claim above what the statements show
-- produces a "verify with additional docs" path, not a fabricated approval).
alter table deals add column if not exists underwriting_context text;

comment on column deals.underwriting_context is
  'Broker-supplied free-text context for the AI underwriter (underwrite-deal). Weighed in the read but never overrides statement-derived math.';
