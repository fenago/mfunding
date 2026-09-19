-- ─────────────────────────────────────────────────────────────────────────────
-- THE ENGINE: one status write fabricates up to ten "events", and until now
-- nothing recorded which of them anybody actually witnessed.
--
-- `deals_stamp_stage_timestamps` is honest about what it computes. Its own
-- comment says:
--
--     ceiling timestamptz := now();  -- transaction time: "by now, it had happened"
--
-- That is a CEILING — the earliest moment we can prove the deal was already past
-- a rung. It is a legitimate and useful thing to compute, and this migration does
-- not change a single stamp it writes.
--
-- The defect is one level up: EVERY READER IN THE APP RENDERS THAT CEILING AS AN
-- EVENT AT TIME T. One `status='funded'` write fills funded_at, offer_accepted_at,
-- offer_presented_at, offer_received_at, submitted_at, bank_statements_at,
-- docs_collected_at, application_sent_at, qualified_at, contacted_at,
-- first_attempt_at, last_attempt_at and contact_attempts=1 — all at now() — and
-- nothing downstream can tell any of them apart from a timestamp written by the
-- act itself.
--
-- Measured on this book before the change:
--   · 15 of 66 deals with application_sent_at carry 2-4 other rung stamps
--     INSIDE THE SAME SECOND.
--   · 79 deals carry the contact_attempts=1 / first_attempt_at=last_attempt_at
--     signature; 5 of those have zero calls across all four call sources.
--   · MF-2026-0363 (Joyce Derian) was stamped application_sent_at by a card drag
--     27 seconds after a draft was opened. No document ever existed. That stamp
--     drove an "App Sent" badge, a red UNSIGNED badge accusing the merchant of
--     ignoring an application she never received, a receipt naming three
--     documents, and a My Day card telling a setter to chase her signature.
--   · Speed-to-Lead read first_attempt_at — back-filled here from contacted_at —
--     and reported 21.8 hours for a dial placed in 35 seconds, against two
--     setters, by name.
--
-- This is also why `is_phantom_application_send` exists AND why it misses: it
-- recognises only creation-time import phantoms (created_by null AND
-- |sent - created| <= a small window), so Joyce's two-day-later card drag
-- returns false and reads as a genuine send everywhere it gates. Provenance
-- makes that heuristic unnecessary rather than wider — a heuristic guessing at
-- what a column meant, replaced by the column saying so.
--
-- WHAT THIS DOES NOT DO — deliberately:
--   · It does not change which stamps are written, or their values. CLAUDE.md
--     requires a status change to stamp its *_at; the ceiling stays.
--   · It does not backfill history. For a row stamped before today we cannot
--     know whether a human witnessed it, and inventing provenance would be the
--     same mistake one level up from the one being fixed. Absence of a key is
--     NOT a claim that the stamp was witnessed — see the column comment.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.deals
  add column if not exists stage_stamp_provenance jsonb;

comment on column public.deals.stage_stamp_provenance is
  'Which stage *_at timestamps on this row were INFERRED by '
  'deals_stamp_stage_timestamps rather than written by the act itself. Shape: '
  '{"application_sent_at": "inferred", ...}. '
  '⚠ READ THIS THE RIGHT WAY ROUND. A key PRESENT is positive proof the trigger '
  'filled that hole from a ceiling (now()), i.e. nobody witnessed the event — a '
  'card was dragged and we back-dated the rungs beneath it. A key ABSENT is NOT '
  'proof the stamp was witnessed: it means only that this trigger did not fill '
  'it, which is also true of every row stamped before 20260919a and of any '
  'write path that sets a stamp directly. Treat absent as UNKNOWN. '
  'Rows predating this column are NULL for exactly that reason — they were not '
  'backfilled, because their provenance is genuinely unknowable and guessing it '
  'would repeat the defect this column exists to end.';

-- ── The trigger, unchanged in behaviour, now recording what it inferred ──────
--
-- Rebuilt from the LIVE CATALOG definition (pg_get_functiondef), not from an
-- older migration file — rebuilding one of these from stale migration text
-- silently reverted five later migrations and took wavv-sync down for 25 minutes
-- on 2026-09-18. Every stamp rule below is byte-identical to what was running;
-- the only additions are the `prov` accumulator and its assignment.
create or replace function public.deals_stamp_stage_timestamps()
 returns trigger
 language plpgsql
as $function$
declare
  r        integer;
  ceiling  timestamptz := now();  -- transaction time: "by now, it had happened"
  prov     jsonb := coalesce(new.stage_stamp_provenance, '{}'::jsonb);
begin
  if new.deal_type is distinct from 'mca' then
    return new;
  end if;

  r := public.deals_stage_rank(new.status);
  if r is null then
    return new;  -- exit status (declined/dead/nurture) — never stamp a rung
  end if;

  -- Highest rung first. `ceiling` is the earliest moment we can prove the deal was
  -- already past the rung we're looking at; a hole gets filled with exactly that, and a
  -- real stamp only tightens it for everything below.
  --
  -- Each `coalesce(x, ceiling)` that actually FIRES is an inference, and is now
  -- recorded as one. Note the test is on the column being NULL *before* the fill:
  -- a stamp that was already there is left alone and gains no provenance entry,
  -- which is correct — this trigger did not put it there and cannot vouch for it.
  if r >= 10 and new.funded_at is null then
    new.funded_at := ceiling;
    prov := prov || jsonb_build_object('funded_at', 'inferred');
  end if;
  if new.funded_at is not null then ceiling := least(ceiling, new.funded_at); end if;

  if r >= 9 and new.offer_accepted_at is null then
    new.offer_accepted_at := ceiling;
    prov := prov || jsonb_build_object('offer_accepted_at', 'inferred');
  end if;
  if new.offer_accepted_at is not null then ceiling := least(ceiling, new.offer_accepted_at); end if;

  if r >= 8 and new.offer_presented_at is null then
    new.offer_presented_at := ceiling;
    prov := prov || jsonb_build_object('offer_presented_at', 'inferred');
  end if;
  if new.offer_presented_at is not null then ceiling := least(ceiling, new.offer_presented_at); end if;

  if r >= 7 and new.offer_received_at is null then
    new.offer_received_at := ceiling;
    prov := prov || jsonb_build_object('offer_received_at', 'inferred');
  end if;
  if new.offer_received_at is not null then ceiling := least(ceiling, new.offer_received_at); end if;

  if r >= 6 and new.submitted_at is null then
    new.submitted_at := ceiling;
    prov := prov || jsonb_build_object('submitted_at', 'inferred');
  end if;
  if new.submitted_at is not null then ceiling := least(ceiling, new.submitted_at); end if;

  if r >= 5 and new.bank_statements_at is null then
    new.bank_statements_at := ceiling;
    prov := prov || jsonb_build_object('bank_statements_at', 'inferred');
  end if;
  if new.bank_statements_at is not null then ceiling := least(ceiling, new.bank_statements_at); end if;

  if r >= 4 and new.docs_collected_at is null then
    new.docs_collected_at := ceiling;
    prov := prov || jsonb_build_object('docs_collected_at', 'inferred');
  end if;
  if new.docs_collected_at is not null then ceiling := least(ceiling, new.docs_collected_at); end if;

  -- application_sent_at is the one the app reads as "a document went to the
  -- merchant", and it has its own verifiable source (deal_send_evidence(), which
  -- reads documents back out of GHL). A card position is not that source, which
  -- is why 20260918-era work stopped the stage MIRROR from writing it. This
  -- trigger still fills the hole for an in-app status change; the provenance
  -- entry is what lets a reader tell the two apart.
  if r >= 3 and new.application_sent_at is null then
    new.application_sent_at := ceiling;
    prov := prov || jsonb_build_object('application_sent_at', 'inferred');
  end if;
  if new.application_sent_at is not null then ceiling := least(ceiling, new.application_sent_at); end if;

  if r >= 2 and new.qualified_at is null then
    new.qualified_at := ceiling;
    prov := prov || jsonb_build_object('qualified_at', 'inferred');
  end if;
  if new.qualified_at is not null then ceiling := least(ceiling, new.qualified_at); end if;

  if r >= 1 and new.contacted_at is null then
    new.contacted_at := ceiling;
    prov := prov || jsonb_build_object('contacted_at', 'inferred');
  end if;

  -- Reaching a merchant proves we tried to reach them, and the attempt was no later than
  -- the contact. Never overwrite a real attempt a closer logged — if they dialled at 10:02
  -- and got through at 10:05, the speed-to-lead SLA is judged on 10:02.
  --
  -- THIS IS THE PAIR THAT DEFAMED TWO SETTERS. first_attempt_at derived from
  -- contacted_at is the moment the merchant PICKED UP, not the moment anyone
  -- dialled, and Speed-to-Lead judged the SLA on it — 21.8 hours for a 35-second
  -- dial. deal_speed_to_lead() now reads the canonical call union instead; the
  -- provenance entry below is what lets any future reader see that this
  -- particular first_attempt_at was never a dial anybody observed.
  if new.contacted_at is not null then
    if new.first_attempt_at is null then
      new.first_attempt_at := new.contacted_at;
      prov := prov || jsonb_build_object('first_attempt_at', 'inferred');
    end if;
    if new.last_attempt_at is null then
      new.last_attempt_at := new.contacted_at;
      prov := prov || jsonb_build_object('last_attempt_at', 'inferred');
    end if;
    if coalesce(new.contact_attempts, 0) = 0 then
      new.contact_attempts := 1;
      prov := prov || jsonb_build_object('contact_attempts', 'inferred');
    end if;
  end if;

  if prov <> '{}'::jsonb then
    new.stage_stamp_provenance := prov;
  end if;

  return new;
end;
$function$;

-- ── Reading it ──────────────────────────────────────────────────────────────
-- IMMUTABLE and tiny, so a surface can ask per-column without a join.
-- Returns TRUE only when we have positive proof the trigger inferred the stamp.
-- Everything else — no record, a row predating the column, a stamp written by a
-- real code path — is FALSE, which means "not known to be inferred", NOT
-- "witnessed". A caller that needs the third state must check for NULL
-- provenance itself; see stage_stamp_is_unknown() below.
create or replace function public.stage_stamp_is_inferred(p_provenance jsonb, p_column text)
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(p_provenance ->> p_column, '') = 'inferred';
$$;

-- The third state, said out loud. TRUE when this row carries no provenance at
-- all — every deal stamped before 20260919a — so a surface can render "we don't
-- know how this got here" instead of quietly implying somebody watched it
-- happen. Tri-state is the whole point: witnessed / inferred / unknown.
create or replace function public.stage_stamp_is_unknown(p_provenance jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select p_provenance is null;
$$;

grant execute on function public.stage_stamp_is_inferred(jsonb, text) to authenticated, service_role;
grant execute on function public.stage_stamp_is_unknown(jsonb) to authenticated, service_role;
