-- A processor could READ a document on a deal outside their book but not
-- ATTACH one — half a capability.
--
-- 20260830z gave processors a bucket-scoped SELECT on customer-documents so
-- the drawer could sign URLs for any deal in the queue. The INSERT side was
-- never added, so an upload fell through to `closer_insert_customer_documents`
-- and was walled to the processor's own book. Catherine and Kristine hit this
-- the first time either of them messages a funder on a deal they don't own:
-- FunderResponsesBoard's ad-hoc attachment dropzone and FunderPicker's
-- signed-application slot both write here.
--
-- This MIRRORS the read policy exactly — same bucket scope, same
-- is_processor() gate, authenticated only. It does not widen anything beyond
-- processors and it does not touch the closer or merchant policies, which
-- stay scoped to their own customers.
--
-- Bucket-scoped on purpose: customer-documents carries BOTH storage path
-- conventions (customer/<uuid>/.. and <uuid>/..), so a path-derived check
-- would silently miss half the objects.

create policy "processor_insert_customer_documents"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'customer-documents'
    and public.is_processor((select auth.uid()))
  );
