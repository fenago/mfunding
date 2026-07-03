-- Structured reply intelligence for funder responses.
--
-- poll-funder-replies (and the ghl-webhook path) stamp deal_submissions.response_at
-- when a funder replies. These columns hold the AI classification of that reply so
-- the closer sees at a glance what the funder wants — a stip request, a decline
-- (with a reason category), an offer, a question — without opening GHL. Written
-- best-effort: classification NEVER blocks the stamp/alert, so any of these may be
-- NULL even when response_at is set.
ALTER TABLE deal_submissions
  ADD COLUMN IF NOT EXISTS response_type    TEXT,
  ADD COLUMN IF NOT EXISTS response_summary TEXT,
  ADD COLUMN IF NOT EXISTS response_data    JSONB,
  ADD COLUMN IF NOT EXISTS classified_at    TIMESTAMPTZ;

COMMENT ON COLUMN deal_submissions.response_type IS
  'AI classification of the funder reply: stip_request | decline | offer | question | acknowledgment | other. NULL until classified.';
COMMENT ON COLUMN deal_submissions.response_summary IS
  'One-sentence AI summary of the funder reply (for the Funder Responses board).';
COMMENT ON COLUMN deal_submissions.response_data IS
  'Full classification payload: { raw: <reply text>, from: <reply from-address>, parsed: { type, decline_reason_category, requested_items[], offer_terms, summary } }.';
COMMENT ON COLUMN deal_submissions.classified_at IS
  'When the reply was classified by the AI (NULL = never classified / classification failed).';
