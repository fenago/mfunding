// ghl-call-history — live call history for a merchant's GHL contact, plus the
// self-auditing sync that makes real GHL/VibeReach dials show up on the deal.
//
// Closers dial through GHL's phone system (LeadConnector); those calls exist
// only as TYPE_CALL conversation messages in GHL. This function:
//  1) Fetches every call for the contact (all their conversations → messages,
//     filtered to TYPE_CALL) and returns them for the CallHistoryPanel:
//     direction, who placed it (GHL user name), when, duration, outcome.
//  2) SYNC (the audit): when a deal_id is passed AND that deal is linked to this
//     exact contact, every OUTBOUND call is written through the record-once
//     ledger (ghl_call_log, PK = GHL message id — re-polls / overlapping panel
//     loads can never double-log). Newly-seen calls each get an activity_log
//     row on the deal, and the batch stamps telemetry atomically via
//     ghl_apply_call_telemetry(): first/last_attempt_at, contact_attempts,
//     and contacted_at only for an ANSWERED call ≥ 30s (see the migration for
//     the threshold rationale). status and callback_at are NEVER touched here.
//
// Why a poll and not a webhook: no GHL workflow carries call events today
// (verified 2026-07-14 — no "Call Status" workflow exists and the workflows API
// is read-only, so one can't be added programmatically). The panel poll runs
// every time staff open the deal's system card, which is exactly when the board
// looks. If the owner later wires a Call Status → Webhook workflow, that path
// can reuse the same ledger and never duplicate anything already seen.
//
// Read-only against GHL. Staff only (closer/admin/super_admin) — call records
// expose staff phone numbers, so there is no merchant path.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient, getGhlConfig, ghlFetch, type GhlConfig } from "../_shared/ghl.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface GhlMessage {
  id: string;
  direction?: string;
  status?: string;
  contactId?: string;
  conversationId?: string;
  dateAdded?: string;
  userId?: string;
  from?: string;
  to?: string;
  messageType?: string;
  meta?: { call?: { duration?: number | null; status?: string | null } };
}

export interface CallRecord {
  id: string;
  direction: "inbound" | "outbound";
  status: string;            // completed | voicemail | no-answer | busy | failed | canceled | unknown
  durationSeconds: number | null;
  calledAt: string;          // ISO
  userId: string | null;
  userName: string | null;   // "Carlos Marquez"
  from: string | null;
  to: string | null;
}

// A call counts as an actual CONTACT (conversation happened) only when it
// connected AND ran ≥ 30 seconds. LeadConnector marks any connected call
// "completed" — including voicemail-box pickups and instant hang-ups — so
// completed alone is an attempt, not a contact. Keep in sync with the comment
// on ghl_apply_call_telemetry() in 20260714_ghl_call_log.sql.
const CONTACT_MIN_SECONDS = 30;
const answered = (c: CallRecord) =>
  c.status === "completed" && (c.durationSeconds ?? 0) >= CONTACT_MIN_SECONDS;

async function fetchContactCalls(cfg: GhlConfig, contactId: string): Promise<CallRecord[]> {
  // 1) Every conversation for this contact (a contact virtually always has one
  //    TYPE_PHONE thread, but don't assume).
  const convRes = await ghlFetch<{ conversations?: Array<{ id: string }> }>(
    cfg, "GET",
    `/conversations/search?locationId=${cfg.locationId}&contactId=${encodeURIComponent(contactId)}&limit=20`,
  );
  if (!convRes.ok) throw new Error(`GHL conversations search failed (${convRes.status}): ${convRes.error ?? ""}`);
  const convIds = (convRes.data?.conversations ?? []).map((c) => c.id).filter(Boolean);

  // 2) Messages per conversation, filtered to calls. One 100-message page per
  //    conversation covers any realistic call volume for a single merchant.
  const calls: CallRecord[] = [];
  const userIds = new Set<string>();
  for (const convId of convIds) {
    const msgRes = await ghlFetch<{ messages?: { messages?: GhlMessage[] } }>(
      cfg, "GET", `/conversations/${convId}/messages?limit=100`,
    );
    if (!msgRes.ok) continue; // one bad thread must not blank the whole panel
    for (const m of msgRes.data?.messages?.messages ?? []) {
      if (m.messageType !== "TYPE_CALL" || !m.id || !m.dateAdded) continue;
      const dir = m.direction === "outbound" ? "outbound" : "inbound";
      const call = m.meta?.call ?? {};
      const rec: CallRecord = {
        id: m.id,
        direction: dir,
        status: String(call.status ?? m.status ?? "unknown"),
        durationSeconds: typeof call.duration === "number" ? call.duration : null,
        calledAt: m.dateAdded,
        userId: m.userId ?? null,
        userName: null,
        from: m.from ?? null,
        to: m.to ?? null,
      };
      calls.push(rec);
      if (rec.userId) userIds.add(rec.userId);
    }
  }

  // 3) Resolve GHL user ids → names ("by Carlos Marquez"). Best-effort.
  const names = new Map<string, string>();
  for (const uid of userIds) {
    try {
      const u = await ghlFetch<{ name?: string; firstName?: string; lastName?: string }>(
        cfg, "GET", `/users/${uid}`,
      );
      const n = u.data?.name ?? [u.data?.firstName, u.data?.lastName].filter(Boolean).join(" ");
      if (u.ok && n) names.set(uid, n);
    } catch { /* name stays null — the record still shows */ }
  }
  for (const c of calls) if (c.userId) c.userName = names.get(c.userId) ?? null;

  calls.sort((a, b) => b.calledAt.localeCompare(a.calledAt)); // most recent first
  return calls;
}

function fmtDuration(sec: number | null): string {
  if (sec == null || sec <= 0) return "0s";
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

function outcomeLabel(c: CallRecord): string {
  if (c.status === "completed") return answered(c) ? "answered" : "connected briefly";
  if (c.status === "voicemail") return "voicemail";
  if (c.status === "no-answer") return "no answer";
  if (c.status === "busy") return "busy";
  return c.status || "unknown";
}

/**
 * Reflect a contact's OUTBOUND dials into its deal: record-once ledger, one
 * activity_log row per new call, atomic telemetry stamp. Idempotent (ledger PK =
 * GHL message id). Used by BOTH the panel poll and the cron sweep — one code
 * path, so "logged when viewed" and "logged automatically" can never diverge.
 */
async function syncCallsForDeal(
  db: ReturnType<typeof serviceClient>,
  dealId: string,
  contactId: string,
  calls: CallRecord[],
): Promise<{ synced: number; syncError: string | null }> {
  let synced = 0;
  let syncError: string | null = null;
  try {
    const outbound = calls.filter((c) => c.direction === "outbound");
    const fresh: CallRecord[] = [];
    for (const c of outbound) {
      const { data: ins, error: insErr } = await db.from("ghl_call_log").upsert({
        ghl_message_id: c.id,
        deal_id: dealId,
        ghl_contact_id: contactId,
        direction: c.direction,
        call_status: c.status,
        duration_seconds: c.durationSeconds,
        ghl_user_id: c.userId,
        ghl_user_name: c.userName,
        from_number: c.from,
        to_number: c.to,
        called_at: c.calledAt,
      }, { onConflict: "ghl_message_id", ignoreDuplicates: true }).select("ghl_message_id");
      if (!insErr && ins && ins.length > 0) fresh.push(c);
    }
    if (fresh.length > 0) {
      for (const c of fresh) {
        await db.from("activity_log").insert({
          entity_type: "deal",
          entity_id: dealId,
          interaction_type: "call",
          subject: `GHL call: outbound, ${fmtDuration(c.durationSeconds)}, ${outcomeLabel(c)}${c.userName ? ` — by ${c.userName}` : ""}`,
          content: JSON.stringify({
            source: "ghl-call-history", ghl_message_id: c.id, status: c.status,
            duration_seconds: c.durationSeconds, called_at: c.calledAt,
            user: c.userName, from: c.from, to: c.to,
          }),
        });
      }
      const times = fresh.map((c) => c.calledAt).sort();
      const answered = (c: CallRecord) =>
        c.status === "completed" && (c.durationSeconds ?? 0) >= CONTACT_MIN_SECONDS;
      const contactedTs = fresh.filter(answered).map((c) => c.calledAt).sort()[0] ?? null;
      const { error: rpcErr } = await db.rpc("ghl_apply_call_telemetry", {
        p_deal_id: dealId,
        p_first_at: times[0],
        p_last_at: times[times.length - 1],
        p_new_attempts: fresh.length,
        p_contacted_at: contactedTs,
      });
      if (rpcErr) syncError = `telemetry stamp failed: ${rpcErr.message}`;
      synced = fresh.length;
    }
  } catch (e) {
    syncError = e instanceof Error ? e.message : String(e);
  }
  return { synced, syncError };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = (await req.json().catch(() => ({}))) as { ghl_contact_id?: string; deal_id?: string };
    const contactId = String(body.ghl_contact_id ?? "").trim();
    const db = serviceClient();

    // ── SWEEP MODE (pg_cron): sync calls for EVERY open deal, no viewing required. ──
    //
    // The panel-poll design had a hole the owner hit within hours: he dialed PRB
    // Environmental through VibeReach, and because nobody opened that deal's card
    // (and the panel only mounted on two steps), the call never logged. "Track
    // calls when we happen to look" is not tracking. The sweep makes GHL dials
    // self-audit within minutes, viewed or not; the panel poll remains the
    // instant path when someone IS looking. Same syncCallsForDeal() either way.
    const url = new URL(req.url);
    const providedSecret = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
    if (providedSecret) {
      const { data: gc } = await db.rpc("get_ghl_config");
      const expected = (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
      if (!expected || providedSecret !== expected) return json({ error: "forbidden" }, 403);

      const cfg = await getGhlConfig(db);
      const { data: open } = await db.from("deals")
        .select("id, ghl_contact_id")
        .not("ghl_contact_id", "is", null)
        .not("status", "in", "(nurture,declined,dead,funded,renewal_eligible,restructure_executed,servicing)");
      const summary = { swept: 0, synced: 0, failed: [] as string[] };
      for (const d of open ?? []) {
        summary.swept++;
        try {
          const calls = await fetchContactCalls(cfg, d.ghl_contact_id as string);
          if (calls.length === 0) continue;
          const r = await syncCallsForDeal(db, d.id as string, d.ghl_contact_id as string, calls);
          summary.synced += r.synced;
          if (r.syncError) summary.failed.push(`${d.id}: ${r.syncError}`);
        } catch (e) {
          summary.failed.push(`${d.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return json({ ok: true, mode: "sweep", ...summary });
    }

    if (!contactId) return json({ error: "ghl_contact_id is required" }, 400);

    // ── Auth: staff only (mirrors ghl-docs-status' staff branch). verify_jwt=true
    //    gates the gateway; this resolves the role. No merchant path on purpose —
    //    call records carry staff numbers.
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Missing authorization" }, 401);
    const { data: userData, error: userErr } = await db.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid session" }, 401);
    const { data: prof } = await db.from("profiles").select("role").eq("id", caller.id).single();
    const role = prof?.role as string | undefined;
    if (!role || !["closer", "admin", "super_admin"].includes(role)) {
      return json({ error: "Staff only" }, 403);
    }

    const cfg = await getGhlConfig(db);
    const calls = await fetchContactCalls(cfg, contactId);

    // ── Self-audit sync: reflect OUTBOUND dials into the deal ────────────────
    let synced = 0;
    let syncError: string | null = null;
    const dealId = String(body.deal_id ?? "").trim();
    if (dealId && calls.length > 0) {
      // Hard guard: only stamp the deal that is actually linked to THIS contact —
      // a mismatched pair must never cross-audit. Silently skip; the panel still shows.
      const { data: deal } = await db.from("deals")
        .select("id, ghl_contact_id").eq("id", dealId).maybeSingle();
      if (deal && deal.ghl_contact_id === contactId) {
        ({ synced, syncError } = await syncCallsForDeal(db, dealId, contactId, calls));
      }
    }

    return json({ ok: true, calls, synced, sync_error: syncError });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown error" }, 500);
  }
});
