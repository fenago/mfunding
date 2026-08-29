-- sms-media — a PUBLIC storage bucket for outbound SMS/MMS picture messages.
--
-- WHY A DEDICATED, PUBLIC BUCKET.
-- JMP/Cheogram turns an outbound text into an MMS by FETCHING an HTTPS URL we
-- hand it in an XEP-0066 (jabber:x:oob) element. The gateway is an unauthenticated
-- third party, so the URL must be reachable with no bearer token — i.e. a Supabase
-- PUBLIC bucket object at
--   https://<ref>.supabase.co/storage/v1/object/public/sms-media/<path>
-- The alternative (a long-lived signed URL out of a private bucket) leaks a
-- capability token into an SMS log and expires; a public object on an isolated
-- bucket is simpler and safer to reason about.
--
-- ISOLATION ON PURPOSE. Merchant picture messages do NOT go in customer-documents
-- (private, RLS'd, and burdened by the two-path convention noted in the
-- storage-path-two-conventions memory). This bucket holds ONLY SMS media so a
-- public-read blast radius can never touch bank statements or IDs.
--
-- WRITE PATH. The Text Messages page uploads with the STAFF member's own JWT, so
-- INSERT is gated to staff roles (closer/employee/admin/super_admin) — the same
-- set that may read sms_messages. Anon cannot write. READ is public by virtue of
-- the bucket being public (that is the whole point — the gateway must fetch it),
-- so no SELECT policy is required for downloads.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sms-media',
  'sms-media',
  true,
  -- Carriers cap MMS payloads hard (~600KB-1MB after transcoding); 5MB is a
  -- generous client-side ceiling that still leaves the gateway room to downscale.
  5242880,
  array['image/jpeg','image/png','image/gif','image/webp','image/heic','image/heif']
)
on conflict (id) do update set
  public            = excluded.public,
  file_size_limit   = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Staff (the same roles that read sms_messages) may upload picture messages.
drop policy if exists sms_media_staff_insert on storage.objects;
create policy sms_media_staff_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'sms-media'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('closer','employee','admin','super_admin')
    )
  );

-- Reads are served over the bucket's PUBLIC path and do not require a policy.
-- A staff SELECT policy is added anyway so the app can list/manage objects via
-- the authenticated storage API without depending on the public route.
drop policy if exists sms_media_staff_select on storage.objects;
create policy sms_media_staff_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'sms-media'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('closer','employee','admin','super_admin')
    )
  );
