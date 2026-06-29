-- Standardize the company-lead closer split to 35% (down from the old defaults).
-- The rate is still set PER CLOSER in Admin → Closers (closers.company_lead_split);
-- this only changes the default for newly created closers and standardizes the
-- existing (seed) closers. Applied live via MCP 2026-06-29.
alter table public.closers alter column company_lead_split set default 35;

-- Bring existing closers to the new 35% company-lead standard (seed records were
-- at 50%). Self-gen / renewal splits are left untouched.
update public.closers set company_lead_split = 35 where company_lead_split in (40, 50);
