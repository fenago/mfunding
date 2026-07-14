// score-lead — computes the v1 lead quality score (grade A–D + expected value)
// for a deal and persists it: columns on `deals` (join-free hot reads) + one
// append-only `lead_score_events` row (the v2 calibration dataset).
//
// The formula lives in ../_shared/leadScore.ts (mirrored to src/lib/leadScore.ts).
// HONESTY: v1 weights are judgment — 0 funded deals exist, there is no ground
// truth. Every score logs its reasons and score_version so a fitted v2 never
// mixes with v1 in analysis. See research/PLAN_lead_scoring.md.
//
// POST body:
//   { dealId: string, trigger?: string }   — score one deal
//   { all: true, trigger?: string }        — score every non-VCF deal (backfill/sweep)
//
// Auth (verify_jwt = true at the gateway), three in-code paths:
//   • ?secret=<GHL webhook_secret> (+ anon Bearer for the gateway) — trusted cron,
//     same pattern as check-email-bounces (house rule #1).
//   • service-role bearer — fn-to-fn fire-and-forget calls (same precedent as
//     underwrite-deal's auto mode).
//   • staff JWT (closer/admin/super_admin) — manual re-score from the UI/curl.
//
// Idempotency: per (deal, inputs-hash). The deals columns are always refreshed
// (cheap, idempotent); the EVENT row is skipped when the inputs hash matches the
// latest event at the same score_version — so the nightly sweep doesn't bloat the
// history with identical snapshots.
//
// Compliance: internal scoring only, no merchant-facing copy. An MCA is a
// purchase of future receivables, NOT a loan.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import {
  SCORE_VERSION, scoreLead, numFromText, positionsFromText, monthsFromOwnerText, yesish,
  type ProgramGate, type ScoreInputs, type UnderwritingInput,
} from "../_shared/leadScore.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
type Any = Record<string, any>;

// FNV-1a — stable inputs hash for idempotency (mirrors underwrite-deal docs_hash).
function stableHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function jwtRole(token: string): string | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return (JSON.parse(atob(b64)) as { role?: string }).role ?? null;
  } catch { return null; }
}

/** credit_score_range is free text ("600-650", "650+"). Take the first 3-digit number. */
function ficoFromRange(range: string | null): number | null {
  if (!range) return null;
  const m = range.match(/\d{3}/);
  return m ? Number(m[0]) : null;
}

interface ScoredRow {
  dealId: string;
  dealNumber: string | null;
  business: string | null;
  grade: string;
  score: number;
  expectedValue: number;
  topReason: string;
  eventLogged: boolean;
  error?: string;
}

async function scoreOne(
  db: SupabaseClient,
  deal: Any,
  programs: Array<ProgramGate & { lender_id: string }>,
  trigger: string,
): Promise<ScoredRow> {
  const cust = (deal.customer ?? {}) as Any;
  const lq = (deal.lead_qual ?? {}) as Record<string, unknown>;

  // Latest underwriting run (bank-statement truth beats stated numbers).
  const { data: uwRow } = await db
    .from("deal_underwriting")
    .select("metrics, flags, risk_rating, affordability_rating, version")
    .eq("deal_id", deal.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  let underwriting: UnderwritingInput | null = null;
  if (uwRow) {
    const metrics = (uwRow.metrics ?? {}) as Any;
    const flags = Array.isArray(uwRow.flags) ? (uwRow.flags as Any[]) : [];
    underwriting = {
      trueMonthlyRevenue: metrics.true_avg_monthly_revenue != null ? Number(metrics.true_avg_monthly_revenue) : null,
      riskRating: (uwRow.risk_rating as string | null) ?? null,
      affordabilityRating: (uwRow.affordability_rating as string | null) ?? null,
      maxAffordableAdvance: metrics.max_affordable_advance != null ? Number(metrics.max_affordable_advance) : null,
      criticalFlagCount: flags.filter((f) => f?.severity === "critical").length,
    };
  }

  // Funder responses: a decline removes that funder from the pool; an offer
  // floors the grade at B.
  const { data: subs } = await db
    .from("deal_submissions")
    .select("lender_id, status")
    .eq("deal_id", deal.id);
  const declinedLenders = new Set(
    (subs ?? []).filter((s) => ["declined", "withdrawn", "offer_declined"].includes(String(s.status))).map((s) => s.lender_id as string),
  );
  const hasOffer = (subs ?? []).some((s) => ["offer_made", "approved", "offer_accepted", "funded"].includes(String(s.status)));
  const pool = programs.filter((p) => !declinedLenders.has(p.lender_id));

  // Inputs: lead_qual (vendor snapshot) with customers.* as fallback.
  const monthlyRevenue = numFromText(lq["monthly_deposits"]) ??
    (cust.monthly_revenue != null ? Number(cust.monthly_revenue) : null);
  const tibMonths = (cust.time_in_business != null ? Number(cust.time_in_business) : null) ??
    monthsFromOwnerText(lq["time_as_owner"]);
  const fico = numFromText(lq["fico"]) ?? ficoFromRange(cust.credit_score_range ?? null);
  const amountRequested = deal.amount_requested != null ? Number(deal.amount_requested) : numFromText(lq["requested_amount"]);

  const inputs: ScoreInputs = {
    status: String(deal.status ?? "new"),
    isRenewal: Boolean(deal.is_renewal),
    amountRequested,
    monthlyRevenue,
    tibMonths,
    fico,
    openPositions: positionsFromText(lq["open_positions"]),
    positionsBalance: positionsFromText(lq["positions_balance"]),
    needMoneyNow: yesish(lq["need_money_now"]),
    useOfFunds: (deal.use_of_funds as string | null) ?? (lq["use_of_funds"] as string | null) ?? null,
    difficultyApproved: (lq["difficulty_approved"] as string | null) ?? null,
    temperature: (deal.temperature as string | null) ?? null,
    emailStatus: (cust.email_status as string | null) ?? null,
    hasPhone: Boolean((cust.phone ?? "").toString().trim()),
    bestTime: (lq["best_time"] as string | null) ?? null,
    programs: pool,
    underwriting,
    hasOffer,
    declinedFunderCount: declinedLenders.size,
  };

  const result = scoreLead(inputs);
  const topReason = result.reasons[0]?.note ?? "";

  // Idempotency hash over everything that determines the score.
  const inputsHash = stableHash(JSON.stringify({ v: SCORE_VERSION, inputs }));

  // 1) Current score → deals columns (loud writes: check .error).
  const { error: updErr } = await db.from("deals").update({
    lead_grade: result.grade,
    lead_score: result.score,
    expected_value: result.expectedValue,
    score_reasons: result.reasons,
    score_version: SCORE_VERSION,
    scored_at: new Date().toISOString(),
  }).eq("id", deal.id);
  if (updErr) {
    return {
      dealId: deal.id, dealNumber: deal.deal_number ?? null, business: cust.business_name ?? null,
      grade: result.grade, score: result.score, expectedValue: result.expectedValue, topReason,
      eventLogged: false, error: `deals update failed: ${updErr.message}`,
    };
  }

  // 2) History → append-only event (skip when inputs are unchanged at this version).
  let eventLogged = false;
  const { data: lastEvent } = await db
    .from("lead_score_events")
    .select("inputs, version")
    .eq("deal_id", deal.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastHash = (lastEvent?.inputs as Any | undefined)?._hash as string | undefined;
  if (!(lastEvent && lastEvent.version === SCORE_VERSION && lastHash === inputsHash)) {
    const { error: evErr } = await db.from("lead_score_events").insert({
      deal_id: deal.id,
      version: SCORE_VERSION,
      trigger,
      inputs: {
        _hash: inputsHash,
        ...inputs,
        // programs are bulky and reconstructable — snapshot the COUNT, not the rows.
        programs: undefined,
        program_count: pool.length,
        p_close: result.pClose,
        fundable_amount: result.fundableAmount,
        expected_commission: result.expectedCommission,
        factor_points: result.reasons,
      },
      score: result.score,
      grade: result.grade,
      expected_value: result.expectedValue,
    });
    if (evErr) {
      // Column update succeeded; report the event failure loudly instead of hiding it.
      return {
        dealId: deal.id, dealNumber: deal.deal_number ?? null, business: cust.business_name ?? null,
        grade: result.grade, score: result.score, expectedValue: result.expectedValue, topReason,
        eventLogged: false, error: `event insert failed: ${evErr.message}`,
      };
    }
    eventLogged = true;
  }

  return {
    dealId: deal.id, dealNumber: deal.deal_number ?? null, business: cust.business_name ?? null,
    grade: result.grade, score: result.score, expectedValue: result.expectedValue, topReason, eventLogged,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();
  const url = new URL(req.url);

  // ── Auth: trusted cron secret OR service-role bearer OR staff JWT ──
  const providedSecret = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const isServiceCall = !!token && (token === serviceKey || jwtRole(token) === "service_role");

  if (providedSecret) {
    const { data: gc } = await db.rpc("get_ghl_config");
    const expected = (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
    if (!expected || providedSecret !== expected) return json({ error: "forbidden" }, 403);
  } else if (!isServiceCall) {
    if (!token) return json({ error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid session" }, 401);
    const { data: prof } = await db.from("profiles").select("role").eq("id", caller.id).single();
    const role = prof?.role as string | undefined;
    if (!role || !["closer", "admin", "super_admin"].includes(role)) {
      return json({ error: "Forbidden — staff only" }, 403);
    }
  }

  let body: { dealId?: string; all?: boolean; trigger?: string } = {};
  try { body = (await req.json()) as typeof body; } catch { /* cron may POST no body */ }
  const trigger = (body.trigger ?? "manual").slice(0, 40);
  if (!body.dealId && !body.all) return json({ error: "dealId or all:true is required" }, 400);

  try {
    // Program pool: active MCA programs from SIGNED funders — mirrors the
    // FunderQualifier's default pool (live_vendor only).
    const { data: progRows, error: pErr } = await db
      .from("lender_programs")
      .select("lender_id, approval_min, approval_max, approval_pct_min, approval_pct_max, monthly_revenue_required, annual_revenue_required, time_in_business_months, min_credit_score, lender:lenders!inner(status)")
      .eq("product_type", "mca")
      .eq("is_active", true);
    if (pErr) return json({ error: `program load failed: ${pErr.message}` }, 502);
    const programs = ((progRows ?? []) as Any[])
      .filter((p) => (p.lender as Any)?.status === "live_vendor")
      .map((p) => ({
        lender_id: p.lender_id as string,
        approval_min: p.approval_min != null ? Number(p.approval_min) : null,
        approval_max: p.approval_max != null ? Number(p.approval_max) : null,
        approval_pct_min: p.approval_pct_min != null ? Number(p.approval_pct_min) : null,
        approval_pct_max: p.approval_pct_max != null ? Number(p.approval_pct_max) : null,
        monthly_revenue_required: p.monthly_revenue_required != null ? Number(p.monthly_revenue_required) : null,
        annual_revenue_required: p.annual_revenue_required != null ? Number(p.annual_revenue_required) : null,
        time_in_business_months: p.time_in_business_months != null ? Number(p.time_in_business_months) : null,
        min_credit_score: p.min_credit_score != null ? Number(p.min_credit_score) : null,
      }));

    const DEAL_SELECT =
      "id, deal_number, deal_type, status, amount_requested, is_renewal, use_of_funds, temperature, lead_qual, " +
      "customer:customers!customer_id(id, business_name, monthly_revenue, time_in_business, credit_score_range, email_status, phone)";

    let deals: Any[] = [];
    if (body.dealId) {
      const { data: d, error } = await db.from("deals").select(DEAL_SELECT).eq("id", body.dealId).maybeSingle();
      if (error || !d) return json({ error: `deal not found: ${error?.message ?? body.dealId}` }, 404);
      if (d.deal_type === "vcf") return json({ ok: true, skipped: true, reason: "vcf deals are not lead-scored" });
      deals = [d];
    } else {
      const { data: all, error } = await db.from("deals").select(DEAL_SELECT).neq("deal_type", "vcf").order("created_at");
      if (error) return json({ error: `deal scan failed: ${error.message}` }, 502);
      deals = (all ?? []) as Any[];
    }

    const results: ScoredRow[] = [];
    for (const d of deals) results.push(await scoreOne(db, d, programs, trigger));

    const failed = results.filter((r) => r.error);
    return json({
      ok: failed.length === 0,
      score_version: SCORE_VERSION,
      trigger,
      scored: results.length,
      events_logged: results.filter((r) => r.eventLogged).length,
      failed: failed.length,
      results,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
