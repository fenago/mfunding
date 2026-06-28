-- lead_tools: registry of public calculators/assessments for the admin "Lead Tools"
-- management page (enable/disable, links, lead counts). Public reads (so the Free
-- Tools hub + pages can respect 'enabled'); admins manage. Applied live via MCP 2026-06-28.

create table if not exists public.lead_tools (
  key text primary key,
  name text not null,
  category text not null check (category in ('calculator','assessment')),
  path text not null,
  intake text not null default 'mca',
  description text,
  enabled boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz default now()
);

alter table public.lead_tools enable row level security;

drop policy if exists "Anyone can read lead tools" on public.lead_tools;
create policy "Anyone can read lead tools" on public.lead_tools for select to public using (true);

drop policy if exists "Admins manage lead tools" on public.lead_tools;
create policy "Admins manage lead tools" on public.lead_tools for all to authenticated
  using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','super_admin')))
  with check (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','super_admin')));

insert into public.lead_tools (key,name,category,path,intake,description,sort_order) values
  ('vcf-savings','VCF Savings Calculator','calculator','/calculators/mca-debt-relief','vcf','Estimate MCA payment reduction',10),
  ('mca-funding','MCA Funding Calculator','calculator','/calculators/how-much-can-i-get','mca','How much working capital you can get',20),
  ('mca-cost','MCA Cost Calculator','calculator','/calculators/advance-cost','mca','Total payback + daily/weekly payment',30),
  ('closer-earnings','Closer Earnings Calculator','calculator','/careers/closer-earnings','contact','Recruiting: closer income estimate',40),
  ('funding-readiness','Funding Readiness Score','assessment','/assessments/funding-readiness-score','mca','0-100 readiness score',50),
  ('funding-matcher','Find Your Funding','assessment','/assessments/find-your-funding','mca','Recommended product matcher',60),
  ('funding-affordability','How Much Can You Handle','assessment','/assessments/how-much-can-you-handle','mca','Safe advance affordability',70),
  ('mca-debt-stress','MCA Debt Stress Test','assessment','/assessments/mca-debt-stress-test','vcf','Danger level + savings + freedom date',80),
  ('relief-qualifier','Do You Qualify for Relief','assessment','/assessments/do-you-qualify-for-relief','vcf','Relief eligibility',90),
  ('business-health','Business Health Scorecard','assessment','/assessments/business-health-scorecard','conditional','A-F financial report card',100),
  ('cashflow-gap','Cash Flow Gap Analyzer','assessment','/assessments/cash-flow-gap-analyzer','mca','Working-capital gap + buffer',110)
on conflict (key) do nothing;
