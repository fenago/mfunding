-- Dignified-exit fields for deals.
-- When a deal is closed to a terminal state (nurture / declined / dead) from the
-- Revenue Playbook's "Close deal…" control, capture WHY it closed so the reason
-- shows up in reporting and the nurture/re-engage sequences have context.
-- Idempotent — safe to re-run.

ALTER TABLE deals ADD COLUMN IF NOT EXISTS closed_reason text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS closed_note text;

COMMENT ON COLUMN deals.closed_reason IS
  'Why the deal was closed to a terminal state (unresponsive, rate_too_high, went_with_competitor, not_qualified, too_many_positions, docs_never_arrived, funders_declined, other).';
COMMENT ON COLUMN deals.closed_note IS 'Optional free-text note captured when the deal was closed.';
