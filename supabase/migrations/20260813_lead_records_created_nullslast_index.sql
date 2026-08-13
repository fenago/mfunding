-- LEAD MACHINE — the index the default lead-browser ordering actually needs.
--
-- Already applied directly to production during a live incident; this file
-- exists so the schema is tracked rather than only living on the server.
--
-- WHY A SECOND created_at INDEX. The browser orders by
--   created_at DESC NULLS LAST, id ASC
-- (PostgREST: `.order('created_at', {ascending:false, nullsFirst:false})`
-- then `.order('id')`). A plain `created_at DESC` index is NULLS FIRST, and
-- Postgres will NOT use it to satisfy a NULLS LAST ordering — the null
-- placement is part of the index's sort order, not an afterthought. So the
-- planner silently fell back to a sequential scan plus a full sort of ~250k
-- rows. Signed-in users carry statement_timeout=8s, so the page's DEFAULT view
-- died every single time: measured 11.6s (timeout) before, 5.7ms after.
--
-- The id column is included so the ordering is TOTAL. Ingest inserts in
-- windows, which leaves ~1000 rows sharing one created_at; without a unique
-- final key, OFFSET paging can repeat and skip rows between pages.
--
-- GENERAL RULE, learned the hard way: an ORDER BY with an explicit NULLS
-- placement needs an index declared with that same placement. If a new sort
-- option is added to the UI, check that its exact ordering has a matching
-- index — a near-miss index is not a partial win here, it is a seq scan.

create index if not exists lead_records_created_nullslast_id_idx
  on public.lead_records (created_at desc nulls last, id);

comment on index public.lead_records_created_nullslast_id_idx is
  'Serves the lead browser default ordering (created_at desc nulls last, id). A plain created_at DESC index is NULLS FIRST and cannot satisfy it, which cost a full seq scan + sort and blew the 8s statement timeout for every signed-in user.';
