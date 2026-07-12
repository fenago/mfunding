-- Wave 4 — Signing feedback loop: record-once idempotence for GHL Documents &
-- Contracts completions, discovered lazily by the ghl-docs-status poller.
--
-- The merchant opens a GHL-hosted signing link in a new tab and signs there.
-- GHL never calls us back. The portal DOES poll ghl-docs-status on load + focus
-- (exactly when the merchant returns), so that poller now notices a freshly
-- completed doc and — ONCE per document — fires the merchant portal message,
-- the closer timeline note, and (for the signed application) the funder-submit
-- checklist tick. This table is the "already handled it" ledger that keeps those
-- side effects firing exactly once even under overlapping focus/visibility polls.

create table if not exists public.ghl_doc_completions (
  document_id      text primary key,               -- GHL Documents & Contracts doc id
  customer_id      uuid references public.customers(id) on delete cascade,
  doc_name         text,
  completed_seen_at timestamptz not null default now()
);

comment on table public.ghl_doc_completions is
  'Record-once ledger of GHL e-sign document completions the ghl-docs-status poller has already reacted to (portal message + timeline note + checklist tick). PK = GHL document id.';

create index if not exists ghl_doc_completions_customer_idx
  on public.ghl_doc_completions (customer_id);

-- RLS on, no policies: only the service-role edge function (which bypasses RLS)
-- ever reads/writes this. No merchant or staff surface needs it.
alter table public.ghl_doc_completions enable row level security;

-- Atomic checklist tick used by the poller when a signed doc is the application
-- (mirrors the deal_doc_requests approve-trigger, so funder availability sees the
-- signed app exactly as a hand-ticked box would). Service-role only.
create or replace function public.ghl_mark_checklist_key(p_deal_id uuid, p_key text)
returns void language sql security definer set search_path = public as $$
  update public.deals
     set doc_checklist = coalesce(doc_checklist, '{}'::jsonb) || jsonb_build_object(p_key, true)
   where id = p_deal_id;
$$;

revoke all on function public.ghl_mark_checklist_key(uuid, text) from public, anon, authenticated;
grant execute on function public.ghl_mark_checklist_key(uuid, text) to service_role;
