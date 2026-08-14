-- Split "a lead failed" from "our stamp didn't land".
--
-- The owner-visible errored counter conflated two very different things. On the
-- first real 85k push it read 12, and only ONE was a real failure:
--   * 1  GHL rejection  — "email must be an email" on a malformed address.
--   * 11 STAMP failures — the contact reached GHL fine, but our UPDATE didn't
--     land. Those rows stay status='loaded', so the drain re-selects and
--     re-pushes them, and the upsert matches the contact that already exists.
--     They self-heal; nothing was lost and nothing needed doing.
--
-- Counting the second kind as "errored" overstates real failures by an order of
-- magnitude and invites someone to go chasing eleven non-problems.
alter table public.lead_push_jobs
  add column if not exists stamp_retries integer not null default 0;
comment on column public.lead_push_jobs.stamp_retries is
  'Pushes that reached GHL but whose DB stamp failed. NOT failures: the row stays status=loaded, the drain re-pushes it, and the upsert matches the contact that already exists — they self-heal. Kept separate from `errored`, which counts real GHL rejections, so the owner-visible failure count means what it says.';
