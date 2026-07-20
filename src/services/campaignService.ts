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
  // Identifier-based attribution. When set, live-transfer-intake attributes an
  // inbound lead to this campaign when the delivery identifier matches — the
  // email a real-time lead is delivered to, or the number a live transfer calls.
  tracking_email: string | null;
  tracking_phone: string | null;
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

// ── Lead-source → campaign-channel matching ──────────────────────────────────
// Maps a deal's lead_source slug (from the playbook intake) to the campaign
// channels that plausibly deliver it, in priority order. Drives the intake's
// smart default: pick the newest ACTIVE campaign whose channel is in this list;
// an empty list means "no channel preference — fall back to any active".
export function channelsForLeadSource(leadSource: string): CampaignChannel[] {
  switch (leadSource) {
    case "live_transfer":
      return ["live_transfer"];
    case "realtime_appt":
    case "real_time":
    case "realtime_transfer":
      return ["realtime_transfer", "real_time"];
    case "website":
    case "web_purchased":
    case "google_ads":
      return ["web_purchased", "google_ads"];
    case "aged_transfer":
    case "aged_lead":
    case "aged":
      return ["aged", "aged_leads", "aged_transfer"];
    case "cold_email":
    case "email":
      return ["email", "cold_email"];
    case "ucc_lead":
    case "ucc":
      return ["ucc"];
    case "referral":
      return ["referral"];
    default:
      return []; // renewal / cold_call / repeat_customer / other → any active
  }
}

/** Short label for a campaign — its code when it has one, else the name. */
export function campaignLabel(c: Pick<Campaign, "code" | "name">): string {
  return c.code || c.name;
}

/**
 * The campaign to auto-attach for a given lead source: the newest ACTIVE
 * campaign whose channel matches the source, else the newest active campaign
 * (so a manual entry is never left untracked when a live campaign exists).
 * `campaigns` is assumed newest-first (listCampaigns order). Returns "" when no
 * active campaign exists — the caller then shows the "no campaigns" warning.
 */
export function defaultCampaignIdForSource(campaigns: Campaign[], leadSource: string): string {
  const active = campaigns.filter((c) => c.status === "active");
  if (active.length === 0) return "";
  for (const ch of channelsForLeadSource(leadSource)) {
    const match = active.find((c) => c.channel === ch);
    if (match) return match.id;
  }
  return active[0].id;
}

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
    { key: "tracking_number", label: "Create a DEDICATED GHL tracking phone number for this campaign, then save it in the Tracking phone field (Edit campaign)", needs_value: true },
    { key: "qual_specs", label: "Confirm vendor qualification specs (6+ mo TIB, $15K+/mo, owner on line, TCPA, exclusive)" },
    { key: "routing", label: "Set lead routing / round-robin" },
    { key: "billing_policy", label: "Confirm billing / replacement (bad-lead credit) policy" },
  ],
  realtime_transfer: [
    { key: "inbound_email", label: "Create a dedicated inbound email/alias for this campaign, then save it in the Tracking email field (Edit campaign) so leads auto-attribute", needs_value: true },
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
  spent: number;                 // ACTUAL logged spend. Never the budget. See spendOf().
  budget: number;                // PLANNED spend. Shown alongside, never substituted for spent.
  spendLogged: boolean;          // false = no actual spend recorded yet -> cost metrics are null, not $0.
  leads: number;                 // attributed deals (leads that entered the pipeline)
  leadsPurchased: number | null; // leads we bought (from the campaign record)
  // ── Contactability — from ghl_call_log ONLY, never deals.contacted_at ─────────
  // contacted_at is stamped by stage moves + a July backfill, not by real calls, so
  // it inflates "contact" (showed 72% where call logs prove 6/58 real conversations).
  // Three honest tiers, mirroring campaignAuditService.getCampaignAudit — THAT service
  // is the definition of record; the call query is duplicated (not imported) here
  // because a sibling agent owns the audit module. Keep the two in sync.
  dialed: number;                // >=1 outbound call attempted
  connected: number;             // an outbound call answered >=30s (incl. voicemail pickups)
  realConversations: number;     // an outbound call >=120s — a genuine conversation
  // Cumulative funnel counts (via stage timestamps).
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
  dialedPct: number | null;              // dialed / leads
  connectedPct: number | null;           // connected / leads (≥30s incl. voicemail — the caveated tier)
  realConversationsPct: number | null;   // realConversations / leads — the PRIMARY owner-facing contact number
  qualifyPct: number | null;             // qualified / connected
  applicationPct: number | null;         // appSent / qualified
  submissionPct: number | null;          // submitted / appSent
  closePct: number | null;               // funded / leads (overall close rate)
  // Cost / efficiency.
  acquisitionCpl: number | null; // spent / leadsPurchased — TRUE cost per lead bought
  costPerLead: number | null;    // spent / attributed leads
  costPerConnect: number | null; // spent / connected (call-truth, not a stage flag)
  costPerFunded: number | null;  // spent / funded — the number that matters most
  cpc: number | null;            // spent / clicks (click channels only)
  avgDealSize: number | null;    // fundedAmount / funded
  roas: number | null;           // estCommission / spent
  roiPct: number | null;         // (estCommission - spent) / spent
  speedToFirstDialHours: number | null;  // created_at → first OUTBOUND dial (median; guards negatives)
}

// Average broker commission on a funded deal ≈ 8 points.
export const COMMISSION_RATE = 0.08;

const FUNDED = new Set(["funded", "restructure_executed"]);
const DEAD = new Set(["declined", "lost", "nurture", "closed_lost"]);

// Call-tier thresholds (seconds), mirroring campaignAuditService. Connected catches
// voicemail pickups; a real conversation needs two minutes of talk time.
const CONNECTED_SECS = 30;
const REAL_CONVO_SECS = 120;

const has = (v: unknown) => v != null && v !== "";
const rate = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);
const div = (a: number, b: number) => (b > 0 ? a / b : null);
const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

interface DealRow {
  id: string;
  campaign_id: string;
  ghl_contact_id: string | null;
  status: string;
  amount_funded: number | null;
  amount_requested: number | null;
  created_at: string | null;
  qualified_at: string | null;
  application_sent_at: string | null;
  docs_collected_at: string | null;
  bank_statements_at: string | null;
  submitted_at: string | null;
  offer_received_at: string | null;
  offer_presented_at: string | null;
  funded_at: string | null;
}

// ── Call-log contact truth (duplicated from campaignAuditService — see note on
// CampaignMetrics; a sibling owns that module so we can't import it). ────────────
interface CallRow {
  deal_id: string | null;
  ghl_contact_id: string | null;
  direction: string | null;
  duration_seconds: number | null;
  called_at: string | null;
  call_status: string | null;
  disposition: string | null;
}
// Per-deal outbound-call summary folded from ghl_call_log. Contact tiers PREFER the
// human disposition (ground truth), duration/status heuristic as fallback — kept
// identical to campaignAuditService (the definition of record).
interface CallSummary {
  calls: number;             // outbound call count
  firstDialAt: string | null;
  realConversation: boolean; // any call is a genuine conversation
  connected: boolean;        // any call connected (incl. voicemail pickups / gatekeeper)
}

// Disposition overrides duration: a graded 'voicemail' is NOT connected even if it
// ran long. Keep in sync with campaignAuditService.classifyCall.
const REAL_DISPOSITIONS = new Set(["spoke", "never_requested", "callback_set"]);
function callIsReal(c: CallRow): boolean {
  if (c.disposition) return REAL_DISPOSITIONS.has(c.disposition);
  return c.call_status === "completed" && (Number(c.duration_seconds) || 0) >= REAL_CONVO_SECS;
}
function callIsConnected(c: CallRow): boolean {
  if (callIsReal(c)) return true;
  if (c.disposition) return c.disposition === "gatekeeper";
  return (Number(c.duration_seconds) || 0) >= CONNECTED_SECS;
}

/**
 * Outbound calls folded per deal. DEFINITION OF RECORD:
 * campaignAuditService.fetchCallSummaries — this is a deliberate duplicate (that
 * module belongs to another agent), so keep the join logic identical to it. A call
 * attributes to a deal by deal_id, or — when the row has no deal_id — by matching
 * ghl_contact_id (a lead usually has one deal per contact). Outbound only.
 */
async function fetchCallSummaries(deals: DealRow[]): Promise<Map<string, CallSummary>> {
  const map = new Map<string, CallSummary>();
  const dealIds = deals.map((d) => d.id);
  if (dealIds.length === 0) return map;
  const contactIds = [...new Set(deals.map((d) => d.ghl_contact_id).filter(Boolean) as string[])];

  const CALL_COLS = "deal_id, ghl_contact_id, direction, duration_seconds, called_at, call_status, disposition";
  const [a, b] = await Promise.all([
    supabase.from("ghl_call_log")
      .select(CALL_COLS)
      .eq("direction", "outbound").in("deal_id", dealIds),
    contactIds.length
      ? supabase.from("ghl_call_log")
          .select(CALL_COLS)
          .eq("direction", "outbound").is("deal_id", null).in("ghl_contact_id", contactIds)
      : Promise.resolve({ data: [] as CallRow[], error: null }),
  ]);
  // Degrade LOUDLY, never silently: a swallowed read here renders a false 0% contact
  // rate (exactly how ghl_call_log's missing RLS policy hid for a while). Keep the page
  // alive but make the failure impossible to miss in the console.
  if (a.error) console.error("[campaignService] ghl_call_log read (by deal_id) failed — contact tiers will under-report:", a.error);
  if (b.error) console.error("[campaignService] ghl_call_log read (by contact_id) failed — contact tiers will under-report:", b.error);
  const byId = (a.error ? [] : (a.data ?? [])) as CallRow[];
  const byContact = (b.error ? [] : (b.data ?? [])) as CallRow[];

  const dealsByContact = new Map<string, string[]>();
  for (const d of deals) {
    if (d.ghl_contact_id) {
      const arr = dealsByContact.get(d.ghl_contact_id) ?? [];
      arr.push(d.id);
      dealsByContact.set(d.ghl_contact_id, arr);
    }
  }
  const apply = (dealId: string, c: CallRow) => {
    const s = map.get(dealId) ?? { calls: 0, firstDialAt: null, realConversation: false, connected: false };
    s.calls += 1;
    if (c.called_at && (!s.firstDialAt || c.called_at < s.firstDialAt)) s.firstDialAt = c.called_at;
    if (callIsReal(c)) s.realConversation = true;
    if (callIsConnected(c)) s.connected = true;
    map.set(dealId, s);
  };
  for (const c of byId) if (c.deal_id) apply(c.deal_id, c);
  for (const c of byContact) {
    if (!c.ghl_contact_id) continue;
    for (const dealId of dealsByContact.get(c.ghl_contact_id) ?? []) apply(dealId, c);
  }
  return map;
}

// Mutable accumulator while we fold over deals.
interface Acc {
  leads: number;
  byStatus: Record<string, number>;
  dialed: number; connected: number; realConversations: number;
  qualified: number; appSent: number;
  docs: number; submitted: number; offer: number; funded: number;
  fundedAmount: number; pipelineValue: number;
  firstDialHours: number[];              // per-deal created→first-dial gap → campaign median
  touchSumHours: number; touchCount: number; // channel-level weighted approximation (rollups only)
}

const blankAcc = (): Acc => ({
  leads: 0, byStatus: {}, dialed: 0, connected: 0, realConversations: 0,
  qualified: 0, appSent: 0,
  docs: 0, submitted: 0, offer: 0, funded: 0, fundedAmount: 0, pipelineValue: 0,
  firstDialHours: [], touchSumHours: 0, touchCount: 0,
});

function foldDeal(a: Acc, d: DealRow, cs: CallSummary | undefined) {
  a.leads += 1;
  a.byStatus[d.status] = (a.byStatus[d.status] || 0) + 1;

  // Contactability from the call log — never contacted_at. Dispositions preferred,
  // duration/status heuristic as fallback (see callIsReal / callIsConnected).
  const calls = cs?.calls ?? 0;
  if (calls > 0) a.dialed += 1;
  if (cs?.connected) a.connected += 1;
  if (cs?.realConversation) a.realConversations += 1;
  if (cs?.firstDialAt && has(d.created_at)) {
    const hrs = (Date.parse(cs.firstDialAt) - Date.parse(d.created_at as string)) / 3_600_000;
    if (Number.isFinite(hrs) && hrs >= 0) a.firstDialHours.push(hrs); // guard negatives / garbage
  }

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
}

function metricsFromAcc(
  a: Acc,
  spent: number,
  leadsPurchased: number | null,
  clicks: number | null,
  budget = 0,
): CampaignMetrics {
  const estCommission = a.fundedAmount * COMMISSION_RATE;
  // No actual spend logged => every cost-per-X is UNKNOWN, not zero. Returning $0
  // would read as "these deals were free", which is how the budget-fallback bug got
  // introduced in the first place (see IMPORTANT_TODO #3): someone swapped a $0 lie
  // for a budget lie. Both are wrong; the honest answer is "—".
  const paid = spent > 0;
  // Per-campaign speed uses the median of real first-dial gaps; channel rollups have
  // no raw array (they re-fold from per-campaign metrics) so they fall back to the
  // dial-weighted mean carried in touchSum/touchCount.
  const speed = a.firstDialHours.length
    ? median(a.firstDialHours)
    : (a.touchCount > 0 ? a.touchSumHours / a.touchCount : null);
  return {
    spent,
    budget,
    spendLogged: paid,
    leads: a.leads,
    leadsPurchased,
    dialed: a.dialed, connected: a.connected, realConversations: a.realConversations,
    qualified: a.qualified, appSent: a.appSent,
    docs: a.docs, submitted: a.submitted, offer: a.offer, funded: a.funded,
    byStatus: a.byStatus,
    fundedAmount: a.fundedAmount,
    estCommission,
    pipelineValue: a.pipelineValue,
    dialedPct: rate(a.dialed, a.leads),
    connectedPct: rate(a.connected, a.leads),
    realConversationsPct: rate(a.realConversations, a.leads),
    qualifyPct: rate(a.qualified, a.connected),
    applicationPct: rate(a.appSent, a.qualified),
    submissionPct: rate(a.submitted, a.appSent),
    closePct: rate(a.funded, a.leads),
    acquisitionCpl: paid && leadsPurchased && leadsPurchased > 0 ? spent / leadsPurchased : null,
    costPerLead: paid ? div(spent, a.leads) : null,
    costPerConnect: paid ? div(spent, a.connected) : null,
    costPerFunded: paid ? div(spent, a.funded) : null,
    cpc: paid && clicks && clicks > 0 ? spent / clicks : null,
    avgDealSize: div(a.fundedAmount, a.funded),
    roas: div(estCommission, spent),
    roiPct: paid ? ((estCommission - spent) / spent) * 100 : null,
    speedToFirstDialHours: speed == null ? null : Math.round(speed * 10) / 10,
  };
}

/**
 * ACTUAL spend only — never the budget. (IMPORTANT_TODO #3)
 *
 * This was `c.spent || c.budget || 0`. Because 0 is falsy, a campaign with a budget
 * and no logged spend reported its ENTIRE BUDGET as spent: live, a campaign showed
 * $3,500 "spent" against $1,000 actual — 3.5x — which then poisoned cost-per-funded,
 * CPL, CPC, ROAS and ROI. Planned money is not spent money; substituting one for the
 * other silently manufactures a cost basis that never left the bank account.
 *
 * Budget is still surfaced (CampaignMetrics.budget) so the UI can show planned vs
 * actual side by side — it just may never stand in for actual.
 */
const spendOf = (c: Campaign) => Number(c.spent ?? 0) || 0;
const budgetOf = (c: Campaign) => Number(c.budget ?? 0) || 0;

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
    tracking_email: (row.tracking_email as string) ?? null,
    tracking_phone: (row.tracking_phone as string) ?? null,
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
  "id, campaign_id, ghl_contact_id, status, amount_funded, amount_requested, created_at, qualified_at, application_sent_at, docs_collected_at, bank_statements_at, submitted_at, offer_received_at, offer_presented_at, funded_at";

/** Compute metrics for every campaign in one pass over attributed deals. */
export async function getCampaignMetrics(campaigns: Campaign[]): Promise<Record<string, CampaignMetrics>> {
  const { data, error } = await supabase.from("deals").select(DEAL_SELECT).not("campaign_id", "is", null);
  if (error) throw error;
  const deals = (data ?? []) as DealRow[];
  const callByDeal = await fetchCallSummaries(deals);

  const acc: Record<string, Acc> = {};
  for (const d of deals) {
    const cid = d.campaign_id;
    if (!acc[cid]) acc[cid] = blankAcc();
    foldDeal(acc[cid], d, callByDeal.get(d.id));
  }

  const out: Record<string, CampaignMetrics> = {};
  for (const c of campaigns) {
    out[c.id] = metricsFromAcc(
      acc[c.id] ?? blankAcc(),
      spendOf(c),
      c.leads_purchased ?? null,
      c.clicks ?? null,
      budgetOf(c),
    );
  }
  return out;
}

/** Head-to-head rollup of the same KPIs aggregated per channel. */
export function channelRollups(campaigns: Campaign[], metrics: Record<string, CampaignMetrics>): ChannelRollup[] {
  const byChannel = new Map<CampaignChannel, { acc: Acc; spent: number; budget: number; purchased: number; clicks: number; count: number }>();

  // Re-fold from the per-campaign metrics we already have (no second query):
  // sum the raw counts and money, then recompute rates on the totals.
  for (const c of campaigns) {
    const m = metrics[c.id];
    if (!m) continue;
    let g = byChannel.get(c.channel);
    if (!g) {
      g = { acc: blankAcc(), spent: 0, budget: 0, purchased: 0, clicks: 0, count: 0 };
      byChannel.set(c.channel, g);
    }
    g.count += 1;
    g.spent += m.spent;
    g.budget += m.budget;
    g.purchased += m.leadsPurchased ?? 0;
    g.clicks += c.clicks ?? 0;
    const a = g.acc;
    a.leads += m.leads;
    a.dialed += m.dialed; a.connected += m.connected; a.realConversations += m.realConversations;
    a.qualified += m.qualified; a.appSent += m.appSent;
    a.docs += m.docs; a.submitted += m.submitted; a.offer += m.offer; a.funded += m.funded;
    a.fundedAmount += m.fundedAmount; a.pipelineValue += m.pipelineValue;
    for (const [s, n] of Object.entries(m.byStatus)) a.byStatus[s] = (a.byStatus[s] || 0) + n;
    // Speed-to-first-dial at channel level: weight the campaign median by its dial
    // count (approximate but directional — we don't re-query raw calls here).
    if (m.speedToFirstDialHours != null && m.dialed > 0) {
      a.touchSumHours += m.speedToFirstDialHours * m.dialed;
      a.touchCount += m.dialed;
    }
  }

  return [...byChannel.entries()]
    .map(([channel, g]) => ({
      channel,
      campaigns: g.count,
      metrics: metricsFromAcc(g.acc, g.spent, g.purchased || null, g.clicks || null, g.budget),
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
