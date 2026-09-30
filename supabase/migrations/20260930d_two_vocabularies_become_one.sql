-- Fifty-seven parks already had a reason. It was in the column nothing reads.
--
-- THIS IS A RECOVERY, NOT A BACKFILL. The owner has twice asked why a specific
-- deal was parked and been told "no reason was recorded". For 57 of the 274
-- nurture deals that was never true: a human opened the Playbooks close dialog,
-- picked a reason from its list, and it was written to deals.closed_reason —
-- a nine-value vocabulary with no CHECK, read by Campaign Audit and nothing
-- else. Meanwhile deals.lost_reason, the fifteen-value coded column that
-- analyticsService and the loss-reason breakdown actually read, stayed NULL on
-- every one of them. All 57 are status='nurture'. Nothing here is invented;
-- every value below was chosen by a person and is being moved to the column
-- that counts it.
--
-- lost_reason is the survivor: it has the CHECK, the analytics read it, and
-- every park path now writes it. closed_reason is NOT dropped — it is
-- backfilled from, its readers are repointed, and the column is left in place.
-- Removing it is a separate change once nothing reads it.
--
-- TWO NEW VALUES, both because flattening them would destroy the only
-- actionable thing in the row:
--   went_to_competitor  5 real rows. "Lost to a named competitor" is
--                       competitive intelligence; merchant_declined says only
--                       "they said no" and throws the signal away.
--   rate_too_high       0 rows, and only because the dialog postdates the
--                       data. A price objection is the one decline the owner
--                       can actually do something about.
--
-- too_many_positions → disqualified, deliberately, for now. Stacking is the
-- dominant MCA decline reason and will earn its own value — but no row has
-- ever used it, and a value added on a guess is how a picker fills up with
-- options nobody means. THE MOMENT A REAL ROW APPEARS, PROMOTE IT.
--
-- bogus_never_requested → bogus_lead must survive intact. Campaign Audit uses
-- it to prove a lead vendor sold garbage, which is worth money at renewal.
-- campaignAuditService reads it OR a contact-sweep signal; both arms are kept.
--
-- ---------------------------------------------------------------------------
-- A NOTE ON MIGRATION 20260926c, WHICH LOOKS LIKE AN ERROR AND IS NOT
-- ---------------------------------------------------------------------------
-- Seven migrations (20260926a–e, 20260928a, 20260930a) were applied by running
-- their SQL directly rather than through the migration path, and were
-- registered in supabase_migrations.schema_migrations afterwards, on
-- 2026-09-30, once each object had been verified present individually.
--
-- 20260926c is the exception and will not verify. Its only object was
-- deals_merchant_notify carrying an app.suppress_merchant_notify gate, and
-- 20260926d DELIBERATELY reverted that, moving the gate to notify_merchant —
-- the single chokepoint all four *_merchant_notify callers pass through. So a
-- present/absent check on c returns FALSE, correctly.
--
-- It is registered anyway, on the strength of the apply log rather than an
-- object check. The asymmetry decides it: a replay with c runs c then d and d
-- wins; a replay without c reaches the identical end state because d rewrites
-- both functions. But leaving it unregistered means it shows as PENDING
-- forever, and someone eventually applies it AFTER d — re-adding a second gate
-- d removed on purpose. Registering a no-op is harmless; leaving a live trap
-- in the pending list is not.

-- ---------------------------------------------------------------------------
-- 1. The two new values
-- ---------------------------------------------------------------------------
alter table public.deals drop constraint if exists deals_lost_reason_check;
alter table public.deals add constraint deals_lost_reason_check check (
  lost_reason is null or lost_reason = any (array[
    'no_contact', 'disqualified', 'docs_not_provided', 'bank_data_fail',
    'funders_declined_all', 'merchant_declined', 'offer_expired',
    'funding_fell_through', 'routed_to_vcf', 'duplicate', 'opted_out',
    'prohibited_industry', 'business_closed', 'bogus_lead',
    'went_to_competitor', 'rate_too_high', 'other'
  ])
);

-- ---------------------------------------------------------------------------
-- 2. One mapping, used by the recovery below and by the client
-- ---------------------------------------------------------------------------
-- The Playbooks close dialog still speaks closed_reason, so the translation has
-- to exist somewhere. Putting it in the database means the backfill and the
-- client cannot drift into two different answers for the same input.

create or replace function public.closed_reason_to_lost_reason(p_reason text)
returns text
language sql
immutable
as $function$
  select case p_reason
    when 'unresponsive'          then 'no_contact'
    when 'docs_never_arrived'    then 'docs_not_provided'
    when 'went_with_competitor'  then 'went_to_competitor'
    when 'rate_too_high'         then 'rate_too_high'
    when 'not_qualified'         then 'disqualified'
    -- Stacking has no value of its own YET — see the header. Promote on evidence.
    when 'too_many_positions'    then 'disqualified'
    when 'funders_declined'      then 'funders_declined_all'
    when 'bogus_never_requested' then 'bogus_lead'
    when 'no_contact'            then 'no_contact'
    when 'other'                 then 'other'
    -- An unmapped value is not guessed at. NULL is honest; 'other' would hide it.
    else null
  end;
$function$;

comment on function public.closed_reason_to_lost_reason(text) is
  'Translates the Playbooks close dialog''s closed_reason vocabulary into the coded '
  'lost_reason one. Returns NULL for anything unmapped rather than folding it into '
  '"other", so a new close reason surfaces instead of disappearing.';

-- ---------------------------------------------------------------------------
-- 3. The recovery
-- ---------------------------------------------------------------------------
-- Only where lost_reason is still NULL: a reason written by any of the park
-- paths is the more specific record and is never overwritten by a translation.

update public.deals d
   set lost_reason = public.closed_reason_to_lost_reason(d.closed_reason)
 where d.closed_reason is not null
   and d.lost_reason is null
   and public.closed_reason_to_lost_reason(d.closed_reason) is not null;

-- Leave a trail on each recovered deal. These rows are about to start showing
-- a reason in the analytics that they never showed before, and the next person
-- to ask "where did that come from" deserves an answer on the deal itself.
insert into public.activity_log (entity_type, entity_id, interaction_type, subject, content)
select 'deal', d.id, 'note', 'stage:reason-recovered',
       'This deal''s park reason (' || d.lost_reason || ') was recovered from closed_reason ('
       || d.closed_reason || '), which the Playbooks close dialog wrote when somebody closed the '
       || 'deal. The reason was always there — it was in a column the analytics did not read, so '
       || 'this deal counted as "no reason recorded". Nothing was invented or guessed.'
  from public.deals d
 where d.closed_reason is not null
   and d.lost_reason = public.closed_reason_to_lost_reason(d.closed_reason)
   and not exists (
     select 1 from public.activity_log a
      where a.entity_type = 'deal' and a.entity_id = d.id and a.subject = 'stage:reason-recovered'
   );
