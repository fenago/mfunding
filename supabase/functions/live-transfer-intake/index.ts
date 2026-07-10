// live-transfer-intake — AUTO-INTAKE for Synergy (Double-Verified) live-transfer leads.
//
// A live-transfer email lands at sales@send.mfunding.net (GHL Conversations),
// FROM Info@Double-Verified.com, subject "Live Transfer! …". A GHL workflow fires
// a Webhook → this function → the lead is parsed, a customer + MCA deal are
// auto-created, a PROPER GHL contact (the merchant, e.g. "Kyle Read" — NOT the
// junk sender contact) + an MCA-pipeline opportunity are created, the deal is
// born HOT with a 5-minute speed-to-lead clock (surfaces at the top of My Day),
// and the team is emailed an urgent "call within 5 min" alert.
//
// Deployed with verify_jwt = false (GHL workflow webhooks can't send a Supabase
// JWT). Authenticates IN CODE via a shared secret (?secret=… or x-lt-secret),
// resolved from the vault (LIVE_TRANSFER_SECRET) — FAIL CLOSED.
//
// Accepts EITHER:
//   • a GHL-workflow Webhook POST (fires on the inbound email). The body text may
//     be included ({{message.body}}); if not, we fetch the newest inbound email on
//     the conversation via the GHL API (same email-record technique as
//     get-funder-email).
//   • a direct structured POST (future Zapier): { company, first_name, last_name,
//     phone, email, state, industry, monthly_deposits, requested_amount,
//     use_of_funds, fico, open_positions, positions_balance, best_time, agent }.
//
// Compliance: MCA = purchase of future receivables, NOT a loan. This function
// creates internal records + an internal team alert only — no merchant-facing
// product claims.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders, serviceClient, getGhlConfig, ghlFetch,
  upsertContact, createOpportunity, listPipelines, sendEmailToContact,
  type GhlConfig,
} from "../_shared/ghl.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Config (kept simple, top of file) ────────────────────────────────────────
// Identifying rule for a live transfer: subject starts with "Live Transfer!"
// AND/OR the sender is @double-verified.com.
const LIVE_TRANSFER_SUBJECT_PREFIX = "live transfer!";
const LIVE_TRANSFER_FROM_DOMAIN = "double-verified.com";
// The campaign these leads attribute to (looked up by code — never hardcode the uuid).
const LIVE_TRANSFER_CAMPAIGN_CODE = "SYN-LT-2026-001";
// Canonical MFunding MCA pipeline (same id ghl-webhook keys off, so stage changes round-trip).
const MCA_PIPELINE_ID = "bG9ZEh4eP9x60E1CyaMx";
// Speed-to-lead SLA: the closer must call within 5 minutes.
const FIRST_CALL_SLA_MS = 5 * 60 * 1000;
// Urgent internal alert recipients.
const TEAM_ALERT_TO = "socrates73@gmail.com";
const TEAM_ALERT_CC = ["cmarq2k8@gmail.com"];
const PLAYBOOK_URL = "https://mfunding.net/admin/playbooks";
// Dedupe window: same phone/email within this many days → no duplicate deal.
const DEDUPE_WINDOW_DAYS = 30;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Constant-time string compare (mirrors ghl-webhook) so the secret gate doesn't
// leak match length/prefix via response timing.
function timingSafeEqualStr(provided: string, expected: string): boolean {
  const enc = new TextEncoder();
  const a = enc.encode(provided);
  const b = enc.encode(expected);
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

// ── Parsing helpers ──────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&#0?39;/g, "'").replace(/&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

// HTML email body → a flat list of non-empty text cells (the label/value table
// collapses to alternating label, value, label, value…). Also works on plain
// text (no tags → one segment per line).
function htmlToSegments(html: string): string[] {
  const withBreaks = html
    .replace(/<\s*(br|\/td|\/tr|\/p|\/div|\/h[1-6]|\/li)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(withBreaks)
    .split(/\n|\r/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

const normLabel = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// canonical key → the label text(s) as they appear in the Double-Verified email.
const LABEL_DEFS: Array<[string, string[]]> = [
  ["company", ["Company Name"]],
  ["contact_name", ["Contact Name"]],
  ["phone", ["Contact's Phone", "Contacts Phone", "Phone"]],
  ["email", ["Contact Email", "Email"]],
  ["state", ["State"]],
  ["industry", ["Industry"]],
  ["best_time", ["What is the best time to reach you?"]],
  ["fax", ["Fax"]],
  ["is_owner", ["Are You The Owner?"]],
  ["time_as_owner", ["How long have you been the owner?"]],
  ["monthly_deposits", ["How much do you deposit per month?"]],
  ["need_money_now", ["Do You Need Money Right Away??", "Do You Need Money Right Away?"]],
  ["requested_amount", ["Requested Amount"]],
  ["use_of_funds", ["Why do they want the funds?"]],
  ["difficulty_approved", ["Have you had difficulty getting approved"]],
  ["processes_cc", ["Do you process credit cards?"]],
  ["fico", ["FICO"]],
  ["has_equity", ["Do you have equity?"]],
  ["property_paid_down", ["Is your property paid down at least 50%?"]],
  ["positions_balance", ["What Are The Balances of The Loans?"]],
  ["open_positions", ["How Many Loans Do You Have Right Now?"]],
  ["agent", ["Select the Company or Agent"]],
];

const LABEL_TO_KEY = new Map<string, string>();
for (const [key, variants] of LABEL_DEFS) for (const v of variants) LABEL_TO_KEY.set(normLabel(v), key);
const LABEL_SET = new Set(LABEL_TO_KEY.keys());

// Walk the label/value cell sequence: each label cell's value is the next cell
// that isn't itself a label.
function parseLabelValue(segments: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < segments.length; i++) {
    const key = LABEL_TO_KEY.get(normLabel(segments[i]));
    if (!key || out[key]) continue;
    const next = segments[i + 1];
    if (next && !LABEL_SET.has(normLabel(next))) out[key] = next.trim();
  }
  return out;
}

const numFrom = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n !== 0 ? n : (String(v).replace(/[^0-9.]/g, "") === "0" ? 0 : null);
};

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function phoneNorm(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return raw.trim();
}

// The canonical lead shape both intake modes produce.
interface Lead {
  business: string;
  first: string;
  last: string;
  phone: string;        // normalized
  phoneRaw: string;
  email: string;
  state: string;
  industry: string;
  monthlyDeposits: number | null;
  requestedAmount: number | null;
  useOfFunds: string;
  fico: number | null;
  openPositions: number | null;
  positionsBalance: number | null;
  bestTime: string;
  agent: string;
  isOwner: string;
  timeAsOwner: string;
  needMoneyNow: string;
  difficultyApproved: string;
  processesCc: string;
  hasEquity: string;
  propertyPaidDown: string;
  raw: Record<string, string>; // everything parsed, verbatim
}

function toLead(f: Record<string, unknown>): Lead {
  const s = (k: string) => (f[k] == null ? "" : String(f[k]).trim());
  // contact_name (email mode) OR first_name/last_name (structured mode).
  let first = s("first_name");
  let last = s("last_name");
  if (!first && !last && s("contact_name")) {
    const n = splitName(s("contact_name"));
    first = n.first; last = n.last;
  }
  const phoneRaw = s("phone");
  return {
    business: s("company"),
    first, last,
    phone: phoneRaw ? phoneNorm(phoneRaw) : "",
    phoneRaw,
    email: s("email").toLowerCase(),
    state: s("state"),
    industry: s("industry"),
    monthlyDeposits: numFrom(f["monthly_deposits"]),
    requestedAmount: numFrom(f["requested_amount"]),
    useOfFunds: s("use_of_funds"),
    fico: numFrom(f["fico"]),
    openPositions: numFrom(f["open_positions"]),
    positionsBalance: numFrom(f["positions_balance"]),
    bestTime: s("best_time"),
    agent: s("agent"),
    isOwner: s("is_owner"),
    timeAsOwner: s("time_as_owner"),
    needMoneyNow: s("need_money_now"),
    difficultyApproved: s("difficulty_approved"),
    processesCc: s("processes_cc"),
    hasEquity: s("has_equity"),
    propertyPaidDown: s("property_paid_down"),
    raw: Object.fromEntries(Object.entries(f).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)])),
  };
}

// Does this look like a Double-Verified structured POST (vs a GHL webhook wrapper)?
function looksStructured(b: Record<string, unknown>): boolean {
  return ["company", "first_name", "last_name", "requested_amount", "monthly_deposits", "positions_balance", "open_positions"]
    .some((k) => b[k] != null && b[k] !== "");
}

// Pull the email body text out of a GHL webhook payload's many possible shapes.
function extractBodyText(b: Record<string, unknown>): string {
  const cands = [
    b.body, b.email_body, b.emailBody, b.message, b.text, b.html, b.email, b.emailContent,
    (b.message as Record<string, unknown> | undefined)?.body,
    (b.email as Record<string, unknown> | undefined)?.body,
    (b.customData as Record<string, unknown> | undefined)?.body,
  ];
  for (const c of cands) {
    if (typeof c === "string" && /contact|requested amount|company name|select the company/i.test(c)) return c;
  }
  // Fall back to any long string field that mentions the labels.
  for (const c of cands) if (typeof c === "string" && c.length > 40) return c;
  return "";
}

function pickId(b: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = b[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

// Fetch the newest INBOUND email body on a GHL conversation (by conversation id,
// or resolved from a contact id). Uses the email-record technique from
// get-funder-email: conversation message → meta.email.messageIds → email record.
async function newestInboundEmail(
  cfg: GhlConfig,
  ids: { conversationId?: string; contactId?: string },
): Promise<{ body: string; subject: string; from: string } | null> {
  let cid = ids.conversationId ?? "";
  if (!cid && ids.contactId) {
    const c = await ghlFetch<{ conversations?: Array<{ id: string }> }>(
      cfg, "GET", `/conversations/search?locationId=${cfg.locationId}&contactId=${ids.contactId}`,
    );
    cid = c.data?.conversations?.[0]?.id ?? "";
  }
  if (!cid) return null;
  const msgs = await ghlFetch<{ messages?: { messages?: Array<Record<string, unknown>> } }>(
    cfg, "GET", `/conversations/${cid}/messages?limit=25`,
  );
  const arr = msgs.data?.messages?.messages ?? [];
  for (const m of arr) {
    if (!/email/i.test(String(m.messageType ?? ""))) continue;
    if (String(m.direction ?? "").toLowerCase() === "outbound") continue;
    const recIds = (m.meta as { email?: { messageIds?: string[] } } | undefined)?.email?.messageIds ?? [];
    const recId = recIds[recIds.length - 1];
    if (!recId) continue;
    const e = await ghlFetch<{ emailMessage?: Record<string, unknown> } & Record<string, unknown>>(
      cfg, "GET", `/conversations/messages/email/${recId}`,
    );
    const em = (e.data?.emailMessage ?? e.data ?? {}) as Record<string, unknown>;
    const body = String(em.body ?? "");
    if (body) return { body, subject: String(em.subject ?? ""), from: String(em.from ?? "") };
  }
  return null;
}

// ── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();

  // GHL config (also the source of the shared secret). Needed up front.
  let cfg: GhlConfig | null = null;
  let cfgErr = "";
  let expectedSecret = "";
  try {
    const { data } = await db.rpc("get_ghl_config");
    expectedSecret = (data?.live_transfer_secret as string | undefined) ?? "";
    const apiKey = data?.api_key as string | undefined;
    const locationId = data?.location_id as string | undefined;
    if (apiKey && locationId) cfg = { apiKey, locationId };
  } catch (e) { cfgErr = e instanceof Error ? e.message : String(e); }
  if (!expectedSecret) expectedSecret = Deno.env.get("LIVE_TRANSFER_SECRET") ?? "";

  // ── Shared-secret gate (FAIL CLOSED) ──
  if (!expectedSecret) return json({ error: "server auth not configured" }, 503);
  const url = new URL(req.url);
  const provided = url.searchParams.get("secret") ?? req.headers.get("x-lt-secret") ?? "";
  if (!provided || !timingSafeEqualStr(provided, expectedSecret)) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { body = {}; }

  // ── Resolve the canonical lead ──
  let fields: Record<string, string>;
  let sourceMode: "structured" | "email-body" | "ghl-fetch";
  let emailSubject = "";
  let emailFrom = "";

  if (looksStructured(body)) {
    sourceMode = "structured";
    fields = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v == null ? "" : String(v)]));
  } else {
    let bodyText = extractBodyText(body);
    if (bodyText) {
      sourceMode = "email-body";
    } else {
      // Fetch the newest inbound email from GHL using whatever id the webhook sent.
      if (!cfg) return json({ error: `GHL not configured: ${cfgErr || "missing credentials"}` }, 502);
      const conversationId = pickId(body, ["conversationId", "conversation_id", "conversation"]);
      const contactId = pickId(body, ["contactId", "contact_id", "id"]);
      const fetched = await newestInboundEmail(cfg, { conversationId, contactId });
      if (!fetched) return json({ error: "no inbound email body found (payload carried no body and no resolvable conversation/contact id)" }, 422);
      bodyText = fetched.body; emailSubject = fetched.subject; emailFrom = fetched.from;
      sourceMode = "ghl-fetch";
    }
    fields = parseLabelValue(htmlToSegments(bodyText));
  }

  const lead = toLead(fields);
  if (emailSubject) lead.raw["_email_subject"] = emailSubject;
  if (emailFrom) lead.raw["_email_from"] = emailFrom;

  // Soft identity check (advisory only — the secret is the real gate).
  const looksLikeLiveTransfer =
    emailSubject.toLowerCase().startsWith(LIVE_TRANSFER_SUBJECT_PREFIX) ||
    emailFrom.toLowerCase().includes(LIVE_TRANSFER_FROM_DOMAIN) ||
    sourceMode === "structured" ||
    Object.keys(fields).length >= 3;

  if (!lead.email && !lead.phone) {
    return json({ error: "could not parse a phone or email from the lead", parsed: lead.raw, mode: sourceMode }, 422);
  }
  const fullName = `${lead.first} ${lead.last}`.trim() || lead.business || "Live Transfer Lead";

  // ── DEDUPE: same phone/email with a live_transfer deal in the last 30 days ──
  const sinceIso = new Date(Date.now() - DEDUPE_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
  const candIds = new Set<string>();
  if (lead.email) {
    const { data } = await db.from("customers").select("id").eq("email", lead.email);
    for (const c of data ?? []) candIds.add(c.id as string);
  }
  if (lead.phone) {
    const { data } = await db.from("customers").select("id").eq("phone", lead.phone);
    for (const c of data ?? []) candIds.add(c.id as string);
  }
  let existingCustomerId: string | null = candIds.size ? [...candIds][0] : null;
  if (candIds.size) {
    const { data: dup } = await db.from("deals")
      .select("id, deal_number, customer_id, created_at")
      .in("customer_id", [...candIds])
      .eq("lead_source", "live_transfer")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();
    if (dup) {
      await db.from("activity_log").insert({
        entity_type: "deal", entity_id: dup.id,
        interaction_type: "note",
        subject: "live-transfer:dedupe",
        content: `Duplicate live-transfer intake suppressed (same ${lead.email ? "email" : "phone"} within ${DEDUPE_WINDOW_DAYS}d). Incoming: ${fullName} / ${lead.business} / ${lead.phone || lead.email}.`,
      }).then(() => {}, () => {});
      return json({ ok: true, deduped: true, dealId: dup.id, dealNumber: dup.deal_number, customerId: dup.customer_id });
    }
  }

  // ── Upsert the CUSTOMER ──
  const custPatch: Record<string, unknown> = {
    first_name: lead.first || null,
    last_name: lead.last || null,
    email: lead.email || null,
    phone: lead.phone || null,
    business_name: lead.business || null,
    address_state: lead.state || null,
    industry: lead.industry || null,
    monthly_revenue: lead.monthlyDeposits,
    amount_requested: lead.requestedAmount,
    use_of_funds: lead.useOfFunds || null,
    source: "live_transfer",
    is_live_transfer: true,
    temperature: "hot",
    lead_qual: lead.raw,
  };
  let customerId: string;
  if (existingCustomerId) {
    // Only fill gaps — never blank out existing data.
    const { data: cur } = await db.from("customers").select("*").eq("id", existingCustomerId).maybeSingle();
    const merged: Record<string, unknown> = { is_live_transfer: true, temperature: "hot", lead_qual: lead.raw, source: "live_transfer" };
    for (const [k, v] of Object.entries(custPatch)) {
      if (v == null || v === "") continue;
      if (cur && (cur[k] == null || cur[k] === "")) merged[k] = v;
    }
    await db.from("customers").update(merged).eq("id", existingCustomerId);
    customerId = existingCustomerId;
  } else {
    const { data: c, error } = await db.from("customers").insert({ status: "lead", ...custPatch }).select("id").single();
    if (error) return json({ error: `could not create customer: ${error.message}` }, 500);
    customerId = c.id as string;
  }

  // ── Resolve the campaign by CODE (never hardcode the uuid) ──
  let campaignId: string | null = null;
  {
    const { data: camp } = await db.from("campaigns").select("id").eq("code", LIVE_TRANSFER_CAMPAIGN_CODE).maybeSingle();
    campaignId = (camp?.id as string | undefined) ?? null;
  }

  // ── Create the DEAL — born HOT with a 5-minute call clock ──
  const now = Date.now();
  const { data: deal, error: dErr } = await db.from("deals").insert({
    customer_id: customerId,
    deal_type: "mca",
    status: "new",
    lead_source: "live_transfer",
    lead_source_detail: `Synergy live transfer${lead.agent ? ` · ${lead.agent}` : ""}`,
    amount_requested: lead.requestedAmount,
    use_of_funds: lead.useOfFunds || null,
    campaign_id: campaignId,
    temperature: "hot",
    urgency: /yes/i.test(lead.needMoneyNow) ? "high" : null,
    first_call_due_at: new Date(now + FIRST_CALL_SLA_MS).toISOString(),
    lead_qual: lead.raw,
    notes: [
      `Live transfer — Synergy (Double-Verified).`,
      lead.business && `Business: ${lead.business}`,
      lead.state && `State: ${lead.state}`,
      lead.industry && `Industry: ${lead.industry}`,
      lead.monthlyDeposits != null && `Monthly deposits: $${lead.monthlyDeposits.toLocaleString()}`,
      lead.requestedAmount != null && `Requested: $${lead.requestedAmount.toLocaleString()}`,
      lead.fico != null && `FICO: ${lead.fico}`,
      lead.openPositions != null && `Open positions: ${lead.openPositions}`,
      lead.positionsBalance != null && `Positions balance: $${lead.positionsBalance.toLocaleString()}`,
      lead.timeAsOwner && `Time as owner: ${lead.timeAsOwner}`,
      lead.bestTime && `Best time to reach: ${lead.bestTime}`,
    ].filter(Boolean).join("\n"),
  }).select("id, deal_number").single();
  if (dErr) return json({ error: `could not create deal: ${dErr.message}` }, 500);
  const dealId = deal.id as string;
  const dealNumber = deal.deal_number as string | null;

  // ── Full audit: the entire parsed payload, nothing lost ──
  await db.from("activity_log").insert({
    entity_type: "deal", entity_id: dealId,
    interaction_type: "note",
    subject: "live-transfer:intake",
    content: `Auto-created from ${sourceMode} live transfer.\n${JSON.stringify(lead.raw, null, 2)}`,
  }).then(() => {}, () => {});

  // ── GHL: proper merchant contact + MCA opportunity at "New Lead" ──
  let ghlContactId: string | null = null;
  let ghlOpportunityId: string | null = null;
  let ghlWarning: string | undefined;
  if (cfg) {
    try {
      const cr = await upsertContact(cfg, {
        firstName: lead.first || null,
        lastName: lead.last || null,
        name: (!lead.first && !lead.last) ? fullName : null,
        email: lead.email || null,
        phone: lead.phone || null,
        companyName: lead.business || null,
        state: lead.state || null,
        tags: ["live-transfer", "synergy", "merchant"],
        source: "Live Transfer",
      });
      ghlContactId = cr.data?.contact?.id ?? null;
      if (!ghlContactId) {
        ghlWarning = cr.error || "GHL upsert returned no contact id";
      } else {
        await db.from("customers").update({ ghl_contact_id: ghlContactId }).eq("id", customerId);
        await db.from("deals").update({ ghl_contact_id: ghlContactId }).eq("id", dealId);
        const pl = await listPipelines(cfg);
        const mca = pl.data?.pipelines?.find((p) => p.id === MCA_PIPELINE_ID)
          ?? pl.data?.pipelines?.find((p) => {
            const n = new Set(p.stages.map((s) => s.name.toLowerCase()));
            return n.has("new lead") && n.has("renewal eligible");
          });
        const stage = mca?.stages.find((s) => s.name.toLowerCase() === "new lead") ?? mca?.stages[0];
        if (mca && stage) {
          const opp = await createOpportunity(cfg, {
            pipelineId: mca.id, pipelineStageId: stage.id, contactId: ghlContactId,
            name: lead.business || fullName,
            monetaryValue: lead.requestedAmount ?? undefined,
          });
          ghlOpportunityId = opp.data?.opportunity?.id ?? null;
          if (ghlOpportunityId) await db.from("deals").update({ ghl_opportunity_id: ghlOpportunityId }).eq("id", dealId);
        }
      }
    } catch (e) {
      ghlWarning = e instanceof Error ? e.message : String(e);
    }
    if (ghlWarning) console.error("live-transfer-intake: GHL sync issue", { dealId, ghlWarning });
  } else {
    ghlWarning = `GHL not configured: ${cfgErr || "missing credentials"}`;
  }

  // ── Urgent internal alert to the team (best-effort) ──
  let alertSent = false;
  let alertWarning: string | undefined;
  if (cfg) {
    try {
      // Send through the alerts inbox contact (owner's address); CC the rest of
      // the team. No name fields on the upsert so we never clobber an existing
      // contact record for that address.
      const alert = await upsertContact(cfg, {
        email: TEAM_ALERT_TO, tags: ["internal-alerts"], source: "Live Transfer Alert",
      });
      const alertContactId = alert.data?.contact?.id;
      if (!alertContactId) {
        alertWarning = alert.error || "no alert contact id";
      } else {
        const rows: Array<[string, string | null]> = [
          ["Contact", fullName],
          ["Business", lead.business || null],
          ["Phone", lead.phoneRaw || lead.phone || null],
          ["Email", lead.email || null],
          ["State", lead.state || null],
          ["Industry", lead.industry || null],
          ["Requested", lead.requestedAmount != null ? `$${lead.requestedAmount.toLocaleString()}` : null],
          ["Monthly deposits", lead.monthlyDeposits != null ? `$${lead.monthlyDeposits.toLocaleString()}` : null],
          ["FICO", lead.fico != null ? String(lead.fico) : null],
          ["Open positions", lead.openPositions != null ? String(lead.openPositions) : null],
          ["Best time", lead.bestTime || null],
          ["Deal #", dealNumber],
        ];
        const trs = rows.filter(([, v]) => v).map(
          ([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#64748b;white-space:nowrap">${k}</td><td style="padding:4px 0;color:#0f172a;font-weight:600">${v}</td></tr>`,
        ).join("");
        const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px">
<div style="background:#dc2626;color:#fff;font-size:16px;font-weight:700;padding:12px 16px;border-radius:8px 8px 0 0">🔴 LIVE TRANSFER — CALL WITHIN 5 MINUTES</div>
<div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 8px 8px;padding:16px">
<p style="margin:0 0 10px;font-size:14px;color:#0f172a">A Synergy live-transfer lead just came in. The merchant is expecting a call <b>right now</b>.</p>
<table style="font-size:14px;border-collapse:collapse">${trs}</table>
<p style="margin:14px 0 0"><a href="${PLAYBOOK_URL}" style="background:#2563eb;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:6px;display:inline-block">Open the Playbook →</a></p>
</div></div>`;
        const text = `LIVE TRANSFER — CALL WITHIN 5 MINUTES\n\n${rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nOpen the playbook: ${PLAYBOOK_URL}`;
        const subject = `🔴 LIVE TRANSFER: ${fullName} / ${lead.business || "—"} — CALL WITHIN 5 MIN`;
        const sr = await sendEmailToContact(cfg, alertContactId, subject, html, { text, emailCc: TEAM_ALERT_CC });
        alertSent = sr.ok;
        if (!sr.ok) alertWarning = sr.error;
      }
    } catch (e) {
      alertWarning = e instanceof Error ? e.message : String(e);
    }
    if (alertWarning) console.error("live-transfer-intake: alert email issue", { dealId, alertWarning });
  }

  return json({
    ok: true,
    deduped: false,
    dealId,
    dealNumber,
    customerId,
    campaignId,
    ghlContactId,
    ghlOpportunityId,
    ghlWarning,
    alertSent,
    alertWarning,
    mode: sourceMode,
    looksLikeLiveTransfer,
    parsedFields: Object.keys(fields).length,
  });
});
