-- Merchant reply detection for active deals.
--
-- Mirrors the funder-reply path (deal_submissions.response_at) but on the MERCHANT
-- side: the poll-funder-replies function, after its funder phase, scans active
-- deals whose customer has a GHL contact and looks for inbound email newer than
-- what we've already seen. When found it stamps merchant_reply_at = the message's
-- own timestamp (never moved backward) so a fresh reply always re-alerts, and
-- stores a one-line AI summary. Written best-effort: the summary NEVER blocks the
-- stamp/alert, so merchant_reply_summary may be NULL even when merchant_reply_at is set.
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS merchant_reply_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS merchant_reply_summary TEXT;

COMMENT ON COLUMN deals.merchant_reply_at IS
  'Timestamp of the newest inbound merchant email the poller has seen (from the GHL email record, not now()). Only ever moves forward. NULL until the merchant first replies.';
COMMENT ON COLUMN deals.merchant_reply_summary IS
  'One-sentence AI summary of the most recent merchant reply (incl. whether they attached/promised documents). Best-effort — may be NULL even when merchant_reply_at is set.';
