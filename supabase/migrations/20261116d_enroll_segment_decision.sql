-- 20261116d_enroll_segment_decision — instantly-enroll now enrolls the PILOT only
-- from the micro-bitty segment (campaign_segment_members, phase-1 contract), so the
-- ledger needs a decision for "not a segment member".
alter table public.instantly_enroll_log drop constraint if exists instantly_enroll_log_decision_check;
alter table public.instantly_enroll_log add constraint instantly_enroll_log_decision_check check (decision in (
  'pending_verification', 'enrolled', 'already_enrolled', 'refused_no_campaign', 'refused_no_email',
  'refused_not_in_segment', 'refused_invalid', 'refused_bounced', 'refused_unverifiable',
  'refused_suppressed', 'error'));
