import supabase from "../supabase";
import { mustWrite } from "@/supabase/writes";

export type CampaignChannel =
  | "live_transfer"
  | "realtime_transfer"
  | "ucc"
  | "aged"
  | "email"
  | "web_purchased"
  | "google_ads"
  | "referral"
  | "seo"
  | "social"
  | "trigger"
  | "other"
  // Legacy channel slugs kept so pre-existing rows keep rendering.
  | "real_time"
  | "aged_leads"
  | "aged_transfer"
  | "cold_email";

export type CampaignStatus = "draft" | "active" | "paused" | "completed";

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  done_at: string | null;
  done_by: string | null;
  note: string;
  value: string | null;   // free-text infra artifact (phone number, email alias, …)
  needs_value?: boolean;  // when true, prompt for a `value`
}

export interface Campaign {
  id: string;
  code: string | null;
  name: string;
  channel: CampaignChannel;
  partner: string;
  status: CampaignStatus;
  budget: number;   // planned budget
  spent: number;    // actual spend
  cost_per_lead_contracted: number | null;
  leads_target: number | null;
  leads_purchased: number | null; // how many leads we actually BOUGHT (true acquisition cost)
  clicks: number | null;          // for click channels (Google Ads) → real CPC
  market: string | null;
  vendor_id: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  setup_checklist: ChecklistItem[];
  product_id: string | null;                     // Synergy catalog product key
  pricing_snapshot: Record<string, unknown> | null; // computed selection at create time
  created_at: string;
  updated_at: string;
}

export type CampaignInput = Omit<Campaign, "id" | "code" | "created_at" | "updated_at">;

// ── Channel metadata ─────────────────────────────────────────────────────────
// One place the app, the chips, and the checklist templates all read from.
export interface ChannelMeta {
  label: string;
  short: string; // matches the DB code abbreviation
  chip: string;  // tailwind classes for the channel chip
}

export const CHANNEL_META: Record<CampaignChannel, ChannelMeta> = {
  live_transfer: { label: "Live Transfer", short: "LT", chip: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  realtime_transfer: { label: "Real-Time Transfer", short: "RT", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  ucc: { label: "UCC Data", short: "UCC", chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  aged: { label: "Aged Leads", short: "AGE", chip: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  email: { label: "Cold Email", short: "EM", chip: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
  web_purchased: { label: "Purchased Web Leads", short: "WEB", chip: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" },
  google_ads: { label: "Google Ads", short: "GAD", chip: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
  referral: { label: "Referral", short: "REF", chip: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300" },
  seo: { label: "SEO / Organic", short: "SEO", chip: "bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-300" },
  social: { label: "Social", short: "SOC", chip: "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300" },
  trigger: { label: "Trigger Leads", short: "TRG", chip: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" },
  other: { label: "Other", short: "OTH", chip: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300" },
  // Legacy slugs → sensible labels/colors so old rows still render.
  real_time: { label: "Real-Time / Appointment", short: "RT", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  aged_leads: { label: "Aged Leads", short: "AGE", chip: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  aged_transfer: { label: "Aged Live Transfers", short: "AGE", chip: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  cold_email: { label: "Cold Email", short: "EM", chip: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" },
};

// Backward-compatible export (old code imported CHANNEL_LABELS).
export const CHANNEL_LABELS: Record<CampaignChannel, string> = Object.fromEntries(
  Object.entries(CHANNEL_META).map(([k, v]) => [k, v.label]),
) as Record<CampaignChannel, string>;

// Channels offered in the "New campaign" picker (canonical set, no legacy dupes).
export const SELECTABLE_CHANNELS: CampaignChannel[] = [
  "realtime_transfer", "live_transfer", "ucc", "aged", "email",
  "web_purchased", "google_ads", "referral", "seo", "social", "trigger", "other",
];

export const STATUSES: CampaignStatus[] = ["draft", "active", "paused", "completed"];

// ── Channel-driven setup checklists ──────────────────────────────────────────
// The "don't forget" reminders auto-attached when a campaign is created. Each
// item carries who/when it was completed and an optional infra `value` (the
// phone number or email alias created for the campaign) so you can look back and
// know exactly what belonged to it.
type ChecklistTemplateItem = { key: string; label: string; needs_value?: boolean };

const CHECKLIST_TEMPLATES: Partial<Record<CampaignChannel, ChecklistTemplateItem[]>> = {
  live_transfer: [
    { key: "tracking_number", label: "Create a DEDICATED GHL tracking phone number for this campaign + record it here", needs_value: true },
    { key: "qual_specs", label: "Confirm vendor qualification specs (6+ mo TIB, $15K+/mo, owner on line, TCPA, exclusive)" },
    { key: "routing", label: "Set lead routing / round-robin" },
    { key: "billing_policy", label: "Confirm billing / replacement (bad-lead credit) policy" },
  ],
  realtime_transfer: [
    { key: "inbound_email", label: "Create a dedicated inbound email/alias for this campaign + record it here", needs_value: true },
    { key: "intake_procedure", label: "Define the intake procedure (who enters the emailed lead + speed-to-call SLA < 5 min)" },
    { key: "send_format", label: "Confirm vendor send format + get a test lead through" },
    { key: "attribution_default", label: "Set campaign attribution default (closers pick this campaign at intake)" },
  ],
  email: [
    { key: "sending_domain", label: "Create/warm a dedicated sending email + domain, record it here", needs_value: true },
    { key: "instantly_link", label: "Link the Instantly campaign" },
    { key: "suppression", label: "DNC / suppression list confirmed" },
  ],
  ucc: [
    { key: "list_import", label: "Load the list via Lead Import with this campaign attached" },
    { key: "dnc_scrub", label: "DNC scrub confirmed" },
    { key: "sequence", label: "Assign the follow-up sequence" },
  ],
  aged: [
    { key: "list_import", label: "Load the list via Lead Import with this campaign attached" },
    { key: "dnc_scrub", label: "DNC scrub confirmed" },
    { key: "sequence", label: "Assign the follow-up sequence" },
  ],
};

// Legacy slugs reuse the canonical template.
const CHANNEL_TEMPLATE_ALIAS: Partial<Record<CampaignChannel, CampaignChannel>> = {
  real_time: "realtime_transfer",
  cold_email: "email",
  aged_leads: "aged",
  aged_transfer: "aged",
};

const GENERIC_CHECKLIST: ChecklistTemplateItem[] = [
  { key: "attribution", label: "Confirm how leads get attributed to this campaign (campaign_id set at intake)" },
  { key: "budget_spend", label: "Set the planned budget and log spend as it happens" },
  { key: "sequence", label: "Assign the follow-up sequence" },
];

/** The blank checklist for a channel, ready to attach to a new campaign. */
export function checklistForChannel(channel: CampaignChannel): ChecklistItem[] {
  const key = CHANNEL_TEMPLATE_ALIAS[channel] ?? channel;
  const template = CHECKLIST_TEMPLATES[key] ?? GENERIC_CHECKLIST;
  return template.map((t) => ({
    key: t.key,
    label: t.label,
    done: false,
    done_at: null,
    done_by: null,
    note: "",
    value: null,
    needs_value: t.needs_value ?? false,
  }));
}

/** Short reminder copy shown the moment a channel is picked in the create flow. */
export function channelReminder(channel: CampaignChannel): string {
  const key = CHANNEL_TEMPLATE_ALIAS[channel] ?? channel;
  switch (key) {
    case "live_transfer":
      return "Live transfers need a DEDICATED tracking number and confirmed qualification specs before the vendor turns it on.";
    case "realtime_transfer":
      return "Real-time transfers are emailed the instant they come in — set up the inbound alias and a < 5 min speed-to-call SLA now.";
    case "email":
      return "Cold email needs a warmed dedicated domain and a confirmed suppression list before the first send.";
    case "ucc":
    case "aged":
      return "Load the list through Lead Import with this campaign attached, scrub against DNC, and assign the follow-up sequence.";
    default:
      return "Confirm how leads get attributed to this campaign and assign a follow-up sequence.";
  }
}

// ── KPIs ─────────────────────────────────────────────────────────────────────
export interface CampaignMetrics {
  spent: number;
  leads: number;                 // attributed deals (leads that entered the pipeline)
  leadsPurchased: number | null; // leads we bought (from the campaign record)
  // Cumulative funnel counts (via stage timestamps).
  contacted: number;
  qualified: number;
  appSent: number;
  docs: number;
  submitted: number;
  offer: number;
  funded: number;
  byStatus: Record<string, number>;
  fundedAmount: number;          // sum of amount_funded
  estCommission: number;         // fundedAmount * commissionRate (the "revenue" to us)
  pipelineValue: number;         // amount_requested still in flight
  // Rates (0–100).
  contactPct: number | null;     // contacted / leads
  qualifyPct: number | null;     // qualified / contacted
  applicationPct: number | null; // appSent / qualified
  submissionPct: number | null;  // submitted / appSent
  closePct: number | null;       // funded / leads (overall close rate)
  // Cost / efficiency.
  acquisitionCpl: number | null; // spent / leadsPurchased — TRUE cost per lead bought
  costPerLead: number | null;    // spent / attributed leads
  costPerContact: number | null; // spent / contacted
  costPerFunded: number | null;  // spent / funded — the number that matters most
  cpc: number | null;            // spent / clicks (click channels only)
  avgDealSize: number | null;    // fundedAmount / funded
  roas: number | null;           // estCommission / spent
  roiPct: number | null;         // (estCommission - spent) / spent
  speedToFirstTouchHours: number | null;
}

// Average broker commission on a funded deal ≈ 8 points.
export const COMMISSION_RATE = 0.08;

const FUNDED = new Set(["funded", "restructure_executed"]);
const DEAD = new Set(["declined", "lost", "nurture", "closed_lost"]);

const has = (v: unknown) => v != null && v !== "";
const rate = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);
const div = (a: number, b: number) => (b > 0 ? a / b : null);

interface DealRow {
  campaign_id: string;
  status: string;
  amount_funded: number | null;
  amount_requested: number | null;
  created_at: string | null;
  contacted_at: string | null;
  qualified_at: string | null;
  application_sent_at: string | null;
  docs_collected_at: string | null;
  bank_statements_at: string | null;
  submitted_at: string | null;
  offer_received_at: string | null;
  offer_presented_at: string | null;
  funded_at: string | null;
}

// Mutable accumulator while we fold over deals.
interface Acc {
  leads: number;
  byStatus: Record<string, number>;
  contacted: number; qualified: number; appSent: number;
  docs: number; submitted: number; offer: number; funded: number;
  fundedAmount: number; pipelineValue: number;
  touchSumHours: number; touchCount: number;
}

const blankAcc = (): Acc => ({
  leads: 0, byStatus: {}, contacted: 0, qualified: 0, appSent: 0,
  docs: 0, submitted: 0, offer: 0, funded: 0, fundedAmount: 0, pipelineValue: 0,
  touchSumHours: 0, touchCount: 0,
});

function foldDeal(a: Acc, d: DealRow) {
  a.leads += 1;
  a.byStatus[d.status] = (a.byStatus[d.status] || 0) + 1;
  if (has(d.contacted_at)) a.contacted += 1;
  if (has(d.qualified_at)) a.qualified += 1;
  if (has(d.application_sent_at)) a.appSent += 1;
  if (has(d.docs_collected_at) || has(d.bank_statements_at)) a.docs += 1;
  if (has(d.submitted_at)) a.submitted += 1;
  if (has(d.offer_received_at) || has(d.offer_presented_at)) a.offer += 1;

  const isFunded = has(d.funded_at) || FUNDED.has(d.status);
  if (isFunded) {
    a.funded += 1;
    a.fundedAmount += Number(d.amount_funded) || 0;
  } else if (!DEAD.has(d.status)) {
    a.pipelineValue += Number(d.amount_requested) || 0;
  }
  if (has(d.contacted_at) && has(d.created_at)) {
    const hrs = (new Date(d.contacted_at as string).getTime() - new Date(d.created_at as string).getTime()) / 3_600_000;
    if (Number.isFinite(hrs) && hrs >= 0) {
      a.touchSumHours += hrs;
      a.touchCount += 1;
    }
  }
}

function metricsFromAcc(a: Acc, spent: number, leadsPurchased: number | null, clicks: number | null): CampaignMetrics {
  const estCommission = a.fundedAmount * COMMISSION_RATE;
  return {
    spent,
    leads: a.leads,
    leadsPurchased,
    contacted: a.contacted, qualified: a.qualified, appSent: a.appSent,
    docs: a.docs, submitted: a.submitted, offer: a.offer, funded: a.funded,
    byStatus: a.byStatus,
    fundedAmount: a.fundedAmount,
    estCommission,
    pipelineValue: a.pipelineValue,
    contactPct: rate(a.contacted, a.leads),
    qualifyPct: rate(a.qualified, a.contacted),
    applicationPct: rate(a.appSent, a.qualified),
    submissionPct: rate(a.submitted, a.appSent),
    closePct: rate(a.funded, a.leads),
    acquisitionCpl: leadsPurchased && leadsPurchased > 0 ? spent / leadsPurchased : null,
    costPerLead: div(spent, a.leads),
    costPerContact: div(spent, a.contacted),
    costPerFunded: div(spent, a.funded),
    cpc: clicks && clicks > 0 ? spent / clicks : null,
    avgDealSize: div(a.fundedAmount, a.funded),
    roas: div(estCommission, spent),
    roiPct: spent > 0 ? ((estCommission - spent) / spent) * 100 : null,
    speedToFirstTouchHours: a.touchCount > 0 ? Math.round((a.touchSumHours / a.touchCount) * 10) / 10 : null,
  };
}

const spendOf = (c: Campaign) => c.spent || c.budget || 0;

export interface ChannelRollup {
  channel: CampaignChannel;
  campaigns: number;
  metrics: CampaignMetrics;
}

// ── Data access ──────────────────────────────────────────────────────────────
export async function listCampaigns(): Promise<Campaign[]> {
  const { data, error } = await supabase.from("campaigns").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(normalizeCampaign);
}

function normalizeCampaign(row: Record<string, unknown>): Campaign {
  return {
    ...(row as unknown as Campaign),
    partner: (row.partner as string) ?? "Synergy Direct",
    setup_checklist: Array.isArray(row.setup_checklist) ? (row.setup_checklist as ChecklistItem[]) : [],
    cost_per_lead_contracted: (row.cost_per_lead_contracted as number) ?? null,
    product_id: (row.product_id as string) ?? null,
    pricing_snapshot: (row.pricing_snapshot as Record<string, unknown>) ?? null,
  };
}

export async function saveCampaign(id: string | null, input: Partial<CampaignInput>): Promise<Campaign> {
  if (id) {
    const rows = await mustWrite<Campaign>("update campaign", supabase.from("campaigns").update(input).eq("id", id));
    return normalizeCampaign(rows[0] as unknown as Record<string, unknown>);
  }
  const rows = await mustWrite<Campaign>("create campaign", supabase.from("campaigns").insert(input));
  return normalizeCampaign(rows[0] as unknown as Record<string, unknown>);
}

export async function deleteCampaign(id: string): Promise<void> {
  await mustWrite("delete campaign", supabase.from("campaigns").delete().eq("id", id));
}

/** Persist just the setup checklist (from ticking an item). */
export async function updateChecklist(id: string, checklist: ChecklistItem[]): Promise<void> {
  await mustWrite("update checklist", supabase.from("campaigns").update({ setup_checklist: checklist }).eq("id", id));
}

const DEAL_SELECT =
  "campaign_id, status, amount_funded, amount_requested, created_at, contacted_at, qualified_at, application_sent_at, docs_collected_at, bank_statements_at, submitted_at, offer_received_at, offer_presented_at, funded_at";

/** Compute metrics for every campaign in one pass over attributed deals. */
export async function getCampaignMetrics(campaigns: Campaign[]): Promise<Record<string, CampaignMetrics>> {
  const { data, error } = await supabase.from("deals").select(DEAL_SELECT).not("campaign_id", "is", null);
  if (error) throw error;

  const acc: Record<string, Acc> = {};
  for (const d of (data ?? []) as DealRow[]) {
    const cid = d.campaign_id;
    if (!acc[cid]) acc[cid] = blankAcc();
    foldDeal(acc[cid], d);
  }

  const out: Record<string, CampaignMetrics> = {};
  for (const c of campaigns) {
    out[c.id] = metricsFromAcc(acc[c.id] ?? blankAcc(), spendOf(c), c.leads_purchased ?? null, c.clicks ?? null);
  }
  return out;
}

/** Head-to-head rollup of the same KPIs aggregated per channel. */
export function channelRollups(campaigns: Campaign[], metrics: Record<string, CampaignMetrics>): ChannelRollup[] {
  const byChannel = new Map<CampaignChannel, { acc: Acc; spent: number; purchased: number; clicks: number; count: number }>();

  // Re-fold from the per-campaign metrics we already have (no second query):
  // sum the raw counts and money, then recompute rates on the totals.
  for (const c of campaigns) {
    const m = metrics[c.id];
    if (!m) continue;
    let g = byChannel.get(c.channel);
    if (!g) {
      g = { acc: blankAcc(), spent: 0, purchased: 0, clicks: 0, count: 0 };
      byChannel.set(c.channel, g);
    }
    g.count += 1;
    g.spent += m.spent;
    g.purchased += m.leadsPurchased ?? 0;
    g.clicks += c.clicks ?? 0;
    const a = g.acc;
    a.leads += m.leads;
    a.contacted += m.contacted; a.qualified += m.qualified; a.appSent += m.appSent;
    a.docs += m.docs; a.submitted += m.submitted; a.offer += m.offer; a.funded += m.funded;
    a.fundedAmount += m.fundedAmount; a.pipelineValue += m.pipelineValue;
    for (const [s, n] of Object.entries(m.byStatus)) a.byStatus[s] = (a.byStatus[s] || 0) + n;
    // Speed-to-touch: weight by contacted count (approximate but directional).
    if (m.speedToFirstTouchHours != null && m.contacted > 0) {
      a.touchSumHours += m.speedToFirstTouchHours * m.contacted;
      a.touchCount += m.contacted;
    }
  }

  return [...byChannel.entries()]
    .map(([channel, g]) => ({
      channel,
      campaigns: g.count,
      metrics: metricsFromAcc(g.acc, g.spent, g.purchased || null, g.clicks || null),
    }))
    .sort((a, b) => b.metrics.funded - a.metrics.funded || b.metrics.leads - a.metrics.leads);
}

// ── Setup completeness ───────────────────────────────────────────────────────
export function checklistProgress(c: Campaign): { done: number; total: number; complete: boolean } {
  const items = c.setup_checklist ?? [];
  const done = items.filter((i) => i.done).length;
  return { done, total: items.length, complete: items.length === 0 ? true : done === items.length };
}

// ── AI analysis ──────────────────────────────────────────────────────────────
export interface CampaignAnalysisResult {
  verdict: "scale" | "keep" | "fix" | "kill";
  headline: string;
  whats_working: string[];
  underperforming: string[];
  projected_cost_per_funded: string;
  recommendations: string[];
}

export interface CampaignAnalysis {
  id: string;
  campaign_id: string;
  verdict: string | null;
  summary: string | null;
  analysis: CampaignAnalysisResult;
  kpis_snapshot: Record<string, unknown>;
  model: string | null;
  created_at: string;
}

export async function listAnalyses(campaignId: string): Promise<CampaignAnalysis[]> {
  const { data, error } = await supabase
    .from("campaign_analyses")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CampaignAnalysis[];
}

/** Fire the AI analysis edge function for a campaign; returns the new run. */
export async function analyzeCampaign(campaignId: string): Promise<{ analysis: CampaignAnalysisResult; model: string; id: string }> {
  const { data, error } = await supabase.functions.invoke("analyze-campaign", { body: { campaignId } });
  if (error) throw new Error(error.message || "Analysis failed");
  if (data?.error) throw new Error(data.error);
  return { analysis: data.analysis, model: data.model, id: data.id };
}
