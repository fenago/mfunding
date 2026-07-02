-- Per-funder submission "recipes" (1:1 with lenders) executed by the
-- submit-to-funders engine v2. A recipe IS that funder's submission workflow.
-- Applied to project ehibjeonqpqskhcvizow via the Supabase MCP tool.
create table if not exists public.funder_submission_profiles (
  id uuid primary key default gen_random_uuid(),
  lender_id uuid not null references public.lenders(id) on delete cascade unique,
  method text not null default 'email' check (method in ('email','portal','email_and_portal')),

  -- EMAIL recipe
  to_email text,                 -- overrides lenders.submission_email when set
  cc_emails text[],
  subject_template text,
  body_template text,
  -- Ordered doc slugs = customer_document_type enum values
  -- (bank_statement, application, id, voided_check, credit_authorization,
  --  business_license, personal_guarantee, tax_return, other).
  attach_docs text[] not null default '{}',
  attachment_mode text not null default 'links'
    check (attachment_mode in ('links','attachments','both')),
  max_statement_months int default 4,

  -- PORTAL recipe
  portal_url text,               -- overrides lenders.submission_portal_url
  portal_steps text[],
  portal_credentials_hint text,

  -- GUARDS
  required_stips text[] not null default '{}',
  special_instructions text,
  active boolean not null default true,
  updated_at timestamptz default now()
);

comment on table public.funder_submission_profiles is
  'Per-funder submission recipe (email/portal format) executed by the submit-to-funders edge function. Doc slugs use customer_document_type enum values.';

-- deal_submissions audit/lifecycle additions
alter table public.deal_submissions add column if not exists submission_method text;      -- email | portal | email_and_portal
alter table public.deal_submissions add column if not exists sent_payload jsonb;          -- exact subject/body/docs sent (audit)
alter table public.deal_submissions add column if not exists portal_confirmed_at timestamptz;
alter table public.deal_submissions add column if not exists error text;

-- RLS mirrors the lenders table: admins/super manage, closers read.
alter table public.funder_submission_profiles enable row level security;

drop policy if exists admin_manage_funder_profiles on public.funder_submission_profiles;
create policy admin_manage_funder_profiles on public.funder_submission_profiles
  for all to authenticated
  using (public.is_admin_or_super(auth.uid()))
  with check (public.is_admin_or_super(auth.uid()));

drop policy if exists closer_read_funder_profiles on public.funder_submission_profiles;
create policy closer_read_funder_profiles on public.funder_submission_profiles
  for select to authenticated
  using (public.is_closer((select auth.uid())));

-- Seed a default 'email' recipe for every lender with a submission_email,
-- so day one behaves like today (generic format) until recipes are tuned.
insert into public.funder_submission_profiles
  (lender_id, method, to_email, subject_template, body_template, attach_docs)
select
  l.id,
  'email',
  l.submission_email,
  'New MCA Submission — {{business_name}} — {{amount_requested}} — ISO: Momentum Funding',
  'New submission from Momentum Funding (ISO) for your review.

Business: {{business_name}}
Owner: {{owner_name}}
Industry: {{industry}}
State: {{state}}
EIN: {{ein}}
Time in business: {{time_in_business}}
Monthly revenue: {{monthly_revenue}}
Amount requested: {{amount_requested}}
Use of funds: {{use_of_funds}}
Owner phone: {{owner_phone}}
Owner email: {{owner_email}}
Deal #: {{deal_number}}

Documents:
{{doc_links}}

This is a purchase of future receivables (MCA) — not a loan. Bank statements and full stips are ready; reply with any questions.
— {{closer_name}}, Momentum Funding Submissions',
  array['application','bank_statement']::text[]
from public.lenders l
where l.submission_email is not null and l.submission_email <> ''
on conflict (lender_id) do nothing;
