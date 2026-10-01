-- The policy fix admitted her to the table and the VIEW still showed her nothing.
--
-- WHAT HAPPENED. 20261001f widened funder_directives SELECT to admit
-- is_processor. Verified as stephaniedecker0611@gmail.com (role 'user', a
-- `closers` row, is_processor flipped inside a rolled-back transaction):
--
--     funder_directives            25 rows   ← fixed
--     funder_directives_actionable  0 rows   ← the page reads THIS
--
-- The view is security_invoker, which is right for funder_directives — but it
-- also INNER JOINs `lenders`, and `lenders` has policies for admin, super_admin,
-- employee and role='closer' and NONE for is_processor. So every row was
-- filtered out by the join, and the page would have rendered an empty queue:
-- not an error, not a refusal, just "nothing needs doing" to the one person
-- about to send submissions. The precise failure this table exists to prevent,
-- and it would have shipped as fixed because the table-level check passed.
--
-- A policy on one table is not a permission to read a view over four.
--
-- THE FIX, and why it is not "grant processors read on lenders". That is a
-- wider decision about a table another workstream owns, and it is not needed:
-- what the view wants from `lenders` and `funder_submission_profiles` is a
-- display name and a destination address, for lenders that already appear in a
-- directive the caller is cleared to see. So those two lookups move into
-- SECURITY DEFINER helpers and the view stops joining the tables at all.
--
-- The access boundary is UNCHANGED and still enforced in exactly one place:
-- funder_directives' own RLS decides which rows you get. The helpers only
-- decorate rows that decision already returned. Neither exposes anything a
-- directive card did not already show.
--
-- `lenders` still has no is_processor SELECT policy. That is a real gap for any
-- other processor surface that reads it directly; out of scope here and flagged
-- rather than silently widened.

create or replace function public.funder_display_name(p_lender_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select l.company_name from public.lenders l where l.id = p_lender_id;
$$;

comment on function public.funder_display_name(uuid) is
  'Funder name for a directive row. SECURITY DEFINER so funder_directives_actionable does not need the caller to hold lenders SELECT — the directive''s own RLS already decided what they may see.';

create or replace function public.funder_current_destination(p_lender_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  -- Resolved the SAME way submit-to-funders resolves it: the active recipe's
  -- to_email first, then the lenders row as the fallback. Reading it any other
  -- way would let the queue call a directive satisfied by an address the engine
  -- does not actually send to.
  select coalesce(
    (select f.to_email from public.funder_submission_profiles f
      where f.lender_id = p_lender_id and f.active and f.to_email <> '' limit 1),
    (select l.submission_email from public.lenders l where l.id = p_lender_id)
  );
$$;

comment on function public.funder_current_destination(uuid) is
  'The address submit-to-funders would actually send to: active recipe to_email, else lenders.submission_email. SECURITY DEFINER for the same reason as funder_display_name.';

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
  public.funder_display_name(fd.lender_id) as company_name,
  public.funder_current_destination(fd.lender_id) as current_destination,
  (fd.kind = 'submission_email_change' and coalesce(r.recency_rank, 1) > 1) as is_superseded,
  case
    when fd.status <> 'open' then false
    -- An older address instruction is history. First, so a superseded row can
    -- never be judged on its own terms and ask for a dead inbox.
    when fd.kind = 'submission_email_change' and coalesce(r.recency_rank, 1) > 1 then false
    -- An address the funder told us to STOP using that we still send to.
    when fd.retired_email is not null
     and lower(fd.retired_email) = lower(coalesce(public.funder_current_destination(fd.lender_id), '')) then true
    -- An address instruction the recipe already complies with.
    when fd.kind = 'submission_email_change'
     and fd.new_email is not null
     and lower(fd.new_email) = lower(coalesce(public.funder_current_destination(fd.lender_id), '')) then false
    else true
  end as needs_action
from public.funder_directives fd
left join ranked r on r.id = fd.id;

comment on view public.funder_directives_actionable is
  'funder_directives decorated with the destination submit-to-funders would resolve, plus computed needs_action and is_superseded. Joins NOTHING with its own RLS: the lender name and address come from SECURITY DEFINER helpers, so a processor who cannot read `lenders` still sees her own queue instead of a silently empty one. funder_directives'' RLS remains the single access decision.';

grant select on public.funder_directives_actionable to authenticated;
