-- PH UCC — pre-filter Connecticut ingest to MCA-matched filings only.
-- =============================================================================
-- WHY: the CT Socrata dataset (xfev-8smz) is a firehose — 62,252 in-window
-- ORIG-FIN-STMT rows landed in ph_ucc_filings but only 338 (~0.5%) match an MCA
-- funder alias and become leads (328 debtors). The other ~61,900 are banks /
-- equipment / auto / ag liens we never use. Dumping the whole firehose bloats the
-- DB and inflates weekly egress (a free-tier egress cap caused a site outage on
-- 2026-08-02). CA/FL FILE loaders already pre-filter to matches locally before
-- loading; this brings the CT (API) path in line.
--
-- The pre-filter MUST use the SAME definition of "MCA filing" that
-- ph_ucc_rebuild_leads() uses, or we would drop filings the rebuild would keep.
-- That definition is: an ACTIVE funder alias (alias_norm length >= 3) matching
-- the normalized secured party as a whole space-delimited TOKEN run, AND the
-- secured party is NOT a deposit institution (ph_ucc_is_depository). This is the
-- exact join predicate from 20260802_ph_ucc_12_alias_cleanup_bank_guard.sql.
--
-- SAFE FOR API STATES ONLY: pre-filtering at ingest discards non-matches instead
-- of storing them, so if the alias dictionary changes later we could no longer
-- re-match rows we never kept. That is acceptable for CT (and any Socrata/api
-- state) because the free data.ct.gov endpoint can always be re-pulled in full.
-- It would NOT be safe for a paid FILE state (CA), whose master unload cannot be
-- cheaply re-fetched — those loaders keep their own local pre-filter and are
-- untouched here.
-- =============================================================================

-- ── 1. Batch matcher the ingest edge fn calls (rpc) ──────────────────────────
-- Given raw secured-party strings, return the DISTINCT ones that match an active
-- MCA funder alias under the exact rebuild predicate (token-boundary + bank
-- guard). The edge function normalizes nothing itself — it hands over the raw
-- names and keeps only rows whose secured party comes back from here, so the
-- ingest's notion of "matched" can never diverge from the rebuild's.
create or replace function public.ph_ucc_match_secured_parties(p_parties text[])
returns setof text
language sql
stable
security definer
set search_path = public
as $function$
  select p.party
  from unnest(p_parties) as p(party)
  where exists (
    select 1
    from public.ph_ucc_funder_aliases a
    where a.active
      and length(a.alias_norm) >= 3
      and public.ph_ucc_norm(p.party) like '%' || a.alias_norm || '%'
      and (' ' || public.ph_ucc_norm(p.party) || ' ')
            like ('%' || ' ' || a.alias_norm || ' ' || '%')
  )
  and not public.ph_ucc_is_depository(public.ph_ucc_norm(p.party));
$function$;

grant execute on function public.ph_ucc_match_secured_parties(text[]) to service_role;

-- ── 2. Backfill: drop the CT junk already in ph_ucc_filings ───────────────────
-- Delete every CT filing whose secured party does NOT match the rebuild predicate
-- above. Uses the stored sp_norm generated column (== ph_ucc_norm(secured_party_raw)),
-- so this keeps EXACTLY the set the rebuild's join keeps — every filing that
-- currently backs a lead survives. Verified before/after: CT leads = 328 both
-- sides (matched filings = 338, all lead-backing).
delete from public.ph_ucc_filings f
where f.state = 'CT'
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
