-- LEAD MACHINE — the RLS hoist. This is the big one.
--
-- ASKED FOR: an index on lead_records(line_type), because a count filtered on
-- line_type ran ~3.4s and one failed live.
--
-- WHAT THE PLANS ACTUALLY SHOWED: a plain btree on line_type would never be used.
-- Mobile (51.0%) + Landline (43.9%) is 94.9% of the table, and no planner picks an
-- index to fetch 95% of the rows — it correctly seq-scans. The index would have
-- been dead weight that every ingest still had to maintain.
--
-- Two real causes, fixed here, measured on the real 249,923 rows:
--
-- 1. THE HEAP IS FAT. lead_records.raw (the original CSV row) makes the heap
--    145MB, so any count dragged 145MB through memory. A COVERING index is 12MB
--    and answers the count with ZERO heap fetches:
--      2,584 ms -> 165 ms  (service_role, Parallel Index Only Scan)
--
-- 2. RLS WAS EVALUATED PER ROW — the dominant cost, and the one that made
--    "slow" into "impossible" for signed-in users (authenticated has
--    statement_timeout=8s). is_admin_or_super() is already STABLE, but Postgres
--    does not hoist a stable function out of a qual; it re-evaluated it once per
--    row. Wrapping the call in a SCALAR SUBQUERY forces it into an InitPlan
--    evaluated exactly ONCE per query:
--      237,231 function calls -> 1
--      3,022 ms -> 202 ms   (authenticated, same query)
--
-- Combined effect, all under role authenticated on an idle instance:
--      per-batch status count            : 10,119 ms ->  56 ms
--      Mobile+Landline count (237k rows) : timing out ->  85 ms
--      VoIP count (11k rows)             : 12,457 ms ->  72 ms
--
-- MEASUREMENT NOTE: this is a NANO-compute instance shared with several agents.
-- The same query measured 4,050 ms under concurrent load and 85 ms idle, with an
-- identical plan and all buffers cached. Timings here are the idle figures; treat
-- any single reading on a busy instance as an upper bound, not the plan's cost.
--
-- This is the standard Supabase RLS pattern and it is worth knowing generally:
-- `using (fn(auth.uid()))` costs one call per row; `using ((select fn(auth.uid())))`
-- costs one call per query. Identical semantics, ~180x here.

-- ── 1. Covering index for line_type / status counts ───────────────────────────
-- (line_type, status) INCLUDE (phone), 12MB against a 145MB heap.
--
-- INCLUDE (phone) rather than `where phone is not null`: the partial version was
-- tried first and was smaller (1.7MB), but it can ONLY serve queries that also
-- say `phone is not null`. The push function's count path always does; the UI's
-- ad-hoc counts do not, and those fell straight back to a 12s seq scan. Carrying
-- phone as an INCLUDE column serves BOTH shapes from the index with zero heap
-- fetches, which is worth the extra 10MB.
create index if not exists lead_records_linetype_status_idx
  on public.lead_records (line_type, status) include (phone);
comment on index public.lead_records_linetype_status_idx is
  'Covering index enabling Index Only Scans for line_type/status counts. The point is NOT selectivity (Mobile+Landline is 95% of rows) but avoiding the 145MB heap that lead_records.raw makes fat: the index is 12MB and answers these counts with zero heap fetches. phone is INCLUDEd so counts that do not filter on it are served too.';

-- ── 2. Hoist the RLS predicate out of the per-row filter ──────────────────────
-- Semantics are unchanged — same function, same argument, same result. Only the
-- number of times it runs changes.
do $do$
declare t text;
begin
  foreach t in array array['lead_batches','lead_records','lead_push_jobs'] loop
    execute format('drop policy if exists %I_admin_all on public.%I', t, t);
    execute format(
      'create policy %I_admin_all on public.%I for all to authenticated '
      || 'using ((select public.is_admin_or_super(auth.uid()))) '
      || 'with check ((select public.is_admin_or_super(auth.uid())))',
      t, t);
  end loop;
end $do$;

-- ── 3. line_type case variants ────────────────────────────────────────────────
-- The real files shipped the SAME value spelled two ways: "VoIP" (9,152) and
-- "Voip" (2,282), "Toll-Free" (1,139) and "Toll-free" (9). A user filtering
-- line_type='VoIP' silently missed 2,282 rows — the same class of bug as the
-- 'TEXAS' vs 'TX' states.
--
-- Unlike state, an UNRECOGNIZED value is KEPT, not nulled: a bad state collides
-- with a real one and yields a wrong answer, whereas an unknown line type
-- ("Satellite") collides with nothing and is informative. normalizeLineType() in
-- supabase/functions/_shared/leadCsv.ts is authoritative for new ingests.
update public.lead_records set line_type = 'VoIP'      where line_type = 'Voip';
update public.lead_records set line_type = 'Toll-Free' where line_type = 'Toll-free';

-- Index-only scans need the visibility map set, which is what makes the above fast.
vacuum analyze public.lead_records;
