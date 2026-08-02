-- PH UCC skip-trace: add the two post-trace terminal statuses.
--   email_only = skip-trace found emails but NO dialable (non-DNC) phone → cold-email channel only.
--   no_match   = skip-trace returned no usable phone AND no email (or no person match at all).
-- Kept as their own migration because a new enum label must be committed before any
-- statement (or the edge fn) can reference it.
alter type public.ph_ucc_lead_status add value if not exists 'email_only';
alter type public.ph_ucc_lead_status add value if not exists 'no_match';
