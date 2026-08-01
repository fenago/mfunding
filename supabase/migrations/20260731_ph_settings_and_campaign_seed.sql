-- PH setter operation — seed the settings row + the audit-separation campaign.
--
-- NAMING LAW: settings key ph_settings, campaign code PH-UCC-2026-001. Nothing here
-- touches MCA/VCF assets.
--
-- Both inserts are idempotent and NON-destructive: `on conflict do nothing` so that
-- re-running the migration never clobbers values a human has since filled into
-- ph_settings (the runbook fills packet_workflow_id / notify_workflow_id / setter_numbers).

-- 1) ph_settings — the human runbook fills the nulls (workflow ids, setter numbers).
insert into public.platform_settings (key, value)
values (
  'ph_settings',
  jsonb_build_object(
    'packet_workflow_id', null,                       -- PH 01 "send packet" GHL workflow (runbook step 2)
    'notify_workflow_id', null,                       -- PH setter/closer notification workflow
    'pipeline_id', 'ZTSCCAEt9wFI6rfdPsLD',            -- PH GHL pipeline
    'connect_field_id', 'OUlkd6rcVZ4ZrYTuPob4',       -- contact.ph_connect_bank_url custom field id
    'setter_numbers', '[]'::jsonb                     -- dialer/tracking numbers for the setter team
  )
)
on conflict (key) do nothing;

-- 2) Campaign for audit separation of PH-sourced deals.
--    partner is NOT NULL — this is an in-house outbound operation → 'House'.
--    status 'planned' (not live yet); budget/spent 0; empty-but-shaped checklist.
insert into public.campaigns (code, name, channel, status, partner, budget, spent, setup_checklist)
values (
  'PH-UCC-2026-001',
  'PH Setters — UCC Dialing',
  'outbound_dial',
  'planned',
  'House',
  0,
  0,
  jsonb_build_array(
    jsonb_build_object('key','ucc_list','done',false,'note','','label','Load / refresh the UCC-filing dialing list','value',null,'needs_value',false),
    jsonb_build_object('key','dialer','done',false,'note','','label','Provision the setter dialer + tracking numbers (record in ph_settings.setter_numbers)','value',null,'needs_value',true),
    jsonb_build_object('key','packet_workflow','done',false,'note','','label','Create the PH 01 packet workflow + set ph_settings.packet_workflow_id','value',null,'needs_value',true),
    jsonb_build_object('key','setter_script','done',false,'note','','label','Finalize the setter call script + application-on-call SLA','value',null,'needs_value',false)
  )
)
on conflict (code) where code is not null do nothing;  -- campaigns_code_key is a partial unique index
