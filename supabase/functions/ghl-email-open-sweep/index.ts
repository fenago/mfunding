// ghl-email-open-sweep — pull-based per-lead email-OPEN sync.
//
// WHY: the Campaign Audit needs a real per-campaign open rate. GHL exposes an
// email's open state on the email RECORD (GET /conversations/messages/email/{id} →
// status "sent"|"delivered"|"opened"|"failed"…), but nothing polled it for
// merchants. The ghl-webhook PUSH path captures opens only when a GHL "Email Events"
// workflow is wired to fire; this sweep is the PULL safety net that works regardless.
//
// WHAT IT DOES (every 15 min, via pg_cron — same cadence as check-email-bounces):
//   1. Picks open-deal, campaign-attributed merchants with a GHL contact, un-opened
//      first (so we don't burn API calls re-checking leads already known to have
//      opened), capped per run.
//   2. For each, lists their RECENT (<=14 days) OUTBOUND email records, skipping any
//      already recorded as "opened" (terminal for our purpose — record-once).
//   3. Reads each remaining record's status and persists it via sync_email_open_status
//      into email_open_events + the customers.email_last_opened_at aggregate the audit
//      reads. Idempotent; never double-counts with the webhook path.
//
// It NEVER sends anything and NEVER touches GHL workflows — read-only against GHL,
// writes only our own tables. Internal observability; no merchant-facing copy.
//
// Auth mirrors check-email-bounces: trusted cron (?secret=<GHL webhook secret> + anon
// bearer for the gateway) OR a signed-in closer/admin/super_admin.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient, getGhlConfig, ghlFetch, getEmailRecord, type GhlConfig } from "../_shared/ghl.ts";

const DEFAULT_LIMIT = 20;              // merchants per run
const MAX_EMAILS_PER_CONTACT = 6;      // cap record fetches per merchant
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000; // only emails from the last 14 days
const PACE_MS = 200;                   // GHL rate-limit courtesy

// Deals in these states are done/dead — not "open" merchants worth polling.
const TERMINAL_DEAL_STATUSES = ["declined", "dead", "nurture"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// A recent outbound email record reference: the email-record id plus the message's
// send time (used to bound the 14-day window before we spend a record fetch).
interface EmailRef { id: string; at: string | null }

// conversation → messages → meta.email.messageIds, filtered to OUTBOUND email
// messages within the lookback window, newest first. (Same traversal the shared
// email helpers use; inlined here to keep the shared lib untouched.)
async function recentOutboundEmailRefs(cfg: GhlConfig, contactId: string, sinceMs: number): Promise<EmailRef[]> {
  const conv = await ghlFetch<{ conversations?: Array<{ id: string }> }>(
    cfg, "GET", `/conversations/search?locationId=${cfg.locationId}&contactId=${contactId}`,
  );
  const cid = conv.data?.conversations?.[0]?.id;
  if (!cid) return [];
  const msgs = await ghlFetch<{ messages?: { messages?: Array<Record<string, unknown>> } }>(
    cfg, "GET", `/conversations/${cid}/messages?limit=25`,
  );
  const out: EmailRef[] = [];
  for (const m of msgs.data?.messages?.messages ?? []) {
    if (!/email/i.test(String(m.messageType ?? ""))) continue;
    if (String(m.direction ?? "").toLowerCase() !== "outbound") continue;
    const at = typeof m.dateAdded === "string" ? m.dateAdded : null;
    if (at && Date.parse(at) < sinceMs) continue; // outside the 14-day window
    const ids = (m.meta as { email?: { messageIds?: string[] } } | undefined)?.email?.messageIds ?? [];
    for (const id of ids) out.push({ id: String(id), at });
  }
  return out.slice(0, MAX_EMAILS_PER_CONTACT);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const db: SupabaseClient = serviceClient();
  const url = new URL(req.url);

  // ── Auth: trusted cron (shared secret) OR a signed-in staff user ──
  const providedSecret = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  const { data: gc } = await db.rpc("get_ghl_config");
  if (providedSecret) {
    const expected = (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
    if (!expected || providedSecret !== expected) return json({ error: "forbidden" }, 403);
  } else {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
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

  let payload: Record<string, unknown> = {};
  try { payload = (await req.json()) as Record<string, unknown>; } catch { /* cron posts no body */ }
  const limit = Number(payload.limit ?? url.searchParams.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT;
  const onlyContactId = (payload.contact_id ?? url.searchParams.get("contact_id") ?? null) as string | null;

  let cfg: GhlConfig;
  try { cfg = await getGhlConfig(db); }
  catch (e) { return json({ error: `GHL not configured: ${e instanceof Error ? e.message : String(e)}` }, 502); }

  // ── Who to poll: open-deal, campaign-attributed merchants with a GHL contact ──
  const candidates = await pickMerchants(db, limit, onlyContactId);

  const since = Date.now() - LOOKBACK_MS;
  let contactsChecked = 0, emailsFetched = 0, opensFound = 0, delivered = 0, skippedOpened = 0;
  const errors: string[] = [];

  for (const c of candidates) {
    contactsChecked++;
    try {
      // Emails we've already recorded as opened for this contact — never re-fetch them.
      const { data: known } = await db.from("email_open_events")
        .select("ghl_message_id").eq("ghl_contact_id", c.ghl_contact_id).eq("status", "opened");
      const opened = new Set((known ?? []).map((r) => (r as { ghl_message_id: string }).ghl_message_id));

      const refs = await recentOutboundEmailRefs(cfg, c.ghl_contact_id, since);
      for (const ref of refs) {
        if (opened.has(ref.id)) { skippedOpened++; continue; }
        const rec = await getEmailRecord(cfg, ref.id);
        const em = rec.data?.emailMessage as (Record<string, unknown> & { status?: string; direction?: string; dateUpdated?: string; dateAdded?: string }) | undefined;
        emailsFetched++;
        if (!em || String(em.direction ?? "").toLowerCase() !== "outbound") continue;
        const status = typeof em.status === "string" ? em.status.toLowerCase() : null;
        if (!status) continue;
        // Best available event time: the record's last change (when it flipped to
        // opened/delivered), else the send time.
        const eventAt = (typeof em.dateUpdated === "string" && em.dateUpdated) ||
          (typeof em.dateAdded === "string" && em.dateAdded) || ref.at || new Date().toISOString();
        const { error } = await db.rpc("sync_email_open_status", {
          p_email_id: ref.id, p_contact_id: c.ghl_contact_id, p_status: status, p_event_at: eventAt,
        });
        if (error) errors.push(`sync ${ref.id}: ${error.message}`);
        else if (status === "opened") opensFound++;
        else if (status === "delivered") delivered++;
        await sleep(PACE_MS);
      }
    } catch (e) {
      errors.push(`${c.ghl_contact_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await sleep(PACE_MS);
  }

  return json({
    ok: true,
    candidates: candidates.length,
    contactsChecked,
    emailsFetched,
    opensFound,
    delivered,
    skippedAlreadyOpened: skippedOpened,
    errors: errors.slice(0, 20),
  });
});

interface Merchant { customer_id: string; ghl_contact_id: string }

// Distinct open-deal merchants with a GHL contact, un-opened FIRST so a run spends
// its budget on leads whose open state we don't yet know.
async function pickMerchants(db: SupabaseClient, limit: number, onlyContactId: string | null): Promise<Merchant[]> {
  if (onlyContactId) {
    const { data } = await db.from("customers").select("id, ghl_contact_id")
      .eq("ghl_contact_id", onlyContactId).maybeSingle();
    const row = data as { id: string; ghl_contact_id: string | null } | null;
    return row?.ghl_contact_id ? [{ customer_id: row.id, ghl_contact_id: row.ghl_contact_id }] : [];
  }

  const { data: deals } = await db.from("deals")
    .select("customer_id, ghl_contact_id, created_at, status")
    .not("campaign_id", "is", null).not("ghl_contact_id", "is", null)
    .order("created_at", { ascending: false }).limit(400);

  // Distinct by contact, dropping terminal deals, newest first.
  const seen = new Set<string>();
  const pool: Merchant[] = [];
  for (const d of (deals ?? []) as Array<{ customer_id: string | null; ghl_contact_id: string | null; status: string }>) {
    if (!d.customer_id || !d.ghl_contact_id) continue;
    if (TERMINAL_DEAL_STATUSES.includes(d.status)) continue;
    if (seen.has(d.ghl_contact_id)) continue;
    seen.add(d.ghl_contact_id);
    pool.push({ customer_id: d.customer_id, ghl_contact_id: d.ghl_contact_id });
  }
  if (pool.length === 0) return [];

  // Un-opened first: fetch which candidate customers already have an open on record.
  const { data: custs } = await db.from("customers")
    .select("id, email_last_opened_at").in("id", pool.map((p) => p.customer_id));
  const openedAt = new Map<string, string | null>();
  for (const c of (custs ?? []) as Array<{ id: string; email_last_opened_at: string | null }>) {
    openedAt.set(c.id, c.email_last_opened_at);
  }
  pool.sort((a, b) => {
    const ao = openedAt.get(a.customer_id) ? 1 : 0;
    const bo = openedAt.get(b.customer_id) ? 1 : 0;
    return ao - bo; // unopened (0) before opened (1); stable otherwise keeps recency
  });
  return pool.slice(0, limit);
}
