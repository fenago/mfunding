-- 20260930a_reclassify_misfiled_live_transfers.sql
--
-- OWNER-APPROVED RECLASSIFICATION of the live-transfer book.
-- Owner ruling, 2026-09-29: "I don't consider that a live transfer. I consider
-- that an internal transfer." Approved for execution 2026-09-30.
--
-- deals.lead_source = 'live_transfer' held 100 rows. Three different things:
--
--   91  VENDOR LIVE TRANSFER — Synergy warm-transferred the merchant. 87 created
--       by live-transfer-intake (a `live-transfer:intake` activity row), plus 4
--       hand-logged by a closer while the vendor's email was in flight, each
--       corroborated by a `deduped` synergy_intake_log row naming the merchant.
--    3  VENDOR REAL-TIME, MISFILED — created by the intake function's REAL-TIME
--       path, then flipped to live_transfer afterwards. Corrupts BOTH products:
--       live transfer inflated by leads it never delivered, real-time deflated
--       by leads it did.
--    4  INTERNAL TRANSFER — our own setters' work, hand-logged by staff.
--    2  DUPLICATE PAIR MEMBERS — one vendor transfer captured twice.
--
-- lead_source is plain `text` with NO check constraint (verified against
-- pg_constraint on 2026-09-30), so 'internal_transfer' is writable as-is. No
-- enum to extend and no column widened. A constraint is deliberately NOT added
-- here: the column already holds eight distinct values across 424 deals and
-- pinning that vocabulary is a separate decision, not a side effect of a
-- back-fill.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- EVIDENCE, per deal. Five independent sources agreed:
--   (1) the `*:intake` / `*:dedupe` activity_log marker written at creation
--   (2) deals.lead_source_detail (a CREATION record — see the warning below)
--   (3) deals.created_by (NULL = the service-role intake function)
--   (4) synergy_intake_log, the per-email ledger (308 rows, 07-10 → 09-25)
--   (5) synergy_intake_log.notes, which names the classified kind per email
--
-- The vendor's own subject line is NOT evidence: all 306 Synergy emails are
-- subject-lined "Live Transfer!", 209 of which classify as real-time. The
-- sender account name is the only discriminator.
--
-- ⚠ lead_source_detail IS NOT UPDATED BY THIS MIGRATION, DELIBERATELY.
-- It is written once at creation and never maintained (MF-2026-0020 reads
-- lead_source 'realtime_appt' while its detail still says "Synergy live
-- transfer"). It is a record of what the intake believed on the day, not a
-- classification. Rewriting it to match would destroy the very evidence that
-- proved these three were misfiled. Any surface that reads lead_source_detail
-- as CURRENT truth is a separate defect — none is known today, and
-- `_origin_key_for_contact`, SOURCE_TABS, SpeedToLead and the campaign
-- attribution path all read lead_source, not the detail string.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- SIDE EFFECTS OF AN UPDATE ON deals — checked, all inert for these writes:
--   · trg_deals_auto_assign_closer      BEFORE INSERT only — does not re-fire.
--   · trg_deals_attribute_dial_campaign BEFORE INSERT only — campaign_id is untouched.
--   · trg_deals_stage_sync_to_ghl       AFTER UPDATE OF status — status unchanged.
--   · zz_deals_refuse_stage_retreat     BEFORE UPDATE OF status — status unchanged.
--   · trg_deals_merchant_notify         BEFORE UPDATE on all columns, but every
--     branch is gated on status or paydown_percentage changing. NO MERCHANT IS
--     MESSAGED by this migration.
--   · zz_deals_audit_lead_source        fires, by design — see below.

-- ── 1. Teach the audit trigger to carry a REASON ─────────────────────────────
-- Shipped yesterday (20260929a). It records old/new and the actor, but a
-- service-role correction like this one reads "a server-side process did it" —
-- indistinguishable, six months from now, from another blind flip. A
-- transaction-local reason fixes that for this back-fill and every future one.
-- Definition below is the catalog's (pg_get_functiondef, 2026-09-30) plus the
-- reason clause — not a rebuild from migration text.
create or replace function public.deals_audit_lead_source()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_actor  text;
  v_reason text := nullif(btrim(coalesce(current_setting('app.lead_source_reason', true), '')), '');
begin
  if v_uid is not null then
    select nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
      into v_actor
      from public.profiles p where p.id = v_uid;
  end if;

  insert into public.activity_log (
    entity_type, entity_id, interaction_type, subject, content,
    old_status, new_status, logged_by
  ) values (
    'deal', new.id, 'note', 'lead_source:changed',
    'Lead source changed from ' || coalesce(old.lead_source, '(none)')
      || ' to ' || coalesce(new.lead_source, '(none)')
      || ' by ' || coalesce(v_actor, v_uid::text, 'a server-side process (no auth.uid — intake function, cron or SQL)')
      || '. Lead source decides the auto-assign pool, whether a 5-minute first-call'
      || ' clock is owed, which Revenue Playbook script is truthful, and which campaign'
      || ' this deal''s cost is attributed to — so a change here moves the deal between'
      || ' products, not just between labels.'
      -- A stated reason means this was a decision. Its ABSENCE is equally
      -- informative: an unexplained flip is the thing we are trying to catch.
      || coalesce(E'\n\nREASON: ' || v_reason,
                  E'\n\nNo reason was recorded for this change. If it was not deliberate, that is the finding.'),
    old.lead_source, new.lead_source, v_uid
  );

  return null;
end;
$function$;

comment on function public.deals_audit_lead_source() is
  'Writes a lead_source:changed activity_log row (old/new in old_status/new_status, '
  'actor in logged_by) on every change to deals.lead_source, including the reason from '
  'the transaction-local GUC app.lead_source_reason when one is set. Deliberately NOT '
  'best-effort: if the audit cannot be written the change is rolled back, because an '
  'unaudited lead_source flip is the defect this exists to prevent.';

-- ── 2. internal_transfer is a REAL-TIME lead source ──────────────────────────
-- An internal transfer is a merchant on the phone, handed between our own
-- people. It owes no 5-minute callback clock and it belongs in the processor
-- pool, exactly like a vendor live transfer. Omitting it here would have
-- silently rerouted every future internal transfer to the normal pool and put a
-- pointless 5-minute timer on a merchant who is already talking to us.
create or replace function public.is_realtime_lead_source(p_lead_source text)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select coalesce(p_lead_source, '') in ('live_transfer', 'realtime_appt', 'internal_transfer');
$function$;

-- ── 3. The reclassification ──────────────────────────────────────────────────
begin;

-- 3a. Three VENDOR REAL-TIME leads misfiled as live transfers.
--
-- All three were created by the intake function's real-time path: a
-- `realtime:intake` activity row at t+0s, lead_source_detail "Synergy
-- real-time", created_by NULL, and a synergy_intake_log row whose notes read
-- "realtime". MF-2026-0051 and MF-2026-0087 were flipped weeks later by the
-- dedupe reclassification at live-transfer-intake/index.ts:1539 (27 and 17 days
-- after creation). MF-2026-0100 has no dedupe row at all; the only unaudited
-- writer with the access and the failure mode was the deal edit modal, whose
-- option list omitted realtime_appt and rendered the field blank (fixed in
-- fc551df).
--
-- All three still carry a first_call_due_at of creation + 5 minutes that
-- SpeedToLead.tsx has never been able to see, because that panel grades
-- lead_source = 'realtime_appt'. This restores them to the graded sample.
-- Their campaign_id already points at "Synergy Real Time transfers" — correct,
-- and untouched.
set local app.lead_source_reason =
  'CORRECTION, not a reclassification of the lead itself. Created by live-transfer-intake''s '
  'REAL-TIME path (realtime:intake at t+0s; lead_source_detail "Synergy real-time"; created_by '
  'NULL; synergy_intake_log notes "realtime"), then flipped to live_transfer afterwards — by the '
  'dedupe path at index.ts:1539 for MF-2026-0051 and MF-2026-0087, by an unaudited edit for '
  'MF-2026-0100. Restored to realtime_appt so the 5-minute first-call clock this deal has carried '
  'since July is finally graded by Speed to Lead. Owner-approved 2026-09-30. '
  'lead_source_detail is left as written — it is a creation record, not a classification.';

update public.deals set lead_source = 'realtime_appt'
 where deal_number in ('MF-2026-0051', 'MF-2026-0087', 'MF-2026-0100')
   and lead_source = 'live_transfer';   -- idempotent: re-running is a no-op

-- 3b. Four INTERNAL TRANSFERS — our own work, never purchased.
--
-- No synergy_intake_log row by customer_id OR by phone digits in the subject
-- line, against a ledger that covers 2026-07-10 → 09-25 continuously. Negative
-- evidence, confirmed two ways, not an absent lookup.
--   MF-2026-0280  13 WAVV dials 08-20 → 08-28 BEFORE the deal existed, the last
--                 a 286-second call dispositioned "Full App + Statements".
--   MF-2026-0281  campaign "PH Setters — UCC Dialing", no vendor trace.
--   MF-2026-0442  WAVV dial 09-28 16:16 before creation; the owner's example.
--   MF-2026-0086  no ledger row, no WAVV before creation, no vendor trace.
set local app.lead_source_reason =
  'Reclassified from live_transfer to internal_transfer per the owner''s ruling of 2026-09-29: '
  '"I don''t consider that a live transfer. I consider that an internal transfer." Our own setter '
  'handed this merchant to a closer; the vendor never delivered them. Confirmed by the absence of '
  'any synergy_intake_log row for this customer BOTH by customer_id and by phone digits, against a '
  'ledger with continuous coverage 2026-07-10 to 09-25. Counting these as vendor deliveries '
  'overstated the live-transfer book by 4 and understated every conversion rate quoted to Synergy. '
  'Owner-approved 2026-09-30.';

update public.deals set lead_source = 'internal_transfer'
 where deal_number in ('MF-2026-0086', 'MF-2026-0280', 'MF-2026-0281', 'MF-2026-0442')
   and lead_source = 'live_transfer';   -- idempotent

-- 3c. The duplicate pair — lead_source is NOT changed.
--
-- Two merchants each hold two deals for ONE vendor live transfer: a closer
-- typed the transfer by hand, and minutes later the vendor's email failed to
-- dedupe onto it (wrong phone / different format) and minted a second deal.
--
--   Nothing But Waste          MF-2026-0033 (human, nurture)  ↔ MF-2026-0034 (intake, dead)
--   BRB / PRB Environmental    MF-2026-0032 (human, dead)     ↔ MF-2026-0036 (intake, nurture)
--
-- Both rows in each pair ARE live transfers, so changing lead_source would be
-- false. The duplication is expressed with the purpose-built columns instead —
-- the same convention 20260828_merge_duplicate_deal_pairs.sql used, and the same
-- one MF-2026-0034 already carries (duplicate_of_deal_id -> MF-2026-0033,
-- lost_reason 'duplicate').
--
-- MF-2026-0033 is deliberately NOT touched: it is the SURVIVOR of its pair
-- (status 'nurture', actively worked) and its dead twin 0034 is already flagged.
-- Only MF-2026-0032 is missing the flag its own notes already assert in prose
-- ("[DUPLICATE of MF-2026-0036 ... wrong business name (B for P), wrong phone").
--
-- This is what turns the corrected denominator from a number asserted in a
-- message into one anybody can query:
--   select count(*) from deals
--    where lead_source = 'live_transfer' and duplicate_of_deal_id is null;  -- 91
update public.deals d
   set duplicate_of_deal_id = (select id from public.deals x where x.deal_number = 'MF-2026-0036'),
       lost_reason = 'duplicate'
 where d.deal_number = 'MF-2026-0032'
   and d.duplicate_of_deal_id is null;   -- idempotent

commit;
