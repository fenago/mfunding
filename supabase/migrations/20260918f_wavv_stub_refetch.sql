-- A call frozen mid-ring looks exactly like a call nobody answered.
--
-- THE DEFECT. wavv-sync writes a row the moment it first sees a call. If the
-- call is still in progress, that row is a STUB: answered_at NULL, ended_at
-- NULL, seconds NULL, outcome 'UNKNOWN'. The sync re-reads a 10-minute overlap
-- behind its watermark so in-flight calls get corrected — but WAVV indexes by
-- startedAt, so once the watermark passes a row's START by more than ten
-- minutes, that row is never in any future window again. `reparse` cannot help:
-- it re-derives from the stored `raw`, and the stored raw IS the stub.
--
-- WHY IT MATTERS AT 7 ROWS IN 34,137. Because the defect is SELF-CONCEALING and
-- it blames a person. A frozen stub is byte-identical to a dial nobody picked
-- up — same empty answered_at, same NULL seconds, same 'UNKNOWN'. So it does not
-- read as a broken record. It reads as a setter who dialled and missed.
--
-- MEASURED LIVE, 2026-09-18, by asking WAVV for each frozen row by id:
--
--   id        dir       what OUR row says          what WAVV actually holds
--   01a0b5ac  outbound  never answered, no disp    answered, 1503s (25 min),
--             (Rafael Badia, MF-2026-0385)         disposition "Full Application"
--   01a063c6  outbound  never answered, no disp    answered, 786s (13 min),
--             (Kietta Gamble, MF-2026-0297)        disposition "Partial Application"
--   a493e5fe  inbound   unfinalised                unfinalised at WAVV too
--   40d01e8f  inbound   unfinalised                unfinalised at WAVV too
--   925d5b36  inbound   unfinalised                unfinalised at WAVV too
--   0b51439b  inbound   unfinalised                unfinalised at WAVV too
--
-- CATHERINE DID NOT FORGET. She had a twenty-five minute conversation and typed
-- "Full Application". Our mirror froze at dial time and the funnel then showed
-- her a call that never connected and was never dispositioned. The premise the
-- derived-disposition work started from — "assume she forgets" — was simply not
-- true of that row. Two of the three original derivation candidates were this
-- bug wearing a coaching costume.
--
-- The four inbound rows are the honest other half: WAVV holds nothing for them
-- either. Those are genuinely unfinalised, not lost by us.
--
-- ── WHAT THIS MIGRATION ADDS ────────────────────────────────────────────────
-- Three columns, existing only so that "we asked and WAVV still has nothing" can
-- never be confused with "frozen, nobody ever asked". Those are different facts
-- and only ONE of them is worth taking to a setter. (Same rule as
-- [[readers-must-distinguish-unreadable]]: absent is not a negative answer.)
--
-- The re-pull itself is wavv-sync action 'finalize', fetching GET /v3/calls/{id}
-- one id at a time. Verified live today: that endpoint returns the FULL final
-- record for a call whose list-window has long closed. The 10-minute overlap
-- stays exactly as it is — widening it to catch seven rows would re-read
-- thousands of finalised calls on every run, forever, for nothing.

begin;

alter table public.wavv_calls
  add column if not exists refetched_at    timestamptz,
  add column if not exists refetch_state   text,
  add column if not exists refetch_attempts int not null default 0;

alter table public.wavv_calls
  drop constraint if exists wavv_calls_refetch_state_check;
alter table public.wavv_calls
  add constraint wavv_calls_refetch_state_check
  check (refetch_state is null or refetch_state in ('finalized', 'still_unfinalized', 'not_found'));

comment on column public.wavv_calls.refetched_at is
  'When we last re-asked WAVV for this call by id. NULL means NEVER ASKED — which is NOT the same as "asked and WAVV had nothing". A stub with a NULL here is an open question; a stub with refetch_state = ''still_unfinalized'' has been answered.';
comment on column public.wavv_calls.refetch_state is
  'Result of the last by-id re-pull: finalized (WAVV had the real record and we took it) | still_unfinalized (WAVV holds a stub too — genuinely unfinished, not lost by us) | not_found (WAVV no longer has the call at all). NULL = never asked.';
comment on column public.wavv_calls.refetch_attempts is
  'How many times we have re-asked. Bounded in the edge function so a permanently unfinalised call is not re-fetched forever; after the cap the row keeps its last honest state.';

-- The eligibility predicate, as an index. A partial index on the stub signature
-- is tiny (6 rows today) and keeps the sweep's cost proportional to the number
-- of STUBS rather than to the size of the call book — the same discipline the
-- GHL standing-consumer ledger demands of any recurring reader.
create index if not exists wavv_calls_unfinalized_idx
  on public.wavv_calls (started_at desc)
  where outcome = 'UNKNOWN' and ended_at is null and seconds is null;

-- ── The worklist, so a human can see the hole without running the sweep ─────
-- security_invoker: wavv_calls RLS still governs (closer/employee/admin/
-- super_admin read).

create or replace view public.v_wavv_unfinalized_calls
with (security_invoker = true) as
select
  w.wavv_call_id,
  w.started_at,
  w.created_at                                   as first_seen_at,
  round(extract(epoch from (w.created_at - w.started_at)))::int as written_after_s,
  w.direction,
  w.phone,
  w.contact_name,
  w.refetched_at,
  w.refetch_state,
  w.refetch_attempts,
  case
    when w.refetched_at is null then 'never asked — this row is an open question'
    when w.refetch_state = 'still_unfinalized' then 'asked, and WAVV has no final record either'
    when w.refetch_state = 'not_found' then 'asked, and WAVV no longer holds this call'
    else 'asked'
  end                                            as readability
from public.wavv_calls w
where w.outcome = 'UNKNOWN'
  and w.ended_at is null
  and w.seconds is null
  and w.started_at < now() - interval '15 minutes';

revoke all on public.v_wavv_unfinalized_calls from public, anon;
grant select on public.v_wavv_unfinalized_calls to authenticated, service_role;

comment on view public.v_wavv_unfinalized_calls is
  'Every wavv_calls row still carrying the stub signature (outcome UNKNOWN, no ended_at, no seconds) more than 15 minutes after the dial. `readability` distinguishes "never asked" from "asked, and WAVV has nothing either" — a frozen stub is byte-identical to a dial nobody answered, so without that distinction the defect reads as a setter who missed.';

commit;
