-- Structured underwriting "box" criteria on lender_programs so the Funder
-- Availability widget can judge FIT (not just document readiness). Every column
-- is nullable and null means "unknown / no data" — the widget must render null as
-- unchecked, never as an automatic pass or fail. Backfilled ONLY from facts
-- already quoted in each funder's own important_details / industries_note; where
-- our records don't state a value it stays null.

alter table public.lender_programs
  add column if not exists max_position            integer,      -- highest position they'll fund BEHIND (Velocity=3 → they can be the 3rd)
  add column if not exists max_open_positions      integer,      -- max # of currently-open positions the merchant may carry (UCS=2)
  add column if not exists max_negative_days_month integer,      -- max negative days allowed in any single month
  add column if not exists max_nsfs_month          integer,      -- max NSFs allowed in any single month
  add column if not exists min_monthly_deposit_count integer,    -- min # of deposits per month
  add column if not exists excluded_states         text[],       -- 2-letter states auto-declined (e.g. {CA,NY})
  add column if not exists excluded_industries      text[],       -- restricted/prohibited industries (free-text tokens)
  add column if not exists min_daily_balance        numeric;     -- min average daily balance required (FundKite $800)

comment on column public.lender_programs.max_position is 'Highest lien position the funder will fund behind (they become position N). null = unknown.';
comment on column public.lender_programs.max_open_positions is 'Max number of currently-open MCA positions the merchant may already carry. null = unknown.';
comment on column public.lender_programs.max_negative_days_month is 'Max negative days allowed in any single month. null = unknown.';
comment on column public.lender_programs.max_nsfs_month is 'Max NSFs allowed in any single month. null = unknown.';
comment on column public.lender_programs.min_monthly_deposit_count is 'Min deposits per month. null = unknown.';
comment on column public.lender_programs.excluded_states is 'States the funder auto-declines. null = unknown / none recorded.';
comment on column public.lender_programs.excluded_industries is 'Restricted / prohibited industries. null = unknown / none recorded.';
comment on column public.lender_programs.min_daily_balance is 'Min average daily balance required. null = unknown.';

-- ---- Backfill (facts sourced from each funder's recorded important_details / industries_note) ----
-- Helper pattern: update the mca program row of one named funder.

update public.lender_programs lp set max_position = 10, excluded_states = '{PR}',
  excluded_industries = '{Financial Services,Non-Profits}'
  from public.lenders l where lp.lender_id = l.id and lp.product_type='mca' and l.company_name = 'Cashable';

update public.lender_programs lp set max_nsfs_month = 5, min_monthly_deposit_count = 5, excluded_states = '{TX}',
  excluded_industries = '{Real Estate,Check Cashing,Jewelry,Bail Bonds,Lawyers}'
  from public.lenders l where lp.lender_id = l.id and lp.product_type='mca' and l.company_name = 'Cobalt Funding Solutions';

update public.lender_programs lp set max_position = 4
  from public.lenders l where lp.lender_id = l.id and lp.product_type='mca' and l.company_name = 'Corfin Group';

update public.lender_programs lp set max_negative_days_month = 4, max_nsfs_month = 4, min_monthly_deposit_count = 5
  from public.lenders l where lp.lender_id = l.id and lp.product_type='mca' and l.company_name = 'Funderial ISO Program';

update public.lender_programs lp set max_negative_days_month = 5, max_nsfs_month = 5, max_open_positions = 2,
  min_daily_balance = 800, excluded_states = '{CA,NY}',
  excluded_industries = '{Non-Profit,Sole Prop,Bail Bonds,Factoring,Payment Processing,Credit Repair,Collections,Securities Brokers}'
  from public.lenders l where lp.lender_id = l.id and lp.product_type='mca' and l.company_name = 'FundKite';

update public.lender_programs lp set max_nsfs_month = 5,
  excluded_industries = '{Credit Repair,Check Cashing,ACH Processors,Bail Bonds,Auctions,Notary,Casinos,Non-Profits,Ticket Brokers,Adult Entertainment}'
  from public.lenders l where lp.lender_id = l.id and lp.product_type='mca' and l.company_name = 'Green Note Capital';

update public.lender_programs lp set min_monthly_deposit_count = 5, max_negative_days_month = 5,
  excluded_industries = '{Trucking,Logistics,Auto Sales,Nonprofit,Debt Consolidation,Credit Repair,Law Firms}'
  from public.lenders l where lp.lender_id = l.id and lp.product_type='mca' and l.company_name = 'Instafunders';

update public.lender_programs lp set max_position = 7
  from public.lenders l where lp.lender_id = l.id and lp.product_type='mca' and l.company_name = 'Instagreen Capital';

update public.lender_programs lp set max_position = 7, min_monthly_deposit_count = 4, max_negative_days_month = 5,
  excluded_industries = '{Auto Sales,Real Estate,Attorneys,Financial Services,Trucking,Gas Stations}'
  from public.lenders l where lp.lender_id = l.id and lp.product_type='mca' and l.company_name = 'Nationwide Capital Solutions';

update public.lender_programs lp set max_position = 5, excluded_states = '{TX,ND}'
  from public.lenders l where lp.lender_id = l.id and lp.product_type='mca' and l.company_name = 'True Advance Funding';

update public.lender_programs lp set max_open_positions = 2
  from public.lenders l where lp.lender_id = l.id and lp.product_type='mca' and l.company_name = 'United Capital Source';

update public.lender_programs lp set max_position = 3, min_monthly_deposit_count = 5,
  excluded_industries = '{Law Firms,Lending,Medical Marijuana,Auto Dealerships,Religious,Real Estate,Trucking,Gas Stations,Vape Shops}'
  from public.lenders l where lp.lender_id = l.id and lp.product_type='mca' and l.company_name = 'Velocity Capital Group';
