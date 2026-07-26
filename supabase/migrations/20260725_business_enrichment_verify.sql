-- ═══════════════════════════════════════════════════════════════════════════
-- BUSINESS ENRICHMENT — VERIFY & SAVE (owner ask 2026-07-25)
--
-- The research card said "found online (unverified)" with no way to accept it.
-- The owner wants a per-field ✓ "Use this" + "Confirm all" that WRITE the found
-- values onto the merchant's real record (customers + GHL contact) and stamp the
-- research row as human-verified.
--
-- These three columns hold the verification state for ONE research row:
--   verified_at      — when a human first confirmed something on this run
--   verified_by      — who confirmed (auth user id)
--   verified_fields  — jsonb array of the field keys applied so far, e.g.
--                      ["street","city","state","zip","phone","website"]
--
-- VERIFICATION RESET is structural, not a code path: enrich-business INSERTs a
-- NEW row per run and the card always loads the latest row (created_at desc), so
-- a re-run surfaces a fresh row with these three columns NULL → unverified again.
-- Only the confirm-enrichment edge function (service role) ever sets them.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.business_enrichment
  add column if not exists verified_at     timestamptz,
  add column if not exists verified_by     uuid references public.profiles(id),
  add column if not exists verified_fields jsonb;

-- No new RLS: the existing SELECT policies already return the whole row to staff
-- (the card reads verified_*), and writes stay service-role-only via the
-- confirm-enrichment edge function — same discipline as the original table.
