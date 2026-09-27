-- The flag has to COMPARE the two times, not assert a sequence
--
-- stage_gate_flag_ahead (20260926a) wrote, on every row it touched:
--
--   '<evidence> on <date> UTC, after this deal was parked.'
--
-- It never received a park time and never compared anything. The phrase was a
-- hardcoded string. Of the 24 notes it wrote on 2026-09-26, seventeen asserted
-- a sequence that is the reverse of the truth, one was correct, and six were
-- on `dead` deals that carry no park timestamp at all, so the claim could
-- not have been checked even in principle.
--
-- This is not a wording bug. The entire justification for flag-don't-move is
-- "evidence arrived AFTER a human decided, so a human should look again." When
-- the evidence PREDATES the park, the human parked the deal with that evidence
-- already in hand — a considered decision, not an oversight, and not news.
-- MF-2026-0404 is the case that surfaced it: the merchant signed on 09-22 and
-- Kristine parked it on 09-25, three days later, and the note told the owner
-- the opposite when he asked a plain question about that deal.
--
-- THE FIXED RULE
--   evidence AFTER the park   → flag 'evidence:ahead-of-stage'. Actionable.
--   evidence BEFORE the park  → say NOTHING. The decision already accounted
--                               for it; a note here is noise that dilutes the
--                               ones that matter.
--   park time UNKNOWN         → flag 'evidence:ahead-of-stage-unverified',
--                               which states plainly that we cannot place the
--                               two events in order. Silence would lose a real
--                               signal (a dead deal holding a signed
--                               application), and a confident claim would
--                               repeat the original sin. Unreadable is its own
--                               answer and gets its own marker.
--
-- Both timestamps now appear in the text, so the reader can check the claim
-- instead of trusting it.

create or replace function public.stage_gate_flag_ahead(
  p_deal_id uuid,
  p_what    text,
  p_when    timestamptz
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_park    timestamptz;
  v_status  text;
  v_subject text;
  v_body    text;
begin
  select coalesce(d.nurture_at, d.declined_at), d.status
    into v_park, v_status
    from public.deals d where d.id = p_deal_id;

  if v_park is not null and p_when <= v_park then
    -- The park was made with this already on file. Nothing to report.
    return;
  end if;

  if v_park is null then
    v_subject := 'evidence:ahead-of-stage-unverified';
    v_body :=
      p_what || ' on ' || to_char(p_when, 'YYYY-MM-DD HH24:MI') || ' UTC. This deal is '
      || coalesce(v_status, 'parked') || ', but it carries NO park timestamp, so we cannot tell '
      || 'whether this arrived before or after the decision to park it. The stage was NOT changed. '
      || 'Treat this as "worth a look", not as "something new happened" — we do not know which.';
  else
    v_subject := 'evidence:ahead-of-stage';
    v_body :=
      p_what || ' on ' || to_char(p_when, 'YYYY-MM-DD HH24:MI') || ' UTC, which is AFTER this deal '
      || 'was parked on ' || to_char(v_park, 'YYYY-MM-DD HH24:MI') || ' UTC. The stage was NOT changed '
      || '— parking is a decision somebody made about this merchant and a document arriving does not '
      || 'reverse it. But this arrived after that decision, so it is worth a second look. If this '
      || 'merchant is back in play, bring the deal back and it resumes from the stage it left.';
  end if;

  insert into public.activity_log (entity_type, entity_id, interaction_type, subject, content)
  select 'deal', p_deal_id, 'note', v_subject, v_body
   where not exists (
     select 1 from public.activity_log a
      where a.entity_type = 'deal' and a.entity_id = p_deal_id
        and a.subject in ('evidence:ahead-of-stage', 'evidence:ahead-of-stage-unverified')
        and a.content like p_what || '%'
   );
end;
$function$;

comment on function public.stage_gate_flag_ahead(uuid, text, timestamptz) is
  'Flags evidence that arrived AFTER a deal was parked. Stays silent when the evidence '
  'predates the park (the decision already accounted for it) and uses a separate '
  '-unverified marker when the deal carries no park timestamp. Both timestamps appear in '
  'the text so the claim can be checked rather than trusted.';

-- ---------------------------------------------------------------------------
-- Marker vocabulary after this migration
-- ---------------------------------------------------------------------------
--   evidence:ahead-of-stage             evidence arrived AFTER the park. The only
--                                       actionable one; a human should look again.
--   evidence:ahead-of-stage-unverified  the deal carries no park timestamp, so the
--                                       order cannot be established either way.
--   evidence:predates-park              HISTORICAL ONLY. The 17 notes from the
--                                       2026-09-26 batch whose evidence turned out to
--                                       predate the park, corrected in place and given
--                                       their own subject so that filtering on
--                                       'evidence:ahead-of-stage' returns only rows
--                                       that actually warrant a second look. The fixed
--                                       function never emits this marker — going
--                                       forward that case produces no note at all.
--
-- A dry run shows the EVIDENCE date. deals_advance_status writes that date only when
-- the rung's *_at column is empty; where a real stamp already exists it keeps it and
-- declines to claim evidence:* provenance for a stamp it did not write. So a dry-run
-- row and the resulting deal row can legitimately differ, and the difference is the
-- function refusing to overwrite a recorded fact with a derived one. A dry run is a
-- forecast, not a promise.
