// dnd-enforce — the GHL half of "a do-not-contact flag actually closes things".
//
// ── WHY ──────────────────────────────────────────────────────────────────────
// 2026-09-04 audit: 19 pipeline deals sat under DND chips. The flag writers
// (Playbook DND button, SMS STOP trigger, WAVV do-not-contact drain) each did
// PART of the job — some set GHL contact DND but left the deal open, the SMS
// STOP trigger suppressed locally but left GHL callable (a setter could still
// dial the merchant from VibeReach after they texted STOP). The durable rule is
// now enforced in ONE place: a DB trigger on customers.do_not_contact
// (false→true) kills the customer's open deals locally AND calls this function
// via pg_net to make GHL agree. Every writer — button, STOP, drain, manual SQL —
// goes through the same trigger, so the enforcement cannot be forgotten again.
//
// ── WHAT IT DOES ─────────────────────────────────────────────────────────────
// POST { ghl_contact_id } →
//   1. PUT /contacts/{id} { dnd: true }  — the suppression WAVV/LeadConnector
//      actually honors (no calls, no texts). Idempotent.
//   2. GET /opportunities/search?contact_id → PUT status "lost" on every opp
//      still "open" (won/abandoned/lost are left alone — never rewrite history).
// A receipt lands in ghl_event_hook_log (type "dnd_enforce") either way, so
// enforcement is observable on /admin/sync-log like every other push event.
//
// Every outcome except failed auth returns 2xx — pg_net fire-and-forget callers
// must never see a retryable error for "contact had no opps". Failures are
// recorded in the receipt (ok:false + reason), not thrown.
//
// Auth: shared secret only (?secret= / x-ghl-secret vs get_ghl_config()'s
// webhook_secret), same fail-closed gate as ghl-event-hook. verify_jwt=false at
// the gateway — the caller is a Postgres trigger, which has no user JWT.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient, getGhlConfig, ghlFetch } from "../_shared/ghl.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();
  const url = new URL(req.url);

  // ── Auth (the ONLY non-2xx path) ──
  const provided = url.searchParams.get("secret") ?? req.headers.get("x-ghl-secret") ?? "";
  const { data: gc } = await db.rpc("get_ghl_config");
  const expected = (gc?.webhook_secret as string | undefined) ?? Deno.env.get("GHL_WEBHOOK_SECRET") ?? "";
  if (!expected || provided !== expected) return json({ error: "forbidden" }, 403);

  const actions: Record<string, unknown> = {};
  let ok = false;
  let contactId: string | null = null;

  const finish = async (status = 200) => {
    const { error } = await db.from("ghl_event_hook_log").insert({
      type: "dnd_enforce", contact_id: contactId, actions, ok,
    });
    if (error) console.error("[dnd-enforce] receipt log insert failed:", error.message);
    return json({ ok, contact_id: contactId, ...actions }, status);
  };

  try {
    let body: { ghl_contact_id?: string } = {};
    try { body = await req.json(); } catch { /* fall through to the no-contact receipt */ }
    contactId = (body.ghl_contact_id ?? "").trim() || null;
    if (!contactId) {
      actions.reason = "no ghl_contact_id — nothing GHL-side to enforce (local suppression already applied by the trigger)";
      ok = true; // a customer with no GHL contact is fully handled locally
      return await finish();
    }

    const cfg = await getGhlConfig(db);

    // 1) Durable dialer suppression on the contact. Idempotent.
    const dndRes = await ghlFetch(cfg, "PUT", `/contacts/${contactId}`, { dnd: true });
    actions.dnd_set = dndRes.ok;
    if (!dndRes.ok) actions.dnd_error = `${dndRes.status}: ${dndRes.error ?? "unknown"}`;

    // 2) Close every still-open opportunity. Terminal opps are never touched.
    const od = await ghlFetch<{ opportunities?: Array<{ id: string; status: string }> }>(
      cfg, "GET", `/opportunities/search?location_id=${cfg.locationId}&contact_id=${contactId}`,
    );
    if (!od.ok) {
      actions.opp_search_error = `${od.status}: ${od.error ?? "unknown"}`;
    } else {
      const open = (od.data?.opportunities ?? []).filter((o) => o.status === "open");
      let closed = 0, failed = 0;
      for (const o of open) {
        const r = await ghlFetch(cfg, "PUT", `/opportunities/${o.id}`, { status: "lost" });
        if (r.ok) closed++; else failed++;
      }
      actions.opps_open = open.length;
      actions.opps_closed = closed;
      if (failed) actions.opps_failed = failed;
    }

    ok = actions.dnd_set === true && !actions.opp_search_error && !actions.opps_failed;
    return await finish();
  } catch (e) {
    actions.reason = e instanceof Error ? e.message : String(e);
    return await finish();
  }
});
