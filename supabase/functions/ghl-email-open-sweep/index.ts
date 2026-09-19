// ghl-email-open-sweep — pull-based per-lead email-OPEN sync.
//
// WHY: the Campaign Audit needs a real per-campaign open rate. GHL exposes an
// email's open state on the email RECORD (GET /conversations/messages/email/{id} →
// status "sent"|"delivered"|"opened"|"failed"…), but nothing polled it for
// merchants. The ghl-webhook PUSH path captures opens only when a GHL "Email Events"
// workflow is wired to fire; this sweep is the PULL safety net that works regardless.
//
// WHAT IT DOES (every 6h via pg_cron — 4 passes of 90 covers all ~346 eligible
// merchants once a day):
//   1. Picks candidates LEAST-RECENTLY-CHECKED first (pick_email_open_candidates):
//      campaign-attributed merchants with a GHL contact and an email address,
//      terminal deals included. Rotation is what guarantees coverage — see below.
//   2. For each, lists their RECENT (<=14 days) OUTBOUND email records, skipping any
//      already recorded as "opened" (terminal for our purpose — record-once).
//   3. Reads each remaining record's status and persists it via sync_email_open_status
//      into email_open_events + the customers.email_last_opened_at aggregate the audit
//      reads. Idempotent; never double-counts with the webhook path.
//   4. Stamps customers.email_open_checked_at per contact, whether or not anything was
//      found. That is both the rotation watermark AND the audit's freshness signal: a
//      lead with no open and no check is UNKNOWN, not zero.
//
// WHY THE ROTATION: this sweep wrote its last row on 2026-09-10 and nothing for the
// eight days after. It ordered candidates un-opened-first and sliced to 40, so a
// merchant who never opens sorted to the front FOREVER — the same head of the list was
// re-polled every run and the tail was never reached. It also excluded terminal deals,
// hiding 197 of 345 campaign merchants from the collector while they still counted in
// the audit's denominator. Never reintroduce either: order by the watermark, and let
// the whole eligible book take its turn.
//
// A run is time-budgeted and simply stops when the budget is spent. Because every
// contact is stamped as it is processed, the next run resumes at the oldest watermark
// instead of restarting at the same head.
//
// It NEVER sends anything and NEVER touches GHL workflows — read-only against GHL,
// writes only our own tables. Internal observability; no merchant-facing copy.
//
// Auth mirrors check-email-bounces: trusted cron (?secret=<GHL webhook secret> + anon
// bearer for the gateway) OR a signed-in closer/admin/super_admin.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, serviceClient, getGhlConfig, ghlFetch, getEmailRecord, type GhlConfig } from "../_shared/ghl.ts";

const DEFAULT_LIMIT = 90;              // merchants per run
const MAX_EMAILS_PER_CONTACT = 6;      // cap record fetches per merchant
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000; // only emails from the last 14 days
const PACE_MS = 200;                   // GHL rate-limit courtesy
const TIME_BUDGET_MS = 110_000;        // stop cleanly well inside the edge-runtime wall

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

  // ── Who to poll: least-recently-checked campaign merchants (see header) ──
  let candidates: Merchant[];
  try {
    candidates = await pickMerchants(db, limit, onlyContactId);
  } catch (e) {
    // An unreadable candidate list is NOT an empty one — say so rather than
    // returning a clean zero the caller would read as "nothing to do".
    return json({ error: `candidate selection failed: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }

  const startedAt = Date.now();
  const since = startedAt - LOOKBACK_MS;
  let contactsChecked = 0, emailsFetched = 0, opensFound = 0, delivered = 0, skippedOpened = 0;
  const errors: string[] = [];
  let budgetSpent = false;

  for (const c of candidates) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) { budgetSpent = true; break; }
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
      // Looked at, and the result is recorded — stamp the watermark so this contact
      // goes to the back of the queue and the next run advances instead of restarting
      // here. Only on a clean pass: a contact we failed to READ keeps its old
      // watermark so it is retried, never silently marked as covered.
      const { error: stampErr } = await db.from("customers")
        .update({ email_open_checked_at: new Date().toISOString() })
        .eq("id", c.customer_id);
      if (stampErr) errors.push(`stamp ${c.customer_id}: ${stampErr.message}`);
    } catch (e) {
      errors.push(`${c.ghl_contact_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await sleep(PACE_MS);
  }

  // Coverage of the whole eligible book, so the caller can tell a real zero from an
  // unfinished sweep. Unreadable → null, never a reassuring number.
  const { data: cov } = await db.rpc("email_open_sweep_status");
  const coverage = Array.isArray(cov) ? cov[0] ?? null : cov ?? null;

  return json({
    ok: true,
    candidates: candidates.length,
    contactsChecked,
    emailsFetched,
    opensFound,
    delivered,
    skippedAlreadyOpened: skippedOpened,
    // True when the run stopped on its time budget: the remaining candidates are
    // UNCHECKED, not open-free. The next run picks them up by watermark.
    budgetSpent,
    remaining: candidates.length - contactsChecked,
    coverage,
    errors: errors.slice(0, 20),
  });
});

interface Merchant { customer_id: string; ghl_contact_id: string }

// Campaign merchants with a contact and an email, LEAST-RECENTLY-CHECKED first, via
// pick_email_open_candidates. The ordering is the whole point: it is what makes the
// sweep reach the entire book instead of re-polling one pinned head of the list.
// Throws on a read failure so the caller reports UNREADABLE rather than "no candidates".
async function pickMerchants(db: SupabaseClient, limit: number, onlyContactId: string | null): Promise<Merchant[]> {
  if (onlyContactId) {
    const { data, error } = await db.from("customers").select("id, ghl_contact_id")
      .eq("ghl_contact_id", onlyContactId).maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as { id: string; ghl_contact_id: string | null } | null;
    return row?.ghl_contact_id ? [{ customer_id: row.id, ghl_contact_id: row.ghl_contact_id }] : [];
  }

  const { data, error } = await db.rpc("pick_email_open_candidates", { p_limit: limit });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ customer_id: string; ghl_contact_id: string }>)
    .filter((r) => r.customer_id && r.ghl_contact_id)
    .map((r) => ({ customer_id: r.customer_id, ghl_contact_id: r.ghl_contact_id }));
}
