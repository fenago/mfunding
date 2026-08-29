-- sms-docs — flip from PUBLIC to PRIVATE; links become 7-day SIGNED URLs.
--
-- WHY. The original design (20260829n_sms_docs_bucket.sql) served texted documents
-- over the bucket's PUBLIC route, so a shared link worked FOREVER. For compliance,
-- a link a merchant received shouldn't be a permanent capability — if it leaks or
-- is forwarded, it should stop working. So the bucket goes PRIVATE and the client
-- now mints a SIGNED URL with a 7-day expiry (createSignedUrl in src/lib/sms.ts).
-- The merchant opens the link within 7 days; after that it 400s (intended). Signed
-- URLs bypass RLS, so a merchant with no login still opens it during the window.
--
-- SAFE TO FLIP. The document-link feature shipped the same day as the bucket, so
-- there are no permanent public links in the wild to migrate — nothing breaks.
--
-- POLICIES ARE UNCHANGED. Staff still need SELECT: minting a signed URL from the
-- browser client goes through the authenticated storage API, which requires the
-- caller to be able to SELECT the object. INSERT stays gated to sending staff.
-- The 15MB size limit and the allowed_mime_types list are left exactly as-is.

update storage.buckets
  set public = false
  where id = 'sms-docs';

-- Staff INSERT + staff SELECT policies from 20260829n are intentionally preserved.
-- SELECT is now load-bearing (not just for management): it authorizes the client
-- to createSignedUrl. Re-assert both here so this migration is self-contained and
-- the policy set survives even if the earlier migration is ever squashed.

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

-- Now REQUIRED so staff can mint 7-day signed URLs from the browser.
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
