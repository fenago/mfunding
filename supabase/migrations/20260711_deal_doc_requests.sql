-- Wave 2 — 2.1: deal_doc_requests (the explicit stips model).
--
-- One authoritative, merchant-facing list of "documents we still need from you"
-- per deal. Admin/closers create the requests; the merchant fulfils each one by
-- uploading a file (which creates a customer_documents row) and calling the
-- mark_doc_request_uploaded() RPC. Ops then reviews (approve/reject).
--
-- Source-of-truth note: deals.doc_checklist (Record<slug,boolean>, keyed by the
-- customer_document_type slug) stays THE source of truth for funder availability
-- (DocumentChecklist.tsx + recommend-lenders read it). This table does NOT replace
-- it — instead, APPROVING a doc request reflects that doc_type into doc_checklist
-- (trigger below), so the two never drift and the closer's "docs on file" view keeps
-- driving funder availability exactly as before.

create table if not exists public.deal_doc_requests (
  id              uuid primary key default gen_random_uuid(),
  deal_id         uuid not null references public.deals(id) on delete cascade,
  -- Denormalized so merchant RLS is a single join-free ownership check.
  customer_id     uuid not null references public.customers(id) on delete cascade,
  -- Same vocabulary as customer_documents.document_type (the enum enforces it):
  -- bank_statement | application | tax_return | id | business_license |
  -- voided_check | credit_authorization | personal_guarantee | other.
  doc_type        public.customer_document_type not null,
  label           text not null,                      -- merchant-facing, e.g. "4 most recent bank statements"
  status          text not null default 'requested'
                    check (status in ('requested','uploaded','under_review','approved','rejected')),
  rejection_reason text,
  due_at          timestamptz,
  requested_by    uuid references public.profiles(id),
  -- Set when the merchant uploads the fulfilling file.
  document_id     uuid references public.customer_documents(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists deal_doc_requests_deal_id_idx     on public.deal_doc_requests (deal_id);
create index if not exists deal_doc_requests_customer_id_idx on public.deal_doc_requests (customer_id);
create index if not exists deal_doc_requests_status_idx      on public.deal_doc_requests (status);

-- Standard updated_at trigger (repo helper public.update_updated_at_column()).
drop trigger if exists set_deal_doc_requests_updated_at on public.deal_doc_requests;
create trigger set_deal_doc_requests_updated_at
  before update on public.deal_doc_requests
  for each row execute function public.update_updated_at_column();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.deal_doc_requests enable row level security;

-- Ops staff (admin/super_admin/employee) — full control.
drop policy if exists deal_doc_requests_staff_all on public.deal_doc_requests;
create policy deal_doc_requests_staff_all on public.deal_doc_requests
  for all to authenticated
  using (public.is_ops_staff(auth.uid()))
  with check (public.is_ops_staff(auth.uid()));

-- Closers — full control over requests on customers they own.
drop policy if exists deal_doc_requests_closer_all on public.deal_doc_requests;
create policy deal_doc_requests_closer_all on public.deal_doc_requests
  for all to authenticated
  using (public.closer_owns_customer(auth.uid(), customer_id))
  with check (public.closer_owns_customer(auth.uid(), customer_id));

-- Merchant — SELECT own rows only. NO insert/update/delete: the ONLY merchant
-- write is the 'requested'/'rejected' -> 'uploaded' transition, done through the
-- SECURITY DEFINER RPC mark_doc_request_uploaded() below.
drop policy if exists deal_doc_requests_merchant_select on public.deal_doc_requests;
create policy deal_doc_requests_merchant_select on public.deal_doc_requests
  for select to authenticated
  using (customer_id in (select id from public.customers where user_id = auth.uid()));

-- ── Merchant upload transition (the only merchant write path) ─────────────────
-- Validates ownership + the allowed transition, then flips the request to
-- 'uploaded' and links the fulfilling document. Cross-system side effects
-- (activity_log, ops notification, AI underwriter) are handled by the
-- merchant-doc-uploaded edge function, which the portal invokes after upload.
create or replace function public.mark_doc_request_uploaded(
  p_request_id  uuid,
  p_document_id uuid
) returns public.deal_doc_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.deal_doc_requests;
  v_owns boolean;
  v_doc_ok boolean;
begin
  select * into v_req from public.deal_doc_requests where id = p_request_id;
  if not found then
    raise exception 'doc request not found';
  end if;

  -- Caller must own the customer this request belongs to.
  select exists (
    select 1 from public.customers c
    where c.id = v_req.customer_id and c.user_id = auth.uid()
  ) into v_owns;
  if not v_owns then
    raise exception 'not authorized for this document request';
  end if;

  -- The linked document must belong to the same customer (no cross-customer link).
  select exists (
    select 1 from public.customer_documents d
    where d.id = p_document_id and d.customer_id = v_req.customer_id
  ) into v_doc_ok;
  if not v_doc_ok then
    raise exception 'document does not belong to this customer';
  end if;

  -- Only an outstanding/rejected request can be (re)fulfilled by the merchant.
  if v_req.status not in ('requested','rejected') then
    raise exception 'doc request is not awaiting an upload (status=%)', v_req.status;
  end if;

  update public.deal_doc_requests
     set status = 'uploaded',
         document_id = p_document_id,
         rejection_reason = null
   where id = p_request_id
   returning * into v_req;

  return v_req;
end;
$$;

revoke all on function public.mark_doc_request_uploaded(uuid, uuid) from public, anon;
grant execute on function public.mark_doc_request_uploaded(uuid, uuid) to authenticated;

-- ── Approve -> reflect into deals.doc_checklist (keep ONE source of truth) ─────
-- When a request is APPROVED, tick the matching doc_checklist slug on the deal so
-- funder availability (the closer's "docs on file" model) sees the doc — exactly
-- what admin code writes today when a closer ticks the box by hand.
create or replace function public.deal_doc_request_sync_checklist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and coalesce(old.status,'') <> 'approved' then
    update public.deals
       set doc_checklist = coalesce(doc_checklist, '{}'::jsonb)
                           || jsonb_build_object(new.doc_type::text, true)
     where id = new.deal_id;
  end if;
  return new;
end;
$$;

drop trigger if exists deal_doc_requests_sync_checklist on public.deal_doc_requests;
create trigger deal_doc_requests_sync_checklist
  after update on public.deal_doc_requests
  for each row execute function public.deal_doc_request_sync_checklist();
