import supabase from "../supabase";
import type { Campaign } from "./campaignService";

// ─────────────────────────────────────────────────────────────────────────────
// Campaign Monte Carlo — the DATA layer.
//
// Pulls one campaign's HONEST funnel from live tables and shapes it into
// simulation inputs. "Honest" = the harder-to-fake signals, matching the way the
// Campaign Audit reads quality in week 2 (small samples, zero funded yet):
//
//   leads      — deals attributed to the campaign (campaign_id)
//   dialed     — deal has ≥1 outbound call logged (ghl_call_log)
//   connected  — deal has ≥1 COMPLETED call ≥30s (a pickup, not a voicemail)
//   conversation — deal has ≥1 COMPLETED call ≥120s (a real 2-minute talk)
//   app sent   — deals.application_sent_at
//   app back   — the merchant COMPLETED the application doc (ghl_doc_completions,
//                app-doc names only — the 04/PREFILL application, not the
//                broker-comp disclosure)
//   submitted  — deals.submitted_at
//   offer      — deals.offer_received_at / offer_presented_at
//   funded     — deals.funded_at (or a funded status)
//
// Why call-duration and doc-completion instead of the deals.contacted_at /
// qualified_at timestamps a closer can set with a click: those softer stamps are
// what the audit flags as gameable. Grounding the projection in call seconds and
// signed docs makes it honest about where a campaign actually stands.
//
// NO FABRICATION: a signal absent from our data is reported as a zero denominator
// (→ the simulation leans entirely on the prior for that stage) or a null cost,
// never invented. Every read is best-effort: a permission/transient error on a
// secondary table degrades THAT signal, it does not fail the pull.
// ─────────────────────────────────────────────────────────────────────────────

export type McStageKey =
  | "dial"
  | "connect"
  | "conversation"
  | "appSent"
  | "appBack"
  | "submit"
  | "offer"
  | "fund";

export interface McStage {
  key: McStageKey;
  label: string;
  /** what the numerator counts, for the tooltip */
  num: number;
  /** the denominator (previous honest stage) */
  denom: number;
}

export interface McDealSize {
  /** lognormal params for advance $ per funded deal */
  mu: number;
  sigma: number;
  /** implied mean advance (exp(mu + sigma²/2)) — for display / the knob default */
  mean: number;
  source: "fitted" | "default";
  /** how many campaign observations the fit used */
  n: number;
}

export interface CampaignMcInputs {
  campaignId: string;
  leads: number;
  /** the 8 transition stages, in chain order, each with observed num/denom */
  stages: McStage[];
  /** leads/week over the campaign's active life; null when there are no deals yet */
  weeklyPace: number | null;
  dealSize: McDealSize;
  /** cost per lead we can defend, or null when no spend/contract is on record */
  costPerLead: number | null;
  costSource: "contracted" | "observed" | null;
}

// ── The application doc. The merchant "returned the app" when they completed the
// 04 / PREFILL application — NOT the broker compensation disclosure (which is a
// separate signature and would over-count). See [[two-path-doc-send]].
const APP_DOC_RE = /\b04|prefill|application/i;
const COMPLETED = "completed";

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const has = (v: unknown) => v != null && v !== "";

// ── Row shapes (only the columns we read) ────────────────────────────────────
interface DealRow {
  id: string;
  customer_id: string | null;
  status: string;
  amount_requested: number | null;
  created_at: string | null;
  application_sent_at: string | null;
  submitted_at: string | null;
  offer_received_at: string | null;
  offer_presented_at: string | null;
  funded_at: string | null;
}

interface CallRow {
  deal_id: string | null;
  call_status: string | null;
  duration_seconds: number | null;
}

interface UwRow {
  deal_id: string;
  version: number | null;
  metrics: Record<string, unknown> | null;
}

const DEAL_SELECT =
  "id, customer_id, status, amount_requested, created_at, application_sent_at, " +
  "submitted_at, offer_received_at, offer_presented_at, funded_at";

const FUNDED_STATUSES = new Set(["funded", "restructure_executed"]);

/**
 * Pull one campaign's honest funnel + a data-fitted deal-size distribution.
 * Everything reads LIVE — call it on open and on the Refresh button.
 */
export async function getCampaignMcInputs(campaign: Campaign): Promise<CampaignMcInputs> {
  const { data: dealsData, error } = await supabase
    .from("deals")
    .select(DEAL_SELECT)
    .eq("campaign_id", campaign.id);
  if (error) throw error;
  const deals = (dealsData ?? []) as unknown as DealRow[];

  const dealIds = deals.map((d) => d.id);
  const customerIds = [...new Set(deals.map((d) => d.customer_id).filter(Boolean) as string[])];

  // Secondary reads in parallel; each swallows its own error (best-effort).
  const [callsByDeal, appBackCustomers, uwByDeal] = await Promise.all([
    fetchCalls(dealIds),
    fetchAppReturns(customerIds),
    fetchLatestUnderwriting(dealIds),
  ]);

  return fold(campaign, deals, callsByDeal, appBackCustomers, uwByDeal);
}

async function fetchCalls(dealIds: string[]): Promise<Map<string, CallRow[]>> {
  const map = new Map<string, CallRow[]>();
  if (dealIds.length === 0) return map;
  const { data, error } = await supabase
    .from("ghl_call_log")
    .select("deal_id, call_status, duration_seconds")
    .in("deal_id", dealIds);
  if (error) return map; // call-based tiers degrade to zero denominators (→ prior)
  for (const r of (data ?? []) as CallRow[]) {
    if (!r.deal_id) continue;
    const arr = map.get(r.deal_id) ?? [];
    arr.push(r);
    map.set(r.deal_id, arr);
  }
  return map;
}

async function fetchAppReturns(customerIds: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  if (customerIds.length === 0) return set;
  const { data, error } = await supabase
    .from("ghl_doc_completions")
    .select("customer_id, doc_name")
    .in("customer_id", customerIds);
  if (error) return set;
  for (const r of (data ?? []) as { customer_id: string | null; doc_name: string | null }[]) {
    if (r.customer_id && r.doc_name && APP_DOC_RE.test(r.doc_name)) set.add(r.customer_id);
  }
  return set;
}

async function fetchLatestUnderwriting(dealIds: string[]): Promise<Map<string, UwRow>> {
  const map = new Map<string, UwRow>();
  if (dealIds.length === 0) return map;
  const { data, error } = await supabase
    .from("deal_underwriting")
    .select("deal_id, version, metrics")
    .in("deal_id", dealIds);
  if (error) return map;
  for (const r of (data ?? []) as UwRow[]) {
    const prev = map.get(r.deal_id);
    if (!prev || (r.version ?? 0) >= (prev.version ?? 0)) map.set(r.deal_id, r);
  }
  return map;
}

// ── The fold — honest counts + deal-size fit for one campaign ─────────────────
function fold(
  campaign: Campaign,
  deals: DealRow[],
  callsByDeal: Map<string, CallRow[]>,
  appBackCustomers: Set<string>,
  uwByDeal: Map<string, UwRow>,
): CampaignMcInputs {
  const leads = deals.length;

  let dialed = 0,
    connected = 0,
    conversation = 0,
    appSent = 0,
    appBack = 0,
    submitted = 0,
    offer = 0,
    funded = 0;

  const sizeSamples: number[] = [];
  let earliest = Number.POSITIVE_INFINITY;

  for (const d of deals) {
    if (has(d.created_at)) {
      const t = Date.parse(d.created_at!);
      if (Number.isFinite(t)) earliest = Math.min(earliest, t);
    }

    // ── call-based honest tiers ──
    const calls = callsByDeal.get(d.id) ?? [];
    if (calls.length > 0) dialed += 1;
    const completed = calls.filter((c) => (c.call_status ?? "").toLowerCase() === COMPLETED);
    if (completed.some((c) => (c.duration_seconds ?? 0) >= 30)) connected += 1;
    if (completed.some((c) => (c.duration_seconds ?? 0) >= 120)) conversation += 1;

    // ── app sent / app returned ──
    if (has(d.application_sent_at)) appSent += 1;
    if (d.customer_id && appBackCustomers.has(d.customer_id)) appBack += 1;

    // ── submit / offer / fund (deal stage timestamps) ──
    if (has(d.submitted_at)) submitted += 1;
    if (has(d.offer_received_at) || has(d.offer_presented_at)) offer += 1;
    if (has(d.funded_at) || FUNDED_STATUSES.has(d.status)) funded += 1;

    // ── deal-size observation (honest advance sizing) ──
    const uw = uwByDeal.get(d.id);
    const m = uw?.metrics ?? {};
    const maxAff = num((m as Record<string, unknown>).max_affordable_advance);
    const trueRev = num((m as Record<string, unknown>).true_avg_monthly_revenue);
    const amtReq =
      num(d.amount_requested) ?? num((m as Record<string, unknown>).amount_requested);
    // Prefer the underwriting's max affordable advance (bank-verified capacity),
    // then ~1 month of bank-verified revenue (a clean first position), then the
    // merchant's stated ask. Everything else is left out — never invented.
    const obs =
      maxAff && maxAff > 0
        ? maxAff
        : trueRev && trueRev > 0
          ? trueRev
          : amtReq && amtReq > 0
            ? amtReq
            : null;
    if (obs != null) sizeSamples.push(obs);
  }

  const stages: McStage[] = [
    { key: "dial", label: "Dialed", num: dialed, denom: leads },
    { key: "connect", label: "Connected (≥30s)", num: connected, denom: dialed },
    { key: "conversation", label: "Real conversation (≥2m)", num: conversation, denom: connected },
    { key: "appSent", label: "Application sent", num: appSent, denom: conversation },
    { key: "appBack", label: "Application returned", num: appBack, denom: appSent },
    { key: "submit", label: "Submitted to funder", num: submitted, denom: appBack },
    { key: "offer", label: "Offer received", num: offer, denom: submitted },
    { key: "fund", label: "Funded", num: funded, denom: offer },
  ];

  // Weekly pace over the campaign's active life.
  let weeklyPace: number | null = null;
  if (leads > 0 && Number.isFinite(earliest)) {
    const weeks = Math.max(1, (Date.now() - earliest) / (7 * 86_400_000));
    weeklyPace = leads / weeks;
  }

  const costPerLead = costOf(campaign);

  return {
    campaignId: campaign.id,
    leads,
    stages,
    weeklyPace,
    dealSize: fitDealSize(sizeSamples),
    costPerLead: costPerLead.value,
    costSource: costPerLead.source,
  };
}

// Contracted CPL is the cleanest cost; else spend/leads if any spend is logged.
function costOf(c: Campaign): { value: number | null; source: "contracted" | "observed" | null } {
  const contracted = num(c.cost_per_lead_contracted);
  if (contracted && contracted > 0) return { value: contracted, source: "contracted" };
  const spent = num(c.spent) ?? 0;
  const purchased = num(c.leads_purchased);
  if (spent > 0 && purchased && purchased > 0)
    return { value: spent / purchased, source: "observed" };
  return { value: null, source: null };
}

const DEFAULT_AVG_FUNDED = 50_000;
const DEFAULT_CV = 0.4; // lognormal spread when we have no fit
const SIGMA_FLOOR = 0.15;
const SIGMA_CAP = 1.2;

/**
 * Fit a lognormal to the campaign's own advance-size observations via log-moments.
 * Falls back to the book-wide default ($50k, CV 40%) when there aren't enough
 * clean observations to trust a fit.
 */
export function fitDealSize(samples: number[]): McDealSize {
  const pos = samples.filter((s) => s > 0);
  if (pos.length >= 3) {
    const logs = pos.map((s) => Math.log(s));
    const meanLog = logs.reduce((a, b) => a + b, 0) / logs.length;
    const varLog = logs.reduce((a, b) => a + (b - meanLog) * (b - meanLog), 0) / logs.length;
    let sigma = Math.sqrt(Math.max(0, varLog));
    if (!Number.isFinite(sigma) || sigma < SIGMA_FLOOR) sigma = SIGMA_FLOOR;
    if (sigma > SIGMA_CAP) sigma = SIGMA_CAP;
    const mu = meanLog;
    return { mu, sigma, mean: Math.exp(mu + (sigma * sigma) / 2), source: "fitted", n: pos.length };
  }
  const sigma = Math.sqrt(Math.log(1 + DEFAULT_CV * DEFAULT_CV));
  const mu = Math.log(DEFAULT_AVG_FUNDED) - (sigma * sigma) / 2;
  return { mu, sigma, mean: DEFAULT_AVG_FUNDED, source: "default", n: pos.length };
}
