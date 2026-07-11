-- Identifier-based campaign attribution.
-- A campaign can own a dedicated TRACKING EMAIL (real-time transfers emailed in)
-- and/or a dedicated TRACKING PHONE (live transfers called in). live-transfer-intake
-- attributes an inbound lead to the campaign whose tracking identifier matches the
-- delivery address/number, falling back to channel-based lookup only when no match.
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS tracking_email text,
  ADD COLUMN IF NOT EXISTS tracking_phone text;

COMMENT ON COLUMN public.campaigns.tracking_email IS
  'Dedicated inbound email/alias for this campaign. live-transfer-intake attributes a lead to this campaign when the inbound email delivery (To) address matches, regardless of channel.';
COMMENT ON COLUMN public.campaigns.tracking_phone IS
  'Dedicated GHL tracking phone number for this campaign (live transfers). Future hook: attribute a call to this campaign when the webhook carries the tracking number that received it.';
