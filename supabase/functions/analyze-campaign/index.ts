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

// Call-tier thresholds (seconds). Contactability comes from ghl_call_log ONLY —
// deals.contacted_at is stamped by stage moves + a July backfill, so it inflates
// "contact" well above real call truth. Mirrors campaignAuditService's tiers.
const CONNECTED_SECS = 30;
const REAL_CONVO_SECS = 120;

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

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

interface Kpis {
  leads: number;
  // Contactability from call logs (see CONNECTED_SECS/REAL_CONVO_SECS), NOT contacted_at.
  dialed: number;                // >=1 outbound call
  connected: number;             // an outbound call >=30s (incl. voicemail pickups)
  realConversations: number;     // an outbound call >=120s — a genuine conversation
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
  costPerConnect: number | null;
  dialedRate: number | null;
  connectedRate: number | null;
  realConversationRate: number | null;  // the PRIMARY contact number — a call-truth tier
  qualifyRate: number | null;           // qualified / connected
  applicationRate: number | null;
  submissionRate: number | null;
  closeRate: number | null;
  costPerFunded: number | null;
  roas: number | null;
  avgDealSize: number | null;
  pipelineValue: number;
  speedToFirstDialHours: number | null; // median created_at → first outbound dial
}

// Per-deal outbound-call summary folded from ghl_call_log.
interface CallSummary { calls: number; maxDuration: number; firstDialAt: string | null; }

// Fold outbound calls per deal. Attribute by deal_id, or — for rows with no deal_id —
// by matching ghl_contact_id (a lead usually has one deal per contact). Mirrors
// campaignAuditService.fetchCallSummaries and the frontend campaignService duplicate.
// deno-lint-ignore no-explicit-any
async function fetchCallSummaries(db: any, deals: Deal[]): Promise<Map<string, CallSummary>> {
  const map = new Map<string, CallSummary>();
  const dealIds = deals.map((d) => d.id as string);
  if (dealIds.length === 0) return map;
  const contactIds = [...new Set(deals.map((d) => d.ghl_contact_id).filter(Boolean) as string[])];
  const cols = "deal_id, ghl_contact_id, direction, duration_seconds, called_at";

  const [a, b] = await Promise.all([
    db.from("ghl_call_log").select(cols).eq("direction", "outbound").in("deal_id", dealIds),
    contactIds.length
      ? db.from("ghl_call_log").select(cols).eq("direction", "outbound").is("deal_id", null).in("ghl_contact_id", contactIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const byId = (a.error ? [] : (a.data ?? [])) as Deal[];
  const byContact = (b.error ? [] : (b.data ?? [])) as Deal[];

  const dealsByContact = new Map<string, string[]>();
  for (const d of deals) {
    if (d.ghl_contact_id) {
      const arr = dealsByContact.get(d.ghl_contact_id) ?? [];
      arr.push(d.id as string);
      dealsByContact.set(d.ghl_contact_id, arr);
    }
  }
  const apply = (dealId: string, c: Deal) => {
    const s = map.get(dealId) ?? { calls: 0, maxDuration: 0, firstDialAt: null };
    s.calls += 1;
    s.maxDuration = Math.max(s.maxDuration, num(c.duration_seconds));
    if (c.called_at && (!s.firstDialAt || c.called_at < s.firstDialAt)) s.firstDialAt = c.called_at;
    map.set(dealId, s);
  };
  for (const c of byId) if (c.deal_id) apply(c.deal_id as string, c);
  for (const c of byContact) {
    if (!c.ghl_contact_id) continue;
    for (const dealId of dealsByContact.get(c.ghl_contact_id) ?? []) apply(dealId, c);
  }
  return map;
}

// Compute the full KPI set from a set of deals + a spend figure + call summaries.
function computeKpis(deals: Deal[], spend: number, callByDeal: Map<string, CallSummary>): Kpis {
  const leads = deals.length;
  let dialed = 0, connected = 0, realConversations = 0;
  let qualified = 0, appSent = 0, docs = 0, submitted = 0, offer = 0, funded = 0;
  let fundedAmount = 0, pipelineValue = 0;
  const firstDialHours: number[] = [];

  for (const d of deals) {
    const cs = callByDeal.get(d.id as string);
    const calls = cs?.calls ?? 0;
    const maxDur = cs?.maxDuration ?? 0;
    if (calls > 0) dialed++;
    if (maxDur >= CONNECTED_SECS) connected++;
    if (maxDur >= REAL_CONVO_SECS) realConversations++;
    if (cs?.firstDialAt && has(d.created_at)) {
      const hrs = (new Date(cs.firstDialAt).getTime() - new Date(d.created_at).getTime()) / 3_600_000;
      if (Number.isFinite(hrs) && hrs >= 0) firstDialHours.push(hrs); // guard negatives
    }

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
  }

  const revenue = fundedAmount * COMMISSION_RATE;
  const speed = median(firstDialHours);
  return {
    leads, dialed, connected, realConversations,
    qualified, appSent, docs, submitted, offer, funded,
    spend,
    fundedAmount,
    revenue,
    cpl: div(spend, leads),
    costPerConnect: div(spend, connected),
    dialedRate: rate(dialed, leads),
    connectedRate: rate(connected, leads),
    realConversationRate: rate(realConversations, leads),
    qualifyRate: rate(qualified, connected),
    applicationRate: rate(appSent, qualified),
    submissionRate: rate(submitted, appSent),
    closeRate: rate(funded, leads),
    costPerFunded: div(spend, funded),
    roas: div(revenue, spend),
    avgDealSize: div(fundedAmount, funded),
    pipelineValue,
    speedToFirstDialHours: speed == null ? null : round1(speed),
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
    const dealCols = "id, campaign_id, ghl_contact_id, status, amount_funded, amount_requested, created_at, qualified_at, application_sent_at, docs_collected_at, bank_statements_at, submitted_at, offer_received_at, offer_presented_at, funded_at, declined_at, nurture_at";
    const { data: dealsRaw, error: dErr } = await db
      .from("deals").select(dealCols).eq("campaign_id", campaignId);
    if (dErr) return json({ error: `could not load deals: ${dErr.message}` }, 502);
    const deals = (dealsRaw ?? []) as Deal[];
    const kpis = computeKpis(deals, spendOf(campaign), await fetchCallSummaries(db, deals));

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
      const peerDeals = (peerDealsRaw ?? []) as Deal[];
      const peerKpis = computeKpis(peerDeals, peerSpend, await fetchCallSummaries(db, peerDeals));
      channelAverages = { ...peerKpis, campaigns: peers.length };
    }

    const benchmarks = {
      // contactability is measured from CALL LOGS in three tiers (dialedRate,
      // connectedRate ≥30s incl. voicemail, realConversationRate ≥2min). These are
      // NOT the old contacted_at stage flag and run far lower — a single-digit to
      // low-double-digit realConversationRate is normal for outbound MCA, not a
      // failure. Judge reach by dialing effort + connect/real-convo tiers together.
      dialed_rate_note: "share of leads with >=1 outbound dial — a dialing-effort/coverage signal",
      connected_rate_note: ">=30s answered (incl. voicemail); healthy outbound often 30-60%",
      real_conversation_rate_note: ">=2min live talk; typically 5-15% — do NOT treat 10% as a failure",
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
      "success or failure. Contactability is measured from CALL LOGS in three tiers — dialedRate, " +
      "connectedRate (>=30s, incl. voicemail), and realConversationRate (>=2min live talk) — NOT a stage " +
      "flag; real-conversation rates in outbound MCA are structurally low (single digits to ~15%), so do " +
      "not call a 10% real-conversation rate a failure. Compare against the benchmarks and channelAverages when present. " +
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
            dialed: kpis.dialed,
            connected: kpis.connected,
            real_conversations: kpis.realConversations,
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
