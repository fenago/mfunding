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
-- explicit go-ahead.
--
-- ROOT CAUSE, still unfixed: playbook-open-contact mints a deal without an
-- ghl_opportunity_id, and ghl-webhook's Gap-A create matches on that column
-- alone. Until Gap-A also looks up an existing unlinked deal by
-- ghl_contact_id + deal_type (and adopts it instead of inserting), this class
-- of duplicate will keep reappearing.
