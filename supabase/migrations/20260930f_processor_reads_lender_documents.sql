-- A processor can read a funder's contacts, their submission recipe and their
-- programs — but not their rate sheet. Three quarters of a capability.
--
-- lender_documents being admin-only is an inconsistency in the policy set
-- rather than a deliberate boundary: every neighbouring table a processor
-- needs for the same job already admits her (funder_submission_profiles via
-- 20260921a, lender_programs via 20260921a, lenders via closer_read_lenders).
-- The rate sheet is exactly what she reaches for mid-chase when a funder asks
-- why we sent them a file.
--
-- Mirrors processor_select_customer_documents in shape: SELECT only,
-- authenticated only, gated purely on is_processor(). Admin and super-admin
-- policies are untouched, and no other role gains anything.
--
-- NOTE FOR THE UI: this does NOT retire the docs.readable flag. Every other
-- role that cannot read this table still gets zero rows with NO error, and
-- "you may not see these" must never degrade into "nothing on file". Grant the
-- policy AND keep honouring the flag — both, not either.

create policy "processor_select_lender_documents"
  on public.lender_documents
  for select
  to authenticated
  using ( public.is_processor((select auth.uid())) );

-- The table grant alone is a tease. FunderLinksBlock lists a funder's rate
-- sheets from lender_documents, then signs a URL against the lender-documents
-- BUCKET when someone clicks open — and that bucket's only policy is
-- ops_all_lender_documents, gated on is_ops_staff (admin / super_admin /
-- employee). A processor is role=closer, so without this she would see 49
-- documents for the funders she is chasing and every single click would fail.
--
-- That is worse than the state before the grant: previously she saw nothing
-- and knew it; this would show her files that error on open.
--
-- SELECT only, authenticated only, bucket-scoped, gated purely on
-- is_processor() — the same shape as processor_select_customer_documents.
-- ops_all_lender_documents is untouched, and no role gains write access.

create policy "processor_select_lender_documents_storage"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'lender-documents'
    and public.is_processor((select auth.uid()))
  );
