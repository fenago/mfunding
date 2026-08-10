-- PH UCC 27 — track the "Push to GHL/HP" load step.
--
-- ph-ucc-push-ghl upserts a filtered, skip-traced UCC lead into a GHL contact
-- (which HotProspector mirrors for dialing). We already carry ghl_contact_id and
-- loaded_at; add pushed_to_ghl_at as the explicit "last pushed" stamp so the push
-- is idempotent (re-push = update, not dupe) and the UI can show what's loaded.
--
-- Non-destructive, additive column only. No data backfill.

alter table public.ph_ucc_leads
  add column if not exists pushed_to_ghl_at timestamptz;

comment on column public.ph_ucc_leads.pushed_to_ghl_at is
  'When ph-ucc-push-ghl last upserted this lead into a GHL contact (HP mirrors GHL). NULL = never pushed. Re-push updates this stamp; ghl_contact_id holds the resolved contact.';

-- Partial index for the common "already pushed within this filter" count the UI
-- runs alongside the push summary.
create index if not exists ph_ucc_leads_pushed_idx
  on public.ph_ucc_leads (pushed_to_ghl_at)
  where pushed_to_ghl_at is not null;
