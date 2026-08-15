-- The vendor's label and OUR RULING are two different facts, so they get two
-- different columns. Collapsing them would make the relabel invisible, and the
-- whole point is that nobody should ever wonder whether we quietly changed
-- someone's revenue basis.
alter table public.lead_records
  add column if not exists revenue_basis_vendor text;

comment on column public.lead_records.revenue_basis_vendor is
  'The basis the VENDOR''S COLUMN NAME claimed: "monthly" for the trigger file''s '
  '"Monthly Revenue", "annual" for the UCC file''s "REVENUE". Never overwritten.';

comment on column public.lead_records.revenue_band_basis is
  'The basis WE COMPUTE ON. Differs from revenue_basis_vendor for the trigger '
  'file: it is named "Monthly Revenue" but ruled ANNUAL on 2026-08-15 on '
  'distribution congruence — read as monthly, 76%% of that file lands at '
  '$250K+/month ($3M+/yr), which is not the shape of a purchased SMB list; read '
  'as annual it matches the UCC file''s distribution almost exactly, and the '
  'range STRINGS are identical to that file''s annual vocabulary. Owner informed '
  'with the numbers and can overrule — that is one UPDATE, not an argument.';

-- record what the vendor said, once
update public.lead_records
   set revenue_basis_vendor = revenue_band_basis
 where revenue_band_basis is not null and revenue_basis_vendor is null;

-- then apply the ruling
update public.lead_records
   set revenue_band_basis = 'annual'
 where revenue_basis_vendor = 'monthly';
