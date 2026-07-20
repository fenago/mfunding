import supabase from "../supabase";
import type { Campaign } from "./campaignService";

// ─────────────────────────────────────────────────────────────────────────────
// Campaign Audit — a REAL-TIME, per-campaign read of lead QUALITY, built to answer
// one owner question in week 2 with zero funded deals: which vendors/campaigns are
// sending real merchants and which are sending garbage?
//
// Everything here reads LIVE tables on every call (load + the Refresh button):
//   deals              — funnel stage timestamps, amounts, reasons
//   ghl_call_log       — CONTACT TRUTH (dial/connect/real-conversation tiers)
//   customers          — email deliverability (via deals.customer_id)
//   deal_underwriting  — bank-verified vs stated revenue (the "truth gap")
//   customer_documents — docs received + returned application
//   ghl_doc_completions— signed-doc (e-sign) completions
//
// CONTACT TRUTH: deals.contacted_at is NOT used — it's stamped by stage moves and
// the July backfill, not by actual conversations. Contactability is computed from
// ghl_call_log ONLY, in three honest tiers (see AuditMetrics).
//
// No fabrication: a signal absent from our data is null / "—", never invented.
// EMAIL OPENS: GHL exposes open status per email record, but we don't persist it
// per lead, so it isn't shown as a live rate — replies are the read proxy.
// ─────────────────────────────────────────────────────────────────────────────

// Funnel stages, in order. The head is the call-truth tiers (leads → dialed →
// connected → real conversation); the tail is the stage-timestamp pipeline. App
// is split into SENT (our outbound) and RETURNED (signed app back on file).
export const AUDIT_FUNNEL: { key: AuditStageKey; label: string }[] = [
  { key: "leads", label: "Leads" },
  { key: "dialed", label: "Dialed" },
  { key: "connected", label: "Connected (incl. vm)" },
  { key: "realConversations", label: "Real conversation" },
  { key: "qualified", label: "Qualified" },
  { key: "appSent", label: "App SENT" },
  { key: "appReturned", label: "App RETURNED" },
  { key: "docs", label: "Docs / statements" },
  { key: "submitted", label: "Submitted" },
  { key: "offer", label: "Offer" },
  { key: "funded", label: "Funded" },
];
export type AuditStageKey =
  | "leads" | "dialed" | "connected" | "realConversations" | "qualified"
  | "appSent" | "appReturned" | "docs" | "submitted" | "offer" | "funded";

export interface AuditMetrics {
  campaignId: string;
  leads: number;

  // ── Cost (only when actual spend is logged; null otherwise — never invented) ──
  spent: number;
  spendLogged: boolean;
  costPerLead: number | null;

  // ── Contactability (ghl_call_log ONLY — never deals.contacted_at) ────────────
  dialed: number;                // ≥1 outbound call record
  connected: number;             // an outbound call answered ≥30s (incl. voicemail pickups)
  realConversations: number;     // an outbound call ≥120s — a genuine conversation
  dialedPct: number | null;
  connectedPct: number | null;
  realConversationsPct: number | null;   // the tier the quality grade uses
  medianMinutesToFirstDial: number | null; // created_at → first outbound call (guards negatives)
  callBuckets: { light: number; medium: number; heavy: number }; // outbound calls 1-2 / 3-6 / 7+
  neverReached7Plus: number;     // 7+ dials and never a real conversation
  neverReached7PlusPct: number | null;
  // Wrong numbers — leads with ≥1 call graded 'wrong_number'. Red vendor signal;
  // feeds nothing else (not the quality grade).
  wrongNumbers: number;
  wrongNumbersPct: number | null;
  // Graded coverage — how much of the contact truth is human-verified vs heuristic.
  totalCalls: number;            // outbound calls logged for this campaign
  gradedCalls: number;           // of those, dispositioned by a human
  gradedCoveragePct: number | null; // gradedCalls / totalCalls

  // ── Email health ────────────────────────────────────────────────────────────
  withEmail: number;
  noEmail: number;
  badEmail: number;              // invalid / bounced / has email_bounced_at
  unverifiedEmail: number;       // unknown / catch_all — deliverability unproven
  noEmailPct: number | null;
  badEmailPct: number | null;

  // ── Engagement / matriculation ──────────────────────────────────────────────
  merchantReplies: number;       // merchant_reply_at — confirmed inbound engagement
  merchantRepliesPct: number | null;
  docsReceived: number;          // customers with >=1 uploaded document
  docsReceivedPct: number | null;
  esignCompletions: number;      // customers with a recorded e-sign completion
  emailOpens: number;            // leads whose customer opened >=1 email (forward-only, see OPEN_TRACKING_SINCE)
  emailOpensPct: number | null;  // emailOpens / withEmail
  // portal sign-ins: omitted — auth.users.last_sign_in_at is service-role only.

  // ── Funnel waterfall ────────────────────────────────────────────────────────
  qualified: number;
  appSent: number;               // application_sent_at — OUR outbound
  appReturned: number;           // signed application on file (app doc or e-sign completion)
  docs: number;                  // docs_collected_at / bank_statements_at
  submitted: number;
  offer: number;
  funded: number;
  // Where leads DIE: terminal status counts + close/lost reason tallies.
  terminalCounts: Record<string, number>; // nurture / declined / dead
  closeReasons: Record<string, number>;   // deals.closed_reason (closer-picked)
  lostReasons: Record<string, number>;    // deals.lost_reason (system/enum)
  bogusNeverRequested: number;            // closed_reason = bogus_never_requested
  bogusPct: number | null;

  // ── Truth gap (bank-verified vs stated) ─────────────────────────────────────
  underwrittenDeals: number;
  avgRevenueQualityPct: number | null;    // true / reported, averaged (100 = all real)
  avgReportedRevenue: number | null;
  avgTrueRevenue: number | null;
  unaffordable: number;
  highRisk: number;
  unaffordablePct: number | null;
  highRiskPct: number | null;

  // ── Composite quality verdict (transparent — inputs exposed) ─────────────────
  quality: {
    grade: string;                        // A–F, or "—" when there's nothing to score
    score: number | null;                 // 0–100 composite
    inputs: { label: string; value: number | null; weight: number }[];
    provisional: boolean;                 // small sample / no bank data yet
  };
}

// The reason value the close-deal dialog writes when a lead denies ever asking for
// info — the headline vendor-junk signal. Kept here so the audit and the dialog agree.
export const BOGUS_REASON = "bogus_never_requested";

// Opens are collected by the ghl-email-open-sweep poll (the webhook push stream is
// dead — zero events ever arrived). The poll reads each email record's status on a
// 14-day rolling window, so it captured opens back to the campaign's start — not just
// the day the collector shipped. This is the earliest campaign date it covers.
export const OPEN_TRACKING_SINCE = "2026-07-07";

// Call-tier thresholds (seconds). Connected catches voicemail pickups; a real
// conversation needs two minutes of talk time.
const CONNECTED_SECS = 30;
const REAL_CONVO_SECS = 120;

const BAD_EMAIL_STATUSES = new Set(["invalid", "bounced", "undeliverable", "disposable"]);
const UNVERIFIED_EMAIL_STATUSES = new Set(["unknown", "catch_all", "catchall"]);
const FUNDED_STATUSES = new Set(["funded", "restructure_executed"]);
const TERMINAL_STATUSES = new Set(["nurture", "declined", "dead"]);

const has = (v: unknown) => v != null && v !== "";
const rate = (n: number, d: number): number | null => (d > 0 ? (n / d) * 100 : null);
const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ── Row shapes (only the columns we read) ────────────────────────────────────
interface DealRow {
  id: string;
  campaign_id: string;
  customer_id: string | null;
  ghl_contact_id: string | null;
  status: string;
  amount_funded: number | null;
  created_at: string | null;
  qualified_at: string | null;
  application_sent_at: string | null;
  docs_collected_at: string | null;
  bank_statements_at: string | null;
  submitted_at: string | null;
  offer_received_at: string | null;
  offer_presented_at: string | null;
  funded_at: string | null;
  merchant_reply_at: string | null;
  closed_reason: string | null;
  lost_reason: string | null;
}

interface CustomerRow {
  id: string;
  email: string | null;
  email_status: string | null;
  email_bounced_at: string | null;
  email_last_opened_at: string | null;
}

interface UwRow {
  deal_id: string;
  version: number | null;
  risk_rating: string | null;
  affordability_rating: string | null;
  metrics: Record<string, unknown> | null;
}

interface CallRow {
  deal_id: string | null;
  ghl_contact_id: string | null;
  direction: string | null;
  duration_seconds: number | null;
  called_at: string | null;
  call_status: string | null;
  disposition: string | null;
}

// Per-deal call summary folded from ghl_call_log. Contact tiers PREFER the human
// disposition (ground truth); the duration/status heuristic is the fallback when a
// call is ungraded. See classifyCall for the exact rule.
interface CallSummary {
  calls: number;             // outbound call count
  firstDialAt: string | null;
  realConversation: boolean; // any call is a genuine conversation
  connected: boolean;        // any call connected (incl. voicemail pickups / gatekeeper)
  dispositioned: number;     // calls with a human grade (graded coverage numerator)
  wrongNumber: number;       // calls graded 'wrong_number' (vendor evidence)
  neverRequested: number;    // calls graded 'never_requested' (feeds bogus)
}

// A call's contact tier. Disposition overrides duration: a graded 'voicemail' is
// NOT connected even if it ran long; only a real grade or the ungraded ≥30s/≥120s
// heuristic counts. Keep in sync with campaignService.classifyCall.
const REAL_DISPOSITIONS = new Set(["spoke", "never_requested", "callback_set"]);
function callIsReal(c: CallRow): boolean {
  if (c.disposition) return REAL_DISPOSITIONS.has(c.disposition);
  return c.call_status === "completed" && (Number(c.duration_seconds) || 0) >= REAL_CONVO_SECS;
}
function callIsConnected(c: CallRow): boolean {
  if (callIsReal(c)) return true;
  if (c.disposition) return c.disposition === "gatekeeper"; // voicemail/no_answer/wrong_number → not connected
  return (Number(c.duration_seconds) || 0) >= CONNECTED_SECS; // ungraded: catches voicemail pickups
}

const DEAL_SELECT =
  "id, campaign_id, customer_id, ghl_contact_id, status, amount_funded, created_at, qualified_at, " +
  "application_sent_at, docs_collected_at, bank_statements_at, submitted_at, offer_received_at, " +
  "offer_presented_at, funded_at, merchant_reply_at, closed_reason, lost_reason";

const spendOf = (c: Campaign) => Number(c.spent ?? 0) || 0;

/**
 * Compute the audit metrics for every campaign in one real-time pass. Secondary
 * reads (calls / customers / underwriting / documents / completions) are each
 * best-effort: a permission or transient error degrades that ONE signal rather
 * than failing the whole page.
 */
export async function getCampaignAudit(campaigns: Campaign[]): Promise<Record<string, AuditMetrics>> {
  const { data: dealsData, error } = await supabase
    .from("deals")
    .select(DEAL_SELECT)
    .not("campaign_id", "is", null);
  if (error) throw error;
  const deals = (dealsData ?? []) as unknown as DealRow[];

  const dealIds = deals.map((d) => d.id);
  const contactIds = [...new Set(deals.map((d) => d.ghl_contact_id).filter(Boolean) as string[])];
  const customerIds = [...new Set(deals.map((d) => d.customer_id).filter(Boolean) as string[])];

  const [callByDeal, custMap, uwByDeal, docCustomerIds, appDocCustomerIds, esignCustomerIds] = await Promise.all([
    fetchCallSummaries(deals, dealIds, contactIds),
    fetchCustomers(customerIds),
    fetchLatestUnderwriting(dealIds),
    fetchCustomersWithDocs(customerIds, null),           // any document → docs received
    fetchCustomersWithDocs(customerIds, "application"),   // application document → app returned
    fetchEsignCompletions(customerIds),
  ]);

  const byCampaign: Record<string, DealRow[]> = {};
  for (const d of deals) (byCampaign[d.campaign_id] ??= []).push(d);

  const out: Record<string, AuditMetrics> = {};
  for (const c of campaigns) {
    out[c.id] = foldCampaign(
      c, byCampaign[c.id] ?? [], callByDeal, custMap, uwByDeal, docCustomerIds, appDocCustomerIds, esignCustomerIds,
    );
  }
  return out;
}

// Outbound calls, folded per deal. A call attributes to a deal by deal_id, or — when
// the call row has no deal_id — by matching ghl_contact_id (a lead usually has one
// deal per contact). Only outbound calls count toward dialing effort.
async function fetchCallSummaries(
  deals: DealRow[], dealIds: string[], contactIds: string[],
): Promise<Map<string, CallSummary>> {
  const map = new Map<string, CallSummary>();
  if (dealIds.length === 0) return map;

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
  const byId = (a.error ? [] : (a.data ?? [])) as CallRow[];
  const byContact = (b.error ? [] : (b.data ?? [])) as CallRow[];

  // Map contact-matched calls to every deal sharing that contact id.
  const dealsByContact = new Map<string, string[]>();
  for (const d of deals) {
    if (d.ghl_contact_id) {
      const arr = dealsByContact.get(d.ghl_contact_id) ?? [];
      arr.push(d.id);
      dealsByContact.set(d.ghl_contact_id, arr);
    }
  }

  const apply = (dealId: string, c: CallRow) => {
    const s = map.get(dealId) ?? {
      calls: 0, firstDialAt: null, realConversation: false, connected: false,
      dispositioned: 0, wrongNumber: 0, neverRequested: 0,
    };
    s.calls += 1;
    if (c.called_at && (!s.firstDialAt || c.called_at < s.firstDialAt)) s.firstDialAt = c.called_at;
    if (callIsReal(c)) s.realConversation = true;
    if (callIsConnected(c)) s.connected = true;
    if (c.disposition) s.dispositioned += 1;
    if (c.disposition === "wrong_number") s.wrongNumber += 1;
    if (c.disposition === "never_requested") s.neverRequested += 1;
    map.set(dealId, s);
  };
  for (const c of byId) if (c.deal_id) apply(c.deal_id, c);
  for (const c of byContact) {
    if (!c.ghl_contact_id) continue;
    for (const dealId of dealsByContact.get(c.ghl_contact_id) ?? []) apply(dealId, c);
  }
  return map;
}

async function fetchCustomers(ids: string[]): Promise<Map<string, CustomerRow>> {
  const map = new Map<string, CustomerRow>();
  if (ids.length === 0) return map;
  const { data, error } = await supabase
    .from("customers")
    .select("id, email, email_status, email_bounced_at, email_last_opened_at")
    .in("id", ids);
  if (error) return map;
  for (const r of (data ?? []) as CustomerRow[]) map.set(r.id, r);
  return map;
}

async function fetchLatestUnderwriting(dealIds: string[]): Promise<Map<string, UwRow>> {
  const map = new Map<string, UwRow>();
  if (dealIds.length === 0) return map;
  const { data, error } = await supabase
    .from("deal_underwriting")
    .select("deal_id, version, risk_rating, affordability_rating, metrics")
    .in("deal_id", dealIds);
  if (error) return map;
  for (const r of (data ?? []) as UwRow[]) {
    const prev = map.get(r.deal_id);
    if (!prev || (r.version ?? 0) >= (prev.version ?? 0)) map.set(r.deal_id, r);
  }
  return map;
}

// customers with a document. docType null = any document; a value = that type only.
async function fetchCustomersWithDocs(customerIds: string[], docType: string | null): Promise<Set<string>> {
  const set = new Set<string>();
  if (customerIds.length === 0) return set;
  let q = supabase.from("customer_documents").select("customer_id").in("customer_id", customerIds);
  if (docType) q = q.eq("document_type", docType);
  const { data, error } = await q;
  if (error) return set;
  for (const r of (data ?? []) as { customer_id: string }[]) if (r.customer_id) set.add(r.customer_id);
  return set;
}

async function fetchEsignCompletions(customerIds: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  if (customerIds.length === 0) return set;
  const { data, error } = await supabase
    .from("ghl_doc_completions")
    .select("customer_id")
    .in("customer_id", customerIds);
  if (error) return set; // no ops-staff policy → degrades to 0, surfaced as "—"
  for (const r of (data ?? []) as { customer_id: string }[]) if (r.customer_id) set.add(r.customer_id);
  return set;
}

// ── The fold — all math for one campaign ─────────────────────────────────────
function foldCampaign(
  campaign: Campaign,
  deals: DealRow[],
  callByDeal: Map<string, CallSummary>,
  custMap: Map<string, CustomerRow>,
  uwByDeal: Map<string, UwRow>,
  docCustomerIds: Set<string>,
  appDocCustomerIds: Set<string>,
  esignCustomerIds: Set<string>,
): AuditMetrics {
  const leads = deals.length;

  // Contactability (from calls)
  let dialed = 0, connected = 0, realConversations = 0, neverReached7Plus = 0;
  let wrongNumbers = 0, totalCalls = 0, gradedCalls = 0;
  const callBuckets = { light: 0, medium: 0, heavy: 0 };
  const firstDialMinutes: number[] = [];

  // Email health
  let withEmail = 0, noEmail = 0, badEmail = 0, unverifiedEmail = 0;

  // Engagement
  let merchantReplies = 0, emailOpens = 0;
  const docCustomers = new Set<string>();
  const esignCustomers = new Set<string>();

  // Funnel
  let qualified = 0, appSent = 0, appReturned = 0, docs = 0, submitted = 0, offer = 0, funded = 0;
  const terminalCounts: Record<string, number> = {};
  const closeReasons: Record<string, number> = {};
  const lostReasons: Record<string, number> = {};
  let bogus = 0;

  // Truth gap
  let underwrittenDeals = 0, unaffordable = 0, highRisk = 0;
  const qualityPcts: number[] = [];
  let reportedSum = 0, reportedN = 0, trueSum = 0, trueN = 0;

  for (const d of deals) {
    // ── contactability (calls only; dispositions preferred, duration fallback) ──
    const cs = callByDeal.get(d.id);
    const calls = cs?.calls ?? 0;
    const didConverse = cs?.realConversation ?? false;
    totalCalls += calls;
    gradedCalls += cs?.dispositioned ?? 0;
    if (calls > 0) dialed += 1;
    if (cs?.connected) connected += 1;
    if (didConverse) realConversations += 1;
    if ((cs?.wrongNumber ?? 0) > 0) wrongNumbers += 1;
    if (calls >= 1 && calls <= 2) callBuckets.light += 1;
    else if (calls >= 3 && calls <= 6) callBuckets.medium += 1;
    else if (calls >= 7) callBuckets.heavy += 1;
    if (calls >= 7 && !didConverse) neverReached7Plus += 1;
    if (cs?.firstDialAt && has(d.created_at)) {
      const m = (Date.parse(cs.firstDialAt) - Date.parse(d.created_at!)) / 60_000;
      if (Number.isFinite(m) && m >= 0) firstDialMinutes.push(m); // guard negatives
    }

    // ── email health ──
    const cust = d.customer_id ? custMap.get(d.customer_id) : undefined;
    const email = cust?.email?.trim();
    if (email) {
      withEmail += 1;
      const st = (cust?.email_status ?? "").toLowerCase();
      if (BAD_EMAIL_STATUSES.has(st) || has(cust?.email_bounced_at)) badEmail += 1;
      else if (UNVERIFIED_EMAIL_STATUSES.has(st)) unverifiedEmail += 1;
    } else {
      noEmail += 1;
    }

    // ── engagement ──
    if (has(d.merchant_reply_at)) merchantReplies += 1;
    if (has(cust?.email_last_opened_at)) emailOpens += 1;
    if (d.customer_id && docCustomerIds.has(d.customer_id)) docCustomers.add(d.customer_id);
    if (d.customer_id && esignCustomerIds.has(d.customer_id)) esignCustomers.add(d.customer_id);

    // ── funnel ──
    if (has(d.qualified_at)) qualified += 1;
    if (has(d.application_sent_at)) appSent += 1;
    // App RETURNED: a signed application on file — an application-type document OR
    // any e-sign completion (the signed app/agreement) for this deal's customer.
    if (d.customer_id && (appDocCustomerIds.has(d.customer_id) || esignCustomerIds.has(d.customer_id))) appReturned += 1;
    if (has(d.docs_collected_at) || has(d.bank_statements_at)) docs += 1;
    if (has(d.submitted_at)) submitted += 1;
    if (has(d.offer_received_at) || has(d.offer_presented_at)) offer += 1;
    if (has(d.funded_at) || FUNDED_STATUSES.has(d.status)) funded += 1;

    if (TERMINAL_STATUSES.has(d.status)) terminalCounts[d.status] = (terminalCounts[d.status] || 0) + 1;
    if (has(d.closed_reason)) closeReasons[d.closed_reason!] = (closeReasons[d.closed_reason!] || 0) + 1;
    if (has(d.lost_reason)) lostReasons[d.lost_reason!] = (lostReasons[d.lost_reason!] || 0) + 1;
    // Bogus = the closer marked it bogus_never_requested OR a call was graded
    // 'never_requested'. Deduped per deal (one lead counts once no matter how many).
    if (d.closed_reason === BOGUS_REASON || (cs?.neverRequested ?? 0) > 0) bogus += 1;

    // ── truth gap ──
    const uw = uwByDeal.get(d.id);
    if (uw) {
      underwrittenDeals += 1;
      if ((uw.affordability_rating ?? "").toLowerCase() === "unaffordable") unaffordable += 1;
      if ((uw.risk_rating ?? "").toLowerCase() === "high") highRisk += 1;
      const m = uw.metrics ?? {};
      const q = num(m.revenue_quality_pct);
      const reported = num(m.reported_avg_monthly_revenue);
      const trueRev = num(m.true_avg_monthly_revenue);
      if (q != null) qualityPcts.push(q);
      else if (reported != null && trueRev != null && reported > 0) qualityPcts.push((trueRev / reported) * 100);
      if (reported != null) { reportedSum += reported; reportedN += 1; }
      if (trueRev != null) { trueSum += trueRev; trueN += 1; }
    }
  }

  const spent = spendOf(campaign);
  const spendLogged = spent > 0;
  const avgQuality = qualityPcts.length ? qualityPcts.reduce((a, b) => a + b, 0) / qualityPcts.length : null;
  const bogusPct = rate(bogus, leads);

  // ── Composite quality verdict — transparent, weighted sub-scores ────────────
  // Each input is 0–100 where higher = healthier. Reach uses the REAL-CONVERSATION
  // tier (≥120s), never a stage flag. Missing inputs drop out and weights renormalize.
  const realConvPct = rate(realConversations, leads);
  const badEmailPct = rate(badEmail, withEmail || leads);
  const inputs: { label: string; value: number | null; weight: number }[] = [
    { label: "Real-conversation rate", value: realConvPct, weight: 0.30 },
    { label: "Email deliverability", value: badEmailPct == null ? null : 100 - badEmailPct, weight: 0.20 },
    { label: "Revenue is real (bank-verified)", value: avgQuality == null ? null : Math.min(100, avgQuality), weight: 0.30 },
    { label: "Not bogus", value: bogusPct == null ? null : 100 - bogusPct, weight: 0.20 },
  ];
  const present = inputs.filter((i) => i.value != null);
  const wSum = present.reduce((a, i) => a + i.weight, 0);
  const score = present.length && wSum > 0
    ? present.reduce((a, i) => a + (i.value as number) * i.weight, 0) / wSum
    : null;
  const provisional = leads < 5 || underwrittenDeals === 0;

  return {
    campaignId: campaign.id,
    leads,
    spent,
    spendLogged,
    costPerLead: spendLogged ? div(spent, leads) : null,

    dialed,
    connected,
    realConversations,
    dialedPct: rate(dialed, leads),
    connectedPct: rate(connected, leads),
    realConversationsPct: realConvPct,
    medianMinutesToFirstDial: median(firstDialMinutes),
    callBuckets,
    neverReached7Plus,
    neverReached7PlusPct: rate(neverReached7Plus, leads),
    wrongNumbers,
    wrongNumbersPct: rate(wrongNumbers, leads),
    totalCalls,
    gradedCalls,
    gradedCoveragePct: rate(gradedCalls, totalCalls),

    withEmail,
    noEmail,
    badEmail,
    unverifiedEmail,
    noEmailPct: rate(noEmail, leads),
    badEmailPct,

    merchantReplies,
    merchantRepliesPct: rate(merchantReplies, leads),
    docsReceived: docCustomers.size,
    docsReceivedPct: rate(docCustomers.size, leads),
    esignCompletions: esignCustomers.size,
    emailOpens,
    emailOpensPct: rate(emailOpens, withEmail),

    qualified,
    appSent,
    appReturned,
    docs,
    submitted,
    offer,
    funded,
    terminalCounts,
    closeReasons,
    lostReasons,
    bogusNeverRequested: bogus,
    bogusPct,

    underwrittenDeals,
    avgRevenueQualityPct: avgQuality,
    avgReportedRevenue: div(reportedSum, reportedN),
    avgTrueRevenue: div(trueSum, trueN),
    unaffordable,
    highRisk,
    unaffordablePct: rate(unaffordable, underwrittenDeals),
    highRiskPct: rate(highRisk, underwrittenDeals),

    quality: { grade: gradeFor(score), score, inputs, provisional },
  };
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function gradeFor(score: number | null): string {
  if (score == null) return "—";
  if (score >= 85) return "A";
  if (score >= 75) return "B";
  if (score >= 65) return "C";
  if (score >= 50) return "D";
  return "F";
}
