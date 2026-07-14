// callback-calendar-sync — projects deals.callback_at onto the GHL
// "Callbacks — Internal" calendar. One direction only: DB → GHL.
//
// WHY (research/PLAN_followups_calendar.md): "call me at 4pm" merchants were
// being missed because the promise lived only in the app. Now the promise
// (deals.callback_at, the single source of truth — set by the 🕐 Call back
// button, cleared by "reached") is mirrored as a GHL appointment assigned to
// the deal's closer, with GHL-native reminders (assignedUser, inApp+email,
// 15 min before) configured on the calendar itself.
//
// WHAT EACH SWEEP DOES (per deal with a callback or a lingering event):
//   • callback set/changed → upsert the appointment (POST, or PUT on the stored
//     event id; a 404 on PUT means someone deleted it GHL-side → recreate).
//     GHL-side edits are OVERWRITTEN by design — the calendar is a view.
//   • callback cleared (closer reached them / rescheduled to nothing) → PUT
//     appointmentStatus "cancelled", then forget the event id.
//   • writes back: callback_ghl_event_id, callback_synced_at (the callback_at
//     INSTANT the event now reflects — drift is a pure column comparison),
//     callback_sync_error (recorded, NEVER thrown to the caller: a GHL outage
//     must never lose a callback; My Day reads callback_at directly and the
//     next sweep retries until healed).
//
// P1 GUARANTEE: nothing merchant-facing. toNotify:false on every appointment
// write, the calendar's contact notifications are disabled, and Google
// invitation emails are off. Merchant invites are Phase 3, per-send, default OFF.
//
// Callers:
//   • pg_cron every 5 min (?secret=<GHL webhook secret> + anon-key Bearer for
//     the gateway) — the reliability floor.
//   • Staff (user JWT, closer/admin/super_admin) — manual sweep / future
//     fire-and-forget single-deal invoke from logContactAttempt (pass deal_id).
//     A service-role bearer is NOT a session and fails the role check — use the
//     cron path for server-side calls (CLAUDE.md house rule #1).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  corsHeaders, serviceClient, getGhlConfig, ghlFetch, ghlErrorMessage,
  type GhlConfig,
} from "../_shared/ghl.ts";

const APPT_MINUTES = 15;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface SyncDeal {
  id: string;
  deal_number: string | null;
  callback_at: string | null;
  callback_ghl_event_id: string | null;
  callback_synced_at: string | null;
  ghl_contact_id: string | null;
  assigned_closer_id: string | null;
  customer: { business_name: string | null; first_name: string | null; last_name: string | null } | null;
}

function titleFor(d: SyncDeal): string {
  const who = d.customer?.business_name ||
    [d.customer?.first_name, d.customer?.last_name].filter(Boolean).join(" ") ||
    "merchant";
  return `Callback: ${who}${d.deal_number ? ` (${d.deal_number})` : ""}`;
}

/** GHL nests the created/updated appointment inconsistently; dig the id out. */
function apptId(data: unknown): string | null {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.id === "string") return d.id;
  for (const k of ["appointment", "event"]) {
    const inner = d[k] as Record<string, unknown> | undefined;
    if (inner && typeof inner.id === "string") return inner.id;
  }
  return null;
}

/** Persist per-deal sync state. Best-effort writes are BANNED silent — log loud. */
async function writeBack(db: SupabaseClient, dealId: string, patch: Record<string, unknown>) {
  const { error } = await db.from("deals").update(patch).eq("id", dealId);
  if (error) console.error("[callback-sync] deals write-back FAILED", JSON.stringify({ dealId, patch, error: error.message }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const db: SupabaseClient = serviceClient();
  const url = new URL(req.url);

  // ── Auth: trusted cron (shared secret) OR a signed-in staff user ──
  // (Mirrors synergy-reconcile exactly.)
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
  try { payload = (await req.json()) as Record<string, unknown>; } catch { /* cron may POST no body */ }
  // Single-deal mode (the P2 instant-invoke hook): sweep just this deal, same logic.
  const onlyDealId = typeof payload.deal_id === "string" ? payload.deal_id
    : url.searchParams.get("deal_id") ?? null;

  // The calendar id is config, not code (platform_settings.callback_calendar).
  const { data: setting, error: settingErr } = await db
    .from("platform_settings").select("value").eq("key", "callback_calendar").maybeSingle();
  const calendarId = (setting?.value as { internal_calendar_id?: string } | null)?.internal_calendar_id;
  if (settingErr || !calendarId) {
    return json({ error: `callback_calendar setting missing: ${settingErr?.message ?? "no internal_calendar_id"}` }, 502);
  }

  let cfg: GhlConfig;
  try { cfg = await getGhlConfig(db); }
  catch (e) { return json({ error: `GHL not configured: ${e instanceof Error ? e.message : String(e)}` }, 502); }

  // ── Candidates: any deal with a callback to project OR a lingering event ──
  // (partial-index-backed; the set is tiny). Drift is decided below in code:
  // callback_at !== callback_synced_at, compared as instants.
  let q = db.from("deals")
    .select(`
      id, deal_number, callback_at, callback_ghl_event_id, callback_synced_at,
      ghl_contact_id, assigned_closer_id,
      customer:customers!customer_id ( business_name, first_name, last_name )
    `)
    .or("callback_at.not.is.null,callback_ghl_event_id.not.is.null");
  if (onlyDealId) q = q.eq("id", onlyDealId);
  const { data: rows, error: rowsErr } = await q;
  if (rowsErr) return json({ error: `deals query failed: ${rowsErr.message}` }, 500);
  const deals = (rows ?? []) as unknown as SyncDeal[];

  // Closer → GHL user mapping (nullable by design; unmapped books unassigned).
  const { data: closerRows } = await db.from("closers")
    .select("user_id, ghl_user_id").not("ghl_user_id", "is", null);
  const ghlUserByProfile = new Map<string, string>(
    (closerRows ?? []).map((c) => [c.user_id as string, c.ghl_user_id as string]),
  );

  const summary = { swept: deals.length, created: 0, updated: 0, cancelled: 0, skipped: 0, failed: [] as { deal: string; error: string }[] };

  for (const d of deals) {
    const label = d.deal_number ?? d.id;
    try {
      // ── CLEARED: callback gone (reached / unset) but an event lingers → cancel ──
      if (!d.callback_at) {
        if (!d.callback_ghl_event_id) { summary.skipped++; continue; }
        const res = await ghlFetch(cfg, "PUT", `/calendars/events/appointments/${d.callback_ghl_event_id}`, {
          appointmentStatus: "cancelled",
          toNotify: false,
        });
        // 404 = already gone GHL-side; that IS the desired end state.
        if (!res.ok && res.status !== 404) {
          const msg = `cancel failed: ${ghlErrorMessage(res.error)}`;
          await writeBack(db, d.id, { callback_sync_error: msg });
          summary.failed.push({ deal: label, error: msg });
          continue;
        }
        await writeBack(db, d.id, { callback_ghl_event_id: null, callback_synced_at: null, callback_sync_error: null });
        summary.cancelled++;
        continue;
      }

      // ── IN SYNC: the event already reflects this exact instant → nothing to do ──
      if (
        d.callback_ghl_event_id && d.callback_synced_at &&
        Date.parse(d.callback_synced_at) === Date.parse(d.callback_at)
      ) { summary.skipped++; continue; }

      // ── SET / CHANGED: upsert ──
      if (!d.ghl_contact_id) {
        // Can't book without a contact (contactId is required). My Day still
        // covers the callback; record why and move on. (17/17 open deals have one.)
        await writeBack(db, d.id, { callback_sync_error: "no ghl contact" });
        summary.failed.push({ deal: label, error: "no ghl contact" });
        continue;
      }

      const startMs = Date.parse(d.callback_at);
      const body: Record<string, unknown> = {
        calendarId,
        locationId: cfg.locationId,
        contactId: d.ghl_contact_id,
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(startMs + APPT_MINUTES * 60_000).toISOString(),
        title: titleFor(d),
        appointmentStatus: "confirmed",
        // A 4pm callback books at 4pm, whatever the slot grid thinks.
        ignoreFreeSlotValidation: true,
        ignoreDateRange: true,
        // P1: nothing merchant-facing, ever. Reminders are calendar-native.
        toNotify: false,
      };
      const ghlUser = d.assigned_closer_id ? ghlUserByProfile.get(d.assigned_closer_id) : undefined;
      if (ghlUser) body.assignedUserId = ghlUser;

      let eventId = d.callback_ghl_event_id;
      let action: "created" | "updated";
      if (eventId) {
        // Duplicate protection: a changed time UPDATES the existing event.
        const res = await ghlFetch(cfg, "PUT", `/calendars/events/appointments/${eventId}`, body);
        if (res.ok) {
          action = "updated";
        } else if (res.status === 404) {
          // Deleted GHL-side — the projection recreates it.
          const created = await ghlFetch(cfg, "POST", "/calendars/events/appointments", body);
          if (!created.ok) throw new Error(`recreate failed: ${ghlErrorMessage(created.error)}`);
          eventId = apptId(created.data);
          action = "created";
        } else {
          throw new Error(`update failed: ${ghlErrorMessage(res.error)}`);
        }
      } else {
        const created = await ghlFetch(cfg, "POST", "/calendars/events/appointments", body);
        if (!created.ok) throw new Error(`create failed: ${ghlErrorMessage(created.error)}`);
        eventId = apptId(created.data);
        action = "created";
      }
      if (!eventId) throw new Error("GHL returned no appointment id");

      await writeBack(db, d.id, {
        callback_ghl_event_id: eventId,
        callback_synced_at: d.callback_at, // the instant the event NOW reflects
        callback_sync_error: null,
      });
      summary[action]++;
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await writeBack(db, d.id, { callback_sync_error: msg });
      summary.failed.push({ deal: label, error: msg });
    }
  }

  console.log("[callback-sync] sweep", JSON.stringify(summary));
  return json({ ok: true, ...summary });
});
