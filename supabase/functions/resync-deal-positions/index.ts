// resync-deal-positions — on-demand refresh of a deal's "existing MCA positions"
// from the backing ph_ucc_lead. This is what the Revenue Playbook's "Re-sync from
// UCC" button calls: a merchant's existing-positions data is auto-mapped from UCC
// at first-open, but new advances they take LATER only surface when we re-read the
// UCC lead. This function re-reads it and writes the fresh stack depth / funders /
// per-lien detail / MCA score onto the deal.
//
//   POST { deal_id }
//     → { ok:true, updated:boolean, existing_positions:number|null, reason:string } (200)
//     | { ok:false, error }                                                          (4xx/5xx)
//
// PRECEDENCE (shared rule, _shared/positionsSource.ts): UCC is a rank-1 estimate.
// It may overwrite only a deal whose current existing_positions_source is null or
// 'ucc'. A human (manual/application, rank 3) or the underwriter (bank_statements,
// rank 2) value is NEVER overwritten — the write is skipped and `reason` says so.
// The DB UPDATE also carries the race-safe .or() source filter (belt + braces).
//
// LEAD RESOLUTION (mirrors playbook-open-contact, via _shared/uccPositions.ts):
//   1) deal.lead_qual.ucc_lead_id, if present (the exact lead the deal was seeded from)
//   2) else the customer's phone last-10 → ph_ucc_leads
//   3) else the customer's / deal's ghl_contact_id → ph_ucc_leads
//
// AUTH: verify_jwt = true (gateway) PLUS an in-code staff role check
// (closer/admin/super_admin), mirroring playbook-open-contact. A service-role
// bearer deliberately fails the role check.
//
// Compliance: an MCA is a purchase of future receivables, NEVER a loan.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { UCC_OVERWRITABLE_OR_FILTER, sourceRank, UCC_RANK, canWrite } from "../_shared/positionsSource.ts";
import {
  type UccLeadRow, buildPositionsPatch, mcaScoreNum,
  fetchUccLeadById, fetchUccLeadByContact, fetchUccLeadByPhone,
} from "../_shared/uccPositions.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const db = serviceClient();

    // ── Authn: signed-in staff only. ───────────────────────────────────────
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ ok: false, error: "Invalid session" }, 401);
    const { data: callerProfile } = await db
      .from("profiles").select("role").eq("id", caller.id).single();
    const role = callerProfile?.role as string | undefined;
    if (!role || !["closer", "admin", "super_admin"].includes(role)) {
      return json({ ok: false, error: "Forbidden — staff only" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const dealId = str(body?.deal_id ?? body?.dealId);
    if (!dealId) return json({ ok: false, error: "deal_id is required" }, 400);

    // ── Load the deal + its customer. ──────────────────────────────────────
    const { data: deal, error: dealErr } = await db
      .from("deals")
      .select("id, customer_id, ghl_contact_id, lead_qual, existing_positions, existing_positions_source")
      .eq("id", dealId)
      .maybeSingle();
    if (dealErr) return json({ ok: false, error: `deal load failed: ${dealErr.message}` }, 500);
    if (!deal) return json({ ok: false, error: "deal not found" }, 404);

    // A closer may only re-sync a deal they own or that is unassigned (RLS parity).
    if (role === "closer") {
      const { data: owned } = await db
        .from("deals").select("id, assigned_closer_id").eq("id", dealId).maybeSingle();
      const assigned = (owned as { assigned_closer_id: string | null } | null)?.assigned_closer_id ?? null;
      if (assigned && assigned !== caller.id) {
        return json({ ok: false, error: "Forbidden — not your deal" }, 403);
      }
    }

    const currentSource = (deal.existing_positions_source as string | null) ?? null;
    const currentPositions = (deal.existing_positions as number | null) ?? null;

    // Fast-path: a higher-trust source already owns this — never overwrite. Report
    // the skip clearly (this is a documented outcome, not an error).
    if (!canWrite(currentSource, UCC_RANK)) {
      return json({
        ok: true, updated: false, existing_positions: currentPositions,
        reason: `source is ${currentSource} — UCC (estimate) won't overwrite a rank-${sourceRank(currentSource)} value`,
      });
    }

    // ── Resolve the backing UCC lead (same playbook resolution order). ─────
    const leadQual = (deal.lead_qual ?? {}) as Record<string, unknown>;
    const seededLeadId = str(leadQual.ucc_lead_id);

    let lead: UccLeadRow | null = null;
    let resolvedVia = "";
    if (seededLeadId) {
      lead = await fetchUccLeadById(db, seededLeadId);
      if (lead) resolvedVia = "lead_qual.ucc_lead_id";
    }

    // Pull the customer for phone/contact fallbacks (and for identity in the reason).
    let custPhone: string | null = null;
    let custContactId: string | null = null;
    if (deal.customer_id) {
      const { data: cust } = await db
        .from("customers").select("phone, ghl_contact_id").eq("id", deal.customer_id).maybeSingle();
      if (cust) {
        custPhone = str((cust as Record<string, unknown>).phone as string | null);
        custContactId = str((cust as Record<string, unknown>).ghl_contact_id as string | null);
      }
    }
    const contactId = str(deal.ghl_contact_id) ?? custContactId;

    if (!lead && custPhone) {
      lead = await fetchUccLeadByPhone(db, custPhone);
      if (lead) resolvedVia = "customer.phone";
    }
    if (!lead && contactId) {
      lead = await fetchUccLeadByContact(db, contactId);
      if (lead) resolvedVia = "ghl_contact_id";
    }

    if (!lead) {
      return json({
        ok: true, updated: false, existing_positions: currentPositions,
        reason: "no backing UCC lead found (no lead_qual.ucc_lead_id, phone, or contact match)",
      });
    }

    // ── Recompute the positions patch + MCA score from the fresh lead. ─────
    const patch = await buildPositionsPatch(db, lead);
    const mca = mcaScoreNum(lead);

    if (!patch && mca == null) {
      return json({
        ok: true, updated: false, existing_positions: currentPositions,
        reason: `backing UCC lead (${lead.id}, via ${resolvedVia}) carries no positions signal or score`,
      });
    }

    const fullPatch: Record<string, unknown> = { ...(patch ?? {}) };
    if (mca != null) fullPatch.mca_score = mca;

    // Write under the race-safe source-rank guard (mirrors canWrite() atomically).
    const { data: updatedRows, error: updErr } = await db
      .from("deals")
      .update(fullPatch)
      .eq("id", dealId)
      .or(UCC_OVERWRITABLE_OR_FILTER)   // source rank <= 1 (null or 'ucc') only
      .select("id, existing_positions, existing_positions_source");
    if (updErr) return json({ ok: false, error: `deal update failed: ${updErr.message}` }, 500);

    const wrote = (updatedRows ?? []).length > 0;
    if (!wrote) {
      // Lost the race to a concurrent higher-trust write between our read + update.
      return json({
        ok: true, updated: false, existing_positions: currentPositions,
        reason: "a higher-trust source claimed the deal during the re-sync — UCC skipped",
      });
    }

    const newPositions = (updatedRows![0].existing_positions as number | null) ?? null;
    return json({
      ok: true, updated: true, existing_positions: newPositions,
      reason: patch
        ? `refreshed from UCC lead ${lead.id} (via ${resolvedVia}): ${newPositions ?? 0} position(s)`
        : `refreshed MCA score from UCC lead ${lead.id} (via ${resolvedVia}); no positions signal`,
    });
  } catch (e) {
    console.error("[resync-deal-positions] fatal:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
