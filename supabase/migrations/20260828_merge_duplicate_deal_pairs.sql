-- 20260828_merge_duplicate_deal_pairs.sql
--
-- ONE-OFF DATA FIX (already applied to ehibjeonqpqskhcvizow on 2026-08-28).
-- No schema change — recorded here so the mutation is auditable alongside the
-- migration history. Re-running is a no-op (every WHERE targets a specific id
-- whose state has already moved).
--
-- WHAT HAPPENED
-- Five merchants ended up with TWO deals each. A setter opened the Revenue
-- Playbook (playbook-open-contact minted the deal directly in Supabase with
-- ghl_opportunity_id NULL), then the GHL opportunity advanced past New Lead and
-- ghl-webhook's Gap-A auto-create — which matches ONLY on ghl_opportunity_id —
-- found no linked deal and minted a second, mirror deal (created_by NULL,
-- lead_source 'ghl_other', owner picked by round-robin instead of the real
-- setter). The setter's row then stopped receiving GHL stage moves entirely.
--
-- SIGNATURE (verified on all 5 before touching anything)
--   SETTER  (survives): created_by = a real profile, ghl_opportunity_id NULL,
--                       lead_source 'ucc_list', correct human owner
--   MIRROR  (retired):  created_by NULL, ghl_opportunity_id SET,
--                       lead_source 'ghl_other', round-robin owner
--   Both rows shared one customer_id and one ghl_contact_id. No mirror was
--   funded or otherwise terminal. No commissions row referenced any mirror.
--
-- MERGE RULE
--   1. Survivor adopts the mirror's ghl_opportunity_id, so future GHL stage
--      moves land on the row the setter is actually working.
--   2. Survivor's status = the FURTHER of the two (only pair 5 moved:
--      new -> docs_collected). deals_stamp_stage_timestamps backfills the
--      lower rungs; docs_collected_at was carried from the mirror explicitly.
--   3. Child records re-pointed to the survivor: activity_log (entity_type
--      'deal'), ghl_call_log, ghl_email_doc_log, lead_score_events.
--   4. Owner + lead_source stay the SETTER's. Round-robin owner discarded.
--   5. Mirror retired SOFT: status 'dead', lost_reason 'duplicate',
--      ghl_opportunity_id CLEARED (ghl-webhook resolves the opportunity with
--      .maybeSingle() — leaving the id on both rows would make every stage
--      move for that opportunity error out), plus a 'deal:merged' note.
--      NEVER hard-deleted.
--
-- Each pair ran as ONE data-modifying-CTE statement so the opportunity id is
-- never visible on two rows at once, even to a webhook firing mid-merge.
--
-- closed_reason was deliberately left NULL: CLOSE_REASONS in
-- src/pages/admin/PlaybooksPage.tsx has no 'duplicate' option, and an unknown
-- value would pollute the Campaign Audit close-reason tallies. The machine-
-- readable marker is deals.lost_reason = 'duplicate'.
--
--  pair | survivor      | owner              | final status   | retired
--  -----+---------------+--------------------+----------------+---------------
--   1   | MF-2026-0226  | Carlos Marquez     | application_sent | MF-2026-0228
--   2   | MF-2026-0236  | Catherine Zaragosa | contacted        | MF-2026-0237
--   3   | MF-2026-0255  | Catherine Zaragosa | application_sent | MF-2026-0256
--   4   | MF-2026-0267  | Catherine Zaragosa | qualifying       | MF-2026-0268
--   5   | MF-2026-0272  | Paola Taruc        | docs_collected   | MF-2026-0273

-- ── Pair 1 — Shoup Wood Works — keep MF-2026-0226, retire MF-2026-0228 ──
with mirror_clear as (
  update deals set ghl_opportunity_id = null, status = 'dead', lost_reason = 'duplicate',
    closed_note = 'Merged into MF-2026-0226 (duplicate mirror deal). Retired 2026-08-28.',
    updated_at = now()
  where id = '4eae013a-846f-4f87-94a1-162afcb603fb' returning id),
setter_set as (
  update deals set ghl_opportunity_id = '77OOR0MAFxfV6dGROjK2', updated_at = now()
  where id = '8c405df2-09f6-4f67-ae4a-252eab40ea78' returning id),
mv_act as (
  update activity_log set entity_id = '8c405df2-09f6-4f67-ae4a-252eab40ea78'
  where entity_type = 'deal' and entity_id = '4eae013a-846f-4f87-94a1-162afcb603fb' returning id),
mv_call as (
  update ghl_call_log set deal_id = '8c405df2-09f6-4f67-ae4a-252eab40ea78'
  where deal_id = '4eae013a-846f-4f87-94a1-162afcb603fb' returning ghl_message_id),
mv_score as (
  update lead_score_events set deal_id = '8c405df2-09f6-4f67-ae4a-252eab40ea78'
  where deal_id = '4eae013a-846f-4f87-94a1-162afcb603fb' returning id),
note_dead as (
  insert into activity_log (entity_type, entity_id, interaction_type, subject, content)
  values ('deal','4eae013a-846f-4f87-94a1-162afcb603fb','note','deal:merged',
    'merged into MF-2026-0226 — duplicate from playbook/GHL opp-id gap. GHL opportunity 77OOR0MAFxfV6dGROjK2 re-pointed to MF-2026-0226; this row retired (status dead, lost_reason duplicate).')
  returning id),
note_live as (
  insert into activity_log (entity_type, entity_id, interaction_type, subject, content)
  values ('deal','8c405df2-09f6-4f67-ae4a-252eab40ea78','note','deal:merged',
    'absorbed duplicate MF-2026-0228 — adopted GHL opportunity 77OOR0MAFxfV6dGROjK2; activity/calls/score events re-pointed here. Status kept at application_sent (further than the mirror''s qualifying).')
  returning id)
select (select count(*) from mirror_clear) mirror_updated,
       (select count(*) from setter_set) setter_updated,
       (select count(*) from mv_act) activity_moved,      -- 4
       (select count(*) from mv_call) calls_moved,        -- 2
       (select count(*) from mv_score) score_moved,       -- 1
       (select count(*) from note_dead) + (select count(*) from note_live) notes_added;

-- ── Pair 2 — PISCANNO LOGISTICS LLC — keep MF-2026-0236, retire MF-2026-0237 ──
with mirror_clear as (
  update deals set ghl_opportunity_id = null, status = 'dead', lost_reason = 'duplicate',
    closed_note = 'Merged into MF-2026-0236 (duplicate mirror deal). Retired 2026-08-28.',
    updated_at = now()
  where id = '3179a98d-f8d8-4dcc-b1d7-de9a9d6960d7' returning id),
setter_set as (
  update deals set ghl_opportunity_id = 'OgqoapzGXeHZh1BJAmtd', updated_at = now()
  where id = 'edb3dde9-fd69-465a-9552-c336e677251c' returning id),
mv_act as (
  update activity_log set entity_id = 'edb3dde9-fd69-465a-9552-c336e677251c'
  where entity_type = 'deal' and entity_id = '3179a98d-f8d8-4dcc-b1d7-de9a9d6960d7' returning id),
mv_score as (
  update lead_score_events set deal_id = 'edb3dde9-fd69-465a-9552-c336e677251c'
  where deal_id = '3179a98d-f8d8-4dcc-b1d7-de9a9d6960d7' returning id),
note_dead as (
  insert into activity_log (entity_type, entity_id, interaction_type, subject, content)
  values ('deal','3179a98d-f8d8-4dcc-b1d7-de9a9d6960d7','note','deal:merged',
    'merged into MF-2026-0236 — duplicate from playbook/GHL opp-id gap. GHL opportunity OgqoapzGXeHZh1BJAmtd re-pointed to MF-2026-0236; this row retired (status dead, lost_reason duplicate).')
  returning id),
note_live as (
  insert into activity_log (entity_type, entity_id, interaction_type, subject, content)
  values ('deal','edb3dde9-fd69-465a-9552-c336e677251c','note','deal:merged',
    'absorbed duplicate MF-2026-0237 — adopted GHL opportunity OgqoapzGXeHZh1BJAmtd; activity/score events re-pointed here. Status stays contacted (both rows were at contacted). Owner stays Catherine Zaragosa (mirror had round-robined to E!).')
  returning id)
select (select count(*) from mirror_clear) m, (select count(*) from setter_set) s,
       (select count(*) from mv_act) act,      -- 7
       (select count(*) from mv_score) sc,     -- 2
       (select count(*) from note_dead) + (select count(*) from note_live) notes;

-- ── Pair 3 — ANDRADE'S STONE INC — keep MF-2026-0255, retire MF-2026-0256 ──
with mirror_clear as (
  update deals set ghl_opportunity_id = null, status = 'dead', lost_reason = 'duplicate',
    closed_note = 'Merged into MF-2026-0255 (duplicate mirror deal). Retired 2026-08-28.',
    updated_at = now()
  where id = 'd457084f-a0db-42c5-806f-9a3d5a759aba' returning id),
setter_set as (
  update deals set ghl_opportunity_id = 'LH0dNdK54OXFOJrfbFbh', updated_at = now()
  where id = 'c1d0a38a-5f31-4733-a952-523ff3dc9383' returning id),
mv_act as (
  update activity_log set entity_id = 'c1d0a38a-5f31-4733-a952-523ff3dc9383'
  where entity_type = 'deal' and entity_id = 'd457084f-a0db-42c5-806f-9a3d5a759aba' returning id),
mv_score as (
  update lead_score_events set deal_id = 'c1d0a38a-5f31-4733-a952-523ff3dc9383'
  where deal_id = 'd457084f-a0db-42c5-806f-9a3d5a759aba' returning id),
note_dead as (
  insert into activity_log (entity_type, entity_id, interaction_type, subject, content)
  values ('deal','d457084f-a0db-42c5-806f-9a3d5a759aba','note','deal:merged',
    'merged into MF-2026-0255 — duplicate from playbook/GHL opp-id gap. GHL opportunity LH0dNdK54OXFOJrfbFbh re-pointed to MF-2026-0255; this row retired (status dead, lost_reason duplicate).')
  returning id),
note_live as (
  insert into activity_log (entity_type, entity_id, interaction_type, subject, content)
  values ('deal','c1d0a38a-5f31-4733-a952-523ff3dc9383','note','deal:merged',
    'absorbed duplicate MF-2026-0256 — adopted GHL opportunity LH0dNdK54OXFOJrfbFbh; activity/score events re-pointed here. Status stays application_sent (both rows were at application_sent). Owner stays Catherine Zaragosa (mirror had round-robined to E!).')
  returning id)
select (select count(*) from mirror_clear) m, (select count(*) from setter_set) s,
       (select count(*) from mv_act) act,      -- 2
       (select count(*) from mv_score) sc,     -- 1
       (select count(*) from note_dead) + (select count(*) from note_live) notes;

-- ── Pair 4 — Larry Graves — keep MF-2026-0267, retire MF-2026-0268 ──
with mirror_clear as (
  update deals set ghl_opportunity_id = null, status = 'dead', lost_reason = 'duplicate',
    closed_note = 'Merged into MF-2026-0267 (duplicate mirror deal). Retired 2026-08-28.',
    updated_at = now()
  where id = 'b4759101-d3cb-4d13-9788-19238c91a9fa' returning id),
setter_set as (
  update deals set ghl_opportunity_id = 'mXgh41RNGKroG25qMvoC', updated_at = now()
  where id = 'a5c76e1a-50cc-4085-9130-332583c5fa10' returning id),
mv_act as (
  update activity_log set entity_id = 'a5c76e1a-50cc-4085-9130-332583c5fa10'
  where entity_type = 'deal' and entity_id = 'b4759101-d3cb-4d13-9788-19238c91a9fa' returning id),
mv_score as (
  update lead_score_events set deal_id = 'a5c76e1a-50cc-4085-9130-332583c5fa10'
  where deal_id = 'b4759101-d3cb-4d13-9788-19238c91a9fa' returning id),
mv_email as (
  update ghl_email_doc_log set deal_id = 'a5c76e1a-50cc-4085-9130-332583c5fa10'
  where deal_id = 'b4759101-d3cb-4d13-9788-19238c91a9fa' returning ghl_email_message_id),
note_dead as (
  insert into activity_log (entity_type, entity_id, interaction_type, subject, content)
  values ('deal','b4759101-d3cb-4d13-9788-19238c91a9fa','note','deal:merged',
    'merged into MF-2026-0267 — duplicate from playbook/GHL opp-id gap. GHL opportunity mXgh41RNGKroG25qMvoC re-pointed to MF-2026-0267; this row retired (status dead, lost_reason duplicate).')
  returning id),
note_live as (
  insert into activity_log (entity_type, entity_id, interaction_type, subject, content)
  values ('deal','a5c76e1a-50cc-4085-9130-332583c5fa10','note','deal:merged',
    'absorbed duplicate MF-2026-0268 — adopted GHL opportunity mXgh41RNGKroG25qMvoC; activity/score/email-doc records re-pointed here. Status kept at qualifying (further than the mirror''s contacted). Owner stays Catherine Zaragosa (mirror had round-robined to Paola Taruc).')
  returning id)
select (select count(*) from mirror_clear) m, (select count(*) from setter_set) s,
       (select count(*) from mv_act) act,      -- 2
       (select count(*) from mv_score) sc,     -- 1
       (select count(*) from mv_email) em,     -- 1
       (select count(*) from note_dead) + (select count(*) from note_live) notes;

-- ── Pair 5 — United Resource Systems — keep MF-2026-0272, retire MF-2026-0273 ──
-- The only pair where the survivor advances: new -> docs_collected. GHL's stage
-- is the source of truth for progress, and the mirror had been mirrored straight
-- to docs_collected at creation. docs_collected_at is carried from the mirror;
-- the BEFORE trigger deals_stamp_stage_timestamps fills contacted_at /
-- qualified_at / application_sent_at using that value as its ceiling.
-- Side effects checked before running:
--   * trg_seed_rail2_doc_requests fires only on 'application_sent' — not hit.
--   * trg_deals_merchant_notify -> notify_merchant is in-app only (inserts into
--     messages) and no-ops when customers.user_id is NULL, which it is here.
--     Nothing was sent to the merchant.
with mirror_clear as (
  update deals set ghl_opportunity_id = null, status = 'dead', lost_reason = 'duplicate',
    closed_note = 'Merged into MF-2026-0272 (duplicate mirror deal). Retired 2026-08-28.',
    updated_at = now()
  where id = '93a50963-fa93-4dd9-aa64-e3e0d5d3e5f3' returning id),
setter_set as (
  update deals set ghl_opportunity_id = 'IzEtFwp9vHd1nDHianOb',
    status = 'docs_collected',
    docs_collected_at = '2026-08-28 14:29:36.359+00',
    updated_at = now()
  where id = 'f74388e7-fbb1-477e-822a-dbde578058b0' returning id),
mv_act as (
  update activity_log set entity_id = 'f74388e7-fbb1-477e-822a-dbde578058b0'
  where entity_type = 'deal' and entity_id = '93a50963-fa93-4dd9-aa64-e3e0d5d3e5f3' returning id),
note_dead as (
  insert into activity_log (entity_type, entity_id, interaction_type, subject, content)
  values ('deal','93a50963-fa93-4dd9-aa64-e3e0d5d3e5f3','note','deal:merged',
    'merged into MF-2026-0272 — duplicate from playbook/GHL opp-id gap. GHL opportunity IzEtFwp9vHd1nDHianOb re-pointed to MF-2026-0272; this row retired (status dead, lost_reason duplicate).')
  returning id),
note_live as (
  insert into activity_log (entity_type, entity_id, interaction_type, subject, content)
  values ('deal','f74388e7-fbb1-477e-822a-dbde578058b0','note','deal:merged',
    'absorbed duplicate MF-2026-0273 — adopted GHL opportunity IzEtFwp9vHd1nDHianOb and advanced new -> docs_collected (GHL stage is source of truth); docs_collected_at carried from the mirror, earlier stage stamps backfilled by deals_stamp_stage_timestamps. Activity re-pointed here. Owner stays Paola Taruc (mirror had round-robined to Carlos Marquez).')
  returning id)
select (select count(*) from mirror_clear) m, (select count(*) from setter_set) s,
       (select count(*) from mv_act) act,      -- 2
       (select count(*) from note_dead) + (select count(*) from note_live) notes;


-- ── VERIFICATION (all passed 2026-08-28) ────────────────────────────────────
-- Each affected customer has exactly 1 non-terminal MCA deal, and it carries
-- the opportunity id:
--   select c.business_name,
--          count(*) filter (where d.status not in ('dead','declined','nurture')) as active,
--          count(*) filter (where d.status not in ('dead','declined','nurture')
--                             and d.ghl_opportunity_id is not null)              as active_with_opp
--     from deals d join customers c on c.id = d.customer_id
--    where d.customer_id in ('7684d249-8f3a-4254-86a6-153f6ddb335f',
--                            '6e51d37f-5f60-4fea-ac59-976aeb4e6c77',
--                            'f6c02897-84a9-4921-9aeb-15b80593da16',
--                            '1506b0e7-4c55-46a3-914e-05733f98a06c',
--                            '6555539a-cc75-407a-a2f9-5560811e858b')
--    group by 1;                       -- => 1 / 1 for all five
--
-- Zero child records left on any retired mirror (checked across every table
-- with a deals FK: activity_log, ghl_call_log, ghl_email_doc_log,
-- lead_score_events, deal_doc_requests, mca_applications, commissions,
-- business_enrichment, call_audit_calls, deal_submissions, funder_replies,
-- merchant_documents) apart from the intentional 'deal:merged' tombstone note.
-- All five mirrors have ghl_opportunity_id IS NULL.


-- ── NOT TOUCHED — needs an owner decision ───────────────────────────────────
-- A SIXTH duplicate of the same class exists and is actively broken:
--   customer a90524b1-af9a-4432-aa85-92a6a9541eb3 "Nothing But Waste"
--   MF-2026-0033 (application_sent, live_transfer, created_by Carlos Marquez, owner E!)
--   MF-2026-0242 (application_sent, ghl_other,     created_by NULL,           owner Carlos Marquez)
--   MF-2026-0034 (dead)
-- All THREE carry the SAME ghl_opportunity_id 'bVn0qtZMfDvYnROOrc4A'. Because
-- ghl-webhook resolves the deal with
--   .eq('ghl_opportunity_id', oppId).maybeSingle()
-- a multi-row match makes that call fail, so every GHL stage move for this
-- opportunity is currently being dropped. Out of scope for this pass (the
-- survivor is a live_transfer deal, not the playbook signature) — flagged for
-- explicit go-ahead.  >>> RESOLVED BELOW (pair 6), authorized by the owner.
--
-- ROOT CAUSE, still unfixed: playbook-open-contact mints a deal without an
-- ghl_opportunity_id, and ghl-webhook's Gap-A create matches on that column
-- alone. Until Gap-A also looks up an existing unlinked deal by
-- ghl_contact_id + deal_type (and adopts it instead of inserting), this class
-- of duplicate will keep reappearing.


-- ════════════════════════════════════════════════════════════════════════════
-- PAIR 6 — "Nothing But Waste" — applied 2026-08-28, owner-authorized.
-- Survivor MF-2026-0033. This one is NOT the same shape as pairs 1-5; read
-- the analysis before assuming it was.
--
-- WHAT WAS ACTUALLY WRONG
-- THREE deal rows carried the same ghl_opportunity_id 'bVn0qtZMfDvYnROOrc4A':
--   MF-2026-0033  application_sent  live_transfer  created_by Carlos Marquez
--                 customer a90524b1 "Nothing But Waste"        owner E!
--   MF-2026-0242  application_sent  ghl_other      created_by NULL
--                 customer a90524b1 "Nothing But Waste"        owner Carlos (round-robin)
--   MF-2026-0034  dead              live_transfer  created_by NULL
--                 customer f952e666 "Nothin' But Waste"        owner Carlos (round-robin)
-- Because ghl-webhook does .eq('ghl_opportunity_id', oppId).maybeSingle(), a
-- three-row match ERRORED on every event, so this merchant's GHL stage moves
-- had been silently dropped since 2026-08-20.
--
-- TWO FINDINGS THAT CHANGED THE PLAN (neither was visible in the first pass)
--  1. MF-2026-0034 sits on a DIFFERENT customer row (f952e666) than 0033/0242.
--     Both customer rows share ghl_contact_id lX1bVpV2ilYESkQx9yzH and the same
--     human (Shontea Jones Taylor, same phone; business name and email differ by
--     one letter). So this is a duplicate CUSTOMER, not just a duplicate deal.
--  2. MF-2026-0034 had ALREADY been merged into 0033 on 2026-07-14 — its
--     activity_log still carries the original "duplicate merged" note ("same
--     merchant, phone stored with/without +1. Call ledger and telemetry moved").
--     That merge simply never cleared the opportunity id. 0034 was residue.
--
-- WHAT WAS DONE
--   MF-2026-0242 — full merge, identical to pairs 1-5: opp id cleared, status
--     'dead', lost_reason 'duplicate', closed_note + tombstone naming 0033, and
--     its 2 activity_log rows + 1 lead_score_event re-pointed onto 0033. Same
--     customer, so the re-point is clean.
--   MF-2026-0034 — already 'dead'; left dead. Stale opp id cleared,
--     lost_reason 'duplicate' and a tombstone note added.
--
-- WHAT WAS DELIBERATELY *NOT* DONE, AND WHY
--   0034's child records were NOT re-pointed onto 0033. The brief said to move
--   them; that instruction predated finding #1 above. Moving them would have
--   caused real damage:
--     * 0034's 4 deal_doc_requests are an EXACT duplicate of 0033's 4 (same
--       doc_types, same labels) — the survivor would end up with 8 checklist
--       items, 4 of them phantom duplicates.
--     * deal_doc_requests and synergy_intake_log both carry their own
--       customer_id, still pointing at f952e666. Re-pointing only deal_id would
--       leave rows whose deal belongs to customer A while customer_id says B.
--   Left in place on 0034 (soft-retired, NOT orphaned): 4 activity_log,
--   4 deal_doc_requests, 7 lead_score_events, 1 lead_intake_claims,
--   1 synergy_intake_log. Nothing was deleted. The webhook fix did not depend
--   on moving them — clearing the opp id was sufficient.
--
-- OWNER — kept as E! on MF-2026-0033, per the "if ambiguous, keep current" rule.
--   The evidence genuinely cuts both ways: created_by is Carlos Marquez, but
--   0033's own activity_log says "Auto-assigned to Ernesto Lee (round-robin)"
--   AND the only outbound calls on the deal were placed by E!. created_by is a
--   weak signal here (Carlos is stamped on just 7 of 75 live_transfer deals).
--   Status left at application_sent — no status change, so no trigger fired and
--   no merchant notification was possible.

with retire_0242 as (
  update deals set ghl_opportunity_id = null, status = 'dead', lost_reason = 'duplicate',
    closed_note = 'Merged into MF-2026-0033 (duplicate mirror deal). Retired 2026-08-28.',
    updated_at = now()
  where id = '09c2e1f1-d3ad-45f7-8507-3cd62f8f1a88' returning id),
clear_0034 as (
  update deals set ghl_opportunity_id = null, lost_reason = 'duplicate',
    closed_note = 'Duplicate of MF-2026-0033; merged 2026-07-14. Stale ghl_opportunity_id cleared 2026-08-28.',
    updated_at = now()
  where id = '09337fba-62da-473b-9fa5-89dafcfb44ac' returning id, status),
mv_act as (
  update activity_log set entity_id = 'be81ff5d-28ae-4c09-b2f2-a7b6139aa1bd'
  where entity_type = 'deal' and entity_id = '09c2e1f1-d3ad-45f7-8507-3cd62f8f1a88' returning id),
mv_score as (
  update lead_score_events set deal_id = 'be81ff5d-28ae-4c09-b2f2-a7b6139aa1bd'
  where deal_id = '09c2e1f1-d3ad-45f7-8507-3cd62f8f1a88' returning id),
note_0242 as (
  insert into activity_log (entity_type, entity_id, interaction_type, subject, content)
  values ('deal','09c2e1f1-d3ad-45f7-8507-3cd62f8f1a88','note','deal:merged',
    'merged into MF-2026-0033 — duplicate from playbook/GHL opp-id gap. GHL opportunity bVn0qtZMfDvYnROOrc4A now lives only on MF-2026-0033; this row retired (status dead, lost_reason duplicate).')
  returning id),
note_0034 as (
  insert into activity_log (entity_type, entity_id, interaction_type, subject, content)
  values ('deal','09337fba-62da-473b-9fa5-89dafcfb44ac','note','deal:merged',
    'merged into MF-2026-0033 — confirmed still retired. This row was already merged 2026-07-14 but kept a stale ghl_opportunity_id, which made the opportunity match THREE deal rows and broke ghl-webhook''s .maybeSingle() lookup. Opp id cleared 2026-08-28. Child records deliberately NOT re-pointed — see the merge note on MF-2026-0033.')
  returning id),
note_live as (
  insert into activity_log (entity_type, entity_id, interaction_type, subject, content)
  values ('deal','be81ff5d-28ae-4c09-b2f2-a7b6139aa1bd','note','deal:merged',
    'absorbed duplicate MF-2026-0242 and reclaimed sole ownership of GHL opportunity bVn0qtZMfDvYnROOrc4A. MF-2026-0034 was stripped of the stale opp id but its child records were LEFT IN PLACE on purpose (second customer row + duplicate doc-request set). Owner kept as E!. Status unchanged at application_sent.')
  returning id)
select (select count(*) from retire_0242) retired_0242,     -- 1
       (select count(*) from clear_0034) cleared_0034,       -- 1
       (select status from clear_0034) status_0034,          -- 'dead'
       (select count(*) from mv_act) activity_moved,         -- 2
       (select count(*) from mv_score) score_moved,          -- 1
       (select count(*) from note_0242) + (select count(*) from note_0034)
         + (select count(*) from note_live) notes_added;     -- 3

-- ── PAIR 6 VERIFICATION (all passed 2026-08-28) ─────────────────────────────
--   * MF-2026-0033: application_sent, owner E!, opp bVn0qtZMfDvYnROOrc4A.
--   * MF-2026-0242: dead, lost_reason duplicate, opp NULL.
--   * MF-2026-0034: dead, lost_reason duplicate, opp NULL.
--   * ZERO deal rows in the ENTIRE table now share a ghl_opportunity_id:
--       select ghl_opportunity_id from deals where ghl_opportunity_id is not null
--        group by 1 having count(*) > 1;            -- => 0 rows
--   * Customer a90524b1 has exactly 1 non-terminal MCA deal and it carries the
--     opp id (MF-2026-0033 = bVn0qtZMfDvYnROOrc4A).
--   * Zero child rows left on MF-2026-0242 across every deals-FK table plus
--     activity_log, apart from its 'deal:merged' tombstone.
--   * Survivor MF-2026-0033 still has exactly 4 deal_doc_requests (not 8) —
--     confirming 0034's duplicate checklist was correctly left alone.

-- ── STILL OPEN AFTER PAIR 6 ─────────────────────────────────────────────────
-- DUPLICATE CUSTOMER, not fixed (needs an owner decision — customer-level merge
-- was outside the authorized scope):
--   a90524b1-af9a-4432-aa85-92a6a9541eb3  "Nothing But Waste"  user_id NULL
--   f952e666-06ed-4b5d-a0d7-3fa3f7bd73d2  "Nothin' But Waste"  user_id 7c31d3a5-…
-- Same person, same phone, same ghl_contact_id. The merchant's PORTAL LOGIN is
-- attached to the SECOND row — the one holding only the dead MF-2026-0034 — so
-- if this merchant signs in to the portal today they will not see the live deal
-- MF-2026-0033. Merging the customers (and moving user_id onto the survivor) is
-- the fix; it was not authorized here.
--   >>> RESOLVED BELOW (customer merge), authorized by the owner.


-- ════════════════════════════════════════════════════════════════════════════
-- CUSTOMER MERGE — "Nothing But Waste" — applied 2026-08-28, owner-authorized.
-- Survivor customer a90524b1 (holds live MF-2026-0033).
-- Retired  customer f952e666 (held only the dead MF-2026-0034).
--
-- GOAL: the merchant's portal login was attached to the WRONG customer row, so
-- signing in showed her only a dead deal. Moving user_id onto the survivor makes
-- the live deal visible — the portal scopes deals through
--   get_my_portal_deals() → where d.customer_id in
--     (select c.id from customers c where c.user_id = auth.uid())
--
-- WHAT WAS DONE
--   1. Portal login user_id 7c31d3a5-… moved a90524b1 ← f952e666.
--      The `and user_id is null` predicate on the survivor's UPDATE IS the
--      collision guard: if the survivor had already had a login the update
--      would touch 0 rows and the assert in the final SELECT aborts the whole
--      statement. (customers.user_id has only a plain index, no UNIQUE, and an
--      FK to auth.users ON DELETE SET NULL — so nothing enforces this for us.)
--   2. 5 `messages` rows (her portal notifications) re-pointed to the survivor.
--      The inbox itself keys on to_user_id, so this is for admin-side coherence.
--   3. f952e666.ghl_contact_id CLEARED. This was not cosmetic: FOUR call sites
--      resolve a customer with `.eq("ghl_contact_id", …).maybeSingle()` and NO
--      .limit(1) — set-contact-dnd:121, _shared/application-fields.ts:633,
--      ghl-email-open-sweep:170, ph-send-packet:118 — every one of which ERRORS
--      on a two-row match. Same failure class as the triple opportunity id.
--      (ghl-webhook:862 and :1116 were already safe: .order(created_at).limit(1).)
--   4. f952e666 soft-retired: do_not_contact = true + reason, tag
--      'merged-duplicate', a full merge record in notes, and a 'customer:merged'
--      activity_log tombstone naming the survivor. NEVER hard-deleted.
--      (customer_status enum has no 'merged'/'dead' value and 'declined' would
--      have polluted funnel counts, so retirement is expressed via the DNC flag
--      + tag rather than by corrupting the status.)
--
-- DEVIATION FROM THE BRIEF — deliberate, and the brief's own goal required it.
-- The instruction was to move MF-2026-0034 and its child rows onto the survivor
-- while keeping 0034's 4 duplicate deal_doc_requests attached to 0034, "just
-- make their customer_id consistent with wherever the deal lands". That cannot
-- be done without causing the exact harm the same instruction was avoiding:
-- the merchant's document checklist is loaded CUSTOMER-scoped, across all deals,
-- with no deal filter and no status filter —
--     src/services/portalService.ts getMyDocRequests():
--       .from("deal_doc_requests").eq("customer_id", customerId)
-- so setting those 4 rows' customer_id to the survivor would have shown Shontea
-- EIGHT checklist items: her 4 real ones from MF-2026-0033 plus 4 phantom asks
-- for the identical document types. There is no status that hides them either —
-- deal_doc_requests_status_check allows only requested/uploaded/under_review/
-- approved/rejected, and marking never-supplied documents 'approved' would
-- falsify a compliance record.
-- RESOLUTION: MF-2026-0034 and ALL of its own child rows (4 deal_doc_requests,
-- 1 synergy_intake_log) were LEFT TOGETHER on the retired customer f952e666.
-- Nothing is orphaned and nothing straddles the boundary — which also satisfies
-- the brief's literal verification ("no child row left with a customer_id
-- pointing at f952e666 while its deal points at a90524b1": 0 such rows, because
-- deal 0034 stayed put too).

with move_login as (
  update customers set user_id = '7c31d3a5-4dfa-4b43-b20f-aff2af8b0def', updated_at = now()
  where id = 'a90524b1-af9a-4432-aa85-92a6a9541eb3' and user_id is null returning id),
retire_dupe as (
  update customers set
    user_id = null,
    ghl_contact_id = null,
    do_not_contact = true,
    do_not_contact_reason = 'Merged into customer a90524b1 (Nothing But Waste) 2026-08-28 — duplicate record.',
    tags = array(select distinct unnest(coalesce(tags,'{}'::text[]) || array['merged-duplicate'])),
    notes = concat_ws(E'\n', nullif(notes,''),
      'MERGED 2026-08-28 into customer a90524b1-af9a-4432-aa85-92a6a9541eb3 ("Nothing But Waste"), which holds the live deal MF-2026-0033.',
      'Portal login user_id 7c31d3a5-4dfa-4b43-b20f-aff2af8b0def moved to the survivor so the merchant sees her live deal.',
      'ghl_contact_id was lX1bVpV2ilYESkQx9yzH — cleared here so the contact resolves to exactly one customer row.',
      'Retained on this row on purpose: dead deal MF-2026-0034 plus its own 4 deal_doc_requests and 1 synergy_intake_log. Do not re-point them; see the merge note.'),
    updated_at = now()
  where id = 'f952e666-06ed-4b5d-a0d7-3fa3f7bd73d2' returning id),
move_messages as (
  update messages set related_customer_id = 'a90524b1-af9a-4432-aa85-92a6a9541eb3'
  where related_customer_id = 'f952e666-06ed-4b5d-a0d7-3fa3f7bd73d2' returning id),
note_dupe as (
  insert into activity_log (entity_type, entity_id, interaction_type, subject, content)
  values ('customer','f952e666-06ed-4b5d-a0d7-3fa3f7bd73d2','note','customer:merged',
    'merged into customer a90524b1 ("Nothing But Waste") 2026-08-28 — duplicate record for the same merchant. Portal login moved to the survivor; ghl_contact_id cleared; 5 portal messages re-pointed. Dead deal MF-2026-0034 and its own child rows deliberately LEFT on this row. Soft-retired, never deleted.')
  returning id),
note_survivor as (
  insert into activity_log (entity_type, entity_id, interaction_type, subject, content)
  values ('customer','a90524b1-af9a-4432-aa85-92a6a9541eb3','note','customer:merged',
    'absorbed duplicate customer f952e666 ("Nothin'' But Waste") 2026-08-28. Adopted the merchant portal login so signing in now shows the LIVE deal MF-2026-0033. The retired row keeps dead deal MF-2026-0034 and its 4 deal_doc_requests, because the portal loads the checklist by customer_id across ALL deals with no status filter.')
  returning id)
select (select count(*) from move_login)    survivor_updated,   -- 1
       (select count(*) from retire_dupe)   dupe_retired,       -- 1
       (select count(*) from move_messages) messages_moved,     -- 5
       (select count(*) from note_dupe) + (select count(*) from note_survivor) notes_added,
       (select case when (select count(*) from move_login) = 1 then 'ok'
                    else (select 'ABORT'::text where false) end) assert_login_moved;

-- ── CUSTOMER MERGE VERIFICATION (all passed 2026-08-28) ─────────────────────
--   * Exactly ONE customer row now holds ghl_contact_id lX1bVpV2ilYESkQx9yzH
--     (a90524b1). The four unguarded .maybeSingle() lookups can no longer error.
--   * Exactly ONE customer row holds portal login 7c31d3a5 → a90524b1.
--   * Simulating the portal RLS for that login returns MF-2026-0033
--     (application_sent, opp bVn0qtZMfDvYnROOrc4A) — the merchant now sees her
--     LIVE deal. This was the whole point of the merge.
--   * Her document checklist returns exactly 4 items, all from MF-2026-0033.
--     No phantoms. (Cross-checked ANDRADE'S STONE, the other merged-pair
--     customer with a portal login: also exactly 4, all from MF-2026-0255.)
--   * Still zero deals anywhere in the table sharing a ghl_opportunity_id.
--   * f952e666 retains only: 1 dead deal, its 4 deal_doc_requests, its 1
--     synergy_intake_log. 0 messages, 0 portal login, 0 ghl_contact_id.
--     (The deal and the synergy row were moved to the survivor in the follow-up
--      step below; only the 4 deal_doc_requests remain by design.)


-- ════════════════════════════════════════════════════════════════════════════
-- CUSTOMER MERGE, FOLLOW-UP — applied 2026-08-28, owner-authorized.
-- Finishes emptying the retired customer row f952e666.
--
-- Only THREE tables actually carry a customer_id that pointed at f952e666:
-- deals, deal_doc_requests, synergy_intake_log. activity_log, lead_score_events
-- and lead_intake_claims have NO customer_id column at all — they hang off the
-- deal, so they followed MF-2026-0034 automatically and needed no update.
--
--   MOVED to a90524b1:  MF-2026-0034 (deal.customer_id) + its 1 synergy_intake_log
--   LEFT on f952e666:   the 4 deal_doc_requests — the single deliberate exception
--
-- WHY THE 4 DOC REQUESTS STAY PUT (this is load-bearing, do not "tidy" it):
-- Keeping them attached to the dead deal 0034 does NOT hide them, because the
-- merchant's checklist is read CUSTOMER-scoped, across every deal, with no deal
-- filter and no status filter:
--     src/services/portalService.ts getMyDocRequests():
--       .from("deal_doc_requests").eq("customer_id", customerId)
-- So the deal's status is irrelevant — the moment those rows carry the survivor's
-- customer_id, Shontea's portal lists EIGHT outstanding document requests: the 4
-- real ones she owes on MF-2026-0033 plus 4 phantom duplicates of the identical
-- doc types. There is no status that suppresses them either
-- (deal_doc_requests_status_check allows only requested / uploaded /
-- under_review / approved / rejected, and marking never-supplied documents
-- 'approved' would falsify a compliance record).
-- The resulting inconsistency — 4 child rows whose customer_id is the retired
-- row while their deal sits on the survivor — is invisible everywhere: the admin
-- panel reads them by deal_id (components/admin/DealDocRequests.tsx), and the
-- merchant cannot see them at all. That is strictly the lesser evil.
--
-- TO OVERRIDE (accepting that the merchant will then see 8 checklist items):
--   update deal_doc_requests set customer_id = 'a90524b1-af9a-4432-aa85-92a6a9541eb3'
--    where customer_id = 'f952e666-06ed-4b5d-a0d7-3fa3f7bd73d2';

with move_deal as (
  update deals set customer_id = 'a90524b1-af9a-4432-aa85-92a6a9541eb3', updated_at = now()
  where id = '09337fba-62da-473b-9fa5-89dafcfb44ac'
    and customer_id = 'f952e666-06ed-4b5d-a0d7-3fa3f7bd73d2' returning deal_number, status),
move_synergy as (
  update synergy_intake_log set customer_id = 'a90524b1-af9a-4432-aa85-92a6a9541eb3'
  where customer_id = 'f952e666-06ed-4b5d-a0d7-3fa3f7bd73d2' returning ghl_email_record_id),
note as (
  insert into activity_log (entity_type, entity_id, interaction_type, subject, content)
  values ('deal','09337fba-62da-473b-9fa5-89dafcfb44ac','note','deal:merged',
    'customer re-pointed f952e666 -> a90524b1 (2026-08-28) as part of the customer merge; this deal stays dead. Its 4 deal_doc_requests keep customer_id f952e666 ON PURPOSE: the merchant portal loads the document checklist customer-scoped across ALL deals with no status filter, so re-pointing them would show the merchant 4 phantom document requests on top of the 4 real ones she owes on MF-2026-0033.')
  returning id)
select (select count(*) from move_deal) deal_moved,                     -- 1
       (select deal_number||' / '||status from move_deal) deal_after,   -- MF-2026-0034 / dead
       (select count(*) from move_synergy) synergy_moved,               -- 1
       (select count(*) from note) notes_added;                         -- 1

-- Only status/paydown changes fire trg_deals_merchant_notify, and this UPDATE
-- touches neither — so re-pointing the deal sent the merchant nothing.

-- ── FOLLOW-UP VERIFICATION (all passed 2026-08-28) ──────────────────────────
--   * user_id 7c31d3a5 resolves to exactly one row: a90524b1 "Nothing But Waste".
--   * f952e666.user_id IS NULL.
--   * a90524b1 now holds MF-2026-0033 (application_sent), MF-2026-0034 (dead),
--     MF-2026-0242 (dead).
--   * f952e666 holds ZERO deals, ZERO synergy_intake_log, ZERO messages.
--     Remaining: the 4 deal_doc_requests (by design) + its customer:merged
--     tombstone.
--   * MF-2026-0033 still has exactly 4 deal_doc_requests, and the merchant sees
--     exactly 4. No phantoms.
--   * Exactly ONE customer row holds ghl_contact_id lX1bVpV2ilYESkQx9yzH.
--   * Still zero deals anywhere in the table sharing a ghl_opportunity_id.

-- ── PRODUCT GAP — FIXED 2026-08-28, owner-authorized (see foot of file) ────
-- get_my_portal_deals() has NO terminal-status filter:
--     from public.deals d
--     where d.customer_id in (select c.id from customers c where c.user_id = auth.uid())
--     order by d.created_at desc;
-- and PortalDashboardPage renders every row it returns. So a merchant whose
-- customer carries a soft-retired duplicate deal sees a dead deal card in their
-- portal. TWO live merchants are in that state right now, both as a direct
-- result of these merges:
--     ANDRADE'S STONE INC  → MF-2026-0255 (application_sent) + MF-2026-0256 (dead)
--     Nothing But Waste    → MF-2026-0033 (application_sent) + MF-2026-0242 (dead)
-- Note merchant_step_key('mca','dead') returns NULL, so the dead card has no
-- step label — it renders as an unlabelled stub.
-- SUGGESTED FIX (one line, but it changes merchant-facing behaviour for EVERY
-- merchant, so it was not applied unilaterally):
--     and d.status not in ('dead','declined')
-- Deliberately excludes 'nurture' — a parked deal is still a real deal the
-- merchant should be able to see.


-- ════════════════════════════════════════════════════════════════════════════
-- PORTAL RPC FIX — APPLIED 2026-08-28, owner-authorized.
--
-- The gap described immediately above is now CLOSED. The DDL lives in its own
-- migration so it sits in the schema history where it belongs, rather than
-- buried inside this data-fix record:
--
--     repo:   supabase/migrations/20260828_portal_deals_hide_terminal_duplicates.sql
--     remote: 20260828155725_portal_deals_hide_terminal_duplicates
--
-- The change is exactly the one-liner suggested above, added to
-- get_my_portal_deals() and nothing else:
--
--     and d.status not in ('dead', 'declined')
--
-- 'nurture' was deliberately NOT added. Measured before applying: ~52 merchants
-- with portal logins have a 'nurture' deal as their ONLY deal, so excluding it
-- would have blanked their portal dashboard entirely.
--
-- Signature, column list, STABLE SECURITY DEFINER and search_path = public are
-- unchanged; CREATE OR REPLACE preserved the ACL and ownership.
--
-- BEFORE → AFTER, replaying the function's own WHERE clause per merchant:
--   ANDRADE'S STONE INC   0256 dead + 0255 application_sent → 0255 only
--   Nothing But Waste     0242 dead + 0034 dead + 0033 application_sent → 0033 only
--   Allman Homes LLC      0031 nurture                      → 0031 nurture (KEPT)
-- Fleet regression: ZERO merchants with a portal login are left seeing no deals.
-- get_advisors(security): no new warning attributable to the change.
--
-- NOTE FOR WHOEVER APPLIES THIS FILE: the statements ABOVE this banner are a
-- record of data mutations already applied on 2026-08-28. They are written
-- against specific row ids whose state has since moved, so re-running this file
-- is a no-op rather than a rollback — it is documentation, not a replayable
-- migration. The portal RPC fix is the only DDL, and it lives in its own file.
