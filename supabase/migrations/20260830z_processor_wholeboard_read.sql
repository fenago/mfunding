-- PROCESSOR whole-board READ so the Operations console loads ANY deal (2026-08-30)
--
-- A processor's core job is to open any interested lead and drive it to a complete
-- application + bank statements. But a processor is role=closer and money-walled
-- (20260827_setter_deal_money_wall) — a direct read of a deal they don't own returns
-- nothing, so getDealById falls back to get_deal_lite (money-masked) and the console
-- can't show the full application or bank statements for a non-own deal.
--
-- Owner ruling: processors see EVERYTHING (full application + bank statements + amount)
-- on ANY deal. These are ADDITIVE SELECT policies gated on is_processor(auth.uid())
-- ONLY. RLS policies are OR'd, so this grants processors whole-board reads WITHOUT
-- loosening anything for a regular (non-processor) closer — is_processor() returns
-- false for them, so their own-book policies remain the only thing that matches.
-- NO write/insert/update policy is added; admins/super_admin already have whole-board.
-- Scoped to the is_processor capability (currently only Kristine Gidoc).

-- deals — full row (incl. amount / economics) for any deal.
create policy "processor_select_all_deals"
  on public.deals
  for select
  to authenticated
  using ( public.is_processor((select auth.uid())) );

-- mca_applications — the full application for any deal (console app panel).
create policy "processor_select_all_apps"
  on public.mca_applications
  for select
  to authenticated
  using ( public.is_processor((select auth.uid())) );

-- customer_documents — doc metadata (esp. bank statements) for any customer.
create policy "processor_select_all_docs"
  on public.customer_documents
  for select
  to authenticated
  using ( public.is_processor((select auth.uid())) );

-- storage: the customer-documents bucket signs URLs via storage RLS
-- (documentService.getDocumentUrl → createSignedUrl). Bucket-scoped, so both
-- storage path conventions (customer/<uuid>/.. and <uuid>/..) are covered.
create policy "processor_select_customer_documents"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'customer-documents'
    and public.is_processor((select auth.uid()))
  );
