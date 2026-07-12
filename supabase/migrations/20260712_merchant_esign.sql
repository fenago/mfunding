-- ============================================================================
-- Wave 3 — 4.2 / 4.3: native merchant e-signature (freeze-and-ledger).
-- Applied live via MCP 2026-07-12.
--
-- This MIRRORS the closer e-sign design (20260711_closer_docs_merge_esign.sql):
-- a server-side merge freezes template text + its SHA-256 onto a document row,
-- and an append-only ledger records the signature against that exact frozen text.
-- A signature against a mutable template is worthless; the ledger points at the
-- bytes the signer actually saw.
--
-- WHAT'S DIFFERENT from the closer flow, and why:
--   • Signing happens in the EDGE FUNCTION sign-merchant-document, not a pure SQL
--     RPC. Reason: on signature we must (a) drop a storage artifact of the signed
--     document and (b) insert a customer_documents row with document_type =
--     'application' so submit-to-funders' hard gate passes (4.3, close-the-loop).
--     Neither is doable from SQL. The integrity-critical writes (append the
--     signature, flip status, insert the app-side copy) are still ATOMIC — they
--     run inside sign_merchant_document(), a SECURITY DEFINER RPC callable ONLY by
--     the service role, so REST clients can never forge a signature.
--   • Disclosure injection (4.4) happens in the merge (send-merchant-document),
--     by product_type + merchant state, from compliance_disclosures.
--
-- ⚠ Template body text is DRAFT pending compliance + attorney review. This
--   migration seeds ONE minimal MCA application/authorization template so the flow
--   is testable end-to-end; w2-compliance owns the final merchant-facing language.
--   MCA = purchase of future receivables, never a "loan".
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Template store. Staff-managed (is_ops_staff = admin/super_admin/employee).
--    Merchants have NO access to templates.
-- ---------------------------------------------------------------------------
create table if not exists public.merchant_doc_templates (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  name         text not null,
  product_type text not null default 'mca',   -- 'mca' | 'vcf' | 'all'
  body_md      text not null,
  active       boolean not null default true,
  sort_order   int not null default 0,
  version      int not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.merchant_doc_templates is
  'Merchant-facing e-signable document templates (application/authorizations). Merged server-side per deal before sending. Body is DRAFT pending compliance/attorney review. MCA is a purchase of future receivables, not a loan.';

alter table public.merchant_doc_templates enable row level security;

drop policy if exists merchant_doc_templates_staff_manage on public.merchant_doc_templates;
create policy merchant_doc_templates_staff_manage on public.merchant_doc_templates
  for all to authenticated
  using ( is_ops_staff((select auth.uid())) )
  with check ( is_ops_staff((select auth.uid())) );

-- ---------------------------------------------------------------------------
-- 2. Frozen, per-deal merged documents.
--    Staff: full manage. Merchant: SELECT their own (customer_id -> user_id).
-- ---------------------------------------------------------------------------
create table if not exists public.merchant_documents (
  id             uuid primary key default gen_random_uuid(),
  deal_id        uuid not null references public.deals(id) on delete cascade,
  customer_id    uuid not null references public.customers(id) on delete cascade,
  template_id    uuid references public.merchant_doc_templates(id) on delete set null,
  template_slug  text,
  name           text not null,
  merged_content text not null,
  content_sha256 text not null,
  status         text not null default 'draft'
                   check (status in ('draft', 'sent', 'signed', 'void')),
  disclosure_state text,          -- merchant state whose disclosure was injected, if any
  created_by     uuid references public.profiles(id) on delete set null,
  sent_at        timestamptz,
  signed_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists merchant_documents_deal_idx     on public.merchant_documents (deal_id);
create index if not exists merchant_documents_customer_idx on public.merchant_documents (customer_id);
create index if not exists merchant_documents_status_idx   on public.merchant_documents (status);

comment on table public.merchant_documents is
  'Per-deal merged merchant document + frozen SHA-256. merged_content is what the merchant signs; content_sha256 is what the signature ledger references.';

alter table public.merchant_documents enable row level security;

drop policy if exists merchant_documents_staff_manage on public.merchant_documents;
create policy merchant_documents_staff_manage on public.merchant_documents
  for all to authenticated
  using ( is_ops_staff((select auth.uid())) )
  with check ( is_ops_staff((select auth.uid())) );

-- A closer who owns the deal may also read + create their merchant's documents.
drop policy if exists merchant_documents_closer_manage on public.merchant_documents;
create policy merchant_documents_closer_manage on public.merchant_documents
  for all to authenticated
  using ( closer_owns_customer((select auth.uid()), customer_id) )
  with check ( closer_owns_customer((select auth.uid()), customer_id) );

-- Merchant: read ONLY their own documents. No write — status only ever flips to
-- 'signed' through the edge function + sign_merchant_document() RPC.
drop policy if exists merchant_documents_self_read on public.merchant_documents;
create policy merchant_documents_self_read on public.merchant_documents
  for select to authenticated
  using (
    customer_id in (select c.id from public.customers c where c.user_id = (select auth.uid()))
  );

create or replace function public.touch_merchant_documents_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists merchant_documents_touch_updated_at on public.merchant_documents;
create trigger merchant_documents_touch_updated_at
  before update on public.merchant_documents
  for each row execute function public.touch_merchant_documents_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Append-only signature ledger. NO update/delete policy for any role, by
--    design — an e-signature record that staff can edit is not evidence. NO
--    insert policy either: rows are written ONLY by sign_merchant_document()
--    (SECURITY DEFINER, service-role), so identity + frozen content are always
--    the server's view, never the browser's.
-- ---------------------------------------------------------------------------
create table if not exists public.merchant_document_signatures (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null references public.merchant_documents(id) on delete restrict,
  signer_user_id   uuid not null references public.profiles(id) on delete restrict,
  -- The full legal name the signer TYPED. The act of typing it is the signature.
  typed_legal_name text not null,
  consent          boolean not null,
  consent_text     text not null,
  content_snapshot text not null,
  content_sha256   text not null,
  ip_address       text,
  user_agent       text,
  signed_at        timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

create index if not exists merchant_doc_sig_document_idx on public.merchant_document_signatures (document_id);

comment on table public.merchant_document_signatures is
  'Append-only merchant e-signature ledger. No UPDATE/DELETE/INSERT policy for any role; written only through sign_merchant_document().';

alter table public.merchant_document_signatures enable row level security;

-- Staff read every signature (evidence).
drop policy if exists merchant_doc_sig_staff_read on public.merchant_document_signatures;
create policy merchant_doc_sig_staff_read on public.merchant_document_signatures
  for select to authenticated
  using ( is_ops_staff((select auth.uid())) );

-- Closer who owns the deal reads its signatures.
drop policy if exists merchant_doc_sig_closer_read on public.merchant_document_signatures;
create policy merchant_doc_sig_closer_read on public.merchant_document_signatures
  for select to authenticated
  using (
    document_id in (
      select md.id from public.merchant_documents md
      where closer_owns_customer((select auth.uid()), md.customer_id)
    )
  );

-- Merchant reads ONLY their own signatures.
drop policy if exists merchant_doc_sig_self_read on public.merchant_document_signatures;
create policy merchant_doc_sig_self_read on public.merchant_document_signatures
  for select to authenticated
  using (
    document_id in (
      select md.id from public.merchant_documents md
      join public.customers c on c.id = md.customer_id
      where c.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 4. The signing entry point (service-role only; the edge function calls it).
--    Atomic: appends the signature, flips the document to 'signed', and inserts
--    the app-side customer_documents 'application' copy that submit-to-funders'
--    gate checks (4.3). The edge function has already: verified the caller owns
--    the customer, uploaded the frozen text to storage (p_storage_path), and
--    captured ip/ua from the request headers.
--
--    Re-validates in SQL (defense in depth): ownership, status 'sent', consent,
--    typed name, and that the frozen hash matches the frozen content.
-- ---------------------------------------------------------------------------
create or replace function public.sign_merchant_document(
  p_document_id     uuid,
  p_signer_user_id  uuid,
  p_typed_legal_name text,
  p_consent         boolean,
  p_consent_text    text,
  p_ip              text,
  p_user_agent      text,
  p_storage_path    text,
  p_filename        text,
  p_file_size       int,
  p_mime_type       text
)
returns public.merchant_document_signatures
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_doc     public.merchant_documents%rowtype;
  v_owns    boolean;
  v_calc    text;
  v_sig     public.merchant_document_signatures;
begin
  if coalesce(btrim(p_typed_legal_name), '') = '' then
    raise exception 'Type your full legal name to sign';
  end if;
  if p_consent is not true then
    raise exception 'You must agree to the consent statement to sign';
  end if;

  select * into v_doc from public.merchant_documents where id = p_document_id;
  if not found then
    raise exception 'Document not found';
  end if;

  select exists (
    select 1 from public.customers c
    where c.id = v_doc.customer_id and c.user_id = p_signer_user_id
  ) into v_owns;
  if not v_owns then
    raise exception 'This document does not belong to you';
  end if;

  if v_doc.status = 'signed' then
    raise exception 'This document has already been signed';
  end if;
  if v_doc.status <> 'sent' then
    raise exception 'This document is not ready to sign';
  end if;

  -- The frozen hash must match the frozen content, byte for byte. digest() lives
  -- in the extensions schema and must be qualified (search_path is 'public').
  v_calc := encode(extensions.digest(v_doc.merged_content, 'sha256'), 'hex');
  if v_calc <> v_doc.content_sha256 then
    raise exception 'Document integrity check failed';
  end if;

  insert into public.merchant_document_signatures (
    document_id, signer_user_id, typed_legal_name, consent, consent_text,
    content_snapshot, content_sha256, ip_address, user_agent
  ) values (
    p_document_id, p_signer_user_id, btrim(p_typed_legal_name), p_consent, p_consent_text,
    v_doc.merged_content, v_doc.content_sha256,
    nullif(btrim(coalesce(p_ip, '')), ''), p_user_agent
  )
  returning * into v_sig;

  update public.merchant_documents
  set status = 'signed', signed_at = v_sig.signed_at
  where id = p_document_id;

  -- 4.3 close-the-loop: the app-side signed-application copy that
  -- submit-to-funders' hard gate checks for (document_type = 'application').
  insert into public.customer_documents (
    document_type, filename, storage_path, file_size, mime_type,
    uploaded_by, customer_id, description, external_ref
  ) values (
    'application', coalesce(p_filename, 'signed-application.md'), p_storage_path,
    p_file_size, coalesce(p_mime_type, 'text/markdown'),
    p_signer_user_id, v_doc.customer_id,
    'Merchant e-signed ' || v_doc.name, 'merchant_document:' || p_document_id::text
  );

  return v_sig;
end;
$fn$;

revoke all on function public.sign_merchant_document(uuid, uuid, text, boolean, text, text, text, text, text, int, text) from public, anon, authenticated;
grant execute on function public.sign_merchant_document(uuid, uuid, text, boolean, text, text, text, text, text, int, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Seed ONE minimal MCA application/authorization template (DRAFT).
--    [STATE_DISCLOSURE] is where send-merchant-document injects the matched
--    compliance_disclosures body at generation time.
-- ---------------------------------------------------------------------------
insert into public.merchant_doc_templates (slug, name, product_type, sort_order, body_md)
values (
  'mca-application-authorization',
  'Application & Authorization',
  'mca',
  1,
  $md$# Application & Authorization
### [COMPANY]

**Applicant / Business:** [BUSINESS NAME]
**Authorized signer:** [MERCHANT NAME]
**Date:** [DATE]

This document confirms your application for working capital through a purchase of your business's future receivables (a merchant cash advance). A merchant cash advance is **not a loan**; it is the purchase of a portion of your future sales.

## 1. Accuracy of Information
I certify that the information I have provided in connection with this application — including business details and bank information — is true and complete to the best of my knowledge.

## 2. Authorization to Obtain Information
I authorize [COMPANY] and the funding partners it works with to obtain and review the information reasonably necessary to evaluate this application, including business bank account activity I have provided or connected. I understand that reviewing my options does not affect my personal credit; only a formal submission to a funding partner may do so.

## 3. Broker Role & No Upfront Fees
I understand [COMPANY] is a broker that is compensated by the funding partner, not by me, and that [COMPANY] does not act as my advisor or fiduciary. **No upfront fee** is charged to me for this application.

## 4. Electronic Communications & Signature
I agree to receive documents and communications electronically, and I intend my typed name below to be my legal electronic signature on this authorization.

## 5. State Disclosure
[STATE_DISCLOSURE]

---

By typing my full legal name and confirming below, I, [MERCHANT NAME], acknowledge that I have read and agree to this Application & Authorization on behalf of [BUSINESS NAME].

*DRAFT — pending compliance and attorney review. Not final legal text.*
$md$
)
on conflict (slug) do nothing;
