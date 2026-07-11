-- The closers column DEFAULTS disagreed with the signed comp plan.
--
--   company_lead_split  30  OK (Momentum Standard)
--   self_gen_split      70  WRONG -- Schedule A says 65
--   renewal_split       35  WRONG -- Schedule A says 30
--
-- Every EXISTING closer row is already 30/65/30 (correct), so this had not bitten
-- yet -- but any NEW closer created without explicit splits would silently receive
-- richer terms than the contract they signed (70% self-gen, 35% renewal).
-- Align the defaults with the offer sheet / Schedule A / COMMISSION_DEFAULTS.
-- Applied live via MCP 2026-07-11.

alter table public.closers alter column self_gen_split set default 65;
alter table public.closers alter column renewal_split  set default 30;

comment on column public.closers.company_lead_split is 'Closer share on company-provided leads. Momentum Standard = 30%.';
comment on column public.closers.self_gen_split      is 'Closer share on self-generated leads. Standard = 65%.';
comment on column public.closers.renewal_split       is 'Closer share on renewals of their SELF-GENERATED funded book. Standard = 30%. Company-lead deals are not closer-renewal-eligible.';
