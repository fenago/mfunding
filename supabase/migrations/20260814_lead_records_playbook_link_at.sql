-- playbook_link_at: which pushed leads already carry the Playbook deep link.
--
-- Stamping the remaining aged book needs a resumable, self-draining selection.
-- The obvious trick — invent a marker TAG and reuse push_tags_missing — would
-- work mechanically and is wrong in practice: push_tags is MIRRORED to GHL, so
-- 85,000 contacts in the owner's CRM would sprout a synthetic tag that means
-- nothing to a setter and clutters every tag picker forever. A column keeps the
-- bookkeeping on our side of the fence, is cheaper to index than a GIN
-- containment test, and doubles as the audit trail for which contacts have the
-- link.
alter table public.lead_records
  add column if not exists playbook_link_at timestamptz;

comment on column public.lead_records.playbook_link_at is
  'When this lead''s GHL contact was last sent its Revenue Playbook deep link '
  '(playbook_link custom field). NULL = not yet carrying the link.';

-- WORKING-SET INDEX. Same shape as lead_records_drain_idx: the predicate matches
-- the rows still TO DO, so the index SHRINKS as the pass completes instead of
-- degrading. Without it the drain scans lead_records_status_idx and filters,
-- which costs more the closer the pass gets to done (measured on the lt-landline
-- retag: 42 rows removed per 250 early, 2,427 near the end).
-- CONCURRENTLY: a plain build takes a SHARE lock and blocks every write to
-- lead_records for its duration, which would freeze a push mid-flight.
create index concurrently if not exists lead_records_playbook_link_pending_idx
  on public.lead_records (id)
  where playbook_link_at is null and status = 'pushed' and phone is not null;

-- NO MASS BACKFILL, DELIBERATELY. Rows pushed after lead-push-ghl started
-- sending the field already carry it, and the obvious move is to UPDATE them so
-- the column tells the whole truth. Measured first: 2,000 rows took 77 SECONDS.
-- This table is wide (a raw-CSV column) and carries two GIN indexes, so updates
-- rarely qualify for HOT and each one rewrites every index entry. Marking ~22k
-- rows would have meant ~14 minutes of write churn contending with a live push.
--
-- The same boundary costs nothing as a READ, so the backfill job passes
-- filters.pushed_before instead and the column is left to fill itself going
-- forward. (A first batch of 2,000 was already marked before the measurement;
-- harmless — those rows are correctly flagged.)
