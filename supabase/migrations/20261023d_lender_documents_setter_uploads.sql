-- ─────────────────────────────────────────────────────────────────────────────
-- Setter-filed submission guidelines.
--
-- The setter asks each funder to email their written submission guidelines and
-- files them against that funder. That is NOT a new document system:
-- `lender_documents` and the private `lender-documents` bucket already exist
-- and already hold 71 files. This migration only opens the narrowest possible
-- door in them.
--
-- Today `lender_documents` INSERT is `is_admin_or_super` and the bucket policy
-- is `is_ops_staff`, so a setter (profiles.role = 'closer') can upload nothing
-- at all. Below, a closer may insert a row ONLY when document_type is
-- 'submission_requirements' — they cannot file an ISO agreement, a rate sheet
-- or a commission schedule.
-- ─────────────────────────────────────────────────────────────────────────────

alter type public.lender_document_type add value if not exists 'submission_requirements';

-- The comparison is on document_type::text, not on the enum literal. That is
-- deliberate: a freshly added enum value cannot be evaluated in the same
-- transaction that added it, and the cast sidesteps it entirely so this file
-- replays in one transaction on a clean database.
drop policy if exists closer_insert_submission_requirements on public.lender_documents;
create policy closer_insert_submission_requirements on public.lender_documents
  for insert to authenticated
  with check (
    is_closer((select auth.uid()))
    and document_type::text = 'submission_requirements'
  );

-- Matching storage policy. All 71 existing objects in this bucket are
-- `lender/<lender_id>/<file>` (verified: 71 of 71) — this bucket has ONE path
-- convention and the policy pins it, both so a setter cannot scatter files
-- elsewhere in the bucket and so the convention stays single.
--
-- INSERT only, and no SELECT: a closer has no read policy on this bucket and
-- must not get one here, because the same bucket holds our executed ISO
-- agreements. The consequence is real and intended — a setter can file a
-- guidelines document but cannot download one back.
drop policy if exists closer_insert_lender_documents_storage on storage.objects;
create policy closer_insert_lender_documents_storage on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'lender-documents'
    and (storage.foldername(name))[1] = 'lender'
    and is_closer((select auth.uid()))
  );
