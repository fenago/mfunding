// analyze-campaign — AI performance read on ONE lead-gen campaign.
//
// POST body: { "campaignId": "<uuid>" }
//
// Loads the campaign + every deal attributed to it (campaign_id), computes the
// funnel KPIs DETERMINISTICALLY in code (never by the model), gathers the same
// aggregate for the campaign's CHANNEL peers so the model can compare head-to-
// head, then asks Claude for a structured verdict + recommendations. The run is
// stored in campaign_analyses (history) and returned.
//
// Auth: verify_jwt = true PLUS an in-code staff role check (mirrors
// get-funder-email). The Anthropic key is loaded server-side by callLLM and is
// never returned to the caller.
//
// Compliance: an MCA is a purchase of future receivables, NOT a loan — the
// system prompt enforces that language. The model reasons about marketing
// performance, never about loan terms.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";
import { callLLM, resolveConfig } from "../_shared/llm.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const COMMISSION_RATE = 0.08;
const FUNDED_STATUS = new Set(["funded", "restructure_executed"]);
const DEAD_STATUS = new Set(["declined", "lost", "nurture", "closed_lost"]);

// deno-lint-ignore no-explicit-any
type Deal = Record<string, any>;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const has = (v: unknown) => v != null && v !== "";
const rate = (num0: number, den: number) => (den > 0 ? (num0 / den) * 100 : null);
const div = (a: number, b: number) => (b > 0 ? a / b : null);
const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

interface Kpis {
  leads: number;
  contacted: number;
  qualified: number;
  appSent: number;
  docs: number;
  submitted: number;
  offer: number;
  funded: number;
  spend: number;
  fundedAmount: number;
  revenue: number;
  cpl: number | null;
  costPerContact: number | null;
  contactRate: number | null;
  qualifyRate: number | null;
  applicationRate: number | null;
  submissionRate: number | null;
  closeRate: number | null;
  costPerFunded: number | null;
  roas: number | null;
  avgDealSize: number | null;
  pipelineValue: number;
  speedToFirstTouchHours: number | null;
}

// Compute the full KPI set from a set of deals + a spend figure.
function computeKpis(deals: Deal[], spend: number): Kpis {
  const leads = deals.length;
  let contacted = 0, qualified = 0, appSent = 0, docs = 0, submitted = 0, offer = 0, funded = 0;
  let fundedAmount = 0, pipelineValue = 0;
  let touchSumHours = 0, touchCount = 0;

  for (const d of deals) {
    if (has(d.contacted_at)) contacted++;
    if (has(d.qualified_at)) qualified++;
    if (has(d.application_sent_at)) appSent++;
    if (has(d.docs_collected_at) || has(d.bank_statements_at)) docs++;
    if (has(d.submitted_at)) submitted++;
    if (has(d.offer_received_at) || has(d.offer_presented_at)) offer++;

    const isFunded = has(d.funded_at) || FUNDED_STATUS.has(d.status);
    if (isFunded) {
      funded++;
      fundedAmount += num(d.amount_funded);
    } else if (!DEAD_STATUS.has(d.status)) {
      pipelineValue += num(d.amount_requested);
    }

    if (has(d.contacted_at) && has(d.created_at)) {
      const hrs = (new Date(d.contacted_at).getTime() - new Date(d.created_at).getTime()) / 3_600_000;
      if (Number.isFinite(hrs) && hrs >= 0) {
        touchSumHours += hrs;
        touchCount++;
      }
    }
  }

  const revenue = fundedAmount * COMMISSION_RATE;
  return {
    leads, contacted, qualified, appSent, docs, submitted, offer, funded,
    spend,
    fundedAmount,
    revenue,
    cpl: div(spend, leads),
    costPerContact: div(spend, contacted),
    contactRate: rate(contacted, leads),
    qualifyRate: rate(qualified, contacted),
    applicationRate: rate(appSent, qualified),
    submissionRate: rate(submitted, appSent),
    closeRate: rate(funded, leads),
    costPerFunded: div(spend, funded),
    roas: div(revenue, spend),
    avgDealSize: div(fundedAmount, funded),
    pipelineValue,
    speedToFirstTouchHours: touchCount > 0 ? round1(touchSumHours / touchCount) : null,
  };
}

const spendOf = (c: Deal) => (num(c.spent) > 0 ? num(c.spent) : num(c.budget));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const db = serviceClient();

    // --- Authn/Authz: signed-in staff only (mirrors get-funder-email). ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid session" }, 401);
    const { data: callerProfile } = await db
      .from("profiles").select("role").eq("id", caller.id).single();
    const callerRole = callerProfile?.role as string | undefined;
    if (!callerRole || !["closer", "admin", "super_admin"].includes(callerRole)) {
      return json({ error: "Forbidden — staff only" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const campaignId = (body?.campaignId ?? body?.campaign_id) as string | undefined;
    if (!campaignId) return json({ error: "campaignId is required" }, 400);

    // 1) Campaign.
    const { data: campaign, error: cErr } = await db
      .from("campaigns")
      .select("id, code, name, channel, partner, status, budget, spent, leads_purchased, cost_per_lead_contracted, start_date, end_date, market, notes")
      .eq("id", campaignId).single();
    if (cErr || !campaign) return json({ error: `campaign not found: ${cErr?.message}` }, 404);

    // 2) This campaign's deals → KPIs.
    const dealCols = "id, campaign_id, status, amount_funded, amount_requested, created_at, contacted_at, qualified_at, application_sent_at, docs_collected_at, bank_statements_at, submitted_at, offer_received_at, offer_presented_at, funded_at, declined_at, nurture_at";
    const { data: dealsRaw, error: dErr } = await db
      .from("deals").select(dealCols).eq("campaign_id", campaignId);
    if (dErr) return json({ error: `could not load deals: ${dErr.message}` }, 502);
    const deals = (dealsRaw ?? []) as Deal[];
    const kpis = computeKpis(deals, spendOf(campaign));

    // 3) Channel peers → aggregate KPIs for head-to-head comparison.
    const { data: peersRaw } = await db
      .from("campaigns").select("id, budget, spent").eq("channel", campaign.channel);
    const peers = (peersRaw ?? []) as Deal[];
    const peerIds = peers.map((p) => p.id as string);
    const peerSpend = peers.reduce((s, p) => s + spendOf(p), 0);
    let channelAverages: (Kpis & { campaigns: number }) | { campaigns: number; note: string } = {
      campaigns: peers.length,
      note: "This is the only campaign in its channel — no peer comparison yet.",
    };
    if (peerIds.length > 1) {
      const { data: peerDealsRaw } = await db
        .from("deals").select(dealCols).in("campaign_id", peerIds);
      const peerKpis = computeKpis((peerDealsRaw ?? []) as Deal[], peerSpend);
      channelAverages = { ...peerKpis, campaigns: peers.length };
    }

    const benchmarks = {
      contact_rate_target_pct: ">= 65",
      close_rate_target_pct: "8 - 12",
      cost_per_funded_target: "< 1500",
      roas_target: ">= 1 (revenue >= spend)",
      golden_ratio: "cost per funded < $1,500 AND avg commission per funded > $4,000",
    };

    const { model } = await resolveConfig(db, "analyze_campaign");

    const system =
      "You are a performance-marketing analyst for an MCA (merchant cash advance — a purchase of future " +
      "receivables, NEVER a loan) ISO/brokerage. Analyze ONE lead-generation campaign against funnel " +
      "benchmarks and its channel peers. Be concrete and numeric; cite the actual KPI values. Never invent " +
      "data that was not provided. If the sample size is tiny (few leads, or no funded deals yet), say the " +
      "read is provisional and focus on setup/leading indicators rather than declaring the campaign a " +
      "success or failure. Compare against the benchmarks and the channelAverages when present. " +
      "Return ONLY strict JSON, no prose or markdown, of the EXACT shape: " +
      '{"verdict":"scale"|"keep"|"fix"|"kill","headline":string,"whats_working":string[],' +
      '"underperforming":string[],"projected_cost_per_funded":string,"recommendations":string[]}. ' +
      "verdict: scale = beating targets, put more budget in; keep = on track, hold; fix = fixable leak, " +
      "diagnose it; kill = structurally unprofitable, stop. recommendations MUST be exactly 3 concrete, " +
      "specific actions. projected_cost_per_funded = your best estimate of cost per funded deal at the " +
      "current pace, as a short string (e.g. \"~$1,250\" or \"unknown — no funded deals yet\").";

    const user =
      "Analyze this campaign.\n\n" +
      JSON.stringify(
        {
          campaign: {
            code: campaign.code,
            name: campaign.name,
            channel: campaign.channel,
            partner: campaign.partner,
            status: campaign.status,
            spend: kpis.spend,
            budget: num(campaign.budget),
            leads_purchased: campaign.leads_purchased ?? null,
            cost_per_lead_contracted: campaign.cost_per_lead_contracted ?? null,
          },
          kpis,
          benchmarks,
          funnel: {
            leads: kpis.leads,
            contacted: kpis.contacted,
            qualified: kpis.qualified,
            application_sent: kpis.appSent,
            docs_collected: kpis.docs,
            submitted: kpis.submitted,
            offer: kpis.offer,
            funded: kpis.funded,
          },
          channelAverages,
        },
        null,
        2,
      ) +
      "\n\nReturn the strict JSON verdict now.";

    let text: string;
    try {
      text = await callLLM(db, {
        system,
        prompt: user,
        maxTokens: 2048,
        temperature: 0.3,
        jsonMode: true,
        task: "analyze_campaign",
      });
    } catch (e) {
      return json({ error: String(e instanceof Error ? e.message : e) }, 502);
    }

    // Parse defensively — pull the JSON object even if wrapped in prose.
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end > start) {
        try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ }
      }
    }
    if (!parsed || typeof parsed.verdict !== "string") {
      return json({ error: "Could not parse AI response.", raw: text.slice(0, 500) }, 502);
    }

    const verdicts = new Set(["scale", "keep", "fix", "kill"]);
    const asStrArr = (v: unknown) =>
      Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    const analysis = {
      verdict: verdicts.has(parsed.verdict as string) ? (parsed.verdict as string) : "keep",
      headline: typeof parsed.headline === "string" ? parsed.headline : "",
      whats_working: asStrArr(parsed.whats_working),
      underperforming: asStrArr(parsed.underperforming),
      projected_cost_per_funded:
        typeof parsed.projected_cost_per_funded === "string" ? parsed.projected_cost_per_funded : "",
      recommendations: asStrArr(parsed.recommendations),
    };

    // Persist the run (history). Service client → bypasses RLS; created_by is
    // null in this server context.
    const { data: inserted, error: insErr } = await db
      .from("campaign_analyses")
      .insert({
        campaign_id: campaignId,
        verdict: analysis.verdict,
        summary: analysis.headline,
        analysis,
        kpis_snapshot: kpis,
        model,
      })
      .select("id, created_at")
      .single();
    if (insErr) return json({ error: `could not store analysis: ${insErr.message}` }, 502);

    return json({
      ok: true,
      id: inserted?.id,
      created_at: inserted?.created_at,
      campaign_id: campaignId,
      model,
      analysis,
      kpis,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
