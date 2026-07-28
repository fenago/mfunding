// plaid-webhook — Plaid tells us when a connected bank's data changes.
//
// verify_jwt = false (Plaid can't send a Supabase JWT). Auth is a fail-closed shared
// secret in the query string (?secret=<GHL webhook secret>), the SAME gate the other
// webhook/cron paths use — the webhook URL registered with Plaid at link time carries
// it. Every event is logged to plaid_events for observability.
//
// Handled:
//   · TRANSACTIONS (SYNC_UPDATES_AVAILABLE / DEFAULT_UPDATE / HISTORICAL_UPDATE /
//     INITIAL_UPDATE) → fire plaid-pull for the item (fresh transactions + statements).
//   · ITEM (ERROR / PENDING_EXPIRATION / USER_PERMISSION_REVOKED / LOGIN_REPAIRED) →
//     update plaid_items.status so the UI can show "reconnect".
//   · STATEMENTS (STATEMENTS_REFRESH_COMPLETE) → fire plaid-pull to download PDFs.
//
// Compliance: internal only. No merchant-facing copy.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, serviceClient } from "../_shared/ghl.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();
  const url = new URL(req.url);

  // ── Fail-closed secret gate ──
  const providedSecret = url.searchParams.get("secret") ?? "";
  const { data: gc } = await db.rpc("get_ghl_config");
  const expected = (gc?.webhook_secret as string | undefined) ?? "";
  if (!expected || providedSecret !== expected) return json({ error: "forbidden" }, 403);

  let evt: Record<string, unknown>;
  try { evt = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const webhookType = (evt.webhook_type as string | undefined) ?? null;
  const webhookCode = (evt.webhook_code as string | undefined) ?? null;
  const itemId = (evt.item_id as string | undefined) ?? null;

  // Resolve our row (if any) for linking + status updates.
  let plaidItemPk: string | null = null;
  if (itemId) {
    const { data: row } = await db.from("plaid_items").select("id").eq("item_id", itemId).maybeSingle();
    plaidItemPk = (row?.id as string | null) ?? null;
  }

  // ── Always log the event first (observability) ──
  const { data: logged } = await db.from("plaid_events").insert({
    item_id: itemId, plaid_item_pk: plaidItemPk,
    webhook_type: webhookType, webhook_code: webhookCode, payload: evt, handled: false,
  }).select("id").maybeSingle();
  const eventId = logged?.id as string | undefined;

  let action = "logged";

  // ── Route ──
  const shouldPull =
    (webhookType === "TRANSACTIONS" && ["SYNC_UPDATES_AVAILABLE", "DEFAULT_UPDATE", "HISTORICAL_UPDATE", "INITIAL_UPDATE"].includes(webhookCode ?? "")) ||
    (webhookType === "STATEMENTS" && webhookCode === "STATEMENTS_REFRESH_COMPLETE");

  if (shouldPull && itemId) {
    action = "pull-triggered";
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
      // Fire-and-forget; plaid-pull is idempotent (upsert on transaction_id, dedupe on statement_id).
      fetch(`${supabaseUrl}/functions/v1/plaid-pull?secret=${encodeURIComponent(expected)}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(anon ? { Authorization: `Bearer ${anon}` } : {}) },
        body: JSON.stringify({ item_id: itemId }),
      }).catch(() => {});
    } catch { /* best-effort */ }
  } else if (webhookType === "ITEM" && plaidItemPk) {
    const err = evt.error as { error_code?: string; error_message?: string } | null;
    if (["ERROR", "PENDING_DISCONNECT", "USER_PERMISSION_REVOKED", "USER_ACCOUNT_REVOKED"].includes(webhookCode ?? "")) {
      action = "item-marked-error";
      await db.from("plaid_items").update({
        status: webhookCode === "USER_PERMISSION_REVOKED" || webhookCode === "USER_ACCOUNT_REVOKED" ? "revoked" : "error",
        error_code: err?.error_code ?? webhookCode, error_message: err?.error_message ?? null,
        updated_at: new Date().toISOString(),
      }).eq("id", plaidItemPk);
    } else if (webhookCode === "LOGIN_REPAIRED") {
      action = "item-recovered";
      await db.from("plaid_items").update({ status: "active", error_code: null, error_message: null, updated_at: new Date().toISOString() }).eq("id", plaidItemPk);
    }
  }

  if (eventId) await db.from("plaid_events").update({ handled: true, note: action }).eq("id", eventId);

  return json({ ok: true, action });
});
