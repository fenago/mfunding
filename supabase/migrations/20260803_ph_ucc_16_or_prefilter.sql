-- PH UCC — pre-filter Oregon ingest to MCA-matched filings only (backfill).
-- =============================================================================
-- Extends 20260803_ph_ucc_15_ct_prefilter.sql to OREGON. OR's snfi-f79b
-- "last month" Socrata dump landed 2,505 rows in ph_ucc_filings but only ~19
-- match an MCA funder alias under the bank-guarded matcher — the rest is the
-- firehose (SNAP-ON CREDIT, KUBOTA CREDIT, SALAL CREDIT UNION, IRS, DEPT OF
-- REVENUE, SHEFFIELD, CATERPILLAR, FARM CREDIT, COLUMBIA BANK, DEERE, US BANK,
-- WELLS FARGO — equipment/bank/tax/ag liens we never use).
--
-- The edge fn now pre-filters OR at ingest via ph_ucc_match_secured_parties()
-- (added in migration 15). This migration backfills: delete the ~2,383 existing
-- non-matching OR filings via the SAME predicate the rebuild uses (active alias,
-- alias_norm>=3, token-boundary, NOT ph_ucc_is_depository), keeping every OR
-- filing that currently backs a lead.
--
-- LEADS ARE NOT TOUCHED. NOTE (loud): the current OR lead set (122) is heavily
-- pre-bank-guard contamination — only ~18 leads are backed by matching filings;
-- ~104 are legacy bank/equipment/tax "leads" from before migration 12's guard,
-- ALREADY orphaned by the current matcher and 100% skip-traced (owner paid,
-- 91 have phones). Per the migration-12 rule ("skip-traced leads are NEVER
-- deleted — flag them"), those leads are LEFT AS-IS here for a separate flag
-- decision. Deleting the junk FILINGS does not change the lead count (the 104
-- were already unbacked) — OR leads stay 122.
--
-- COLORADO is intentionally untouched: ingestCO already source-matches per alias
-- (715 rows, 708 matched → 650 leads), so there is nothing meaningful to purge.
-- =============================================================================

delete from public.ph_ucc_filings f
where f.state = 'OR'
  and not (
    exists (
      select 1
      from public.ph_ucc_funder_aliases a
      where a.active
        and length(a.alias_norm) >= 3
        and f.sp_norm like '%' || a.alias_norm || '%'
        and (' ' || f.sp_norm || ' ') like ('%' || ' ' || a.alias_norm || ' ' || '%')
    )
    and not public.ph_ucc_is_depository(f.sp_norm)
  );
