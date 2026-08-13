// uccPositions — shared resolution + computation of a merchant's "existing MCA
// positions" from the backing ph_ucc_lead. Used by playbook-open-contact (auto-
// populate/refresh on open) and resync-deal-positions (on-demand "Re-sync from
// UCC" button) so both derive positions the SAME way and can never drift.
//
// The provenance/precedence rule (who may overwrite whom) lives in
// _shared/positionsSource.ts — this module only READS the lead and BUILDS the
// deal patch; the caller applies it under the race-safe source-rank DB guard.
//
// Compliance: an MCA is a purchase of future receivables, NEVER a loan.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** The sentinel matched_funders value ph-ucc-ingest writes for agent-filed leads
 * (the real funder is hidden behind a representation agent). NOT a real funder. */
export const AGENT_FILED_SENTINEL = "— agent-filed (funder unknown) —";

/** The backing UCC lead behind a merchant — source of the auto-populated address
 * + existing-MCA-positions. */
export interface UccLeadRow {
  id: string;
  debtor_address: string | null;
  debtor_city: string | null;
  debtor_state: string | null;
  debtor_zip: string | null;
  stack_depth: number | null;
  matched_funders: string[] | null;
  mca_score: number | string | null;
}

/** ph_ucc_leads columns needed to enrich the customer address + deal positions. */
export const UCC_ENRICH_COLS =
  "id, debtor_address, debtor_city, debtor_state, debtor_zip, stack_depth, matched_funders, mca_score";

const s = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
};

/** Normalize any dialed/stored phone to its US last-10 digits. */
export function last10(raw: string | null): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d : null;
}

/** Real (non-agent-sentinel) funder names on the lead. */
export function realFunders(lead: UccLeadRow | null): string[] {
  return (lead?.matched_funders ?? []).filter((f) => f && f !== AGENT_FILED_SENTINEL);
}

/** The lead's MCA quality score as a finite number (or null when absent/unparsable). */
export function mcaScoreNum(lead: UccLeadRow | null): number | null {
  if (lead?.mca_score == null) return null;
  const n = Number(lead.mca_score);
  return Number.isFinite(n) ? n : null;
}

/** Coerce a raw ph_ucc_leads row (possibly wider) into a UccLeadRow. */
export function toUccLeadRow(row: Record<string, unknown>): UccLeadRow {
  return {
    id: row.id as string,
    debtor_address: (row.debtor_address as string | null) ?? null,
    debtor_city: (row.debtor_city as string | null) ?? null,
    debtor_state: (row.debtor_state as string | null) ?? null,
    debtor_zip: (row.debtor_zip as string | null) ?? null,
    stack_depth: (row.stack_depth as number | null) ?? null,
    matched_funders: (row.matched_funders as string[] | null) ?? null,
    mca_score: (row.mca_score as number | string | null) ?? null,
  };
}

// ── Lead resolution ─────────────────────────────────────────────────────────

/** Resolve the backing UCC lead by its id (the deal's lead_qual.ucc_lead_id). */
export async function fetchUccLeadById(
  db: SupabaseClient, leadId: string,
): Promise<UccLeadRow | null> {
  const { data, error } = await db
    .from("ph_ucc_leads").select(UCC_ENRICH_COLS).eq("id", leadId).maybeSingle();
  if (error) { console.error("[uccPositions] fetchUccLeadById failed:", error.message); return null; }
  return data ? toUccLeadRow(data as Record<string, unknown>) : null;
}

/** Resolve by ghl_contact_id (deep-link path). Highest-score row wins. */
export async function fetchUccLeadByContact(
  db: SupabaseClient, contactId: string,
): Promise<UccLeadRow | null> {
  const { data, error } = await db
    .from("ph_ucc_leads").select(UCC_ENRICH_COLS)
    .eq("ghl_contact_id", contactId)
    .order("score", { ascending: false, nullsFirst: false })
    .limit(1).maybeSingle();
  if (error) { console.error("[uccPositions] fetchUccLeadByContact failed:", error.message); return null; }
  return data ? toUccLeadRow(data as Record<string, unknown>) : null;
}

/** Resolve by phone last-10 (dialer path). ph_ucc_leads stores bare 10-digit
 * numbers; the trailing-match also picks up +1XXXXXXXXXX / 1XXXXXXXXXX rows. */
export async function fetchUccLeadByPhone(
  db: SupabaseClient, phoneRaw: string | null,
): Promise<UccLeadRow | null> {
  const digits = last10(phoneRaw);
  if (!digits) return null;
  const { data, error } = await db
    .from("ph_ucc_leads").select(`id, phone, ${UCC_ENRICH_COLS}`)
    .like("phone", `%${digits}`)
    .order("score", { ascending: false, nullsFirst: false })
    .limit(5);
  if (error) { console.error("[uccPositions] fetchUccLeadByPhone failed:", error.message); return null; }
  const row = (data ?? []).find((l) => last10(s((l as Record<string, unknown>).phone as string | null)) === digits);
  return row ? toUccLeadRow(row as Record<string, unknown>) : null;
}

// ── Positions patch ─────────────────────────────────────────────────────────

/** Per-lien detail from the ph_ucc_lead_filings RPC (one row per UCC position). */
export async function fetchPositionsDetail(
  db: SupabaseClient, leadId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await db.rpc("ph_ucc_lead_filings", { p_lead_id: leadId });
  if (error) { console.error("[uccPositions] ph_ucc_lead_filings failed:", error.message); return []; }
  return ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
    funder: s(f.secured_party_raw),
    filed_date: (f.filed_date as string | null) ?? null,
    state: s(f.state),
    filing_no: s(f.filing_no),
  }));
}

/** Build the deal patch for existing MCA positions from the freshly-read lead —
 * or null when the lead carries no positions signal at all (so we never stamp
 * source='ucc' onto nothing). Stamps source='ucc' + synced_at=now. */
export async function buildPositionsPatch(
  db: SupabaseClient, lead: UccLeadRow | null,
): Promise<Record<string, unknown> | null> {
  if (!lead) return null;
  const funders = realFunders(lead);
  const detail = await fetchPositionsDetail(db, lead.id);
  const hasSignal = lead.stack_depth != null || funders.length > 0 || detail.length > 0;
  if (!hasSignal) return null;
  return {
    existing_positions: lead.stack_depth ?? null,
    existing_funders: funders.length ? funders : null,
    existing_positions_detail: detail,
    existing_positions_source: "ucc",
    existing_positions_synced_at: new Date().toISOString(),
  };
}
