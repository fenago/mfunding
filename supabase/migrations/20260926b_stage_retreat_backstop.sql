-- A deal does not go backward unless a person says so
--
-- PIECE 3 of the retreat fix. The other two live in edge functions:
--   · ghl-webhook          — refuses an inbound stage echo that ranks below the
--                            deal's current stage (stops the writes we know about)
--   · wavv-disposition-sync — refuses to PUT a GHL card to a stage behind where
--                            it already sits (stops the card moving, so GHL and
--                            the app keep agreeing)
--
-- This one exists because those two only cover the writers we have enumerated.
-- The 28 backward writes between 2026-08-03 and 2026-09-25 arrived through the
-- mirror, but the mirror was only relaying them: 21 of 32 landed within twenty
-- minutes of a WAVV dial, and our own disposition sync is provably not the
-- source (every one of those events carried a no-action tag, which that sync
-- leaves untouched). Something GHL-side is moving the cards and has not been
-- identified yet. A guard that only knows about today's writers would be
-- bypassed by tomorrow's.
--
-- WHAT IS AND IS NOT BLOCKED
--
-- Blocked: any UPDATE that moves a deal DOWN its own ladder, by any caller
-- without a person behind it. That is the echo case, which carries no author
-- and no intent.
--
-- Not blocked, deliberately:
--   · An admin or super_admin moving a deal back. This is a real thing people
--     need to do, it already goes through updateDealStatus (src/services/
--     dealService.ts:722) which gates it to those two roles and logs
--     'Stage moved backward' with the mover's name, and it stays working
--     exactly as it does today. The role test here is the SAME pair of roles —
--     deliberately NOT is_ops_staff(), which also admits 'employee' and would
--     make this backstop looser than the gate it is backing up.
--   · Any move into or out of an EXIT (nurture / declined / dead). Those are
--     not rungs and have no rank, so parking, losing and reviving are all
--     untouched. dnd-enforce killing a deal still works.
--   · A move within a pipeline the deal does not belong to — ranks are only
--     ever compared inside one ladder.
--
-- ESCAPE HATCH. A service-role job with a genuine reason to rewind sets
--   select set_config('app.allow_stage_retreat', 'on', true);
-- in the SAME transaction. Transaction-local, so it cannot leak into the next
-- statement, and it has to be typed on purpose.
--
-- IT RAISES, IT DOES NOT SILENTLY COERCE. Setting new.status := old.status
-- would make a refused write indistinguishable from an accepted one, which is
-- the exact failure mode that let this problem hide for two months: an empty
-- read that looked like a clean bill of health. With Pieces 1 and 2 in place
-- this should never fire in normal operation, and that is what makes it a
-- useful alarm rather than routine noise.

-- ---------------------------------------------------------------------------
-- 1. The VCF ladder, so the backstop is not MCA-only
-- ---------------------------------------------------------------------------
-- deals_stage_rank() covers the MCA rungs and returns NULL for everything else,
-- which would leave every VCF deal unprotected. Mirrors VCF_PIPELINE in
-- src/data/pipelines.ts.

create or replace function public.deals_vcf_stage_rank(p_status text)
returns integer
language sql
immutable
as $function$
  select case p_status
    when 'new_distressed'       then 0
    when 'hardship_consult'     then 1
    when 'positions_analysis'   then 2
    when 'strategy_proposal'    then 3
    when 'agreement_sent'       then 4
    when 'submitted_to_vcf'     then 5
    when 'restructure_executed' then 6
    when 'servicing'            then 7
    -- nurture / declined / dead are EXITS on this ladder too, and have no rank.
    else null
  end;
$function$;

comment on function public.deals_vcf_stage_rank(text) is
  'Rank of a VCF pipeline stage, NULL for anything that is not a VCF rung. The VCF '
  'twin of deals_stage_rank(); mirrors VCF_PIPELINE in src/data/pipelines.ts.';

-- ---------------------------------------------------------------------------
-- 2. The backstop
-- ---------------------------------------------------------------------------

create or replace function public.deals_refuse_stage_retreat()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old integer;
  v_new integer;
  v_uid uuid := auth.uid();
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Rank both ends on the deal's OWN ladder. Comparing an MCA rank to a VCF one
  -- would be comparing "Docs Collected" to "Agreement Sent" because both happen
  -- to be 4.
  if new.deal_type = 'vcf' then
    v_old := public.deals_vcf_stage_rank(old.status);
    v_new := public.deals_vcf_stage_rank(new.status);
  else
    v_old := public.deals_stage_rank(old.status);
    v_new := public.deals_stage_rank(new.status);
  end if;

  -- Not both rungs → not a retreat. Parking, losing, reviving and every move
  -- involving an exit status pass straight through.
  if v_old is null or v_new is null or v_new >= v_old then
    return new;
  end if;

  -- An explicit, transaction-local override from a job that means it.
  if coalesce(current_setting('app.allow_stage_retreat', true), '') = 'on' then
    return new;
  end if;

  -- A person with the authority to rewind. Same two roles as the client gate.
  if v_uid is not null and exists (
       select 1 from public.profiles p
        where p.id = v_uid and p.role in ('admin', 'super_admin')
     ) then
    return new;
  end if;

  raise exception
    'Refused to move deal % backward (% → %): a deal does not go down its own ladder without a person behind it. '
    'An admin can make this change on the deal itself; an automated job that genuinely needs to rewind must set '
    'app.allow_stage_retreat in the same transaction.',
    coalesce(new.deal_number, new.id::text), old.status, new.status
    using errcode = 'P0001';
end;
$function$;

-- Named zz_ so it fires LAST: Postgres runs same-timing triggers in name order,
-- and the existing BEFORE-UPDATE-of-status triggers are
-- deals_stamp_stage_timestamps_trg and zz_deals_application_sender_trg.
-- Correctness does not depend on this — the exception aborts the whole
-- statement whenever it is raised — but letting the stamp trigger finish first
-- keeps the two from having to know about each other.
--
-- Verified safe against every existing writer: the only SQL functions that
-- UPDATE deals.status are customers_dnd_close_open_deals and
-- processor_move_to_nurture (both target exits, which have no rank) and
-- deals_advance_status (forward only). No edge function writes a backward
-- status: live-transfer-intake's dpatch does not touch status, and dnd-enforce
-- works through the DNC trigger, which lands on dead.
drop trigger if exists zz_deals_refuse_stage_retreat on public.deals;
create trigger zz_deals_refuse_stage_retreat
  before update of status on public.deals
  for each row execute function public.deals_refuse_stage_retreat();

comment on function public.deals_refuse_stage_retreat() is
  'Backstop: no caller moves a deal DOWN its pipeline ladder. Admins and super_admins '
  'are exempt (the client rewind path is theirs and stays working), exits have no rank '
  'so parking and reviving are untouched, and a service job can override for one '
  'transaction with app.allow_stage_retreat. Raises rather than coercing, so a refused '
  'write can never be mistaken for an accepted one.';

-- ---------------------------------------------------------------------------
-- 3. Before enabling this, look at what it would have refused
-- ---------------------------------------------------------------------------
-- Read-only. Every backward stage write the mirror recorded, reconstructed from
-- the JSON in activity_log.content — which is where the direction has been
-- living, and the reason this went unseen. Rows whose entity_id no longer
-- resolves to a deal are reported separately rather than silently dropped;
-- counting them as live deals is how "28 across 22" was first misreported as
-- "32 across 24".

create or replace function public.stage_retreat_census(p_days integer default 60)
returns table(
  deal_number   text,
  business_name text,
  old_status    text,
  new_status    text,
  occurred_at   timestamptz,
  wavv_dial_within_20min boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with m as (
    select a.entity_id, a.created_at,
           (a.content::jsonb)->>'from'            as f,
           (a.content::jsonb)->>'to'              as t,
           (a.content::jsonb)#>>'{evt,contact_id}' as cid
      from public.activity_log a
     where a.entity_type = 'deal'
       and a.subject like 'ghl:%'
       and a.content like '{%'
       and a.created_at > now() - make_interval(days => p_days)
  )
  select d.deal_number, c.business_name, m.f, m.t, m.created_at,
         exists (select 1 from public.wavv_calls w
                  where w.contact_id = m.cid
                    and w.started_at between m.created_at - interval '20 minutes' and m.created_at)
    from m
    join public.deals d     on d.id = m.entity_id
    join public.customers c on c.id = d.customer_id
   where m.t is not null
     and public.deals_stage_rank(m.f) is not null
     and public.deals_stage_rank(m.t) is not null
     and public.deals_stage_rank(m.t) < public.deals_stage_rank(m.f)
   order by m.created_at desc;
$function$;

revoke all on function public.stage_retreat_census(integer) from public, anon;
grant execute on function public.stage_retreat_census(integer) to authenticated, service_role;

comment on function public.stage_retreat_census(integer) is
  'READ-ONLY. Backward stage writes the GHL mirror accepted, parsed out of the JSON in '
  'activity_log.content. Flags whether a WAVV dial landed within 20 minutes before each '
  'one. Joins to deals, so log rows whose entity_id no longer resolves are excluded.';
