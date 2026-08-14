-- The RETAG drain's working-set index — and the reason the owner lost 7 hours.
--
-- WHAT HAPPENED: the lt-* backfill ran overnight as retag jobs. Retag mode widens
-- to status='pushed', so lead_records_drain_idx (partial on status='loaded') did
-- not apply, and no other index served the predicate. Postgres fell back to a full
-- PRIMARY KEY scan, per chunk:
--     Index Scan using lead_records_pkey
--       Rows Removed by Filter: 15,601
--       Buffers: shared hit=5,787 read=11,345     <- ~90MB from DISK, per chunk
--       Execution Time: 7,601 ms
--
-- THE ACTUAL FAILURE MODE WAS NOT CPU. The database was never CPU-bound — when it
-- was finally reachable there was no autovacuum, no long query, and one ordinary
-- PostgREST request. What died was CONNECTION SLOTS: each chunk pinned a
-- connection for 7.6 seconds of disk I/O, twelve workers at a time, window after
-- window for seven hours. GoTrue could not obtain a connection to check a
-- password, hit its 10s deadline, and 504'd — so the OWNER WAS LOCKED OUT OF THE
-- APP while the database sat nearly idle. A slow query does not have to burn CPU
-- to take down auth; it only has to hold a connection.
--
-- THE FIX: index the retag predicate's POSITIVE parts, with id last so the
-- existing retag cursor can page through it. The NOT-contains stays an in-memory
-- filter on the small cursor window — a negated GIN containment can never be
-- served by an index, so the answer is to make the set it filters tiny.
--     7,601 ms -> 397 ms, disk reads 11,345 -> 35.
--
-- Paired with this, in lead-push-ghl: worker CONCURRENCY is now derived from the
-- requested rate, because concurrency is a CONNECTION BUDGET, not just a speed
-- knob. A slow background job now also holds few connections.
create index if not exists lead_records_retag_idx
  on public.lead_records (batch_id, line_type, id)
  where status = 'pushed' and phone is not null;
comment on index public.lead_records_retag_idx is
  'Serves the retag/backfill drain (batch + line_type + cursor) while status=pushed. Without it a retag chunk fell back to a full PK scan — 7.6s and ~90MB of disk reads EACH — which pinned connection slots until GoTrue could not get one and the owner was locked out of the app. The NOT-contains on push_tags stays an in-memory filter: a negated GIN containment cannot be indexed, so the fix is to keep the set it filters small.';
