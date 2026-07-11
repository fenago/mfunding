-- 0.5 — Sanitized merchant deal reads.
--
-- deals RLS is row-level only: a merchant CAN read their own deal rows via the
-- API, but that exposes internal columns (notes, ai_lender_recommendations,
-- closer/commission fields). RLS cannot hide columns, so the portal reads deals
-- ONLY through this SECURITY DEFINER RPC, which projects a merchant-safe column
-- set. Rows are scoped to deals whose customer belongs to the caller.
--
-- NOTE: stips_promised_by is a `date` in the deals schema (not timestamptz) and
-- is returned as such — the UI contract was adjusted to match reality.

create or replace function public.get_my_portal_deals()
returns table (
  id uuid,
  deal_number text,
  deal_type text,
  status text,
  amount_requested numeric,
  amount_funded numeric,
  created_at timestamptz,
  contacted_at timestamptz,
  qualified_at timestamptz,
  application_sent_at timestamptz,
  docs_collected_at timestamptz,
  bank_statements_at timestamptz,
  submitted_at timestamptz,
  offer_received_at timestamptz,
  offer_presented_at timestamptz,
  offer_accepted_at timestamptz,
  funded_at timestamptz,
  declined_at timestamptz,
  nurture_at timestamptz,
  stips_promised_by date,
  paydown_percentage numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.id, d.deal_number, d.deal_type, d.status,
    d.amount_requested, d.amount_funded, d.created_at,
    d.contacted_at, d.qualified_at, d.application_sent_at, d.docs_collected_at,
    d.bank_statements_at, d.submitted_at, d.offer_received_at, d.offer_presented_at,
    d.offer_accepted_at, d.funded_at, d.declined_at, d.nurture_at,
    d.stips_promised_by, d.paydown_percentage
  from public.deals d
  where d.customer_id in (
    select c.id from public.customers c where c.user_id = auth.uid()
  )
  order by d.created_at desc;
$$;

grant execute on function public.get_my_portal_deals() to authenticated;
