-- Courtesy thank-you note to a funder who declined a file. Stamped when the
-- note goes out so the "Send thank-you" button on the Funder Responses board is
-- idempotent — one courtesy note per submission, disabled after it's sent.
ALTER TABLE deal_submissions
  ADD COLUMN IF NOT EXISTS courtesy_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN deal_submissions.courtesy_sent_at IS
  'When a courtesy thank-you note was emailed to a funder that declined this file (via submit-to-funders action=courtesy_decline). NULL = not sent.';
