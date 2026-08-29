-- sms-docs — a PUBLIC storage bucket for outbound merchant-shared DOCUMENTS.
--
-- WHY A SECOND PUBLIC BUCKET, SEPARATE FROM sms-media.
-- MMS can't reliably carry a PDF/Word/Excel doc — carriers transcode media and
-- routinely drop or mangle non-image attachments. So "attach a document" on the
-- SMS composers is NOT the MMS/media_url path. Instead we upload the file here and
-- insert a shareable HTTPS link into the message BODY, which sends as ordinary
-- text through sms-send (no media_url, no jabber:x:oob). A merchant with no login
-- taps the link and their browser opens the file directly.
--
-- PUBLIC-READ IS THE POINT. The recipient is an unauthenticated merchant, so the
-- object must be reachable with no bearer token — a Supabase PUBLIC bucket object
-- at https://<ref>.supabase.co/storage/v1/object/public/sms-docs/<path>.
--
-- UNGUESSABLE KEYS ARE THE SECURITY MODEL. Because the link is unauthenticated,
-- the object key is the only thing gating access. The client (smsDocsObjectPath in
-- src/lib/sms.ts) mints a long random (2×UUID, 64 hex) key per file, so a link is
-- effectively a bearer capability that can't be enumerated. Nothing here that
-- would be harmful if leaked should ever be sent this way; this bucket holds ONLY
-- documents a staff member deliberately chose to text to a merchant.
--
-- ISOLATION ON PURPOSE. This is NOT customer-documents (private, RLS'd, bank
-- statements + IDs) and NOT sms-media (images only). A dedicated bucket keeps the
-- public-read blast radius off every sensitive object. Staff copy a file INTO here
-- to share it; the source of record stays wherever it lived.
--
-- WRITE PATH. Uploaded with the STAFF member's own JWT, so INSERT is gated to the
-- same staff roles that may send on the line (closer/employee/admin/super_admin).
-- Anon cannot write. READ is served over the bucket's public route and needs no
-- SELECT policy; a staff SELECT policy is added anyway so the app can list/manage
-- objects through the authenticated storage API.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sms-docs',
  'sms-docs',
  true,
  -- Reasonable cap for a texted document. Bigger than the 10MB image cap because
  -- multi-page PDFs run large, but still small enough that a link stays snappy.
  15728640,   -- 15 * 1024 * 1024
  array[
    -- Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain',
    -- Images too (trivial, and staff sometimes want a doc-as-image link that
    -- isn't going out as an MMS)
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Staff (the same roles that may send on the SMS line) may upload documents.
drop policy if exists sms_docs_staff_insert on storage.objects;
create policy sms_docs_staff_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'sms-docs'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('closer','employee','admin','super_admin')
    )
  );

-- Reads are served over the bucket's PUBLIC path and do not require a policy.
-- A staff SELECT policy is added anyway so the app can list/manage objects via
-- the authenticated storage API without depending on the public route.
drop policy if exists sms_docs_staff_select on storage.objects;
create policy sms_docs_staff_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'sms-docs'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('closer','employee','admin','super_admin')
    )
  );
