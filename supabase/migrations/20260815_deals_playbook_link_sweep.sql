-- Every merchant with a deal should carry the Open Playbook link.
--
-- The push path stamps it at birth, so the purchased book is covered. Merchants
-- arriving any OTHER way were not: live transfers, the GHL webhook, mca-intake,
-- vcf-intake, bulk imports. Rodney McGuire came in tagged live-transfer/synergy,
-- had a deal, and his Open Playbook field was empty.
--
-- A cron over DEALS rather than a hook in each creation path: there are a dozen
-- ways a deal gets made and more will be added, and hooking every one is a
-- promise nobody keeps. Reading deals catches all of them, including the paths
-- that do not exist yet.
alter table public.deals add column if not exists playbook_link_at timestamptz;

comment on column public.deals.playbook_link_at is
  'When this deal''s GHL contact was last given its Playbook deep link. NULL = '
  'the sweep still owes it one. Bookkeeping only — the link itself lives on the '
  'GHL contact.';

-- The working set is the rows still TO DO, so the index shrinks to nothing in
-- the steady state.
create index if not exists deals_playbook_link_pending_idx
  on public.deals (id)
  where playbook_link_at is null and ghl_contact_id is not null;

-- The 176 contacts stamped by hand on 2026-08-15 are already done; recording
-- that stops the first sweep re-doing work GHL has already accepted.
update public.deals
   set playbook_link_at = now()
 where playbook_link_at is null and ghl_contact_id is not null;
