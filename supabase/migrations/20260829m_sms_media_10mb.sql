-- sms-media — raise the outbound picture-message ceiling 5MB → 10MB.
--
-- Owner ask: setters were bumping the old 5MB client cap on photos taken by
-- modern phones (HEIC/large JPEG). The gateway (Cheogram) still transcodes MMS
-- payloads down hard, so this is purely a generous client-side upper bound, not a
-- target — it just stops a legitimate phone photo from being rejected before it
-- can be downscaled. The image mime allow-list is UNCHANGED.
--
-- The client-side ceiling in src/lib/sms.ts (SMS_MEDIA_MAX_BYTES) is bumped to
-- match in the same change; this migration is the authoritative bucket-side gate.

update storage.buckets
set file_size_limit = 10485760            -- 10 * 1024 * 1024
where id = 'sms-media';
