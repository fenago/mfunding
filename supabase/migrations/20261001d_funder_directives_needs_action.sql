-- needs_action — the difference between "a funder stated an address" and
-- "a funder stated an address we are not using".
--
-- WHY THIS EXISTS. Widening the detector's recall (it was missing instructions
-- that carried no "effective immediately"-style temporal cue — see
-- GENERIC_PLURAL_OBJECT in _shared/funderDirective.ts) took detections on the
-- 160 captured replies from 4 to 23. Measured against the live recipes, those
-- 23 are 12 funders, and:
--
--     9 of the 12 already match what we send   ← nothing for a human to do
--     3 diverge                                ← the entire point of the queue
--
-- Surfacing all 12 would have built a queue that is three-quarters noise, and a
-- queue that is mostly noise is one nobody reads — which is the exact failure
-- this whole feature was built to end, rebuilt one layer out. The row is still
-- WRITTEN in every case, because it is evidence and because the recipe can
-- change later; what this view decides is whether it is asking for anything.
--
-- The rule is computed, never stored, for that reason: an instruction that was
-- satisfied when it arrived becomes actionable again the moment someone edits
-- the recipe away from it. A boolean column would have been right once.
--
-- `current_destination` resolves the SAME way submit-to-funders does —
-- funder_submission_profiles.to_email first, then lenders.submission_email.
-- Reading it any other way would let this view call a directive satisfied by an
-- address the engine does not actually send to. (Verified: no lender has more
-- than one active profile, so the left join cannot fan out.)
--
-- security_invoker so the underlying funder_directives RLS still applies —
-- including the closer clause, without which the person who actually sends
-- submissions cannot see her own queue.

create or replace view public.funder_directives_actionable
with (security_invoker = true) as
select
  fd.*,
  l.company_name,
  coalesce(fsp.to_email, l.submission_email) as current_destination,
  case
    -- Resolved rows ask for nothing regardless of what they say.
    when fd.status <> 'open' then false
    -- An address the funder told us to STOP using, that we are still sending
    -- to, is always actionable — this is the case submit-to-funders hard-blocks
    -- on, so the queue must never quietly call it satisfied.
    when fd.retired_email is not null
     and lower(fd.retired_email) = lower(coalesce(fsp.to_email, l.submission_email, '')) then true
    -- An address instruction we already comply with needs nobody. This is the
    -- 9-of-12 case: funder onboarding emails naming the submissions inbox we
    -- were set up from in the first place.
    when fd.kind = 'submission_email_change'
     and fd.new_email is not null
     and lower(fd.new_email) = lower(coalesce(fsp.to_email, l.submission_email, '')) then false
    -- Everything else — portal moves, new required docs, contact changes, and
    -- any address instruction whose destination we could not read — needs a
    -- human. Defaulting to "needs action" is deliberate: an unreadable case
    -- must land in front of someone, not fall off the list.
    else true
  end as needs_action
from public.funder_directives fd
join public.lenders l on l.id = fd.lender_id
left join public.funder_submission_profiles fsp
  on fsp.lender_id = fd.lender_id and fsp.active;

comment on view public.funder_directives_actionable is
  'funder_directives joined to the destination submit-to-funders would actually resolve, with needs_action computed. needs_action is COMPUTED, never stored: a directive satisfied today becomes actionable again the moment someone edits the recipe away from it.';

grant select on public.funder_directives_actionable to authenticated;
