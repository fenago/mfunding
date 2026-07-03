// recommend-lenders — AI funder-matching for the submit-to-funders flow.
//
// POST body: { "deal_id": "<deal uuid>" }
//
// Loads the deal + customer and the funder network (lenders with any criteria or
// submission data), builds a merchant profile, and asks Claude to rank the best
// funder fits for THIS deal. Returns STRICT JSON:
//   { recommendations: [{ lender_id, lender_name, fit, reasons[], watch_outs[] }],
//     summary, missing_fields[], model }
//
// This does NOT submit anything or send any email — it only produces a ranked
// short-list the closer reviews in the FunderPicker before hitting Submit.
//
// Auth: verify_jwt stays default (authenticated staff call it via
// supabase.functions.invoke). The Anthropic key is a function secret, never the
// client's, and is never returned to the caller.
//
// Compliance: MCA = purchase of future receivables, NOT a loan. The system prompt
// enforces receivables language; the model reasons about fit, not loan terms.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { callLLM, resolveConfig } from "../_shared/llm.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const tib = (months: unknown) => {
  const m = Number(months);
  if (!m || Number.isNaN(m)) return null;
  if (m < 12) return `${m} months`;
  const y = Math.floor(m / 12);
  const r = m % 12;
  return r ? `${y} yr ${r} mo` : `${y} yr`;
};

const money = (n: unknown) =>
  n == null || n === "" ? null : `$${Number(n).toLocaleString("en-US")}`;

// Array/string field is "present" when it holds something meaningful.
function has(v: unknown): boolean {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.trim() !== "";
  return true;
}

// deno-lint-ignore no-explicit-any
type Lender = Record<string, any>;

// The criteria/submission fields we hand the model. A lender is "usable" for
// recommendation if it has a name plus at least one of these populated.
const LENDER_FIELDS = [
  "lender_types", "funding_products", "paper_types",
  "min_funding_amount", "max_funding_amount", "min_time_in_business",
  "min_monthly_revenue", "min_credit_score", "requires_collateral",
  "industries_restricted", "industries_preferred",
  "states_available", "states_restricted",
  "factor_rate_range", "funding_speed", "stacking_policy",
  "submission_email", "submission_portal_url", "submission_notes", "notes",
] as const;

// Compact one-funder view — drop empty fields so the prompt stays lean and the
// model isn't misled by nulls.
function lenderForPrompt(l: Lender) {
  const out: Record<string, unknown> = {
    lender_id: l.id,
    lender_name: l.company_name,
    status: l.status,
  };
  for (const f of LENDER_FIELDS) {
    if (has(l[f])) out[f] = l[f];
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const db = serviceClient();

    // Provider/model come from the pluggable LLM layer (task "recommend_lenders"),
    // super-admin-switchable in Admin → Integrations → AI Provider. The model
    // label is surfaced in the response and persisted with the recommendations.
    const { model } = await resolveConfig(db, "recommend_lenders");

    const body = await req.json().catch(() => ({}));
    const dealId = (body?.deal_id ?? body?.dealId) as string | undefined;
    if (!dealId) return json({ error: "deal_id is required" }, 400);

    // 1) Deal + merchant.
    const { data: deal, error: dErr } = await db
      .from("deals")
      .select("id, deal_type, status, amount_requested, use_of_funds, vcf_active_positions, customer:customers!customer_id(business_name, monthly_revenue, time_in_business, industry, business_type, address_state, credit_score_range, ein)")
      .eq("id", dealId).single();
    if (dErr || !deal) return json({ error: `deal not found: ${dErr?.message}` }, 404);
    const cust = (deal.customer ?? {}) as Lender;

    // 2) Funder network — pull everything, then keep the ones with a name and
    //    at least one criteria/submission field to reason about.
    const selectCols = ["id", "company_name", "status", ...LENDER_FIELDS].join(", ");
    const { data: lendersRaw, error: lErr } = await db
      .from("lenders").select(selectCols)
      // Only funders we actually have a relationship with — matches the Step 6
      // picker's filter (getMatchingLenders), so the AI never recommends a
      // funder the closer can't submit to.
      .in("status", ["live_vendor", "approved"]);
    if (lErr) return json({ error: `could not load lenders: ${lErr.message}` }, 502);
    const lenders = ((lendersRaw ?? []) as Lender[])
      .filter((l) => l.company_name && LENDER_FIELDS.some((f) => has(l[f])));
    if (lenders.length === 0) {
      return json({ error: "No funders with usable criteria in the network yet." }, 422);
    }

    // 3) Merchant profile + which fields are missing (be honest about gaps).
    const profile = {
      business_name: cust.business_name ?? null,
      product_requested: deal.deal_type,
      amount_requested: money(deal.amount_requested),
      monthly_revenue: money(cust.monthly_revenue),
      time_in_business: tib(cust.time_in_business),
      industry: cust.industry ?? cust.business_type ?? null,
      state: cust.address_state ?? null,
      credit: cust.credit_score_range ?? null,
      use_of_funds: deal.use_of_funds ?? null,
      existing_positions: deal.vcf_active_positions ?? null,
    };
    const missingLabels: Record<string, string> = {
      monthly_revenue: "monthly revenue",
      time_in_business: "time in business",
      industry: "industry",
      state: "business state",
      credit: "credit score / range",
      amount_requested: "amount requested",
    };
    const missing_fields = Object.entries(missingLabels)
      .filter(([k]) => !profile[k as keyof typeof profile])
      .map(([, label]) => label);

    const productLabel = deal.deal_type === "mca" ? "MCA (purchase of future receivables)" : deal.deal_type;

    const system =
      "You are an MCA underwriting analyst for an ISO (Independent Sales Organization / broker) " +
      "matching a merchant to the right funders in the ISO's network. " +
      "An MCA is a purchase of future receivables, NOT a loan — never call it a loan or use lending terms for MCA deals. " +
      "Rank funders by how well the merchant profile fits each funder's stated criteria " +
      "(funding range, minimum time in business, minimum monthly revenue, " +
      "industry preferences/restrictions, state availability/restrictions, stacking policy, product type). " +
      "IMPORTANT — credit score weighting: MCA underwriting is revenue/cash-flow based; most MCA funders " +
      "have NO credit minimum, and an unknown credit score is NORMAL at this stage. Never treat unknown credit " +
      "as a global blocker, never make obtaining a credit score a general priority action, and never downgrade " +
      "a funder's fit for unknown credit UNLESS that specific funder has a stated min_credit_score — mention " +
      "credit only in that funder's own watch_outs. " +
      "Be honest and explicit about other missing data — never invent facts. " +
      "Recommend 3 to 7 funders, best first. " +
      'A "strong" fit clearly meets the stated criteria; "possible" is plausible but has gaps or unknowns; ' +
      '"poor" is a likely mismatch (include only if few good options exist). ' +
      "Return ONLY a single strict JSON object, no prose or markdown, of the exact shape: " +
      '{"recommendations":[{"lender_id":string,"lender_name":string,"fit":"strong"|"possible"|"poor","reasons":string[],"watch_outs":string[]}],"summary":string}. ' +
      "Use the exact lender_id and lender_name from the provided funder list.";

    const user =
      `MERCHANT PROFILE (product requested: ${productLabel}):\n` +
      JSON.stringify(profile, null, 2) +
      (missing_fields.length ? `\n\nMissing/unknown merchant fields: ${missing_fields.join(", ")}.` : "") +
      `\n\nFUNDER NETWORK (${lenders.length} funders; only populated criteria are shown per funder):\n` +
      JSON.stringify(lenders.map(lenderForPrompt), null, 2) +
      `\n\nReturn the ranked JSON now.`;

    // 4) Call the active LLM provider (task "recommend_lenders"). callLLM
    //    resolves provider/model from llm_settings, loads the key server-side,
    //    dispatches to the right protocol, and returns assistant text with
    //    ```json fences stripped. A provider/HTTP error throws a clear message.
    let text: string;
    try {
      text = await callLLM(db, {
        system,
        prompt: user,
        maxTokens: 4096,
        temperature: 0.2,
        jsonMode: true,
        task: "recommend_lenders",
      });
    } catch (e) {
      return json({ error: String(e instanceof Error ? e.message : e) }, 502);
    }

    // 5) Parse defensively — extract the JSON object even if wrapped in prose.

    let parsed: { recommendations?: unknown; summary?: unknown } | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end > start) {
        try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ }
      }
    }
    if (!parsed || !Array.isArray(parsed.recommendations)) {
      return json({ error: "Could not parse AI response.", raw: text.slice(0, 500) }, 502);
    }

    // Keep only recommendations that point at a real funder in the list.
    const validIds = new Map(lenders.map((l) => [l.id, l.company_name]));
    const fits = new Set(["strong", "possible", "poor"]);
    // deno-lint-ignore no-explicit-any
    const recommendations = (parsed.recommendations as any[])
      .filter((r) => r && validIds.has(r.lender_id))
      .map((r) => ({
        lender_id: r.lender_id as string,
        lender_name: validIds.get(r.lender_id) as string,
        fit: fits.has(r.fit) ? r.fit : "possible",
        reasons: Array.isArray(r.reasons) ? r.reasons.filter((x: unknown) => typeof x === "string") : [],
        watch_outs: Array.isArray(r.watch_outs) ? r.watch_outs.filter((x: unknown) => typeof x === "string") : [],
      }));
    // Persist — these recommendations cost tokens; the picker rehydrates from
    // the deal so a reload never throws them away.
    await db.from("deals").update({
      ai_lender_recommendations: { summary: parsed.summary ?? "", recommendations: parsed.recommendations ?? [] },
      ai_recommended_at: new Date().toISOString(),
    }).eq("id", dealId);


    return json({
      ok: true,
      deal_id: dealId,
      model,
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      recommendations,
      missing_fields,
      considered: lenders.length,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
