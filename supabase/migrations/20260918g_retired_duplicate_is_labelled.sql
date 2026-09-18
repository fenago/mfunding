-- A retired duplicate deal should say what it is, on the row.
--
-- THE PROBLEM IS NOT THE DUPLICATES — THEY ARE ALL ALREADY RETIRED.
-- 20260828_merge_duplicate_deal_pairs.sql merged six pairs by hand: the loser got
-- status 'dead', lost_reason 'duplicate', its ghl_opportunity_id cleared, and a
-- tombstone note naming the survivor. The create-path bug behind them was fixed
-- the same week (adoptOrphanDeal) and has not recurred in three weeks of 1-3
-- webhook-created deals a day.
--
-- What was never done is TELLING ANYONE. Nothing in the codebase filters or
-- labels lost_reason = 'duplicate', so a retired duplicate renders wherever a
-- dead deal renders — as an unexplained second row on a merchant — and the only
-- record of what happened to it is a free-text activity_log note nobody opens.
-- That is the most likely thing behind "I don't even understand how there can be
-- three totally different deals with the same company".
--
-- LABEL, DO NOT HIDE. Hiding is what produced the worst failure of the day:
-- ghl-docs-status' 20-document window hid 248 documents and rendered as "nothing
-- to sign" for 44 merchants. A confusing row you can read beats a tidy screen
-- that is lying. So: a column that names the survivor, backfilled from the
-- tombstones, and a UI line that turns the artifact into a sentence.

begin;

alter table public.deals
  add column if not exists duplicate_of_deal_id uuid references public.deals(id);

comment on column public.deals.duplicate_of_deal_id is
  'When this deal was retired as a duplicate, the deal it was merged INTO. '
  'Set together with status=dead + lost_reason=duplicate. NULL on a row marked '
  'duplicate without a known survivor — render that as "retired", never as '
  '"duplicate of" something we cannot name.';

create index if not exists deals_duplicate_of_idx
  on public.deals (duplicate_of_deal_id) where duplicate_of_deal_id is not null;

-- ── Backfill from the tombstones the merge migration left behind ─────────────
-- The notes read: 'merged into MF-2026-0255 — duplicate from playbook/GHL ...'.
-- Match the FIRST deal number in the note; a row with no such note stays NULL.
with tomb as (
  select
    a.entity_id as dead_deal_id,
    (regexp_match(a.content, 'merged into (MF-[0-9]{4}-[0-9]{4})'))[1] as survivor_number,
    row_number() over (partition by a.entity_id order by a.created_at desc) as rn
  from public.activity_log a
  where a.entity_type = 'deal'
    and a.content ~ 'merged into MF-[0-9]{4}-[0-9]{4}'
)
update public.deals d
   set duplicate_of_deal_id = s.id
  from tomb t
  join public.deals s on s.deal_number = t.survivor_number
 where t.rn = 1
   and d.id = t.dead_deal_id
   and d.lost_reason = 'duplicate'
   and d.duplicate_of_deal_id is null
   and s.id <> d.id;

-- A row can only be a duplicate OF something else, and only one hop deep.
-- (Belt and braces — the backfill above already excludes self-reference.)
alter table public.deals
  drop constraint if exists deals_duplicate_of_not_self;
alter table public.deals
  add constraint deals_duplicate_of_not_self
  check (duplicate_of_deal_id is null or duplicate_of_deal_id <> id);

commit;
