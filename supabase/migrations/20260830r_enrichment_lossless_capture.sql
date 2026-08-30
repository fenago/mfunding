-- Enrichment lossless-capture wave — "save ALL enrichment outputs, nothing lost".
--
-- Field-gap analysis found four leaks:
--   • Apollo kept only email+title; its full company/industry/revenue/LinkedIn/phones
--     payload was DROPPED with no raw.
--   • Twilio / RealValidation dropped their raw + confidence / sub-status / extra fields.
--   • Skip-trace's litigator / DNC counts weren't queryable (only inside the raw blob).
--   • Enrichment that landed only on smart_list_members was lost on its ON DELETE CASCADE.
--
-- Fix = (a) lossless raw JSONB per provider, (b) typed filterable columns, (c) write-back
-- to the durable source record. All adds are `if not exists` — safe to re-run. No data
-- migration, no drops. The edge fns (ph-ucc-apollo-enrich / ph-ucc-skiptrace /
-- phone-validate) are updated in the same wave to populate every column below.

-- ── 1. smart_list_members — raw + typed enrichment capture ───────────────────────
-- The materialized membership is a copy; when a list is deleted its members cascade
-- away, so anything written ONLY here is lost. We now write to BOTH the durable
-- source row AND the member, so the member view stays rich while the source is the
-- system of record.
alter table public.smart_list_members
  -- lossless raw, one blob per provider ------------------------------------------
  add column if not exists skiptrace_raw        jsonb,
  add column if not exists apollo_raw           jsonb,
  add column if not exists phone_validation_raw jsonb,
  -- phone-validation typed (filterable) ------------------------------------------
  add column if not exists phone_status_raw     text,     -- RPV 'connected-75' / Twilio composite verdict
  add column if not exists phone_quality_score  numeric,  -- RPV confidence (parsed from 'connected-75'); Twilio null
  add column if not exists sms_pumping_risk      text,
  add column if not exists mcc                   text,
  add column if not exists mnc                   text,
  add column if not exists carrier_error_code    text,
  add column if not exists caller_name           text,
  add column if not exists national_format       text,
  -- skip-trace typed (filterable) ------------------------------------------------
  add column if not exists best_phone            text,
  add column if not exists best_phone_type       text,
  add column if not exists best_phone_dnc        boolean,
  add column if not exists tcpa_litigator        boolean,
  add column if not exists dnc_suppressed_count  int,
  add column if not exists best_email            text,
  add column if not exists person_name           text,
  add column if not exists phones                jsonb,
  add column if not exists emails                jsonb,
  -- apollo typed (filterable) ----------------------------------------------------
  add column if not exists business_email        text,
  add column if not exists owner_title           text,
  add column if not exists company               text,
  add column if not exists industry              text,
  add column if not exists employees             int,
  add column if not exists annual_revenue        numeric,
  add column if not exists linkedin_url          text,
  add column if not exists website               text,
  add column if not exists apollo_city           text,
  add column if not exists apollo_state          text,
  -- bookkeeping ------------------------------------------------------------------
  add column if not exists skiptraced_at         timestamptz,
  add column if not exists apollo_checked_at     timestamptz;

-- ── 2. ph_ucc_leads — Apollo full payload + queryable TCPA/DNC ───────────────────
-- Skip-trace raw already lives losslessly in ph_ucc_contacts.raw (not duplicated).
alter table public.ph_ucc_leads
  add column if not exists apollo_raw            jsonb,
  add column if not exists apollo_company        text,
  add column if not exists apollo_industry       text,
  add column if not exists apollo_employees      int,
  add column if not exists apollo_revenue        numeric,
  add column if not exists apollo_linkedin_url   text,
  add column if not exists apollo_website        text,
  add column if not exists tcpa_litigator        boolean,   -- person-level litigator OR dnc.tcpa
  add column if not exists dnc_suppressed_count  int;       -- # of DNC-suppressed numbers pulled

-- ── 3. lead_records — phone-validation + skip-trace/apollo raw + business contact ─
-- Already has line_type / extra_phones / extra_emails / revenue / employees / title /
-- company. Adds the phone-validation write-back target columns + the raw blobs.
alter table public.lead_records
  add column if not exists carrier              text,
  add column if not exists phone_reachable      boolean,
  add column if not exists phone_disconnected   boolean,
  add column if not exists phone_status_raw     text,
  add column if not exists phone_validated_at   timestamptz,
  add column if not exists skiptrace_raw        jsonb,
  add column if not exists apollo_raw           jsonb,
  add column if not exists business_email       text,
  add column if not exists owner_title          text;

-- ── 4. customers — phone-validation write-back + raw blobs ────────────────────────
-- Already has line_type / phone_status / phone_status_source / phone_checked_at /
-- additional_* / annual_revenue / employees / owner_title. Adds only what's missing.
alter table public.customers
  add column if not exists carrier              text,
  add column if not exists phone_reachable      boolean,
  add column if not exists phone_status_raw     text,
  add column if not exists skiptrace_raw        jsonb,
  add column if not exists apollo_raw           jsonb;
