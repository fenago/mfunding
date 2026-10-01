-- Supersession — because the queue was about to hand back the exact address
-- that started all of this.
--
-- WHAT THE FIRST FULL-RECALL SCAN SURFACED. Uplyft Capital, two real
-- instructions five weeks apart:
--
--   2026-08-12  jeffs@  "You can now submit deals directly to
--                        Underwriting@uplyftcapital.com for review."
--   2026-09-17  scott@  "Effective immediately, please send all new deal
--                        submissions to submissions@uplyftcapital.com. Please
--                        stop sending submissions to
--                        underwriting@uplyftcapital.com..."
--
-- Both correctly detected. Both open. So the queue showed a processor
-- "Uplyft: use underwriting@uplyftcapital.com" — the retired inbox, the one
-- that swallowed MF-2026-0366 and MF-2026-0385 — as outstanding work, five
-- weeks after the funder retired it. Acting on it would have re-broken the
-- failure this whole feature exists to fix, and the queue would have been the
-- thing that asked for it.
--
-- Nothing was wrong with the detection. What was missing is that instructions
-- about WHERE TO SEND are not a set, they are a sequence: only the newest one
-- from a given funder describes the present. An older address instruction is
-- history, not an instruction.
--
-- Scoped to submission_email_change ONLY. A newer address change says nothing
-- about an older "we now require tax returns" or "your rep has changed" —
-- those are independent facts and must keep asking. Getting this wrong in the
-- other direction would silently retire real requirements.
--
-- Ordering is (received_at, created_at, id): received_at is the funder's clock
-- and the right one, created_at breaks ties for replies captured without one,
-- and id makes it total so the result can never depend on scan order.

-- Dropped and recreated rather than CREATE OR REPLACE: the new is_superseded
-- column lands before needs_action, and Postgres refuses a replace that
-- reorders or renames existing view columns.
drop view if exists public.funder_directives_actionable;

create view public.funder_directives_actionable
with (security_invoker = true) as
with ranked as (
  select
    fd.id,
    row_number() over (
      partition by fd.lender_id
      order by fd.received_at desc nulls last, fd.created_at desc, fd.id desc
    ) as recency_rank
  from public.funder_directives fd
  where fd.kind = 'submission_email_change'
)
select
  fd.*,
  l.company_name,
  coalesce(fsp.to_email, l.submission_email) as current_destination,
  -- True when a LATER address instruction exists from the same funder. Exposed,
  -- not just acted on, so the page can say "superseded by a later instruction"
  -- rather than silently dropping a row a human may remember seeing.
  (fd.kind = 'submission_email_change' and coalesce(r.recency_rank, 1) > 1) as is_superseded,
  case
    when fd.status <> 'open' then false
    -- An older address instruction is history. This clause sits FIRST, above
    -- the retired-address rule, because the 2026-08-12 Uplyft row names
    -- underwriting@ as a DESTINATION — it would otherwise have to be judged on
    -- its own terms and would keep asking for the dead inbox.
    when fd.kind = 'submission_email_change' and coalesce(r.recency_rank, 1) > 1 then false
    -- An address the funder told us to STOP using that we still send to is
    -- always actionable — this is what submit-to-funders hard-blocks on.
    when fd.retired_email is not null
     and lower(fd.retired_email) = lower(coalesce(fsp.to_email, l.submission_email, '')) then true
    -- An address instruction we already comply with needs nobody.
    when fd.kind = 'submission_email_change'
     and fd.new_email is not null
     and lower(fd.new_email) = lower(coalesce(fsp.to_email, l.submission_email, '')) then false
    -- Everything else needs a human. Defaulting to "needs action" is
    -- deliberate: an unreadable case must land in front of someone.
    else true
  end as needs_action
from public.funder_directives fd
join public.lenders l on l.id = fd.lender_id
left join public.funder_submission_profiles fsp
  on fsp.lender_id = fd.lender_id and fsp.active
left join ranked r on r.id = fd.id;

comment on view public.funder_directives_actionable is
  'funder_directives joined to the destination submit-to-funders would actually resolve, with needs_action and is_superseded computed. Both are COMPUTED, never stored: a directive satisfied today becomes actionable again the moment someone edits the recipe away from it, and a newer address instruction from the same funder retires an older one. Supersession applies to submission_email_change ONLY — a new address says nothing about an older document requirement.';

grant select on public.funder_directives_actionable to authenticated;
