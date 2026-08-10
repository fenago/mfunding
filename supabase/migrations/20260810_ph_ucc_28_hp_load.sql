-- ph_ucc_leads: HotProspector direct-load bookkeeping.
--
-- The UCC "push" now loads leads DIRECTLY into HotProspector's dialer store via
-- the HP API (AddMultipleLeads) — the reliable direction — and lets HP's own
-- HP→GHL sync carry them up to GHL. (The old GHL→HP direction did not reliably
-- land leads in HP.) These columns make that load idempotent + auditable:
--   pushed_to_hp_at — set when the lead was submitted to HP's queue; the loader
--                     skips already-stamped leads so a re-push never re-queues a
--                     duplicate into HP.
--   hp_group_id     — the HP group the lead was loaded into (the per-batch group
--                     that an HP dialer campaign targets).
-- Both nullable; existing rows are untouched. `loaded_at` / `status='loaded'`
-- keep their meaning.
alter table public.ph_ucc_leads
  add column if not exists pushed_to_hp_at timestamptz,
  add column if not exists hp_group_id text;

comment on column public.ph_ucc_leads.pushed_to_hp_at is
  'When this lead was submitted to the HotProspector lead queue (AddMultipleLeads). Idempotency stamp — a re-push skips leads already stamped.';
comment on column public.ph_ucc_leads.hp_group_id is
  'HotProspector GroupId the lead was loaded into (the per-batch group an HP dialer campaign targets).';
