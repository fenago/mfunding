-- Additional merchant email addresses, so an outbound email can reach more than
-- one contact at the business (owner + bookkeeper, two partners, etc.).
-- customers.email stays the PRIMARY address; these are CC'd alongside it. The
-- column lives on the existing customers table, so it inherits the table's RLS.
alter table public.customers
  add column if not exists additional_emails text[] not null default '{}';
